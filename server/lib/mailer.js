// Outbound mail via the local postfix relay. Sender must be approved in
// the OCI Email Delivery console or the relay rejects the envelope.
'use strict'
const { execFile } = require('child_process')

const FROM = process.env.KAS_MAIL_FROM || 'noreply@kastrava.pp.ua'
const DEV = process.env.KAS_MAIL_DEV === '1'

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()) }

// Callback-style: cb(null) on accepted, cb(err) otherwise.
function send(to, subject, text, cb) {
  const done = typeof cb === 'function' ? cb : () => {}
  if (!validEmail(to)) { done(new Error('bad address')); return }
  const cleanSubject = String(subject || '').replace(/[\r\n]/g, ' ').slice(0, 120)
  const body = 'From: Kastrava <' + FROM + '>\nTo: ' + to + '\nSubject: ' + cleanSubject +
    '\nContent-Type: text/plain; charset=utf-8\n\n' + String(text || '')
  if (DEV) { console.log('[mail:dev] to=' + to + ' subject=' + cleanSubject + '\n' + String(text || '')); done(null); return }
  const child = execFile('/usr/sbin/sendmail', ['-t', '-f', FROM], (err) => {
    done(err || null)
  })
  try {
    child.stdin.write(body)
    child.stdin.end()
  } catch (e) { done(e) }
}

function sendAsync(to, subject, text) {
  return new Promise((resolve) => send(to, subject, text, (err) => resolve(!err)))
}

module.exports = { send, sendAsync, FROM }
