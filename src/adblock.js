const { app, net, session } = require('electron')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const FILTER_DIR = () => path.join(app.getPath('userData'), 'data', 'filters')
const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt'
const EASYPRIVACY_URL = 'https://easylist.to/easylist/easyprivacy.txt'
const ANNOYANCE_URL = 'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt'
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000

let filterRules = []
let filterRegex = []
let enabled = true
// Host fast-path: base domains pulled from ||-anchored rules. shouldBlock
// first walks the URL's host parents against this set (microseconds); only
// hosts with a candidate rule pay for the full regex scan. Same verdicts,
// ~99% of first-party requests skip the scan entirely.
let hostSet = new Set()
let isLoaded = false
function hostOf(url) {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h || ''
  } catch { return '' }
}
function hostHit(host) {
  if (!host || !hostSet.size) return false
  let h = host
  while (true) {
    if (hostSet.has(h)) return true
    const i = h.indexOf('.')
    if (i < 0) return false
    h = h.slice(i + 1)
  }
}
let stats = { blocked: 0, allowed: 0 }

function ensureFilterDir() {
  const dir = FILTER_DIR()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const req = proto.get(url, { headers: { 'User-Agent': 'Kastrava/101' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try {
          fs.writeFileSync(destPath, Buffer.concat(chunks))
          resolve()
        } catch (e) { reject(e) }
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function parseFilterLine(line) {
  line = line.trim()
  if (!line || line[0] === '!' || line[0] === '[' || line.startsWith('<!--')) return null
  if (line.startsWith('@@')) return null
  if (line.includes('#@#') || line.includes('#?#')) return null
  if (line.startsWith('#')) return null

  // Strip filter options (everything after $)
  let optIdx = line.indexOf('$')
  if (optIdx !== -1) {
    const opts = line.slice(optIdx + 1).toLowerCase()
    // Skip domain-restricted rules (we can't check referrer domain)
    if (opts.includes('domain=') || opts.includes('site=')) return null
    // Skip popup/overlay rules (not network-level blocks)
    if (opts.includes('popup') || opts.includes('document')) return null
    line = line.slice(0, optIdx)
  }

  let pattern = line

  // Handle domain-anchored rules (||domain)
  if (pattern.startsWith('||')) {
    pattern = pattern.slice(2)
    // Must contain a dot to be a domain pattern
    if (!pattern.includes('.')) return null
    // Feed the host fast-path set (strip path/options remnants).
    try {
      let hd = pattern.split(/[/^|]/)[0].toLowerCase().replace(/^\.+|\.+$/, '')
      if (hd && hd.includes('.') && !hd.includes('*') && !hd.includes('?')) hostSet.add(hd)
    } catch {}

    // Strip trailing | (end-of-URL anchor)
    let endAnchor = ''
    if (pattern.endsWith('|')) {
      pattern = pattern.slice(0, -1)
      endAnchor = '([/?&#]|$)'
    }

    // Strip trailing ^ (separator)
    if (pattern.endsWith('^')) {
      pattern = pattern.slice(0, -1)
      endAnchor = '([/?&#]|$)'
    }

    pattern = '^https?://([a-z0-9-]+\\.)*' + pattern.replace(/\./g, '\\.') + endAnchor
    try { return new RegExp(pattern, 'i') } catch { return null }
  }

  // Skip lines that don't look like URL patterns
  if (!pattern.includes('.') && !pattern.startsWith('/') && !pattern.startsWith('|')) return null
  if (pattern.length < 5) return null

  // Left-anchored (| at start)
  if (pattern.startsWith('|')) {
    pattern = pattern.slice(1)
    if (pattern.startsWith('http')) {
      try {
        const hh = new URL(pattern).hostname.toLowerCase()
        if (hh && hh.includes('.')) hostSet.add(hh)
      } catch {}
      // Strip trailing |
      let endAnchor = ''
      if (pattern.endsWith('|')) { pattern = pattern.slice(0, -1); endAnchor = '$' }
      if (pattern.endsWith('^')) { pattern = pattern.slice(0, -1); endAnchor = '([/?&#]|$)' }
    if (pattern.endsWith('?')) pattern = pattern.slice(0, -1)
    pattern = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[a-z0-9._%-]*').replace(/\?/g, '.').replace(/\^/g, '[/?&#]').replace(/\//g, '\\/') + endAnchor
    } else {
      return null
    }
    try { return new RegExp(pattern, 'i') } catch { return null }
  }

  // Contains a domain-like pattern — convert to substring match.
  // Feed the host fast-path so verdicts stay identical.
  try {
    const dm = pattern.match(/([a-z0-9-]+\.)+[a-z]{2,}/i)
    if (dm) {
      let hd = dm[0].toLowerCase().replace(/^\.+|\.+$/, '')
      if (hd && hd.includes('.')) hostSet.add(hd)
    }
  } catch {}
  if (!pattern.includes('.')) return null

  // Strip trailing |
  if (pattern.endsWith('|')) pattern = pattern.slice(0, -1)
  if (pattern.endsWith('^')) pattern = pattern.slice(0, -1)
  if (pattern.endsWith('?')) pattern = pattern.slice(0, -1)

  pattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '[a-z0-9._%-]*').replace(/\?/g, '.').replace(/\^/g, '[/?&#]').replace(/\//g, '\\/')
  // Require at least 3 escaped dots (sub.domain.tld) for substring matching to avoid false positives
  const dotCount = (pattern.match(/\\\./g) || []).length
  if (dotCount < 3) return null

  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

async function loadFilters() {
  const dir = ensureFilterDir()
  const sources = [
    { url: EASYLIST_URL, file: 'easylist.txt' },
    { url: EASYPRIVACY_URL, file: 'easyprivacy.txt' },
    { url: ANNOYANCE_URL, file: 'easylist_cookie.txt' }
  ]

  const downloaded = []
  for (const src of sources) {
    const dest = path.join(dir, src.file)
    const exists = fs.existsSync(dest)
    const age = exists ? Date.now() - fs.statSync(dest).mtimeMs : Infinity
    if (age < REFRESH_INTERVAL && exists) {
      downloaded.push(fs.readFileSync(dest, 'utf-8'))
      continue
    }
    try {
      await downloadFile(src.url, dest)
      downloaded.push(fs.readFileSync(dest, 'utf-8'))
      console.log(`[AdBlock] downloaded ${src.file}`)
    } catch (e) {
      console.error(`[AdBlock] failed to download ${src.file}:`, e.message)
      if (exists) downloaded.push(fs.readFileSync(dest, 'utf-8'))
    }
  }

  filterRules = []
  filterRegex = []
  for (const text of downloaded) {
    const lines = text.split('\n')
    for (const line of lines) {
      const re = parseFilterLine(line)
      if (re) filterRegex.push(re)
    }
  }
  isLoaded = true
  console.log(`[AdBlock] loaded ${filterRegex.length} filter rules`)
}

// Payments and our own infrastructure are never blocked, no matter what
// a future filter-list update adds. A broken checkout is worse than an ad.
const NEVER_BLOCK = new Set([
  'api.razorpay.com', 'checkout.razorpay.com',
  'paypal.com', 'www.paypal.com', 'paypalobjects.com',
  'kastrava.in', 'store.kastrava.in', 'api.kastrava.in',
  'search.kastrava.in', 'account.kastrava.in'
])

// Known ad-serving hosts that are always blocked (supplements EasyList).
// YouTube ads often come from these; googlevideo.com is deliberately NOT
// listed here because it also serves the actual video stream.
const BLOCK_HOSTS = new Set([
  'googleadservices.com',
  'doubleclick.net',
  'pubads.g.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'googleads.g.doubleclick.net',
  'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com',
  'adservice.google.com',
  'ad.doubleclick.net',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com'
])
function shouldBlock(url) {
  if (!enabled || !isLoaded || !filterRegex.length) return false
  try {
    const h = new URL(url).hostname.toLowerCase()
    if (NEVER_BLOCK.has(h)) return false
    // Host fast-path: known ad domains are blocked immediately.
    let hh = h
    while (true) {
      if (BLOCK_HOSTS.has(hh)) { stats.blocked++; return true }
      const i = hh.indexOf('.')
      if (i < 0) break
      hh = hh.slice(i + 1)
    }
  } catch {}
  if (!hostHit(hostOf(url))) { stats.allowed++; return false }
  // ~99% of requests die here: host has no candidate rule, no scan.
  if (!hostHit(hostOf(url))) { stats.allowed++; return false }
  for (const re of filterRegex) {
    if (re.test(url)) {
      stats.blocked++
      return true
    }
  }
  stats.allowed++
  return false
}

function getStats() {
  return { ...stats, rules: filterRegex.length, loaded: isLoaded, enabled }
}
function setEnabled(v) { enabled = !!v }
function isEnabled() { return enabled }

function install(sessionObj) {
  if (!sessionObj) return
  sessionObj.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      callback({})
      return
    }
    if (shouldBlock(details.url)) {
      callback({ cancel: true })
      return
    }
    callback({})
  })
}

module.exports = { loadFilters, shouldBlock, getStats, install, ensureFilterDir, setEnabled, isEnabled }
