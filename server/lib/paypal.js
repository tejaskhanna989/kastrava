// PayPal API glue (Orders v2 + capture + webhook verify) via plain fetch.
// Without PAYPAL_CLIENT_ID/SECRET the server runs in DEV mode: orders are
// synthetic and capture always succeeds, mirroring lib/razorpay.js so the
// whole flow is testable with no credentials.
// Set PAYPAL_MODE=live for real money (default sandbox).

const BASE = () => (process.env.PAYPAL_MODE === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com')

function hasKeys() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)
}

function isDev() {
  return !hasKeys()
}

let tokenCache = { at: 0, token: '' }

async function accessToken() {
  if (tokenCache.token && Date.now() - tokenCache.at < 8 * 60 * 1000) return tokenCache.token
  const res = await fetch(BASE() + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(process.env.PAYPAL_CLIENT_ID + ':' + process.env.PAYPAL_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('paypal auth error: ' + res.status + ' ' + JSON.stringify(j))
  tokenCache = { at: Date.now(), token: j.access_token }
  return j.access_token
}

async function createOrder(amount, currency, description) {
  if (isDev()) {
    return {
      dev: true,
      order_id: 'ppdev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      amount, currency
    }
  }
  const token = await accessToken()
  const res = await fetch(BASE() + '/v2/checkout/orders', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: String(amount) }, description: String(description || 'Kastrava').slice(0, 120) }],
      application_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' }
    })
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('paypal order error: ' + res.status + ' ' + JSON.stringify(j))
  return { order_id: j.id, amount: String(amount), currency }
}

// Capture an buyer-approved order. Returns the capture id + status.
async function captureOrder(ppOrderId) {
  if (isDev()) {
    return { ok: true, capture_id: 'ppdev_cap_' + String(ppOrderId).slice(-6), status: 'COMPLETED', dev: true }
  }
  const token = await accessToken()
  const res = await fetch(BASE() + '/v2/checkout/orders/' + encodeURIComponent(ppOrderId) + '/capture', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: '{}'
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, status: j.status || 'FAILED', raw: j }
  try {
    const cap = j.purchase_units[0].payments.captures[0]
    return { ok: cap.status === 'COMPLETED', capture_id: cap.id, status: cap.status }
  } catch {
    return { ok: false, status: j.status || 'UNKNOWN', raw: j }
  }
}

// Webhook verification via PayPal's verify API (needs webhook id).
async function verifyWebhook(headers, body) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID
  if (isDev() || !webhookId) return false
  try {
    const token = await accessToken()
    const res = await fetch(BASE() + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: body
      })
    })
    const j = await res.json().catch(() => ({}))
    return j.verification_status === 'SUCCESS'
  } catch {
    return false
  }
}

function clientId() {
  return isDev() ? 'test' : process.env.PAYPAL_CLIENT_ID
}

module.exports = { createOrder, captureOrder, verifyWebhook, isDev, hasKeys, clientId }
