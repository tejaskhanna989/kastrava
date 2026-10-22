// YooKassa API glue (payments + status checks) via plain fetch.
// Without YOOKASSA_SHOP_ID/SECRET the server runs in DEV mode: payments
// are synthetic and always succeed, mirroring lib/paypal.js so the whole
// flow is testable with no credentials.
// Set YOOKASSA_MODE=live for real money (default test is implicit —
// YooKassa uses the same endpoint, test mode comes from test credentials).

const BASE = 'https://api.yookassa.com/v3'

function hasKeys() {
  return !!(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SHOP_SECRET)
}

function isDev() {
  return !hasKeys()
}

function auth() {
  return 'Basic ' + Buffer.from(process.env.YOOKASSA_SHOP_ID + ':' + process.env.YOOKASSA_SHOP_SECRET).toString('base64')
}

function idem() {
  return require('crypto').randomBytes(16).toString('hex')
}

// Create a card/SBP payment. Returns { order_id (ours), yk_id, amount,
// currency, confirm_url }. Capture is automatic (capture:true).
async function createPayment(ourOrderId, amount, currency, description, returnUrl) {
  if (isDev()) {
    return {
      dev: true,
      yk_id: 'ykdev_' + Date.now().toString(36),
      amount: String(amount),
      currency,
      confirm_url: null
    }
  }
  const res = await fetch(BASE + '/payments', {
    method: 'POST',
    headers: {
      Authorization: auth(),
      'Content-Type': 'application/json',
      'Idempotence-Key': idem()
    },
    body: JSON.stringify({
      amount: { value: String(amount), currency },
      capture: true,
      confirmation: { type: 'redirect', return_url: returnUrl || 'https://kastrava.in/' },
      description: String(description || 'Kastrava').slice(0, 128),
      metadata: { kastrava_order: String(ourOrderId) }
    })
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('yookassa payment error: ' + res.status + ' ' + JSON.stringify(j))
  return {
    yk_id: j.id,
    amount: j.amount && j.amount.value,
    currency: j.amount && j.amount.currency,
    confirm_url: j.confirmation && j.confirmation.confirmation_url
  }
}

// Check a payment by YooKassa id. Returns { ok, status }.
async function paymentStatus(ykId, ourOrderId) {
  if (isDev() || String(ykId).startsWith('ykdev_')) {
    return { ok: true, status: 'succeeded', dev: true }
  }
  const res = await fetch(BASE + '/payments/' + encodeURIComponent(ykId), {
    headers: { Authorization: auth(), 'Content-Type': 'application/json' }
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, status: j.status || 'unknown' }
  return { ok: j.status === 'succeeded', status: j.status }
}

module.exports = { createPayment, paymentStatus, isDev, hasKeys }
