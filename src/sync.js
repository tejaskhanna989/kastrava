// Phase 2: in-app sync engine (desktop). Zero-knowledge per
// docs/sync-protocol.md — PBKDF2-HMAC-SHA256 (200k) + AES-256-GCM, with the
// server storing only an opaque blob it can never read.
//
// Session + salts persist in the settings DB (same as the license key);
// the encryption key itself lives in memory, backed by the OS keychain
// (safeStorage) so restarts keep syncing without retyping the password.
// License keys sync as a view-only reference and are NEVER auto-activated:
// activation stays machine-bound and server-checked.
const crypto = require('crypto')

const EXCLUDE = new Set([
  'session', 'closedTabs',
  'syncToken', 'syncEmail', 'syncSalts', 'syncKeyEnc',
  'syncRev', 'syncBase', 'syncHash', 'syncLastAt'
])

let memKey = null
let memEmail = null

function stable(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o)
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']'
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}'
}

function hash(o) {
  return crypto.createHash('sha256').update(stable(o)).digest('hex')
}

function deriveKey(password, syncSaltHex) {
  return crypto.pbkdf2Sync(String(password), Buffer.from(syncSaltHex, 'hex'), 200000, 32, 'sha256')
}

function encrypt(key, obj) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const pt = Buffer.from(JSON.stringify(obj), 'utf8')
  const ct = Buffer.concat([c.update(pt), c.final()])
  const tag = c.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

function decrypt(key, blobB64) {
  const raw = Buffer.from(String(blobB64), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ct = raw.subarray(28)
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'))
}

async function api(path, apiBase, token, body) {
  const r = await fetch(String(apiBase).replace(/\/$/, '') + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
      token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(25000)
  })
  let j = {}
  try { j = await r.json() } catch {}
  return { status: r.status, json: j }
}

function loadKey(ss, store) {
  if (memKey && memEmail === store.get('syncEmail')) return memKey
  memKey = null
  memEmail = null
  try {
    const enc = store.get('syncKeyEnc')
    if (!enc || !ss || !ss.isEncryptionAvailable || !ss.isEncryptionAvailable()) return null
    memKey = Buffer.from(ss.decryptString(Buffer.from(enc, 'base64').toString('latin1')), 'hex')
    memEmail = store.get('syncEmail')
    return memKey
  } catch { return null }
}

function stashKey(ss, store, email, keyBuf) {
  memKey = keyBuf
  memEmail = email
  try {
    if (ss && ss.isEncryptionAvailable && ss.isEncryptionAvailable()) {
      store.set('syncKeyEnc', Buffer.from(ss.encryptString(keyBuf.toString('hex')), 'latin1').toString('base64'))
    }
  } catch {}
}

async function login(apiBase, email, password, store, ss, totp) {
  const body = { email, password }
  if (totp) body.totp = totp
  const r = await api('/api/account/login', apiBase, null, body)
  if (!r.json || !r.json.ok || !r.json.token) {
    const err = (r.json && r.json.error) || 'login_failed'
    if (err === 'need_totp') return { ok: false, need_totp: true, msg: (r.json && r.json.msg) || 'Enter your 6-digit authenticator code.' }
    return { ok: false, msg: err === 'bad_login' ? 'Wrong email or password.' : 'Login failed.' }
  }
  store.set('syncToken', r.json.token)
  store.set('syncEmail', r.json.email)
  store.set('syncSalts', { auth: r.json.auth_salt, sync: r.json.sync_salt })
  const key = deriveKey(password, r.json.sync_salt)
  stashKey(ss, store, r.json.email, key)
  store.set('syncRev', 0)
  store.set('syncBase', {})
  store.set('syncHash', '')
  return { ok: true, email: r.json.email }
}

async function logout(store) {
  memKey = null
  memEmail = null
  for (const k of ['syncToken', 'syncEmail', 'syncSalts', 'syncKeyEnc', 'syncRev', 'syncBase', 'syncHash', 'syncLastAt']) {
    try { store.set(k, k === 'syncRev' ? 0 : (k === 'syncBase' ? {} : '')) } catch {}
  }
  return { ok: true }
}

function status(store, ss) {
  const email = store.get('syncEmail') || ''
  const token = store.get('syncToken') || ''
  const hasKey = !!loadKey(ss, store)
  return {
    loggedIn: !!(email && token && hasKey),
    email,
    rev: store.get('syncRev') || 0,
    lastSyncAt: store.get('syncLastAt') || null
  }
}

function snapshotPrefs(allSettings) {
  const out = {}
  for (const k of Object.keys(allSettings || {})) {
    if (!EXCLUDE.has(k)) out[k] = allSettings[k]
  }
  return out
}

async function syncNow(apiBase, store, ss, data) {
  const token = store.get('syncToken') || ''
  const email = store.get('syncEmail') || ''
  if (!token || !email) return { ok: false, msg: 'Not logged in.' }
  const key = loadKey(ss, store)
  if (!key) return { ok: false, msg: 'Unlock sync by logging in again.' }
  const salts = store.get('syncSalts') || {}
  if (!salts.sync) return { ok: false, msg: 'Unlock sync by logging in again.' }

  const pull = await api('/api/sync/pull', apiBase, token, {})
  if (!pull.json || pull.json === null || typeof pull.json.rev !== 'number') {
    return { ok: false, msg: 'Sync server unreachable.' }
  }
  let localRev = store.get('syncRev') || 0
  let base = store.get('syncBase') || {}
  let licenseOnFile = null
  if (pull.json.rev > localRev && pull.json.blob) {
    let remote
    try { remote = decrypt(key, pull.json.blob) } catch { return { ok: false, msg: 'Could not decrypt server copy.' } }
    if (remote && remote.v === 1) {
      if (remote.license && remote.license.key && remote.license.key !== data.licenseKey()) {
        licenseOnFile = remote.license.key
      }
      const cur = snapshotPrefs(data.getSettings())
      const merged = {}
      const rPrefs = remote.prefs || {}
      const keys = new Set(Object.keys(cur).concat(Object.keys(rPrefs)))
      keys.forEach((k) => {
        const b = base[k]
        const c = cur[k]
        // Untouched locally since last sync -> take remote; else keep local.
        merged[k] = (stable(c) === stable(b)) ? rPrefs[k] : c
        if (merged[k] === undefined) delete merged[k]
      })
      for (const k of Object.keys(merged)) {
        try { data.setSetting(k, merged[k]) } catch {}
      }
      const have = new Set((data.getBookmarks() || []).map((b) => b.url))
      for (const b of (remote.bookmarks || [])) {
        if (b && b.u && !have.has(b.u)) {
          try { data.addBookmark({ title: b.t || b.u, url: b.u }); have.add(b.u) } catch {}
        }
      }
      base = merged
      localRev = pull.json.rev
      try {
        store.set('syncBase', base)
        store.set('syncRev', localRev)
      } catch {}
    }
  }

  const prefs = snapshotPrefs(data.getSettings())
  const marks = (data.getBookmarks() || []).map((b) => ({ t: b.title || b.url, u: b.url }))
  const changed = hash({ prefs, marks }) !== (store.get('syncHash') || '')
  if (changed) {
    const envelope = { v: 1, bookmarks: marks, prefs, license: { key: data.licenseKey() || null } }
    const blob = encrypt(key, envelope)
    let push = await api('/api/sync/push', apiBase, token, { blob, base_rev: localRev })
    if (push.status === 409 && push.json && push.json.blob) {
      // Lost the race: merge once against the winner and retry a single time.
      let remote2 = null
      try { remote2 = decrypt(key, push.json.blob) } catch {}
      if (remote2 && remote2.v === 1) {
        const have2 = new Set(marks.map((m) => m.u))
        for (const b of (remote2.bookmarks || [])) {
          if (b && b.u && !have2.has(b.u)) {
            try { data.addBookmark({ title: b.t || b.u, url: b.u }) } catch {}
            marks.push({ t: b.t || b.u, u: b.u })
          }
        }
        const blob2 = encrypt(key, { v: 1, bookmarks: marks, prefs, license: { key: data.licenseKey() || null } })
        push = await api('/api/sync/push', apiBase, token, { blob: blob2, base_rev: push.json.rev })
      }
    }
    if (push.json && push.json.ok) {
      localRev = push.json.rev
      try {
        store.set('syncRev', localRev)
        store.set('syncBase', prefs)
        store.set('syncHash', hash({ prefs, marks }))
        store.set('syncLastAt', new Date().toISOString())
      } catch {}
    } else if (!(pull.json.rev > (store.get('syncRev') || 0))) {
      return { ok: false, msg: 'Sync upload failed.' }
    }
  } else {
    try { store.set('syncLastAt', new Date().toISOString()) } catch {}
  }
  const out = { ok: true, rev: store.get('syncRev') || 0 }
  if (licenseOnFile) out.licenseOnFile = licenseOnFile
  return out
}

module.exports = { login, logout, status, syncNow }
