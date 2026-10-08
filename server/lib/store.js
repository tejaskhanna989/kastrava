// Tiny JSON-backed store for orders + licenses. Used by the dev server and
// local installs alike; swap for SQLite when volume grows.
const fs = require('fs')
const path = require('path')

class Store {
  constructor(file) {
    this.file = file
    this.data = { orders: {}, subscriptions: {}, licenses: {}, accounts: {}, sessions: {}, sync: {} }
    this.load()
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.data.orders = raw.orders || {}
      this.data.subscriptions = raw.subscriptions || {}
      this.data.licenses = raw.licenses || {}
      // Accounts, sessions and sync blobs must survive restarts exactly
      // like orders and licenses — losing them logs everyone out and drops
      // synced data on every deploy.
      this.data.accounts = raw.accounts || {}
      this.data.sessions = raw.sessions || {}
      this.data.sync = raw.sync || {}
      // Grandfathered logins predate verification: they stay working.
      for (const e in this.data.accounts) {
        if (this.data.accounts[e].verified === undefined) this.data.accounts[e].verified = true
      }
    } catch {}
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 })
  }

  // ---- orders ----
  createOrder(orderId, meta) {
    this.data.orders[orderId] = { status: 'created', created_at: new Date().toISOString(), ...meta }
    this.save()
    return this.data.orders[orderId]
  }

  getOrder(orderId) {
    return this.data.orders[orderId] || null
  }

  markPaid(orderId, paymentId, amountPaise) {
    const o = this.getOrder(orderId)
    if (!o) return null
    o.status = 'paid'
    o.payment_id = paymentId
    if (Number(amountPaise) > 0) o.amount_paise = Number(amountPaise)
    o.paid_at = new Date().toISOString()
    this.save()
    return o
  }

  keyForOrder(orderId) {
    for (const k in this.data.licenses) {
      if (this.data.licenses[k].order_id === orderId) return k
    }
    return null
  }

  // ---- subscriptions ----
  createSubscription(subId, meta) {
    this.data.subscriptions[subId] = { status: 'created', created_at: new Date().toISOString(), ...meta }
    this.save()
    return this.data.subscriptions[subId]
  }

  getSubscription(subId) {
    return this.data.subscriptions[subId] || null
  }

  markSubPaid(subId, paymentId, currentEnd) {
    const s = this.getSubscription(subId)
    if (!s) return null
    s.status = 'active'
    s.payment_id = paymentId
    if (currentEnd) s.current_end = currentEnd
    s.paid_at = new Date().toISOString()
    this.save()
    return s
  }

  setSubscriptionStatus(subId, status) {
    const s = this.getSubscription(subId)
    if (!s) return null
    s.status = status
    s.updated_at = new Date().toISOString()
    this.save()
    return s
  }

  linkSubKey(subId, key, paymentId, status) {
    const s = this.getSubscription(subId)
    if (!s) return null
    if (key) s.key = key
    if (paymentId) s.last_payment = paymentId
    if (status) s.status = status
    s.updated_at = new Date().toISOString()
    this.save()
    return s
  }

  keyForSubscription(subId) {
    for (const k in this.data.licenses) {
      if (this.data.licenses[k].subscription_id === subId) return k
    }
    return null
  }

  // ---- licenses ----
  getLicense(key) {
    return this.data.licenses[key] || null
  }

  issueLicense(key, orderId, subscriptionId, expiresAt) {
    this.data.licenses[key] = {
      key,
      order_id: orderId || null,
      subscription_id: subscriptionId || null,
      status: 'issued',
      machine_id: null,
      expires_at: expiresAt || null,
      issued_at: new Date().toISOString()
    }
    this.save()
    return this.data.licenses[key]
  }

  // Renewal: point a paid order back at the license it extended, so
  // re-verification stays idempotent.
  setLicenseOrder(key, orderId) {
    const l = this.getLicense(key)
    if (!l) return null
    l.order_id = orderId
    this.save()
    return l
  }

  // The (single) license bound to a machine, used so a renewal payment with
  // the machine code extends the existing key instead of minting a new one.
  licenseForMachine(machineId) {
    const m = String(machineId || '').toUpperCase()
    if (!m) return null
    for (const k in this.data.licenses) {
      const l = this.data.licenses[k]
      if (l.machine_id && l.machine_id.toUpperCase() === m) return l
    }
    return null
  }

  extendLicense(key, expiresAt) {
    const l = this.getLicense(key)
    if (!l) return null
    l.expires_at = expiresAt
    l.renewed_at = new Date().toISOString()
    if (l.status === 'expired') l.status = 'activated'
    this.save()
    return l
  }

  bindLicense(key, machineId) {
    const l = this.getLicense(key)
    if (!l) return null
    l.machine_id = machineId
    l.status = 'activated'
    l.activated_at = new Date().toISOString()
    this.save()
    return l
  }

  releaseLicense(key) {
    const l = this.getLicense(key)
    if (!l) return null
    l.machine_id = null
    l.status = 'released'
    l.released_at = new Date().toISOString()
    this.save()
    return l
  }

  all() {
    return this.data
  }

  // ---- account-bound licensing (10 devices per key) ----
  setAccountEmail(key, email) {
    const l = this.getLicense(key)
    if (!l) return null
    l.account_email = String(email).toLowerCase()
    if (!l.devices) l.devices = {}
    this.save()
    return l
  }

  keysForAccount(email) {
    const e = String(email || '').toLowerCase()
    if (!e) return []
    return Object.values(this.data.licenses).filter((l) => l.account_email === e)
  }

  touchDevice(key, machineId, name, version) {
    const l = this.getLicense(key)
    if (!l) return -1
    if (!l.devices) l.devices = {}
    const m = String(machineId || '').toUpperCase()
    if (!m) return Object.keys(l.devices).length
    const now = new Date().toISOString()
    if (!l.devices[m]) l.devices[m] = { first_seen: now, name: String(name || '').slice(0, 60) || null }
    l.devices[m].last_seen = now
    if (name) l.devices[m].name = String(name).slice(0, 60)
    if (version) l.devices[m].app_version = String(version).slice(0, 20)
    this.save()
    return Object.keys(l.devices).length
  }

  removeDevice(key, machineId) {
    const l = this.getLicense(key)
    if (!l || !l.devices) return 0
    delete l.devices[String(machineId || '').toUpperCase()]
    this.save()
    return Object.keys(l.devices).length
  }

  // ---- accounts (Kastrava logins for sync) ----
  // Passwords: scrypt hash + salt, server-side. Sync payloads are opaque
  // client-encrypted blobs — the server can never read bookmarks/prefs.
  ensureAccountMaps() {
    if (!this.data.accounts) this.data.accounts = {}
    if (!this.data.sessions) this.data.sessions = {}
    if (!this.data.sync) this.data.sync = {}
  }

  getAccountByEmail(email) {
    this.ensureAccountMaps()
    const e = String(email || '').trim().toLowerCase()
    return this.data.accounts[e] || null
  }

  createAccount(email, passHash, passSalt, authSalt, syncSalt) {
    this.ensureAccountMaps()
    const e = String(email || '').trim().toLowerCase()
    if (this.data.accounts[e]) return null
    this.data.accounts[e] = {
      email: e, pass_hash: passHash, pass_salt: passSalt,
      auth_salt: authSalt, sync_salt: syncSalt,
      created_at: new Date().toISOString()
    }
    this.save()
    return this.data.accounts[e]
  }

  createSession(email, ttlMs, meta) {
    this.ensureAccountMaps()
    const tokenHashKey = (t) => require('crypto').createHash('sha256').update(t).digest('hex')
    const token = 'kas_' + require('crypto').randomBytes(32).toString('hex')
    const h = tokenHashKey(token)
    this.data.sessions[h] = {
      id: h.slice(0, 12),
      email: String(email).toLowerCase(),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      last_seen: new Date().toISOString(),
      label: String((meta && meta.label) || '').slice(0, 60) || null,
      ip: String((meta && meta.ip) || '').slice(0, 45) || null
    }
    this.save()
    return token
  }

  // Refresh last_seen at most every 10 minutes to avoid a disk write per call.
  touchSession(token) {
    this.ensureAccountMaps()
    if (!token || !token.startsWith('kas_')) return
    const h = require('crypto').createHash('sha256').update(token).digest('hex')
    const s = this.data.sessions[h]
    if (!s) return
    if (Date.now() - new Date(s.last_seen || 0).getTime() < 600000) return
    s.last_seen = new Date().toISOString()
    this.save()
  }

  sessionsForAccount(email) {
    this.ensureAccountMaps()
    const e = String(email || '').toLowerCase()
    return Object.entries(this.data.sessions)
      .filter(([h, s]) => s.email === e && new Date(s.expires_at).getTime() >= Date.now())
      .map(([h, s]) => ({ id: s.id || h.slice(0, 12), created_at: s.created_at, last_seen: s.last_seen,
        label: s.label || null, ip: s.ip || null, expires_at: s.expires_at }))
  }

  // Revoke one session by id prefix, or everything except the caller's token.
  revokeSession(email, id) {
    this.ensureAccountMaps()
    const e = String(email || '').toLowerCase()
    const idp = String(id || '')
    let n = 0
    for (const h in this.data.sessions) {
      const s = this.data.sessions[h]
      if (s.email === e && h.startsWith(idp) && idp.length >= 6) { delete this.data.sessions[h]; n++ }
    }
    if (n) this.save()
    return n
  }

  revokeOtherSessions(email, keepToken) {
    this.ensureAccountMaps()
    const e = String(email || '').toLowerCase()
    const keepH = keepToken ? require('crypto').createHash('sha256').update(String(keepToken)).digest('hex') : null
    let n = 0
    for (const h in this.data.sessions) {
      const s = this.data.sessions[h]
      if (s.email === e && h !== keepH) { delete this.data.sessions[h]; n++ }
    }
    if (n) this.save()
    return n
  }

  getSessionAccount(token) {
    this.ensureAccountMaps()
    if (!token || !token.startsWith('kas_')) return null
    const h = require('crypto').createHash('sha256').update(token).digest('hex')
    const s = this.data.sessions[h]
    if (!s) return null
    if (new Date(s.expires_at).getTime() < Date.now()) {
      delete this.data.sessions[h]
      this.save()
      return null
    }
    // Session list stays fresh without a write on every request.
    if (Date.now() - new Date(s.last_seen || 0).getTime() > 600000) {
      s.last_seen = new Date().toISOString()
      this.save()
    }
    return this.getAccountByEmail(s.email)
  }

  destroySession(token) {
    this.ensureAccountMaps()
    if (!token) return
    const h = require('crypto').createHash('sha256').update(String(token)).digest('hex')
    if (this.data.sessions[h]) {
      delete this.data.sessions[h]
      this.save()
    }
  }

  // ---- two-factor auth (TOTP, zero dependencies) ----
  totpSetup(email) {
    this.ensureAccountMaps()
    const acc = this.getAccountByEmail(email)
    if (!acc || acc.totp_secret) return null
    const secret = require('crypto').randomBytes(20).toString('base64')
      .replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=+$/, '').toUpperCase()
      .replace(/[^A-Z2-7]/g, '').slice(0, 32)
    acc.totp_pending = { secret, created_at: new Date().toISOString() }
    this.save()
    const e = String(email).toLowerCase()
    const url = 'otpauth://totp/Kastrava:' + encodeURIComponent(e) +
      '?secret=' + secret + '&issuer=Kastrava&digits=6&period=30'
    return { secret, otpauth_url: url }
  }

  totpConfirm(email, code) {
    this.ensureAccountMaps()
    const acc = this.getAccountByEmail(email)
    if (!acc || !acc.totp_pending) return null
    if (Date.now() - new Date(acc.totp_pending.created_at).getTime() > 600000) {
      delete acc.totp_pending
      this.save()
      return null
    }
    const ok = require('./totp').verify(acc.totp_pending.secret, String(code || ''))
    if (!ok) return false
    acc.totp_secret = acc.totp_pending.secret
    delete acc.totp_pending
    const recovery = []
    const hashes = []
    for (let i = 0; i < 10; i++) {
      const c = require('crypto').randomBytes(5).toString('hex').toUpperCase().slice(0, 8)
      recovery.push(c)
      hashes.push(require('crypto').createHash('sha256').update(c).digest('hex'))
    }
    acc.totp_recovery = hashes
    this.save()
    return recovery
  }

  totpDisable(email) {
    const acc = this.getAccountByEmail(email)
    if (!acc) return false
    delete acc.totp_secret
    delete acc.totp_pending
    delete acc.totp_recovery
    this.save()
    return true
  }

  // Returns 'totp' | 'recovery' | false. Recovery codes burn on use.
  totpCheck(email, code) {
    const acc = this.getAccountByEmail(email)
    if (!acc || !acc.totp_secret) return false
    const c = String(code || '').replace(/\s/g, '')
    if (!c) return false
    if (require('./totp').verify(acc.totp_secret, c)) return 'totp'
    const h = require('crypto').createHash('sha256').update(c.toUpperCase()).digest('hex')
    const idx = (acc.totp_recovery || []).indexOf(h)
    if (idx >= 0) {
      acc.totp_recovery.splice(idx, 1)
      this.save()
      return 'recovery'
    }
    return false
  }

  // ---- email codes (verification, login OTP, password reset) ----
  // One active code per (email, purpose). 10 minutes to live, 5 tries.
  _codeMaps() {
    this.ensureAccountMaps()
    if (!this.data.email_codes) this.data.email_codes = {}
    if (!this.data.email_sends) this.data.email_sends = {}
  }

  emailThrottled(email) {
    this._codeMaps()
    const e = String(email || '').toLowerCase()
    const hourAgo = Date.now() - 3600000
    const log = (this.data.email_sends[e] || []).filter((t) => t > hourAgo)
    this.data.email_sends[e] = log
    if (log.length >= 5) return true
    log.push(Date.now())
    this.save()
    return false
  }

  // Returns the plain code (to email), or null when throttled.
  issueEmailCode(email, purpose) {
    this._codeMaps()
    const e = String(email || '').toLowerCase()
    if (this.emailThrottled(email)) return null
    let code = ''
    for (let i = 0; i < 6; i++) code += Math.floor(require('crypto').randomInt(0, 10))
    this.data.email_codes[e + '|' + purpose] = {
      hash: require('crypto').createHash('sha256').update(code).digest('hex'),
      created_at: new Date().toISOString(), attempts: 0
    }
    this.save()
    return code
  }

  // Returns true once per correct code; burns it.
  checkEmailCode(email, purpose, code) {
    this._codeMaps()
    const e = String(email || '').toLowerCase()
    const k = e + '|' + purpose
    const rec = this.data.email_codes[k]
    if (!rec) return false
    if (Date.now() - new Date(rec.created_at).getTime() > 600000) {
      delete this.data.email_codes[k]
      this.save()
      return false
    }
    rec.attempts = (rec.attempts || 0) + 1
    if (rec.attempts > 5) {
      delete this.data.email_codes[k]
      this.save()
      return false
    }
    const h = require('crypto').createHash('sha256').update(String(code || '').trim()).digest('hex')
    if (h.length !== rec.hash.length) { this.save(); return false }
    const ok = require('crypto').timingSafeEqual(Buffer.from(h), Buffer.from(rec.hash))
    if (ok) delete this.data.email_codes[k]
    this.save()
    return ok
  }

  setVerified(email, on) {
    const acc = this.getAccountByEmail(email)
    if (!acc) return false
    acc.verified = !!on
    this.save()
    return true
  }

  // Password-verified, waiting on the email code (10 minutes).
  stageLogin(email, label, ip) {
    this._codeMaps()
    if (!this.data.login_pending) this.data.login_pending = {}
    this.data.login_pending[String(email).toLowerCase()] = {
      label: String(label || '').slice(0, 60), ip: String(ip || '').slice(0, 45),
      created_at: new Date().toISOString()
    }
    this.save()
  }

  peekLogin(email) {
    this._codeMaps()
    if (!this.data.login_pending) return null
    const rec = this.data.login_pending[String(email).toLowerCase()]
    if (!rec) return null
    if (Date.now() - new Date(rec.created_at).getTime() > 600000) return null
    return rec
  }

  takeLogin(email) {
    const rec = this.peekLogin(email)
    this._codeMaps()
    if (!this.data.login_pending) return rec
    delete this.data.login_pending[String(email).toLowerCase()]
    this.save()
    return rec
  }

  // ---- audit log (security events per account, newest last, capped) ----
  audit(email, type, detail) {
    this.ensureAccountMaps()
    const e = String(email || '').toLowerCase()
    if (!e) return
    if (!this.data.audit) this.data.audit = {}
    const log = this.data.audit[e] || []
    log.push({ t: new Date().toISOString(), type: String(type).slice(0, 32),
      detail: String(detail || '').slice(0, 160) })
    this.data.audit[e] = log.slice(-100)
    this.save()
  }

  getAudit(email) {
    this.ensureAccountMaps()
    if (!this.data.audit) this.data.audit = {}
    return (this.data.audit[String(email || '').toLowerCase()] || []).slice().reverse()
  }

  // ---- family sharing: owner lends a key, same 10-device pool ----
  shareKey(key, email) {
    const l = this.getLicense(key)
    if (!l) return null
    if (!l.shared_with) l.shared_with = []
    const e = String(email || '').toLowerCase()
    if (!this.getAccountByEmail(e)) return 'no_account'
    if (l.account_email === e) return 'self'
    if (!l.shared_with.includes(e)) l.shared_with.push(e)
    this.save()
    return l
  }

  unshareKey(key, email) {
    const l = this.getLicense(key)
    if (!l || !l.shared_with) return 0
    const e = String(email || '').toLowerCase()
    const before = l.shared_with.length
    l.shared_with = l.shared_with.filter((x) => x !== e)
    // Family devices leave with the share.
    if (l.devices && l.device_owners && l.device_owners[e]) {
      for (const m of l.device_owners[e]) delete l.devices[m]
      delete l.device_owners[e]
    }
    this.save()
    return before - l.shared_with.length
  }

  // Keys visible to an account: owned plus shared (flagged, read-only).
  keysVisibleTo(email) {
    const e = String(email || '').toLowerCase()
    const owned = this.keysForAccount(e).map((l) => ({ lic: l, shared: false }))
    const lent = Object.values(this.data.licenses)
      .filter((l) => (l.shared_with || []).includes(e))
      .map((l) => ({ lic: l, shared: true, owner: l.account_email || null }))
    return owned.concat(lent)
  }

  // Who put each device on a key (owner vs family member email).
  noteDeviceOwner(key, machineId, email) {
    const l = this.getLicense(key)
    if (!l) return
    if (!l.device_owners) l.device_owners = {}
    const m = String(machineId || '').toUpperCase()
    const e = String(email || '').toLowerCase()
    for (const k in l.device_owners) {
      l.device_owners[k] = (l.device_owners[k] || []).filter((x) => x !== m)
      if (!l.device_owners[k].length) delete l.device_owners[k]
    }
    if (!l.device_owners[e]) l.device_owners[e] = []
    if (!l.device_owners[e].includes(m)) l.device_owners[e].push(m)
    this.save()
  }

  // ---- device approvals: new hardware waits for the key owner's OK ----
  setRequireApproval(email, on) {
    this.ensureAccountMaps()
    const acc = this.getAccountByEmail(email)
    if (!acc) return null
    acc.require_approval = !!on
    this.save()
    return acc.require_approval
  }

  requireApproval(email) {
    const acc = this.getAccountByEmail(email)
    return !!(acc && acc.require_approval)
  }

  createApproval(accountEmail, key, machineId, deviceName) {
    this.ensureAccountMaps()
    if (!this.data.approvals) this.data.approvals = {}
    const id = require('crypto').randomBytes(8).toString('hex')
    // One pending request per device: re-taps refresh instead of piling up.
    for (const k in this.data.approvals) {
      const a = this.data.approvals[k]
      if (a.account_email === accountEmail && a.key === key && a.machine_id === machineId) {
        a.created_at = new Date().toISOString()
        if (deviceName) a.device_name = String(deviceName).slice(0, 60)
        this.save()
        return { id: k, refreshed: true }
      }
    }
    this.data.approvals[id] = { id, account_email: accountEmail, key,
      machine_id: machineId, device_name: String(deviceName || '').slice(0, 60) || null,
      created_at: new Date().toISOString() }
    this.save()
    return { id, refreshed: false }
  }

  approvalsFor(email) {
    this.ensureAccountMaps()
    if (!this.data.approvals) this.data.approvals = {}
    const e = String(email || '').toLowerCase()
    return Object.values(this.data.approvals).filter((a) => a.account_email === e)
  }

  resolveApproval(email, id, approve) {
    this.ensureAccountMaps()
    if (!this.data.approvals) this.data.approvals = {}
    const a = this.data.approvals[String(id)]
    if (!a || a.account_email !== String(email).toLowerCase()) return null
    delete this.data.approvals[String(id)]
    this.save()
    return { approval: a, approved: !!approve }
  }

  getSync(email) {
    this.ensureAccountMaps()
    const e = String(email).toLowerCase()
    return this.data.sync[e] || { rev: 0, blob: null, updated_at: null }
  }

  // Returns {ok, rev} or {conflict, rev, blob}.
  pushSync(email, blob, baseRev) {
    this.ensureAccountMaps()
    const e = String(email).toLowerCase()
    const cur = this.getSync(e)
    if (Number(baseRev) !== cur.rev) {
      return { conflict: true, rev: cur.rev, blob: cur.blob, updated_at: cur.updated_at }
    }
    const next = { rev: cur.rev + 1, blob, updated_at: new Date().toISOString() }
    this.data.sync[e] = next
    this.save()
    return { ok: true, rev: next.rev }
  }
}

module.exports = Store