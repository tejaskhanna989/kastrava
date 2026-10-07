// Tiny JSON-backed store for orders + licenses. Used by the dev server and
// local installs alike; swap for SQLite when volume grows.
const fs = require('fs')
const path = require('path')

class Store {
  constructor(file) {
    this.file = file
    this.data = { orders: {}, subscriptions: {}, licenses: {} }
    this.load()
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.data.orders = raw.orders || {}
      this.data.subscriptions = raw.subscriptions || {}
      this.data.licenses = raw.licenses || {}
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

  touchDevice(key, machineId, name) {
    const l = this.getLicense(key)
    if (!l) return -1
    if (!l.devices) l.devices = {}
    const m = String(machineId || '').toUpperCase()
    if (!m) return Object.keys(l.devices).length
    const now = new Date().toISOString()
    if (!l.devices[m]) l.devices[m] = { first_seen: now, name: String(name || '').slice(0, 60) || null }
    l.devices[m].last_seen = now
    if (name) l.devices[m].name = String(name).slice(0, 60)
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

  createSession(email, ttlMs) {
    this.ensureAccountMaps()
    const tokenHashKey = (t) => require('crypto').createHash('sha256').update(t).digest('hex')
    const token = 'kas_' + require('crypto').randomBytes(32).toString('hex')
    this.data.sessions[tokenHashKey(token)] = {
      email: String(email).toLowerCase(),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlMs).toISOString()
    }
    this.save()
    return token
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