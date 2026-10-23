// Inbound mail for the admin "Email Center" — the email-center@kastrava.in
// mailbox. Postfix pipes matching messages into a spool folder as raw .eml;
// the license server polls that folder, parses the MIME here (no deps — the
// box runs bare Node), and keeps a bounded JSON store the admin API reads.
'use strict'
const fs = require('fs')
const path = require('path')

const MAX_MESSAGES = 500   // ring-buffer the store
const MAX_STORE_BYTES = 2 * 1024 * 1024  // per message, drop blobs past this
const MAX_SPOOL_AGE_MS = 7 * 86400000    // safety sweep for stuck files

// ---- RFC 2047 encoded-words: =?utf-8?B?...?= / =?iso-8859-1?Q?...?= ----
function decodeWords(s) {
  if (!s || s.indexOf('=?') === -1) return s || ''
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, kind, payload) => {
    try {
      if (kind.toUpperCase() === 'B') return charsetToUtf8(Buffer.from(payload, 'base64'), cs)
      // Q-encoding: underscore is space, =XX is a byte
      const bytes = payload.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16)))
      return charsetToUtf8(Buffer.from(bytes, 'binary'), cs)
    } catch { return m }
  })
}

// Node only ships utf8/latin1. For legacy charsets a latin1 pass covers
// iso-8859-* and windows-1252 well enough for reading customer replies.
function charsetToUtf8(buf, cs) {
  const c = String(cs || 'utf-8').toLowerCase()
  if (c === 'utf-8' || c === 'utf8' || c === 'us-ascii' || c === 'ascii') return buf.toString('utf8')
  if (c === 'iso-8859-1' || c === 'latin1' || c === 'windows-1252' || c === 'cp1252') return buf.toString('latin1')
  return buf.toString('utf8')
}

// Unfold continuation lines, then split into a lowercase header map.
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

// Content-Transfer-Encoding -> Buffer
function decodeBody(raw, enc) {
  const e = String(enc || '7bit').toLowerCase()
  if (e === 'base64') return Buffer.from(String(raw).replace(/\s+/g, ''), 'base64')
  if (e === 'quoted-printable') {
    const bytes = String(raw)
      .replace(/=\r?\n/g, '')                      // soft line breaks
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    return Buffer.from(bytes, 'binary')
  }
  return Buffer.from(String(raw), 'binary')
}

function splitMultipart(body, boundary) {
  const delim = '--' + boundary
  const segs = String(body).split(delim)
  const parts = []
  for (let i = 1; i < segs.length; i++) {
    let s = segs[i]
    if (/^--/.test(s)) break                       // closing boundary
    s = s.replace(/^\r?\n/, '').replace(/\r?\n$/, '')
    parts.push(s)
  }
  return parts
}

// Recursively walk the MIME tree into { text, html, attachments[] }.
function walkEntity(raw, acc) {
  const split = String(raw).search(/\r?\n\r?\n/)
  const headerBlock = split >= 0 ? raw.slice(0, split) : raw
  const body = split >= 0 ? raw.slice(split).replace(/^\r?\n\r?\n/, '') : ''
  const h = parseHeaders(headerBlock)
  const ctRaw = h['content-type'] || 'text/plain'
  const ct = ctRaw.toLowerCase()
  const mainType = ct.split(';')[0].trim()

  if (mainType.indexOf('multipart/') === 0) {
    // Boundary values are case-SENSITIVE and appear verbatim in the body, so
    // pull them from the raw header. Lowercasing with the rest of ct would
    // turn --XXBOUND into --xxbound and match nothing.
    const m = ctRaw.match(/boundary\s*=\s*"?([^";\s]+)"?/)
    if (m) { for (const p of splitMultipart(body, m[1])) walkEntity(p, acc) }
    return
  }

  const buf = decodeBody(body, h['content-transfer-encoding'])
  const cd = (h['content-disposition'] || '').toLowerCase()
  const fnameM = (cd.match(/filename\s*=\s*"?([^";]+)"?/) || ct.match(/name\s*=\s*"?([^";]+)"?/))
  const isAttach = cd.indexOf('attachment') === 0 || (!!fnameM && mainType !== 'text/plain' && mainType !== 'text/html')

  if (isAttach) {
    acc.attachments.push({
      name: fnameM ? decodeWords(fnameM[1].trim()) : 'attachment',
      type: mainType, size: buf.length,
      data: buf.length <= MAX_STORE_BYTES ? buf.toString('base64') : null,
      tooLarge: buf.length > MAX_STORE_BYTES
    })
    return
  }
  if (mainType === 'text/html' && !acc.html) acc.html = charsetToUtf8(buf, (ct.match(/charset\s*=\s*"?([^";\s]+)"?/) || [])[1])
  else if (mainType === 'text/plain' && !acc.text) acc.text = charsetToUtf8(buf, (ct.match(/charset\s*=\s*"?([^";\s]+)"?/) || [])[1])
}

// Parse one raw RFC 5322 message into a store record.
function parseEml(raw) {
  const acc = { text: '', html: '', attachments: [] }
  walkEntity(String(raw), acc)
  const headerBlock = String(raw).search(/\r?\n\r?\n/)
  const h = parseHeaders(headerBlock >= 0 ? raw.slice(0, headerBlock) : raw)
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    from: decodeWords(h.from || '').slice(0, 300),
    to: decodeWords(h.to || '').slice(0, 300),
    // Envelope recipient added by the Postfix pipe. This is what actually
    // got delivered, so a BCC copy (visible To: names someone else) is still
    // recognised as mail for the centre.
    envelopeTo: decodeWords(h['x-kastrava-envelope-to'] || '').slice(0, 300),
    subject: decodeWords(h.subject || '(no subject)').slice(0, 300),
    date: h.date || new Date().toISOString(),
    messageId: (h['message-id'] || '').slice(0, 200),
    inReplyTo: (h['in-reply-to'] || '').slice(0, 200),
    text: acc.text.slice(0, 20000),
    // Strip tags for a safe one-line preview; the reader shows plain text.
    preview: (acc.text || String(acc.html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200),
    attachments: acc.attachments,
    read: false,
    received_at: new Date().toISOString()
  }
}

function extractEmail(s) {
  const m = String(s || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  return m ? m[0].toLowerCase() : ''
}

class Inbox {
  constructor(spoolDir, storeFile) {
    this.spool = spoolDir
    this.file = storeFile
    this.messages = []
    this._load()
  }

  _load() {
    try { this.messages = JSON.parse(fs.readFileSync(this.file, 'utf8')) || [] } catch { this.messages = [] }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.messages), { mode: 0o600 })
  }

  // Drain the spool: parse every ready .eml, archive it, append to the store.
  // Returns how many new messages were ingested.
  drain() {
    let files = []
    try { files = fs.readdirSync(this.spool) } catch { return 0 }
    let n = 0
    const processed = path.join(this.spool, '..', 'processed')
    for (const f of files) {
      if (!/\.eml$/i.test(f)) continue
      const full = path.join(this.spool, f)
      let raw
      try {
        // Skip files still being written: only take .eml older than ~1s.
        const st = fs.statSync(full)
        if (Date.now() - st.mtimeMs < 1000) continue
        raw = fs.readFileSync(full, 'utf8')
      } catch { continue }
      try {
        const msg = parseEml(raw)
        // Only keep mail addressed to the centre (defence in depth). Prefer
        // the envelope recipient so a BCC / list copy isn't dropped just
        // because the visible To: header names someone else.
        const dest = extractEmail(msg.envelopeTo) || extractEmail(msg.to)
        if (dest.indexOf('email-center@kastrava.in') !== -1 || dest.indexOf('kastrava.in') !== -1) {
          this.messages.unshift(msg)
          n++
        }
        try {
          fs.mkdirSync(processed, { recursive: true })
          fs.renameSync(full, path.join(processed, f))
        } catch { try { fs.unlinkSync(full) } catch {} }
      } catch { try { fs.unlinkSync(full) } catch {} }
    }
    if (n) {
      if (this.messages.length > MAX_MESSAGES) this.messages.length = MAX_MESSAGES
      this._save()
    }
    // Sweep ancient stragglers so the spool can't grow unbounded.
    try {
      for (const f of fs.readdirSync(this.spool)) {
        const full = path.join(this.spool, f)
        try { if (Date.now() - fs.statSync(full).mtimeMs > MAX_SPOOL_AGE_MS) fs.unlinkSync(full) } catch {}
      }
    } catch {}
    return n
  }

  list() {
    return this.messages.map(m => ({
      id: m.id, from: m.from, subject: m.subject, date: m.date,
      preview: m.preview, read: m.read, received_at: m.received_at,
      hasAttachments: (m.attachments || []).length > 0
    }))
  }

  get(id) { return this.messages.find(m => m.id === id) || null }

  markRead(id) {
    const m = this.get(id)
    if (!m) return false
    m.read = true; this._save(); return true
  }

  markAllRead() {
    for (const m of this.messages) m.read = true
    this._save(); return true
  }

  remove(id) {
    const i = this.messages.findIndex(m => m.id === id)
    if (i < 0) return false
    this.messages.splice(i, 1); this._save(); return true
  }

  // Attribute a message to the customer who sent it, for quick reply.
  replyToAddress(id) {
    const m = this.get(id)
    return m ? extractEmail(m.from) : ''
  }
}

module.exports = { Inbox, parseEml }
