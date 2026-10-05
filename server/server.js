// Kastrava license/Payment server. Serves the site + payment+license API.
//   npm run server            -> dev mode (no Razorpay keys needed)
//   RAZORPAY_KEY_ID=.. RAZORPAY_KEY_SECRET=.. ADMIN_TOKEN=.. npm run server
// Env (also readable from server/.env):
//   PORT                  default 8787
//   BIND_HOST             interface to bind, default 127.0.0.1 (0.0.0.0 for a public/bare deployment)
//   KAS_HOST              public base URL used in responses, default http://127.0.0.1:8787
//   PRICE_INR             one-time price per 34-day license, default 248
//   PERIOD_DAYS           license validity days per payment, default 34
//   GRACE_DAYS            days past expiry before access is revoked, default 3
//   RAZORPAY_WEBHOOK_SECRET  secret for /api/webhook signature verification
//   LICENSE_YEARS         legacy fallback for old one-time keys, default 10
//   DATA_DIR              store location, default ../data
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

require('./lib/env').loadEnv()
const sign = require('./lib/sign')
const razorpay = require('./lib/razorpay')

const port = parseInt(process.env.PORT || '8787', 10)
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1'
const HOST = process.env.KAS_HOST || 'http://127.0.0.1:' + port
const PRICE_INR = parseInt(process.env.PRICE_INR || '248', 10)
const PERIOD_DAYS = parseInt(process.env.PERIOD_DAYS || '34', 10)
const GRACE_DAYS = parseInt(process.env.GRACE_DAYS || '3', 10)
const LICENSE_YEARS = parseInt(process.env.LICENSE_YEARS || '10', 10)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''
const SITE_DIR = path.join(__dirname, '..', 'site')

const keys = sign.ensureKeys()
const store = new (require('./lib/store'))(path.join(DATA_DIR, 'db.json'))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.deb': 'application/vnd.debian.binary-package',
  '.zst': 'application/zstd',
  '.gz': 'application/gzip'
}

function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
    'Access-Control-Max-Age': '600'
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy() })
    req.on('end', () => {
      let parsed = {}
      try { parsed = JSON.parse(data || '{}') } catch {}
      resolve({ raw: data, parsed })
    })
    req.on('error', () => resolve({ raw: data, parsed: {} }))
  })
}

function licenseExpirySeconds(lic) {
  let end = null
  if (lic && lic.expires_at) end = Math.floor(new Date(lic.expires_at).getTime() / 1000)
  // Fall back to the subscription's period end (covers licenses issued
  // before the expiry was seeded).
  if (!end && lic && lic.subscription_id) {
    const sub = store.getSubscription(lic.subscription_id)
    if (sub && sub.current_end) end = Math.floor(new Date(sub.current_end).getTime() / 1000)
  }
  if (!end) return null
  return end + GRACE_DAYS * 86400
}

function makeLicensePayload(key, machineId) {
  const now = Math.floor(Date.now() / 1000)
  const lic = store.getLicense(key)
  const exp = licenseExpirySeconds(lic)
  const payload = {
    sub: key,
    mid: (machineId || '').toUpperCase(),
    product: 'kastrava-premium',
    edition: 'premium',
    iss: 'kastrasoft',
    iat: now,
    // Subscription keys expire at period end + grace; legacy one-time
    // keys (no expires_at in store) keep the long LICENSE_YEARS lifetime.
    exp: exp || now + LICENSE_YEARS * 365 * 24 * 3600
  }
  if (lic && lic.expires_at) payload.sub_end = Math.floor(new Date(lic.expires_at).getTime() / 1000)
  return payload
}

// Signed purchase receipt: Ed25519 over the exact payload with the same
// license-signing key. Anyone can verify it (public key never leaves the
// server here — /api/receipt/verify does it), nobody can forge it.
function makeReceipt(orderId, machineRaw) {
  const order = store.getOrder(orderId)
  if (!order) return null
  const key = store.keyForOrder(orderId)
  const lic = key ? store.getLicense(key) : null
  const machine = String(machineRaw || (order && order.machine_id) || '').trim().toUpperCase() || null
  const receipt = {
    kind: 'kastrava-receipt',
    version: 1,
    order_id: orderId,
    payment_id: order.payment_id || null,
    key: key,
    machine_id: machine,
    amount_paise: PRICE_INR * 100,
    currency: 'INR',
    plan: 'premium-34d',
    product: 'kastrava-premium',
    iss: 'kastrasoft',
    iat: Math.floor(Date.now() / 1000),
    exp: licenseExpirySeconds(lic) || null,
    paid_thru: (lic && lic.expires_at) || null
  }
  return { receipt, receipt_sig: sign.signPayload(receipt, keys.privateKey) }
}

function adminOk(req) {
  const t = (req.headers['x-admin-token'] || '').toString()
  return !!ADMIN_TOKEN && t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN))
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html'
  let p = path.normalize(path.join(SITE_DIR, pathname))
  if (p !== SITE_DIR && !p.startsWith(SITE_DIR + path.sep)) return json(res, 403, { error: 'forbidden' })
  fs.stat(p, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: 'not_found' })
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'X-Content-Type-Options': 'nosniff'
    })
    fs.createReadStream(p).pipe(res)
  })
}

// One-time payment settlement. Called by /api/verify (checkout callback) and
// the payment.captured webhook — idempotent, so both can race safely:
//   - never paid before   -> mint a key with a fresh 34-day expiry
//   - paid with a machine code that already has a license -> EXTEND that key
//     from max(now, expiry) + PERIOD_DAYS and return the SAME key, so renewal
//     needs no new activation; the app picks it up on its next re-activate.
function finalizePayment(orderId, paymentId, machineIdRaw) {
  const order = store.getOrder(orderId)
  store.markPaid(orderId, paymentId)
  const machine = String(machineIdRaw || (order && order.machine_id) || '').trim().toUpperCase()
  let key = store.keyForOrder(orderId)
  let renewed = false
  if (!key) {
    const existing = machine ? store.licenseForMachine(machine) : null
    if (existing && existing.status === 'activated') {
      // Renewal: same machine keeps its key, expiry extends from today (or
      // from its old end if still in the future — tightening is never applied).
      key = existing.key
      const base = existing.expires_at
        ? Math.max(Date.now(), new Date(existing.expires_at).getTime())
        : Date.now()
      store.extendLicense(key, new Date(base + PERIOD_DAYS * 86400000).toISOString())
      store.setLicenseOrder(key, orderId)
      renewed = true
    } else {
      key = sign.makeLicenseKey()
      store.issueLicense(key, orderId, null, new Date(Date.now() + PERIOD_DAYS * 86400000).toISOString())
    }
  }
  return { key, renewed }
}

async function handlePost(req, res, pathname) {
  const { raw, parsed: body } = await readBody(req)

  if (pathname === '/api/order') {
    try {
      const o = await razorpay.createOrder(PRICE_INR * 100)
      const meta = {}
      if (typeof body.name === 'string' && body.name) meta.name = body.name
      if (typeof body.email === 'string' && body.email) meta.email = body.email
      if (typeof body.machine_id === 'string' && body.machine_id.trim()) meta.machine_id = body.machine_id.trim().toUpperCase()
      store.createOrder(o.order_id, meta)
      return json(res, 200, { order_id: o.order_id, amount: o.amount, currency: o.currency, key_id: o.key_id, dev: !!o.dev })
    } catch (e) {
      return json(res, 500, { error: 'order_failed', msg: String(e.message || e) })
    }
  }

  if (pathname === '/api/verify') {
    const { order_id, payment_id, signature, machine_id } = body
    if (!order_id || !payment_id) return json(res, 400, { error: 'bad_request' })
    const order = store.getOrder(order_id)
    if (!order) return json(res, 404, { error: 'order_not_found' })
    if (order.status === 'paid') {
      const k = store.keyForOrder(order_id)
      if (k) {
        const rc = makeReceipt(String(order_id), machine_id)
        return json(res, 200, { ok: true, already_paid: true, key: k,
          receipt: rc && rc.receipt, receipt_sig: rc && rc.receipt_sig })
      }
    }
    if (!razorpay.verifySignature(String(order_id), String(payment_id), String(signature || ''))) {
      return json(res, 403, { error: 'bad_signature', msg: 'Payment could not be verified.' })
    }
    const r = finalizePayment(String(order_id), String(payment_id), machine_id)
    const rc = makeReceipt(String(order_id), machine_id)
    return json(res, 200, { ok: true, key: r.key, renewed: r.renewed, already_paid: false,
      receipt: rc && rc.receipt, receipt_sig: rc && rc.receipt_sig })
  }

  // ---- one-time payments: webhook safety net (payment.captured) ----

  // Razorpay webhook safety net. The checkout callback normally settles the
  // order in /api/verify; this catches payments whose tab closed first.
  // Event: payment.captured (entity.order_id links to our order).
  if (pathname === '/api/webhook') {
    if (!razorpay.verifyWebhookSignature(raw, (req.headers['x-razorpay-signature'] || '').toString())) {
      return json(res, 400, { error: 'bad_signature', msg: 'Webhook signature verification failed.' })
    }
    try {
      const ent = body.payload && body.payload.payment && body.payload.payment.entity
      if (ent && ent.order_id && body.event === 'payment.captured') {
        const order = store.getOrder(String(ent.order_id))
        if (order && order.status !== 'paid') {
          const r = finalizePayment(String(ent.order_id), String(ent.id || ''), order.machine_id || '')
          console.log('[webhook] payment.captured', String(ent.order_id), r.renewed ? 'renewal' : 'new key', r.key)
        }
      }
    } catch (e) {
      console.error('[webhook] error:', e)
    }
    return json(res, 200, { ok: true })
  }

  if (pathname === '/api/receipt/verify') {
    const { receipt, receipt_sig } = body
    if (!receipt || !receipt_sig) return json(res, 400, { error: 'bad_request' })
    let valid = false
    try { valid = sign.verifyPayload(receipt, String(receipt_sig), keys.publicKey) } catch {}
    if (!valid) return json(res, 200, { ok: true, valid: false })
    const lic = receipt.key ? store.getLicense(receipt.key) : null
    return json(res, 200, { ok: true, valid: true, receipt,
      key_status: lic ? lic.status : 'unknown',
      key_expires_at: lic ? (lic.expires_at || null) : null })
  }

  // Re-issue a signed receipt for a past order. Public, but requires BOTH
  // the order ID and the license key it minted — knowing only one gets nothing.
  if (pathname === '/api/receipt/reissue') {
    const orderId = String(body.order_id || '').trim()
    const key = String(body.key || '').trim().toUpperCase()
    if (!orderId || !key) return json(res, 400, { error: 'bad_request' })
    const order = store.getOrder(orderId)
    if (!order || order.status !== 'paid') return json(res, 404, { error: 'order_not_found' })
    if (store.keyForOrder(orderId) !== key) return json(res, 403, { error: 'key_mismatch' })
    const rc = makeReceipt(orderId)
    if (!rc) return json(res, 404, { error: 'order_not_found' })
    return json(res, 200, { ok: true, key, receipt: rc.receipt, receipt_sig: rc.receipt_sig })
  }

  // Stop Premium without refund: the bound machine ends its own license.
  // No money moves (Razorpay is never touched). Cancelled keys cannot be
  // re-activated or renewed; paying again mints a fresh key.
  if (pathname === '/api/cancel') {
    const key = String(body.key || '').trim().toUpperCase()
    const machineId = String(body.machine_id || '').trim().toUpperCase()
    if (!key || !machineId) return json(res, 400, { error: 'bad_request' })
    const lic = store.getLicense(key)
    if (!lic) return json(res, 404, { error: 'invalid_key', msg: 'No such license key.' })
    if (lic.status !== 'activated' && lic.status !== 'issued') {
      return json(res, 400, { error: 'not_active', msg: 'This license is not active.' })
    }
    // Fresh keys are not bound yet (binding happens at activation), so fall
    // back to the checkout machine recorded on the order.
    const order = store.getOrder(lic.order_id)
    const bound = ((lic.machine_id || (order && order.machine_id)) || '').toUpperCase()
    if (bound !== machineId) {
      return json(res, 403, { error: 'machine_mismatch', msg: 'Only the bound machine can stop this license.' })
    }
    lic.status = 'cancelled'
    lic.cancelled_at = new Date().toISOString()
    store.save()
    return json(res, 200, { ok: true, key })
  }

  if (pathname === '/api/admin/issue') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' })
    const machine = String(body.machine_id || '').trim().toUpperCase() || null
    const note = String(body.note || '').slice(0, 200)
    const orderId = 'admin_' + Date.now().toString(36)
    store.createOrder(orderId, { provider: 'manual', machine_id: machine, note })
    store.markPaid(orderId, 'manual')
    const key = sign.makeLicenseKey()
    const expires = new Date(Date.now() + PERIOD_DAYS * 86400000).toISOString()
    store.issueLicense(key, orderId, null, expires)
    if (machine) store.bindLicense(key, machine)
    const rc = makeReceipt(orderId)
    return json(res, 200, { ok: true, key, order_id: orderId, expires_at: expires,
      receipt: rc && rc.receipt, receipt_sig: rc && rc.receipt_sig })
  }

  // Full order dossier for the admin panel: order + license + a freshly
  // signed receipt. Powers PDF cross-checks (extracted PDF fields are
  // compared against this server truth).
  if (pathname === '/api/admin/order') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' })
    const orderId = String(body.order_id || '').trim()
    const order = store.getOrder(orderId)
    if (!order) return json(res, 404, { error: 'order_not_found' })
    const key = store.keyForOrder(orderId)
    const lic = key ? store.getLicense(key) : null
    const rc = makeReceipt(orderId)
    return json(res, 200, { ok: true, order,
      license: lic ? { key: lic.key, status: lic.status, machine_id: lic.machine_id,
        expires_at: lic.expires_at, issued_at: lic.issued_at } : null,
      receipt: rc && rc.receipt, receipt_sig: rc && rc.receipt_sig })
  }

  if (pathname === '/api/admin/extend') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' })
    const key = String(body.key || '').trim().toUpperCase()
    const days = Math.floor(Number(body.days) || 0)
    const lic = store.getLicense(key)
    if (!lic) return json(res, 404, { error: 'invalid_key' })
    if (!(days >= 1 && days <= 3650)) return json(res, 400, { error: 'bad_request' })
    const base = lic.expires_at ? Math.max(Date.now(), new Date(lic.expires_at).getTime()) : Date.now()
    const expires = new Date(base + days * 86400000).toISOString()
    store.extendLicense(key, expires)
    if (lic.status === 'revoked' || lic.status === 'cancelled') {
      lic.status = 'issued'
      delete lic.revoked_at
      delete lic.cancelled_at
      store.save()
    }
    return json(res, 200, { ok: true, key, expires_at: expires })
  }

  if (pathname === '/api/admin/rebind') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' })
    const key = String(body.key || '').trim().toUpperCase()
    const machine = String(body.machine_id || '').trim().toUpperCase()
    const lic = store.getLicense(key)
    if (!lic) return json(res, 404, { error: 'invalid_key' })
    if (!machine) return json(res, 400, { error: 'bad_request' })
    lic.machine_id = machine
    lic.rebound_at = new Date().toISOString()
    store.save()
    return json(res, 200, { ok: true, key, machine_id: machine })
  }

  if (pathname === '/api/admin/revoke') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' })
    const key = String(body.key || '').trim().toUpperCase()
    const lic = store.getLicense(key)
    if (!lic) return json(res, 404, { error: 'invalid_key' })
    lic.status = 'revoked'
    lic.revoked_at = new Date().toISOString()
    store.save()
    return json(res, 200, { ok: true, key })
  }

  if (pathname === '/api/activate') {
    const key = String(body.key || '').trim().toUpperCase()
    const machineId = String(body.machine_id || '').trim().toUpperCase()
    if (!key || !machineId) return json(res, 400, { error: 'bad_request' })
    const lic = store.getLicense(key)
    if (!lic) return json(res, 404, { error: 'invalid_key', msg: 'No such license key.' })
    if (lic.status === 'revoked') {
      return json(res, 403, { error: 'license_revoked', msg: 'This license was revoked. Contact support.' })
    }
    if (lic.status === 'cancelled') {
      return json(res, 403, { error: 'license_cancelled', msg: 'This license was cancelled. Buy again to restart Premium.' })
    }
    if (lic.status === 'activated' && lic.machine_id !== machineId) {
      return json(res, 403, { error: 'machine_mismatch', msg: 'This key is already activated on another machine.' })
    }
    if (lic.status === 'activated') {
      // Same machine re-activating: just re-sign, idempotent.
      const payload = makeLicensePayload(key, machineId)
      const sig = sign.signPayload(payload, keys.privateKey)
      return json(res, 200, { ok: true, license: { key, payload, sig }, status: 'renewed' })
    }
    store.bindLicense(key, machineId)
    const payload = makeLicensePayload(key, machineId)
    const sig = sign.signPayload(payload, keys.privateKey)
    return json(res, 200, { ok: true, license: { key, payload, sig }, status: 'activated' })
  }

  if (pathname === '/api/admin/release') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' })
    const lic = store.releaseLicense(String(body.key || '').trim().toUpperCase())
    if (!lic) return json(res, 404, { error: 'invalid_key' })
    return json(res, 200, { ok: true })
  }

  if (pathname === '/api/admin/markpaid') {
    if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' })
    const order = store.getOrder(String(body.order_id || ''))
    if (!order) return json(res, 404, { error: 'order_not_found' })
    const r = finalizePayment(String(body.order_id), String(body.payment_id || 'admin'), body.machine_id || order.machine_id || '')
    return json(res, 200, { ok: true, key: r.key, renewed: r.renewed })
  }

  return json(res, 404, { error: 'not_found' })
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
      'Access-Control-Max-Age': '600'
    })
    return res.end()
  }

  const u = new URL(req.url, HOST + '/')
  const pathname = u.pathname

  if (req.method === 'POST') return handlePost(req, res, pathname)

  // HEAD is served like GET (same headers incl. Content-Length; Node
  // suppresses the response body automatically), so download managers and
  // `curl -I` probes get a real 200 instead of 405.
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/api/health') {
      return json(res, 200, { ok: true, dev: razorpay.isDev(), host: HOST, price: PRICE_INR, period_days: PERIOD_DAYS, grace_days: GRACE_DAYS, version: '101.3.0', codename: 'Starship Wonders' })
    }
    if (pathname === '/api/admin/list') {
      if (!adminOk(req)) return json(res, 401, { error: 'unauthorized' })
      return json(res, 200, store.all())
    }
    return serveStatic(req, res, pathname)
  }

  return json(res, 405, { error: 'method_not_allowed' })
})

server.listen(port, BIND_HOST, () => {
  console.log('[kastrava-licenses] listening on http://' + BIND_HOST + ':' + port)
  console.log('[kastrava-licenses] host=' + HOST + ' price=INR ' + PRICE_INR + '/' + PERIOD_DAYS + 'd one-time grace=' + GRACE_DAYS + 'd dev=' + razorpay.isDev())
})