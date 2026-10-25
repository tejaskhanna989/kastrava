// Bounce (hard-failure) processor for the Kastrava mail queue.
//
// Postfix pipes bounces (envelope sender noreply@kastrava.in, or any address
// whose mail cannot be delivered) into a spool folder as raw .eml files.
// This module polls that spool, detects hard-bounce / DSN messages, extracts
// the original recipient, and suppresses that address so it is never mailed
// again — protecting the OCI sender reputation and the mailbox.
//
// Postfix wiring (one-time, as root):
//   # /etc/postfix/transport
//   noreply@kastrava.in   bounce_spool:
//   # /etc/postfix/master.cf
//   bounce_spool unix - n n - - pipe
//     flags=F user=ubuntu argv=/bin/sh -c 'umask 077; cat > /home/ubuntu/kastrava/server/data/bounce-spool/$(date +%s%N)-$$.eml'
//   # then: postmap /etc/postfix/transport && systemctl reload postfix
//
// If postfix piping is not configured, call processSpool() manually from the
// admin UI or a cron job pointed at the spool dir.

'use strict'
const fs = require('fs')
const path = require('path')

const MAX_SPOOL_BYTES = 2 * 1024 * 1024
const MAX_SPOOL_AGE_MS = 7 * 86400000

function decodeWords(s) {
  if (!s || s.indexOf('=?') === -1) return s || ''
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, kind, payload) => {
    try {
      if (kind.toUpperCase() === 'B') return charsetToUtf8(Buffer.from(payload, 'base64'), cs)
      const bytes = payload.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16)))
      return charsetToUtf8(Buffer.from(bytes, 'binary'), cs)
    } catch { return m }
  })
}
function charsetToUtf8(buf, cs) {
  const c = String(cs || 'utf-8').toLowerCase()
  if (c === 'utf-8' || c === 'utf8' || c === 'us-ascii' || c === 'ascii') return buf.toString('utf8')
  if (c === 'iso-8859-1' || c === 'latin1' || c === 'windows-1252' || c === 'cp1252') return buf.toString('latin1')
  return buf.toString('utf8')
}
function parseHeaders(block) {
  const out = {}
  let key = null
  for (let line of String(block).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && key) { out[key] += ' ' + line.trim(); continue }
    const i = line.indexOf(':')
    if (i <= 0) continue
    key = line.slice(0, i).trim().toLowerCase()
    out[key] = line.slice(i + 1).trim()
  }
  return out
}
function splitMultipart(body, boundary) {
  const delim = '--' + boundary
  const segs = String(body).split(delim)
  const parts = []
  for (let i = 1; i < segs.length; i++) {
    let s = segs[i]
    if (/^--/.test(s)) break
    s = s.replace(/^\r?\n/, '').replace(/\r?\n$/, '')
    parts.push(s)
  }
  return parts
}
function extractEmail(s) {
  const m = String(s || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  return m ? m[0].toLowerCase() : ''
}

// Is this message a bounce / delivery-status notification?
function isBounce(raw) {
  const hdrEnd = String(raw).search(/\r?\n\r?\n/)
  const headerBlock = hdrEnd >= 0 ? String(raw).slice(0, hdrEnd) : String(raw)
  const h = parseHeaders(headerBlock)
  const ct = (h['content-type'] || '').toLowerCase()
  const subj = decodeWords(h.subject || '').toLowerCase()
  const body = String(raw)
  // DSN / MDN reports
  if (/multipart\/report/.test(ct) && /delivery-status/.test(ct)) return true
  if (ct.indexOf('message/delivery-status') !== -1) return true
  if (h['content-disposition'] && /notification/.test(h['content-disposition'])) return true
  // Subject keywords
  if (/undeliver|undelivered|delivery status|delivery failure|returned mail|mail delivery|bounce|failure notice/i.test(subj)) return true
  // Body keyword heuristics for non-DSN bounces
  if (/5\.1\.1|5\.1\.0|5\.0\.0|user unknown|mailbox unavailable|mailbox full|no such user|address not found|recipient address rejected/i.test(body)) return true
  return false
}

// Extract the original recipient from a bounce/DSN message.
function extractFailedRecipient(raw) {
  const hdrEnd = String(raw).search(/\r?\n\r?\n/)
  const headerBlock = hdrEnd >= 0 ? String(raw).slice(0, hdrEnd) : String(raw)
  const h = parseHeaders(headerBlock)
  // DSN fields (most reliable)
  for (const key of ['final-recipient', 'original-recipient', 'x-failed-recipients', 'original-envelope-id']) {
    const v = h[key]
    if (!v) continue
    const m = v.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
    if (m) return m[0].toLowerCase()
    if (key === 'x-failed-recipients') {
      const addrs = v.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g)
      if (addrs && addrs.length) return addrs[0].toLowerCase()
    }
  }
  // RFC 822 forwarded message inside the bounce: look for its To:/Envelope-To
  const m = String(raw).match(/original-envelope-id\s*:\s*([^\r\n]+)/i)
  if (m) {
    const mm = m[1].match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
    if (mm) return mm[0].toLowerCase()
  }
  // Fallback: the bounce's own To: is often the original recipient for simple bounces
  const to = extractEmail(h.to || '')
  if (to) return to
  return null
}

// Hard-bounce reason string from DSN diagnostic.
function bounceReason(raw) {
  const body = String(raw)
  const m = body.match(/diagnostic-code\s*:\s*smtp;\s*(.+)/i)
  if (m) return String(m[1]).trim().slice(0, 200)
  const m2 = body.match(/(5\.1\.1|5\.1\.0|5\.0\.0|user unknown|mailbox unavailable|no such user|address not found|recipient address rejected)[^\r\n]{0,120}/i)
  if (m2) return String(m2[0]).trim().slice(0, 200)
  return 'hard_bounce'
}

class BounceProcessor {
  constructor(spoolDir, store) {
    this.spool = spoolDir
    this.store = store
    fs.mkdirSync(spoolDir, { recursive: true })
    this.timer = null
    this.running = false
    this.onBounce = opts => { /* noop */ }
  }
  start(opts = {}) {
    if (this.running) return
    this.running = true
    if (opts.onBounce) this.onBounce = opts.onBounce
    const tick = async () => {
      try { await this.process() } catch (e) { console.error('[bounce] tick:', e && e.message) }
      if (this.running) setTimeout(tick, 30000).unref()
    }
    tick()
    console.log('[bounce] processor started (spool=' + this.spool + ')')
  }
  stop() { this.running = false }
  async process() {
    let files
    try { files = fs.readdirSync(this.spool) } catch { return { processed: 0, suppressed: 0 } }
    let processed = 0, suppressed = 0
    const processedDir = path.join(this.spool, '..', 'bounce-processed')
    for (const f of files) {
      if (!/\.eml$/i.test(f)) continue
      const full = path.join(this.spool, f)
      let raw
      try {
        const st = fs.statSync(full)
        if (Date.now() - st.mtimeMs < 1000) continue
        raw = fs.readFileSync(full, 'utf8')
      } catch { continue }
      try {
        if (!isBounce(raw)) {
          // Not a bounce; archive it so we don't re-scan forever.
          try { fs.mkdirSync(processedDir, { recursive: true }); fs.renameSync(full, path.join(processedDir, f)) } catch { try { fs.unlinkSync(full) } catch {} }
          continue
        }
        processed++
        const recipient = extractFailedRecipient(raw)
        const reason = bounceReason(raw)
        if (recipient && this.store) {
          this.store.suppress(recipient, reason, 'bounce_processor')
          this.store.setAccountEmailStatus(recipient, 'bounced', reason)
          this.store.audit(recipient, 'bounce_suppress', reason)
          suppressed++
          this.onBounce && this.onBounce({ email: recipient, reason })
        }
        try { fs.mkdirSync(processedDir, { recursive: true }); fs.renameSync(full, path.join(processedDir, f)) } catch { try { fs.unlinkSync(full) } catch {} }
      } catch { try { fs.unlinkSync(full) } catch {} }
    }
    // Sweep ancient stragglers
    try {
      for (const f of fs.readdirSync(this.spool)) {
        const full = path.join(this.spool, f)
        try { if (Date.now() - fs.statSync(full).mtimeMs > MAX_SPOOL_AGE_MS) fs.unlinkSync(full) } catch {}
      }
    } catch {}
    return { processed, suppressed }
  }
}

module.exports = { BounceProcessor, isBounce, extractFailedRecipient, bounceReason }
