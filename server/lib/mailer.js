// Kastrava outbound mail.
//   * send()/sendAsync()      -> immediate (transactional: codes, receipts)
//   * sendWithQueue()         -> enqueues via MailQueue (broadcasts, newsletters)
//   * Every outbound mail carries List-Unsubscribe + one-click unsubscribe link
//   * Hard bounces route through MailQueue.bounceJob() -> store.suppress()
//
// Env:
//   KAS_MAIL_FROM        default noreply@kastrava.in   (envelope sender for automated mail)
//   KAS_MAIL_TEAM_FROM   default email-center@kastrava.in (admin centre / replies)
//   KAS_MAIL_DEV         =1  -> log instead of sending
//   KAS_MAIL_BASE_URL    public base URL, default http://127.0.0.1:8787  (unsubscribe links)
//   KAS_MAIL_RATE_PER_HOUR default 400 (200-500 recommended)
//   KAS_MAIL_BATCH       default 8   (micro-batch size)
//   KAS_MAIL_TICK_MS     default 10000 (processor tick interval)

'use strict'
const { execFile } = require('child_process')
const crypto = require('crypto')
const { MailQueue } = require('./mailq')

const FROM = process.env.KAS_MAIL_FROM || 'noreply@kastrava.in'
const TEAM_FROM = process.env.KAS_MAIL_TEAM_FROM || 'email-center@kastrava.in'
const DEV = process.env.KAS_MAIL_DEV === '1'
let BASE_URL = (process.env.KAS_MAIL_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')

const storeRef = {}   // populated by init() — gives us accounts + suppression
let queue = null

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()) }

// ---- unsubscribe token --------------------------------------------------
// One-click unsubscribe: GET /api/mail/unsubscribe?token=XXX&email=XXX
function makeUnsubscribeToken(email) {
  if (!storeRef.store || typeof storeRef.store.createUnsubscribeToken !== 'function') return ''
  return storeRef.store.createUnsubscribeToken(email) || ''
}
function consumeUnsubscribeToken(token) {
  if (!storeRef.store || typeof storeRef.store.consumeUnsubscribeToken !== 'function') return null
  return storeRef.store.consumeUnsubscribeToken(token)
}
function isMailable(email) {
  if (!storeRef.store || typeof storeRef.store.isEmailMailable !== 'function') return true
  return storeRef.store.isEmailMailable(email)
}

// Raw sendmail delivery (used both by immediate send and by the queue worker).
function rawSend(to, subject, text, html, from, cb) {
  const done = typeof cb === 'function' ? cb : () => {}
  if (!validEmail(to)) { done(new Error('bad address')); return }
  const sender = validEmail(from) ? String(from).trim() : FROM
  const cleanSubject = String(subject || '(no subject)').replace(/[\r\n]/g, ' ').slice(0, 120)
  const plain = String(text || '')
  const escHtml = plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
  const unsub = makeUnsubscribeToken(to)
  const unsubLink = unsub ? (BASE_URL + '/api/mail/unsubscribe?token=' + encodeURIComponent(unsub) + '&email=' + encodeURIComponent(to)) : ''
  const unsubHtml = unsubLink
    ? '<p style="font-size:11px;color:#8a8474;margin-top:24px;border-top:1px solid #f0ede6;padding-top:12px">'
      + 'No longer want these? <a href="' + unsubLink + '" style="color:#1a73e8">Unsubscribe</a> '
      + 'or reply to this email.'
      + '</p>'
    : ''
  const htmlDoc = '<html><body style="margin:0;padding:0;background:#faf7f1;">' +
    '<div style="max-width:520px;margin:0 auto;padding:28px 20px;font-family:Arial,sans-serif;color:#14110b;">' +
    '<div style="margin-bottom:18px"><img src="https://kastrava.in/logo.png" alt="Kastrava" width="44" style="border-radius:9px;vertical-align:middle">' +
    '<span style="font-size:16px;font-weight:bold;letter-spacing:4px;margin-left:10px">KASTRAVA</span></div>' +
    '<div style="background:#ffffff;border:1px solid #f0ede6;border-radius:14px;padding:22px;font-size:14px;line-height:1.65">' + escHtml + unsubHtml + '</div>' +
    '<div style="font-size:11px;color:#8a8474;margin-top:14px">Kastrava · private by default</div>' +
    '</div></body></html>'
  const bound = 'kas' + crypto.randomBytes(8).toString('hex')
  const listUnsub = unsub
    ? '<https://' + BASE_URL.replace(/^https?:\/\//, '') + '/api/mail/unsubscribe?token=' + encodeURIComponent(unsub) + '&email=' + encodeURIComponent(to) + '>, <mailto:unsubscribe@kastrava.in?subject=unsubscribe%20' + encodeURIComponent(to) + '>'
    : ''
  const body = 'From: Kastrava <' + sender + '>\nTo: ' + to + '\nSubject: ' + cleanSubject +
    (listUnsub ? '\nList-Unsubscribe: ' + listUnsub : '') +
    (listUnsub ? '\nList-Unsubscribe-Post: List-Unsubscribe=One-Click' : '') +
    '\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary="' + bound + '"\n\n' +
    '--' + bound + '\nContent-Type: text/plain; charset=utf-8\n\n' + plain + (unsubLink ? '\n\nUnsubscribe: ' + unsubLink : '') +
    '\n--' + bound + '\nContent-Type: text/html; charset=utf-8\n\n' + htmlDoc +
    '\n--' + bound + '--'
  if (DEV) { console.log('[mail:dev] from=' + sender + ' to=' + to + ' subject=' + cleanSubject + '\n' + plain + (unsubLink ? '\nUNSUBSCRIBE: ' + unsubLink : '')); done(null); return }
  const child = execFile('/usr/sbin/sendmail', ['-t', '-f', sender], (err) => {
    done(err || null)
  })
  try {
    child.stdin.write(body)
    child.stdin.end()
  } catch (e) { done(e) }
}

// ---- public API ---------------------------------------------------------

function init(store, baseUrl) {
  if (store) storeRef.store = store
  if (baseUrl) {
    BASE_URL = baseUrl.replace(/\/$/, '')
  }
  if (!queue) {
    queue = new MailQueue({
      ratePerHour: parseInt(process.env.KAS_MAIL_RATE_PER_HOUR || String(DEFAULT_RATE_PER_HOUR), 10) || DEFAULT_RATE_PER_HOUR,
      batchSize: parseInt(process.env.KAS_MAIL_BATCH || String(DEFAULT_BATCH), 10) || DEFAULT_BATCH,
      tickMs: parseInt(process.env.KAS_MAIL_TICK_MS || String(DEFAULT_TICK_MS), 10) || DEFAULT_TICK_MS,
      onSent: (job) => { try { storeRef.store && storeRef.store.audit && storeRef.store.audit('mailq', 'sent', job.to + ' :: ' + job.subject) } catch {} },
      onFailed: (job) => { try { storeRef.store && storeRef.store.audit && storeRef.store.audit('mailq', 'failed', job.to + ' :: ' + (job.error || 'unknown')) } catch {} },
      onBounced: (job) => { try {
        if (storeRef.store) {
          storeRef.store.setAccountEmailStatus(job.to, 'bounced', job.bounceReason || 'hard_bounce')
          storeRef.store.suppress(job.to, job.bounceReason || 'hard_bounce', 'bounce_processor')
          storeRef.store.audit('mailq', 'bounced', job.to + ' :: ' + (job.bounceReason || 'hard_bounce'))
        }
      } catch {} }
    })
  }
  return queue
}

function getQueue() { return queue }

function setStore(store) { storeRef.store = store }

const DEFAULT_RATE_PER_HOUR = 400
const DEFAULT_BATCH = 8
const DEFAULT_TICK_MS = 10000

// Callback-style immediate send (transactional mail). `from` overrides sender.
function send(to, subject, text, cb, from) {
  const done = typeof cb === 'function' ? cb : () => {}
  if (!isMailable(to)) { done(new Error('suppressed_or_unsubscribed')); return }
  rawSend(to, subject, text, null, from, done)
}
function sendAsync(to, subject, text, from) {
  return new Promise((resolve) => send(to, subject, text, (err) => resolve(!err), from))
}

// Queue a message for batched, rate-limited delivery. Returns job id.
function sendWithQueue({ to, subject, text, html, from } = {}) {
  if (!queue) throw new Error('mailer: queue not initialized — call mailer.init(store) first')
  if (!isMailable(to)) return null
  return queue.enqueue({ to, subject, text, html, from })
}

// Immediate transactional send (verify codes, receipts) — bypasses the queue
// so time-critical mail arrives at once.
function sendTransactional(to, subject, text, from) {
  return new Promise((resolve) => {
    if (!isMailable(to)) { resolve(false); return }
    rawSend(to, subject, text, null, from, (err) => resolve(!err))
  })
}

// Queue worker: pulls from mailq and delivers via rawSend.
async function queueSendFn(job) {
  return new Promise((resolve, reject) => {
    rawSend(job.to, job.subject, job.text, job.html, job.from, (err) => {
      if (err) reject(err); else resolve()
    })
  })
}

module.exports = {
  send, sendAsync, sendWithQueue, sendTransactional,
  FROM, TEAM_FROM, BASE_URL, init, getQueue, setStore, makeUnsubscribeToken,
  consumeUnsubscribeToken, isMailable, queueSendFn
}
