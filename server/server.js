// Kastrava license/Payment server. Serves the site + payment+license API.
//   npm run server            -> dev mode (no Razorpay keys needed)
//   RAZORPAY_KEY_ID=.. RAZORPAY_KEY_SECRET=.. ADMIN_TOKEN=.. npm run server
// Env (also readable from server/.env):
//   PORT                  default 8787
//   BIND_HOST             interface to bind, default 127.0.0.1 (0.0.0.0 for a public/bare deployment)
//   KAS_HOST              public base URL used in responses, default http://127.0.0.1:8787
//   PRICE_INR             legacy fallback price (paise x100), default 248
//   PERIOD_DAYS           legacy fallback validity days, default 34
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
const DEVICE_LIMIT = 10
// Plans: one-time default, auto-renew optional. `legacy` keeps old
// builds working: no plan sent -> 34 days for INR 248, exactly as before.
const PLANS = {
  legacy: { usd: 2.8, inr: 248, days: 34, label: 'Legacy 34-day' },
  monthly: { usd: 7, inr: 670, days: 30, label: 'Monthly', interval: 'monthly' },
  daily: { usd: 2, inr: 190, days: 1, label: 'Daily', interval: 'daily' }
}
function planOf(name) {
  return PLANS[name] || PLANS.legacy
}

// Razorpay plan ids for auto-renew (created once, cached on disk).
function rzpPlanFile() { return path.join(DATA_DIR, 'plans.json') }
function rzpPlanIds() {
  try { return JSON.parse(fs.readFileSync(rzpPlanFile(), 'utf8')) } catch { return {} }
}
async function ensureRzpPlans() {
  const ids = rzpPlanIds()
  let changed = false
  // NOTE: Razorpay rejects daily intervals under 7, so auto-renew is
  // Monthly-only. Daily stays manual. The loop keeps working if that
  // ever changes upstream.
  for (const name of ['monthly', 'daily']) {
    try {
      const envId = process.env['RAZORPAY_PLAN_' + name.toUpperCase()]
      if (envId) { if (ids[name] !== envId) { ids[name] = envId; changed = true } continue }
      if (ids[name]) continue
      const plan = PLANS[name]
      const created = await razorpay.createPlan(plan.interval, plan.inr * 100, 'Kastrava Premium ' + plan.label)
      ids[name] = created.id
      changed = true
      console.log('[kastrava-licenses] razorpay plan created:', name, created.id)
    } catch (e) {
      console.error('[kastrava-licenses] plan ensure failed for', name + ':', String((e && e.message) || e))
    }
  }
  if (changed) {
    try {
      fs.mkdirSync(path.dirname(rzpPlanFile()), { recursive: true })
      fs.writeFileSync(rzpPlanFile(), JSON.stringify(ids, null, 2), { mode: 0o600 })
    } catch {}
  }
  return ids
}
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, Authorization',
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

function makeLicensePayload(key, machineId, accountEmail) {
  const now = Math.floor(Date.now() / 1000)
  const lic = store.getLicense(key)
  const exp = licenseExpirySeconds(lic)
  // v2 (account-bound): acc names the owning account, mid is the activating
  // device (informational — the 10-device cap is enforced server-side, not
  // in the signature). Field order is the signed canonical form: sub, acc,
  // mid, product, edition, iss, iat, exp, sub_end?. Apps must mirror it.
  // v1 (legacy machine-bound): no acc, mid enforced on-device as before.
  const payload = accountEmail ? { sub: key, acc: String(accountEmail).toLowerCase() } : { sub: key }
  payload.mid = (machineId || '').toUpperCase()
  payload.product = 'kastrava-premium'
  payload.edition = 'premium'
  payload.iss = 'kastrasoft'
  payload.iat = now
  // Subscription keys expire at period end + grace; legacy one-time
  // keys (no expires_at in store) keep the long LICENSE_YEARS lifetime.
  payload.exp = exp || now + LICENSE_YEARS * 365 * 24 * 3600
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
  const plan = planOf(order.plan)
  const receipt = {
    kind: 'kastrava-receipt',
    version: 1,
    order_id: orderId,
    payment_id: order.payment_id || null,
    key: key,
    machine_id: machine,
    amount_paise: order.amount_paise || plan.inr * 100,
    currency: 'INR',
    plan: 'premium-' + ((order.plan || 'legacy') === 'legacy' ? '34d' : order.plan),
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
function finalizePayment(orderId, paymentId, machineIdRaw, accountEmailRaw) {
  const order = store.getOrder(orderId)
  const plan = planOf(order && order.plan)
  store.markPaid(orderId, paymentId, (order && order.amount_paise) || plan.inr * 100)
  const machine = String(machineIdRaw || (order && order.machine_id) || '').trim().toUpperCase()
  const account = String(accountEmailRaw || (order && order.account_email) || '').trim().toLowerCase() || null
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
      store.extendLicense(key, new Date(base + plan.days * 86400000).toISOString())
      store.setLicenseOrder(key, orderId)
      if (account && !existing.account_email) store.setAccountEmail(key, account)
      renewed = true
    } else if (account) {
      // Account renewal: the account's newest live key extends (same key on
      // every device picks it up on next launch) — otherwise mint + assign.
      const cands = store.keysForAccount(account)
        .filter((l) => l.status === 'activated' || l.status === 'issued')
        .sort((a, b) => String(b.expires_at || '') < String(a.expires_at || '') ? -1 : 1)
      if (cands.length) {
        key = cands[0].key
        const base = cands[0].expires_at
          ? Math.max(Date.now(), new Date(cands[0].expires_at).getTime())
          : Date.now()
        store.extendLicense(key, new Date(base + plan.days * 86400000).toISOString())
        store.setLicenseOrder(key, orderId)
        renewed = true
      } else {
        key = sign.makeLicenseKey()
        store.issueLicense(key, orderId, null, new Date(Date.now() + plan.days * 86400000).toISOString())
        store.setAccountEmail(key, account)
      }
    } else {
      key = sign.makeLicenseKey()
      store.issueLicense(key, orderId, null, new Date(Date.now() + plan.days * 86400000).toISOString())
    }
  } else if (account) {
    const lic = store.getLicense(key)
    if (lic && !lic.account_email) store.setAccountEmail(key, account)
  }
  return { key, renewed, plan: (order && order.plan) || 'legacy' }
}

// ---- Kastrava accounts + zero-knowledge sync (module scope: the
// throttle map must survive across requests) ----
const AUTH_WINDOW_MS = 60000
const AUTH_MAX = 20
const authHits = new Map()

async function handlePost(req, res, pathname) {
  const { raw, parsed: body } = await readBody(req)

  if (pathname === '/api/order') {
    try {
      const planName = (body.plan === 'monthly' || body.plan === 'daily') ? body.plan : 'legacy'
      const plan = planOf(planName)
      const o = await razorpay.createOrder(plan.inr * 100)
      const meta = { plan: planName, amount_paise: plan.inr * 100 }
      if (typeof body.name === 'string' && body.name) meta.name = body.name
      if (typeof body.email === 'string' && body.email) meta.email = body.email
      if (typeof body.machine_id === 'string' && body.machine_id.trim()) meta.machine_id = body.machine_id.trim().toUpperCase()
      if (typeof body.account_token === 'string' && body.account_token) {
        const acc = store.getSessionAccount(body.account_token)
        if (acc) meta.account_email = acc.email
      }
      store.createOrder(o.order_id, meta)
      return json(res, 200, { order_id: o.order_id, amount: o.amount, currency: o.currency, key_id: o.key_id, dev: !!o.dev, plan: planName, plan_usd: plan.usd, plan_days: plan.days })
    } catch (e) {
      return json(res, 500, { error: 'order_failed', msg: String(e.message || e) })
    }
  }

  if (pathname === '/api/verify') {
    const { order_id, payment_id, signature, machine_id, account_token } = body
    if (!order_id || !payment_id) return json(res, 400, { error: 'bad_request' })
    const order = store.getOrder(order_id)
    if (!order) return json(res, 404, { error: 'order_not_found' })
    if (order.status === 'paid') {
      const k = store.keyForOrder(order_id)
      if (k) {
        const rc = makeReceipt(String(order_id), machine_id)
        const ord = store.getOrder(String(order_id))
        return json(res, 200, { ok: true, already_paid: true, key: k, plan: (ord && ord.plan) || 'legacy',
          receipt: rc && rc.receipt, receipt_sig: rc && rc.receipt_sig })
      }
    }
    if (!razorpay.verifySignature(String(order_id), String(payment_id), String(signature || ''))) {
      return json(res, 403, { error: 'bad_signature', msg: 'Payment could not be verified.' })
    }
    const vacc = account_token ? store.getSessionAccount(String(account_token)) : null
    const r = finalizePayment(String(order_id), String(payment_id), machine_id, vacc ? vacc.email : null)
    const rc = makeReceipt(String(order_id), machine_id)
    return json(res, 200, { ok: true, key: r.key, renewed: r.renewed, already_paid: false, plan: r.plan, plan_days: planOf(r.plan).days,
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
          const r = finalizePayment(String(ent.order_id), String(ent.id || ''), order.machine_id || '', order.account_email || '')
          console.log('[webhook] payment.captured', String(ent.order_id), r.renewed ? 'renewal' : 'new key', r.key)
        }
      }
      const subEnt = body.payload && body.payload.subscription && body.payload.subscription.entity
      if (subEnt && subEnt.id && String(body.event || '').startsWith('subscription.')) {
        const ev = body.event
        if (ev === 'subscription.activated') {
          const rec0 = store.getSubscription(subEnt.id)
          if (!rec0) store.createSubscription(subEnt.id, { plan: planNameForRzp(subEnt.plan_id), status: 'active' })
          else store.linkSubKey(subEnt.id, null, null, 'active')
          console.log('[webhook]', ev, subEnt.id)
        } else if (ev === 'subscription.charged') {
          const pay = (body.payload.payment && body.payload.payment.entity) || {}
          const rec1 = store.getSubscription(subEnt.id)
          const r = settleSubscription(subEnt.id, pay.id || null, (rec1 && rec1.account_email) || null, planNameForRzp(subEnt.plan_id))
          console.log('[webhook]', ev, subEnt.id, r.key)
        } else if (ev === 'subscription.cancelled' || ev === 'subscription.halted' || ev === 'subscription.completed') {
          store.linkSubKey(subEnt.id, null, null, 'cancelled')
          console.log('[webhook]', ev, subEnt.id)
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
    if (!key) return json(res, 400, { error: 'bad_request' })
    const lic = store.getLicense(key)
    if (!lic) return json(res, 404, { error: 'invalid_key', msg: 'No such license key.' })
    if (lic.status !== 'activated' && lic.status !== 'issued') {
      return json(res, 400, { error: 'not_active', msg: 'This license is not active.' })
    }
    // Account owners can stop their own keys from the dashboard (no machine
    // needed); otherwise the legacy bound-machine check applies.
    let ownerOk = false
    if (body.account_token) {
      const acc = store.getSessionAccount(String(body.account_token))
      ownerOk = !!(acc && lic.account_email === acc.email)
    }
    if (!ownerOk) {
      if (!machineId) return json(res, 400, { error: 'bad_request' })
      // Fresh keys are not bound yet (binding happens at activation), so fall
      // back to the checkout machine recorded on the order.
      const order = store.getOrder(lic.order_id)
      const bound = ((lic.machine_id || (order && order.machine_id)) || '').toUpperCase()
      if (bound !== machineId) {
        return json(res, 403, { error: 'machine_mismatch', msg: 'Only the bound machine can stop this license.' })
      }
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
    store.markPaid(orderId, 'manual', 0)
    const key = sign.makeLicenseKey()
    const issueDays = Math.min(Math.max(Math.floor(Number(body.days) || 30), 1), 36500)
    const expires = new Date(Date.now() + issueDays * 86400000).toISOString()
    store.issueLicense(key, orderId, null, expires)
    if (machine) store.bindLicense(key, machine)
    const rc = makeReceipt(orderId)
    return json(res, 200, { ok: true, key, order_id: orderId, expires_at: expires,
      receipt: rc && rc.receipt, receipt_sig: rc && rc.receipt_sig })
  }

  // Account device management: list keys+devices, free a device slot.
  if (pathname === '/api/account/devices' || pathname === '/api/account/device/remove') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    if (pathname === '/api/account/devices') {
      const keys = store.keysVisibleTo(acc.email).map(({ lic: l, shared, owner }) => ({
        key: l.key, status: l.status, expires_at: l.expires_at || null,
        shared: !!shared, owner: owner || null,
        shared_with: l.account_email === acc.email ? (l.shared_with || []) : undefined,
        devices_used: Object.keys(l.devices || {}).length, device_limit: DEVICE_LIMIT,
        devices: Object.entries(l.devices || {}).map(([id, d]) => ({
          id, name: (d && d.name) || null,
          first_seen: d && d.first_seen, last_seen: d && d.last_seen
        }))
      }))
      return json(res, 200, { ok: true, keys, device_limit: DEVICE_LIMIT })
    }
    const key = String(body.key || '').trim().toUpperCase()
    const lic = store.getLicense(key)
    if (!lic || lic.account_email !== acc.email) return json(res, 404, { error: 'invalid_key' })
    const left = store.removeDevice(key, String(body.machine_id || ''))
    return json(res, 200, { ok: true, key, devices_used: left })
  }

  // Per-key receipt for the account dashboard: signed receipt data plus
  // the devices currently using the key. Key owners only.
  if (pathname === '/api/account/key/receipt') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const key = String(body.key || '').trim().toUpperCase()
    const lic = store.getLicense(key)
    if (!lic || lic.account_email !== acc.email) return json(res, 404, { error: 'invalid_key' })
    if (!lic.order_id) return json(res, 404, { error: 'no_receipt' })
    const rc = makeReceipt(lic.order_id, null)
    if (!rc) return json(res, 404, { error: 'no_receipt' })
    return json(res, 200, { ok: true, key,
      receipt: rc.receipt, receipt_sig: rc.receipt_sig,
      expires_at: lic.expires_at || null, status: lic.status,
      devices_used: Object.keys(lic.devices || {}).length, device_limit: DEVICE_LIMIT,
      devices: Object.entries(lic.devices || {}).map(([id, d]) => ({
        id, name: (d && d.name) || null,
        first_seen: d && d.first_seen, last_seen: d && d.last_seen })) })
  }

  // Manual key claim ("Add a key manually"): attach a loose key handed out
  // by support to your own account. Same rule as activation first-touch:
  // unbound keys can be claimed by whoever holds them; bound keys stay put.
  if (pathname === '/api/account/key/claim') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const key = String(body.key || '').trim().toUpperCase()
    if (!key) return json(res, 400, { error: 'bad_request', msg: 'Enter the license key.' })
    const lic = store.getLicense(key)
    if (!lic) return json(res, 404, { error: 'invalid_key', msg: 'No such license key.' })
    if (lic.status === 'revoked') return json(res, 403, { error: 'license_revoked', msg: 'This license was revoked. Contact support.' })
    if (lic.status === 'cancelled') return json(res, 403, { error: 'license_cancelled', msg: 'This license was cancelled.' })
    if (lic.account_email && lic.account_email !== acc.email) {
      return json(res, 403, { error: 'wrong_account', msg: 'This key belongs to a different account.' })
    }
    if (!lic.account_email) {
      store.setAccountEmail(key, acc.email)
      store.audit(acc.email, 'key_claim', 'key added manually')
    }
    return json(res, 200, { ok: true, key, expires_at: lic.expires_at || null, status: lic.status })
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
    if (!(days >= 1 && days <= 36500)) return json(res, 400, { error: 'bad_request' })
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
    // Account-bound flow (new apps): one key auto-activates up to
    // DEVICE_LIMIT devices. Legacy {key, machine_id} flow below is kept
    // byte-identical for old builds.
    if (body.account_token) {
      const acc = store.getSessionAccount(String(body.account_token))
      if (!acc) return json(res, 401, { error: 'unauthorized', msg: 'Login expired. Log in again.' })
      const machineId = String(body.machine_id || '').trim().toUpperCase()
      if (!machineId) return json(res, 400, { error: 'bad_request' })
      const deviceName = String(body.device_name || '').slice(0, 60)
      const reqKey = String(body.key || '').trim().toUpperCase()
      let lic = null
      if (reqKey) {
        lic = store.getLicense(reqKey)
        if (!lic) return json(res, 404, { error: 'invalid_key', msg: 'No such license key.' })
        if (lic.status === 'revoked') return json(res, 403, { error: 'license_revoked', msg: 'This license was revoked. Contact support.' })
        if (lic.status === 'cancelled') return json(res, 403, { error: 'license_cancelled', msg: 'This license was cancelled. Buy again to restart Premium.' })
        const ownerEmail = lic.account_email || null
        const shared = !ownerEmail ? false : ((lic.shared_with || []).includes(acc.email))
        if (ownerEmail && ownerEmail !== acc.email && !shared) {
          return json(res, 403, { error: 'wrong_account', msg: 'This key belongs to a different account.' })
        }
        // First touch claims a loose key for the account (whoever holds the
        // key could already activate it anywhere, so this grants nothing new).
        if (!lic.account_email) store.setAccountEmail(reqKey, acc.email)
      } else {
        const cands = store.keysVisibleTo(acc.email).map((x) => x.lic)
          .filter((l) => l.status !== 'revoked' && l.status !== 'cancelled')
          .sort((a, b) => String(b.expires_at || '') < String(a.expires_at || '') ? -1 : 1)
        if (!cands.length) return json(res, 404, { error: 'no_key', msg: 'No Premium key on this account yet.' })
        lic = cands[0]
      }
      const live = licenseExpirySeconds(lic)
      if (!live || live * 1000 < Date.now()) {
        return json(res, 402, { error: 'key_expired', msg: 'The key on this account expired. Renew to keep Premium on all devices.', key: lic.key })
      }
      // Device approvals: unknown hardware waits for the key owner's OK.
      if (!lic.devices) lic.devices = {}
      const ownerForGate = lic.account_email || acc.email
      if (!lic.devices[machineId] && store.requireApproval(ownerForGate)) {
        const pend = store.createApproval(ownerForGate, lic.key, machineId, deviceName)
        store.audit(ownerForGate, 'approval_wait', 'new device waiting' + (pend.refreshed ? '' : ''))
        return json(res, 403, { error: 'approval_pending', msg: 'New device — approve it on your account dashboard, then retry.', key: lic.key })
      }
      const devs = lic.devices || {}
      if (!devs[machineId] && Object.keys(devs).length >= DEVICE_LIMIT) {
        return json(res, 403, { error: 'device_limit', msg: 'All ' + DEVICE_LIMIT + ' device slots are used. Remove one or buy a new key.', key: lic.key, devices_used: Object.keys(devs).length, device_limit: DEVICE_LIMIT })
      }
      const isNew = !((lic.devices || {})[machineId])
      const used = store.touchDevice(lic.key, machineId, deviceName)
      store.noteDeviceOwner(lic.key, machineId, acc.email)
      if (isNew) store.audit(lic.account_email || acc.email, 'device_add', 'device activated')
      if (!lic.machine_id) store.bindLicense(lic.key, machineId)
      const payload = makeLicensePayload(lic.key, machineId, acc.email)
      const sig = sign.signPayload(payload, keys.privateKey)
      const allSubs = store.all().subscriptions || {}
      const auto = Object.values(allSubs).some((s) => s.account_email === acc.email && (s.status === 'active' || s.status === 'created' || s.status === 'pending'))
      return json(res, 200, { ok: true, license: { key: lic.key, payload, sig }, status: 'activated', devices_used: used, device_limit: DEVICE_LIMIT, auto })
    }
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

  function authThrottle(req) {
    const fwd = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
    const ip = fwd || (req.socket && req.socket.remoteAddress) || 'unknown'
    const now = Date.now()
    const hits = (authHits.get(ip) || []).filter((t) => now - t < AUTH_WINDOW_MS)
    hits.push(now)
    authHits.set(ip, hits)
    if (authHits.size > 5000) authHits.clear()
    return hits.length <= AUTH_MAX
  }
  function clientIp(req) {
    const cf = (req.headers['cf-connecting-ip'] || '').toString().trim()
    if (cf) return cf
    const fwd = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
    return fwd || (req.socket && req.socket.remoteAddress) || 'unknown'
  }
  function bearer(req) {
    const h = (req.headers.authorization || req.headers.Authorization || '').toString()
    const m = h.match(/^Bearer\s+(kas_[A-Za-z0-9]+)$/)
    return m ? m[1] : null
  }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()) }

  if (pathname === '/api/account/signup' || pathname === '/api/account/login') {
    if (!authThrottle(req)) return json(res, 429, { error: 'too_many' })
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!validEmail(email)) return json(res, 400, { error: 'bad_email' })
    if (password.length < 8) return json(res, 400, { error: 'weak_password' })
    if (pathname === '/api/account/signup') {
      if (store.getAccountByEmail(email)) return json(res, 409, { error: 'exists' })
      const passSalt = crypto.randomBytes(16).toString('hex')
      const authSalt = crypto.randomBytes(16).toString('hex')
      const syncSalt = crypto.randomBytes(16).toString('hex')
      const passHash = crypto.scryptSync(password, passSalt, 32).toString('hex')
      store.createAccount(email, passHash, passSalt, authSalt, syncSalt)
      const token = store.createSession(email, 30 * 86400000, { label: String(body.label || '').slice(0, 60), ip: clientIp(req) })
      store.audit(email, 'signup', 'account created')
      return json(res, 200, { ok: true, token, email, auth_salt: authSalt, sync_salt: syncSalt })
    }
    const acc = store.getAccountByEmail(email)
    if (!acc) return json(res, 401, { error: 'bad_login' })
    let good = false
    try {
      const h = crypto.scryptSync(password, acc.pass_salt, 32)
      good = h.length === 32 && crypto.timingSafeEqual(h, Buffer.from(acc.pass_hash, 'hex'))
    } catch {}
    if (!good) return json(res, 401, { error: 'bad_login' })
    if (acc.totp_secret) {
      const how = store.totpCheck(email, body.totp)
      if (!how) return json(res, 401, { error: 'need_totp', msg: 'Enter the 6-digit code from your authenticator app.' })
      if (how === 'recovery') store.audit(email, 'totp_recovery', 'recovery code used')
    }
    const token = store.createSession(email, 30 * 86400000, { label: String(body.label || '').slice(0, 60), ip: clientIp(req) })
    store.audit(email, 'login', 'login from ' + clientIp(req))
    return json(res, 200, { ok: true, token, email, auth_salt: acc.auth_salt, sync_salt: acc.sync_salt })
  }
  if (pathname === '/api/account/logout') {
    const tok = bearer(req)
    const who = tok ? store.getSessionAccount(tok) : null
    store.destroySession(tok)
    if (who) store.audit(who.email, 'logout', 'session ended')
    return json(res, 200, { ok: true })
  }

  // Sessions, audit log, family sharing, device approvals.
  if (pathname === '/api/account/sessions') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const tok = bearer(req)
    const cur = tok ? require('crypto').createHash('sha256').update(tok).digest('hex').slice(0, 12) : null
    return json(res, 200, { ok: true, current: cur,
      sessions: store.sessionsForAccount(acc.email).map((x) => ({ ...x, current: x.id === cur })) })
  }
  if (pathname === '/api/account/session/revoke') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const n = store.revokeSession(acc.email, String(body.id || ''))
    if (n) store.audit(acc.email, 'session_revoke', 'session ended remotely')
    return json(res, 200, { ok: true, revoked: n })
  }
  if (pathname === '/api/account/sessions/revoke-others') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const n = store.revokeOtherSessions(acc.email, bearer(req))
    if (n) store.audit(acc.email, 'session_revoke', n + ' other session(s) ended')
    return json(res, 200, { ok: true, revoked: n })
  }
  if (pathname === '/api/account/audit') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    return json(res, 200, { ok: true, events: store.getAudit(acc.email) })
  }
  if (pathname === '/api/account/key/share' || pathname === '/api/account/key/unshare') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const key = String(body.key || '').trim().toUpperCase()
    const lic = store.getLicense(key)
    if (!lic || lic.account_email !== acc.email) return json(res, 404, { error: 'invalid_key' })
    const email = String(body.email || '').trim().toLowerCase()
    if (!validEmail(email)) return json(res, 400, { error: 'bad_email' })
    if (pathname === '/api/account/key/share') {
      const r = store.shareKey(key, email)
      if (r === 'no_account') return json(res, 404, { error: 'no_account', msg: 'No Kastrava account with that email yet.' })
      if (r === 'self') return json(res, 400, { error: 'bad_request', msg: 'That is your own account.' })
      store.audit(acc.email, 'share_add', 'key shared with ' + email)
      store.audit(email, 'share_add', 'key shared by ' + acc.email)
      return json(res, 200, { ok: true, key })
    }
    store.unshareKey(key, email)
    store.audit(acc.email, 'share_remove', 'key unshared from ' + email)
    return json(res, 200, { ok: true, key })
  }
  if (pathname === '/api/account/approvals') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    return json(res, 200, { ok: true, require_approval: store.requireApproval(acc.email),
      approvals: store.approvalsFor(acc.email) })
  }
  if (pathname === '/api/account/totp/setup') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    if (acc.totp_secret) return json(res, 400, { error: 'already_on' })
    const setup = store.totpSetup(acc.email)
    if (!setup) return json(res, 400, { error: 'bad_request' })
    store.audit(acc.email, 'totp_setup', '2FA setup started')
    return json(res, 200, { ok: true, secret: setup.secret, otpauth_url: setup.otpauth_url })
  }
  if (pathname === '/api/account/totp/confirm') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const recovery = store.totpConfirm(acc.email, body.code)
    if (recovery === null) return json(res, 400, { error: 'bad_request', msg: 'Setup expired — start over.' })
    if (recovery === false) return json(res, 401, { error: 'bad_code', msg: 'Wrong code — check the authenticator and retry.' })
    store.audit(acc.email, 'totp_on', '2FA enabled')
    return json(res, 200, { ok: true, recovery })
  }
  if (pathname === '/api/account/totp/disable') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const password = String(body.password || '')
    let good = false
    try {
      const h = crypto.scryptSync(password, acc.pass_salt, 32)
      good = h.length === 32 && crypto.timingSafeEqual(h, Buffer.from(acc.pass_hash, 'hex'))
    } catch {}
    if (!good) return json(res, 401, { error: 'bad_login' })
    store.totpDisable(acc.email)
    store.audit(acc.email, 'totp_off', '2FA disabled')
    return json(res, 200, { ok: true })
  }
  if (pathname === '/api/account/export') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    return json(res, 200, { ok: true, export: {
      email: acc.email, created_at: acc.created_at,
      totp: !!acc.totp_secret, require_approval: !!acc.require_approval,
      keys: store.keysVisibleTo(acc.email).map((x) => ({ key: x.lic.key,
        status: x.lic.status, expires_at: x.lic.expires_at || null,
        shared: !!x.shared, owner: x.owner || null,
        devices: Object.keys(x.lic.devices || {}).length })),
      sessions: store.sessionsForAccount(acc.email).length,
      sync_rev: store.getSync(acc.email).rev,
      audit: store.getAudit(acc.email) } })
  }
  if (pathname === '/api/account/delete') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    if (String(body.confirm || '') !== 'DELETE') return json(res, 400, { error: 'bad_request', msg: 'Type DELETE to confirm.' })
    const password = String(body.password || '')
    let good = false
    try {
      const h = crypto.scryptSync(password, acc.pass_salt, 32)
      good = h.length === 32 && crypto.timingSafeEqual(h, Buffer.from(acc.pass_hash, 'hex'))
    } catch {}
    if (!good) return json(res, 401, { error: 'bad_login' })
    // Owned keys die with the account (devices lose Premium on next check);
    // shares evaporate; sessions, sync and audit are wiped.
    for (const l of store.keysForAccount(acc.email)) {
      l.status = 'cancelled'
      l.cancelled_at = new Date().toISOString()
      l.shared_with = []
    }
    for (const k in store.data.licenses) {
      const l = store.data.licenses[k]
      if (l.shared_with) l.shared_with = (l.shared_with || []).filter((e) => e !== acc.email)
    }
    for (const h in store.data.sessions) {
      if (store.data.sessions[h].email === acc.email) delete store.data.sessions[h]
    }
    if (store.data.sync) delete store.data.sync[acc.email]
    if (store.data.audit) delete store.data.audit[acc.email]
    delete store.data.accounts[acc.email]
    store.save()
    return json(res, 200, { ok: true })
  }
  if (pathname === '/api/account/approval-require') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const on = !!body.on
    store.setRequireApproval(acc.email, on)
    store.audit(acc.email, 'approval_require', on ? 'device approvals on' : 'device approvals off')
    return json(res, 200, { ok: true, require_approval: on })
  }
  if (pathname === '/api/account/approval/resolve') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const r = store.resolveApproval(acc.email, String(body.id || ''), !!body.approve)
    if (!r) return json(res, 404, { error: 'not_found' })
    if (r.approved) {
      store.touchDevice(r.approval.key, r.approval.machine_id, r.approval.device_name)
      store.noteDeviceOwner(r.approval.key, r.approval.machine_id, acc.email)
      store.audit(acc.email, 'approval_ok', 'device approved')
    } else {
      store.audit(acc.email, 'approval_deny', 'device denied')
    }
    return json(res, 200, { ok: true, approved: r.approved })
  }
  if (pathname === '/api/account/me' || pathname === '/api/sync/pull' || pathname === '/api/sync/push') {
    const acc = store.getSessionAccount(bearer(req))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    if (pathname === '/api/account/me') {
      const allSubs = store.all().subscriptions || {}
      const auto = Object.values(allSubs).some((s) => s.account_email === acc.email && (s.status === 'active' || s.status === 'created' || s.status === 'pending'))
      return json(res, 200, { ok: true, email: acc.email, created_at: acc.created_at, auto, totp: !!acc.totp_secret })
    }
    if (pathname === '/api/sync/pull') {
      const cur = store.getSync(acc.email)
      return json(res, 200, { ok: true, rev: cur.rev, blob: cur.blob, updated_at: cur.updated_at })
    }
    const blob = String(body.blob || '')
    if (!blob || blob.length > 262144) return json(res, 400, { error: 'bad_blob' })
    const r = store.pushSync(acc.email, blob, Number(body.base_rev) || 0)
    if (r.conflict) return json(res, 409, { error: 'conflict', rev: r.rev, blob: r.blob, updated_at: r.updated_at })
    return json(res, 200, { ok: true, rev: r.rev })
  }

  // ---- Auto-renew (optional): Razorpay Subscriptions ----
  // Manual one-time stays the default everywhere. This powers the second
  // checkout choice: a mandate whose every billing settles the same key.
  function planNameForRzp(planId) {
    try {
      const ids = rzpPlanIds()
      for (const k of Object.keys(ids)) if (ids[k] === planId) return k
    } catch {}
    return 'monthly'
  }
  function settleSubscription(subId, paymentId, accountEmail, planName) {
    const plan = planOf(planName === 'daily' ? 'daily' : 'monthly')
    const pname = planName === 'daily' ? 'daily' : 'monthly'
    let rec = store.getSubscription(subId)
    if (!rec) {
      store.createSubscription(subId, { account_email: accountEmail || null, plan: pname, status: 'pending' })
      rec = store.getSubscription(subId)
    }
    if (!rec) return { key: null, renewed: false }
    if (paymentId && rec.last_payment === paymentId) {
      return { key: rec.key || null, renewed: true, dup: true }
    }
    const email = accountEmail || rec.account_email || null
    let key = (rec.key && store.getLicense(rec.key)) ? rec.key : null
    let renewed = false
    if (!key && email) {
      const cands = store.keysForAccount(email)
        .filter((l) => l.status === 'activated' || l.status === 'issued')
        .sort((a, b) => String(b.expires_at || '') < String(a.expires_at || '') ? -1 : 1)
      if (cands.length) key = cands[0].key
    }
    if (key) {
      const lic = store.getLicense(key)
      const base = (lic && lic.expires_at)
        ? Math.max(Date.now(), new Date(lic.expires_at).getTime())
        : Date.now()
      store.extendLicense(key, new Date(base + plan.days * 86400000).toISOString())
      if (email && lic && !lic.account_email) store.setAccountEmail(key, email)
      renewed = true
    } else {
      key = sign.makeLicenseKey()
      store.issueLicense(key, null, subId, new Date(Date.now() + plan.days * 86400000).toISOString())
      if (email) store.setAccountEmail(key, email)
    }
    // One synthetic order per billing so revenue + receipts keep working.
    if (paymentId) {
      const oid = 'subpay_' + String(paymentId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
      if (!store.getOrder(oid)) {
        store.createOrder(oid, { provider: 'subscription', subscription_id: subId, account_email: email, plan: pname, amount_paise: plan.inr * 100 })
        store.markPaid(oid, paymentId, plan.inr * 100)
        const lic2 = store.getLicense(key)
        if (lic2) { lic2.order_id = oid; store.save() }
      }
    }
    store.linkSubKey(subId, key, paymentId || rec.last_payment, 'active')
    return { key, renewed, plan: pname }
  }

  if (pathname === '/api/subscribe') {
    if (body.plan === 'daily') {
      return json(res, 400, { error: 'manual_only', msg: 'Daily is manual-renew only — auto-renew needs the Monthly plan.' })
    }
    const planName = 'monthly'
    const acc = store.getSessionAccount(String(body.account_token || ''))
    if (!acc) return json(res, 401, { error: 'unauthorized', msg: 'Log in first — auto-renew attaches to your account.' })
    try {
      let ids = rzpPlanIds()
      if (!ids[planName]) { await ensureRzpPlans(); ids = rzpPlanIds() }
      if (!ids[planName]) return json(res, 503, { error: 'busy', msg: 'Billing is warming up. Try again in a minute.' })
      const sub = await razorpay.createSubscription(ids[planName], acc.email)
      store.createSubscription(sub.id, { account_email: acc.email, plan: planName, status: 'created' })
      const plan = PLANS[planName]
      return json(res, 200, { ok: true, subscription_id: sub.id, key_id: sub.key_id,
        amount: plan.inr * 100, currency: 'INR', plan: planName, plan_days: plan.days, dev: !!sub.dev })
    } catch (e) {
      return json(res, 500, { error: 'billing_failed', msg: String((e && e.message) || e) })
    }
  }
  if (pathname === '/api/subscribe/verify') {
    const { subscription_id, payment_id, signature, account_token } = body
    if (!subscription_id || !payment_id) return json(res, 400, { error: 'bad_request' })
    const acc = store.getSessionAccount(String(account_token || ''))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    if (!razorpay.verifySubscriptionSignature(String(payment_id), String(subscription_id), String(signature || ''))) {
      return json(res, 403, { error: 'bad_signature', msg: 'Mandate verification failed.' })
    }
    const rec = store.getSubscription(String(subscription_id))
    const r = settleSubscription(String(subscription_id), String(payment_id), acc.email, rec ? rec.plan : 'monthly')
    if (!r.key) return json(res, 500, { error: 'settle_failed' })
    return json(res, 200, { ok: true, key: r.key, renewed: r.renewed, plan: r.plan, auto: true })
  }
  if (pathname === '/api/subscription/cancel') {
    const acc = store.getSessionAccount(String(body.account_token || body.token || ''))
    if (!acc) return json(res, 401, { error: 'unauthorized' })
    const data = store.all()
    let n = 0
    for (const sid of Object.keys(data.subscriptions || {})) {
      const rec = data.subscriptions[sid]
      if (rec.account_email === acc.email && (rec.status === 'active' || rec.status === 'created' || rec.status === 'pending')) {
        try { await razorpay.cancelSubscription(sid) } catch {}
        store.linkSubKey(sid, null, null, 'cancelled')
        n++
      }
    }
    return json(res, 200, { ok: true, cancelled: n })
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
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, Authorization',
      'Access-Control-Max-Age': '600'
    })
    return res.end()
  }

  const u = new URL(req.url, HOST + '/')
  let pathname = u.pathname

  if (req.method === 'POST') return handlePost(req, res, pathname)

  // HEAD is served like GET (same headers incl. Content-Length; Node
  // suppresses the response body automatically), so download managers and
  // `curl -I` probes get a real 200 instead of 405.
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/register' || pathname === '/register/' || pathname === '/login' || pathname === '/login/') {
      pathname = '/account.html'
    }
    if (pathname === '/api/health') {
      return json(res, 200, { ok: true, dev: razorpay.isDev(), host: HOST, price: PRICE_INR, period_days: PERIOD_DAYS, grace_days: GRACE_DAYS, version: '101.4.0', codename: 'Starship Wonders',
        plans: { monthly: PLANS.monthly, daily: PLANS.daily } })
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
  ensureRzpPlans().catch(() => {})
  console.log('[kastrava-licenses] listening on http://' + BIND_HOST + ':' + port)
  console.log('[kastrava-licenses] host=' + HOST + ' price=INR ' + PRICE_INR + '/' + PERIOD_DAYS + 'd one-time grace=' + GRACE_DAYS + 'd dev=' + razorpay.isDev())
})