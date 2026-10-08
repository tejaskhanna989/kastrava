// TOTP (RFC 6238): SHA1, 30s step, 6 digits, ±1 step window. No deps.
'use strict'
const crypto = require('crypto')

function b32decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const ch of clean) bits += alpha.indexOf(ch).toString(2).padStart(5, '0')
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}

function hotp(secret, counter) {
  const key = b32decode(secret)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', key).update(msg).digest()
  const o = h[h.length - 1] & 0x0f
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(code % 1000000).padStart(6, '0')
}

function verify(secret, code, windowSteps) {
  const c = String(code || '').replace(/[\s-]/g, '')
  if (!/^\d{6}$/.test(c)) return false
  const step = Math.floor(Date.now() / 30000)
  const w = windowSteps == null ? 1 : windowSteps
  for (let d = -w; d <= w; d++) {
    const expect = hotp(secret, step + d)
    if (expect.length === c.length && crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(c))) return true
  }
  return false
}

module.exports = { b32decode, hotp, verify }
