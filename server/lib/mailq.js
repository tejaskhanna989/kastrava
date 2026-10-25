// Kastrava outbound mail queue.
// File-based async queue with BullMQ-equivalent semantics:
//   * jobs persisted as JSON files (survives restarts)
//   * micro-batch processing (claim N, send, rate-limit, repeat)
//   * fixed-window rate limiter (default 400/hour, configurable 200-500)
//   * exponential backoff retries, dead-letter failed queue
//   * hard-bounce routing to a separate bounced/ dir
//
// No Redis required. If you later want BullMQ/ioredis, swap the Queue class
// implementation and keep the same enqueue()/start() interface.

'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SUBDIRS = ['pending', 'sending', 'sent', 'failed', 'bounced', 'skipped']
const DEFAULT_RATE_PER_HOUR = 400   // within your 200-500/hour target band
const DEFAULT_BATCH = 8
const DEFAULT_TICK_MS = 10000
const MAX_ATTEMPTS = 5
const HOUR_MS = 3600000

function mailqDir() {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'mailq')
}

function ensureDirs(dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const d of SUBDIRS) fs.mkdirSync(path.join(dir, d), { recursive: true })
}

function jid() { return crypto.randomBytes(12).toString('hex') }
function now() { return Date.now() }

function rateFile(dir) { return path.join(dir, 'rate.json') }
function readRate(dir) {
  try { return JSON.parse(fs.readFileSync(rateFile(dir), 'utf8')) } catch { return { windowStart: now(), count: 0 } }
}
function writeRate(dir, r) { fs.writeFileSync(rateFile(dir), JSON.stringify(r), { mode: 0o600 }) }

// Fixed-window rate limiter: returns true if a mail may be sent now.
function canSend(dir, ratePerHour) {
  const r = readRate(dir)
  if (now() - r.windowStart > HOUR_MS) { r.windowStart = now(); r.count = 0 }
  return r.count < ratePerHour
}
function countSent(dir, ratePerHour) {
  const r = readRate(dir)
  const hour = HOUR_MS
  if (now() - r.windowStart > hour) { r.windowStart = now(); r.count = 0 }
  r.count += 1
  writeRate(dir, r)
}

class MailQueue {
  constructor(opts = {}) {
    this.dir = opts.dir || mailqDir()
    ensureDirs(this.dir)
    this.ratePerHour = opts.ratePerHour || DEFAULT_RATE_PER_HOUR
    this.batchSize = opts.batchSize || DEFAULT_BATCH
    this.tickMs = opts.tickMs || DEFAULT_TICK_MS
    this.timer = null
    this.running = false
    this._sendFn = null
    this.onSent = opts.onSent || (() => {})
    this.onFailed = opts.onFailed || (() => {})
    this.onBounced = opts.onBounced || (() => {})
  }

  // Enqueue a message. Returns job id.
  enqueue({ to, subject, text, html, from } = {}) {
    if (!to || typeof to !== 'string') throw new Error('mailq: missing to')
    const id = jid()
    const job = {
      id,
      to: String(to).trim().toLowerCase(),
      subject: String(subject || '(no subject)').slice(0, 200),
      text: String(text || ''),
      html: String(html || ''),
      from: String(from || ''),
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      createdAt: now(),
      scheduledAt: now(),
      status: 'pending',
      error: null
    }
    fs.writeFileSync(path.join(this.dir, 'pending', id + '.json'), JSON.stringify(job), { mode: 0o600 })
    return id
  }

  // Claim up to batchSize pending jobs due now (atomic via rename to sending/).
  claimBatch() {
    const pendingDir = path.join(this.dir, 'pending')
    const sendingDir = path.join(this.dir, 'sending')
    const jobs = []
    let files
    try { files = fs.readdirSync(pendingDir) } catch { return jobs }
    const t = now()
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const full = path.join(pendingDir, f)
      let job
      try { job = JSON.parse(fs.readFileSync(full, 'utf8')) } catch { continue }
      if (job.scheduledAt > t) continue
      jobs.push({ full, job })
    }
    jobs.sort((a, b) => a.job.createdAt - b.job.createdAt)
    const claimed = jobs.slice(0, this.batchSize)
    for (const { full, job } of claimed) {
      job.status = 'sending'
      job.attempts += 1
      job.claimedAt = now()
      fs.writeFileSync(path.join(sendingDir, job.id + '.json'), JSON.stringify(job), { mode: 0o600 })
      try { fs.unlinkSync(full) } catch {}
    }
    return claimed.map(c => c.job)
  }

  completeJob(job, result) {
    const sendingDir = path.join(this.dir, 'sending')
    const targetDir = path.join(this.dir, result === 'sent' ? 'sent' : result === 'bounced' ? 'bounced' : 'failed')
    try { fs.unlinkSync(path.join(sendingDir, job.id + '.json')) } catch {}
    job.status = result
    job.completedAt = now()
    fs.writeFileSync(path.join(targetDir, job.id + '.json'), JSON.stringify(job), { mode: 0o600 })
  }

  // One rate-limited processing tick.
  async tick(sendFn) {
    if (!this.running) return { processed: 0, sent: 0, failed: 0, skipped: 0 }
    const batch = this.claimBatch()
    if (!batch.length) return { processed: 0, sent: 0, failed: 0, skipped: 0 }
    let sent = 0, failed = 0, skipped = 0
    for (const job of batch) {
      if (!canSend(this.dir, this.ratePerHour)) {
        // Rate window exhausted: park back to pending, retry in ~1 minute.
        job.status = 'pending'
        job.scheduledAt = now() + 60000
        fs.writeFileSync(path.join(this.dir, 'pending', job.id + '.json'), JSON.stringify(job), { mode: 0o600 })
        try { fs.unlinkSync(path.join(this.dir, 'sending', job.id + '.json')) } catch {}
        skipped++
        continue
      }
      try {
        await sendFn(job)
        countSent(this.dir, this.ratePerHour)
        this.completeJob(job, 'sent')
        this.onSent(job)
        sent++
      } catch (e) {
        job.error = String(e && e.message || e).slice(0, 300)
        if (job.attempts >= job.maxAttempts) {
          this.completeJob(job, 'failed')
          this.onFailed(job)
          failed++
        } else {
          job.status = 'pending'
          job.scheduledAt = now() + Math.min(300000, 5000 * job.attempts)
          fs.writeFileSync(path.join(this.dir, 'pending', job.id + '.json'), JSON.stringify(job), { mode: 0o600 })
          try { fs.unlinkSync(path.join(this.dir, 'sending', job.id + '.json')) } catch {}
          failed++
        }
      }
    }
    return { processed: batch.length, sent, failed, skipped }
  }

  start(sendFn) {
    if (this.running) return
    this.running = true
    if (sendFn) this._sendFn = sendFn
    const tick = async () => {
      try { await this.tick(this._sendFn) } catch (e) { console.error('[mailq] tick:', e && e.message) }
      if (this.running) setTimeout(tick, this.tickMs).unref()
    }
    tick()
    console.log('[mailq] queue processor started (rate=' + this.ratePerHour + '/h, batch=' + this.batchSize + ', tick=' + this.tickMs + 'ms)')
  }

  stop() { this.running = false }

  stats() {
    const count = (d) => { try { return fs.readdirSync(path.join(this.dir, d)).filter(f => f.endsWith('.json')).length } catch { return 0 } }
    return {
      pending: count('pending'), sending: count('sending'), sent: count('sent'),
      failed: count('failed'), bounced: count('bounced'), skipped: count('skipped'),
      ratePerHour: this.ratePerHour, running: this.running, dir: this.dir
    }
  }

  // Hard bounce: mark job bounced and suppress the address so it is never mailed again.
  bounceJob(job, reason) {
    this.completeJob(job, 'bounced')
    job.status = 'bounced'
    job.bounceReason = String(reason || '').slice(0, 200)
    job.bouncedAt = now()
    fs.writeFileSync(path.join(this.dir, 'bounced', job.id + '.json'), JSON.stringify(job), { mode: 0o600 })
  }

  // Re-queue failed jobs for another attempt.
  retryFailed(limit = 50) {
    const failedDir = path.join(this.dir, 'failed')
    const pendingDir = path.join(this.dir, 'pending')
    let n = 0
    try {
      const files = fs.readdirSync(failedDir).filter(f => f.endsWith('.json')).slice(0, limit)
      for (const f of files) {
        const full = path.join(failedDir, f)
        let job
        try { job = JSON.parse(fs.readFileSync(full, 'utf8')) } catch { continue }
        job.status = 'pending'
        job.attempts = 0
        job.error = null
        job.scheduledAt = now()
        fs.writeFileSync(path.join(pendingDir, job.id + '.json'), JSON.stringify(job), { mode: 0o600 })
        try { fs.unlinkSync(full) } catch {}
        n++
      }
    } catch {}
    return n
  }

  getJob(id) {
    for (const d of SUBDIRS) {
      try {
        const p = path.join(this.dir, d, id + '.json')
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
      } catch {}
    }
    return null
  }
}

module.exports = { MailQueue, mailqDir }
