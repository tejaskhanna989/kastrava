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
  const plain = String(text || '')
  const escHtml = plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
  const html = '<html><body style="margin:0;padding:0;background:#faf7f1;">' +
    '<div style="max-width:520px;margin:0 auto;padding:28px 20px;font-family:Arial,sans-serif;color:#14110b;">' +
    '<div style="margin-bottom:18px"><img src="https://kastrava.pp.ua/logo.png" alt="Kastrava" width="44" style="border-radius:9px;vertical-align:middle">' +
    '<span style="font-size:16px;font-weight:bold;letter-spacing:4px;margin-left:10px">KASTRAVA</span></div>' +
    '<div style="background:#ffffff;border:1px solid #f0ede6;border-radius:14px;padding:22px;font-size:14px;line-height:1.65">' + escHtml + '</div>' +
    '<div style="font-size:11px;color:#8a8474;margin-top:14px">Kastrava · private by default</div>' +
    '</div></body></html>'
  const bound = 'kas' + require('crypto').randomBytes(8).toString('hex')
  const body = 'From: Kastrava <' + FROM + '>\nTo: ' + to + '\nSubject: ' + cleanSubject +
    '\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary="' + bound + '"\n\n' +
    '--' + bound + '\nContent-Type: text/plain; charset=utf-8\n\n' + plain +
    '\n--' + bound + '\nContent-Type: text/html; charset=utf-8\n\n' + html +
    '\n--' + bound + '--' 
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
