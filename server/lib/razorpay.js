// Razorpay API glue (one-time orders + signature verification) via plain
// fetch. Without RAZORPAY_KEY_ID/SECRET the server runs in DEV mode: orders
// are synthetic and any signature is accepted, so the whole flow can be
// tested locally with no credentials.
//
// One-time model on purpose: recurring subscriptions require card e-mandates
// (UPI autopay / card SIMD) that most buyers haven't enabled, and Razorpay
// rejects those at checkout. So Premium is a plain ₹199 order; the license
// server seeds the 34-day expiry and the app reminds the user to renew.
const crypto = require('crypto')

const BASE = 'https://api.razorpay.com/v1'

function hasKeys() {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

function isDev() {
  return !hasKeys()
}

function auth() {
  return 'Basic ' + Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64')
}

async function createOrder(amountPaise) {
  if (isDev()) {
    return {
      dev: true,
      order_id: 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      amount: amountPaise,
      currency: 'INR',
      key_id: 'rzp_test_dev'
    }
  }
  const res = await fetch(BASE + '/orders', {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', notes: { product: 'kastrava-premium' } })
  })
  const body = await res.json()
  if (!res.ok) throw new Error('razorpay order error: ' + res.status + ' ' + JSON.stringify(body))
  return { order_id: body.id, amount: body.amount, currency: body.currency, key_id: process.env.RAZORPAY_KEY_ID }
}

// One-time checkout signs order_id|payment_id with the key secret.
function verifySignature(orderId, paymentId, signature) {
  if (isDev()) return true
  const secret = process.env.RAZORPAY_KEY_SECRET
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(orderId + '|' + paymentId)
      .digest('hex')
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(signature, 'hex')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// Webhooks sign the raw request body with the webhook secret
// (X-Razorpay-Signature header).
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret || !signature) return false
  try {
    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    const a = Buffer.from(expected, 'hex')
    const b = Buffer.from(String(signature), 'hex')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ---- Subscriptions (auto-renew via e-mandate / UPI Autopay) ----
// Manual one-time stays the default; this powers the optional auto-renew
// choice at checkout. First billing happens at mandate auth; every later
// cycle arrives as a subscription.charged webhook that extends the same key.

async function apiPost(path, data) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error('razorpay ' + path + ' error: ' + res.status + ' ' + JSON.stringify(body))
  return body
}

module.exports = {
  createOrder,
  verifySignature,
  verifyWebhookSignature,
  isDev,
  hasKeys
}