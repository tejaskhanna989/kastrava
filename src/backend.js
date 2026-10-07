const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const DEFAULTS = {
  searchEngine: 'kastravasearch',
  customEngine: '',
  accent: '#4fc3f7',
  theme: '',
  startup: 'last',
  confirmClose: 'off',
  historyEnabled: 'on',
  bookmarksEnabled: 'on',
  bookmarkBar: 'auto',
  suggest: 'off',
  fontSize: '12',
  reduceAnimations: 'off',
  hwAcc: 'on',
  dnt: 'on',
  tracking: 'strict',
  cookies: 'off',
  location: 'block',
  zoom: '100',
  uiRadius: 'medium',
  speedDial: 'comfortable',
  showHomeBtn: 'off',
  showCopyBtn: 'on',
  showNtpClock: 'on',
  showNtpLogo: 'on',
  tabLayout: 'horizontal',
  uiStyle: 'firefox',
  vtabsCollapsed: 'off',
  setupDone: '',
  shortcuts: {},
  maxSuggestions: '8',
  launchMaximized: 'off',
  sendReferrer: 'off',
  cursorFx: 'off',
  cursorFxMode: 'color',
  cursorFxColor: '#4fc3f7',
  cursorFxForce: 'medium',
  cursorFxSize: 'medium',
  blobFx: 'off',
  blobColor: '#2f6fed',
  blobCount: '3',
  blobSize: 'medium',
  blobOpacity: '0.6',
  blobShape: 'circle',
  glassFx: 'off',
  glassColor: '#3b82f6',
  glassShape: 'sphere',
  glassSize: 'medium',
  glassOpacity: '0.5',
  particleFx: 'off',
  particleColor: '#3b82f6',
  particleSize: 'medium',
  particleDensity: 'medium',
  clickSparkFx: 'off',
  clickSparkColor: '#ffffff',
  clickSparkSize: 'medium',
  clickSparkCount: '8',
  clickSparkDuration: '400',
  pixelTrailFx: 'off',
  pixelTrailColor: '#ffffff',
  pixelTrailGrid: 'medium',
  pixelTrailTrail: 'medium',
  ribbonsFx: 'off',
  ribbonsColor: '#2f6fed',
  ribbonsThickness: 'medium',
  ribbonsPoints: '50',
  cursorStyle: 'system',
  cursorStyleColor: '#ffffff',
  webrtcMode: 'disable',
  jsGlobal: 'on',
  images: 'on',
  doh: 'off',
  startupUrls: '',
  showFullUrls: 'off',
  ntpQuick: 'on',
  ntpSearch: 'on',
  ntpBg: 'default',
  ntpTiles: '8',
  tabFavicons: 'on',
  clearHistoryOnExit: 'off',
  historyKeep: '0',
  maxTabs: '0',
  askDlLoc: 'off',
  dlDir: '',
  proxy: { enabled: false, type: 'socks5', host: '', port: '' },
  migrateKs: ''
}

const PREFS_KEYS = ['hwAcc', 'dnt', 'doh']

function prefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json')
}

function readPrefsSync() {
  try {
    const raw = fs.readFileSync(prefsPath(), 'utf-8')
    const o = JSON.parse(raw)
    return typeof o === 'object' && o ? o : {}
  } catch { return {} }
}

function writePrefsSync(prefs) {
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true })
    fs.writeFileSync(prefsPath(), JSON.stringify(prefs, null, 2))
  } catch {}
}

const DOH_SERVERS = {
  cloudflare: 'https://1.1.1.1/dns-query',
  quad9: 'https://dns.quad9.net/dns-query',
  google: 'https://dns.google/dns-query'
}
function initPreReady() {
  const prefs = readPrefsSync()
  if (prefs.hwAcc === 'off') {
    try { app.disableHardwareAcceleration() } catch {}
  }
  // Encrypted DNS, applied before any network runs. Needs a restart.
  if (prefs.doh && prefs.doh !== 'off' && DOH_SERVERS[prefs.doh]) {
    try { app.commandLine.appendSwitch('dns-over-https-mode', 'secure') } catch {}
    try { app.commandLine.appendSwitch('dns-over-https-servers', DOH_SERVERS[prefs.doh]) } catch {}
  }
  return prefs
}

function createSettingsBackend({ all, run }) {
  const cache = Object.assign({}, DEFAULTS)

  function load() {
    const rows = all('SELECT key, value FROM settings')
    const stored = {}
    for (const r of rows) {
      try { stored[r.key] = JSON.parse(r.value) } catch { stored[r.key] = r.value }
    }
    for (const k in stored) {
      if (stored[k] !== undefined && stored[k] !== null && k !== 'session') {
        cache[k] = stored[k]
      }
    }
    if (cache.migrateKs !== '1' && cache.searchEngine !== 'kastravasearch') {
      cache.searchEngine = 'kastravasearch'
      cache.migrateKs = '1'
      if (run) {
        run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['searchEngine', JSON.stringify(cache.searchEngine)])
        run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['migrateKs', JSON.stringify('1')])
      }
    }
    return Object.assign({}, cache)
  }

  function getAll() {
    return Object.assign({}, cache)
  }

  function set(key, value) {
    cache[key] = value
    if (run) run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)])
    if (PREFS_KEYS.includes(key)) {
      const prefs = readPrefsSync()
      prefs[key] = value
      writePrefsSync(prefs)
    }
  }

  function get(key) {
    return cache[key]
  }

  return { load, getAll, set, get }
}

function createRadarBackend({ send }) {
  const map = new Map()
  const mainHost = new Map()
  const MAX_EVENTS = 300

  function setMain(wcId, host) {
    if (!wcId || !host) return
    mainHost.set(wcId, host)
  }

  function isThird(wcId, host) {
    const mh = mainHost.get(wcId)
    if (!mh) return false
    return host !== mh
  }

  function add(wcId, ev) {
    if (!wcId) return
    ev = Object.assign({ third: isThird(wcId, ev.host) }, ev)
    if (!map.has(wcId)) map.set(wcId, [])
    const arr = map.get(wcId)
    if (arr.length >= MAX_EVENTS) arr.shift()
    arr.push(ev)
    if (send) send(wcId, ev)
  }

  function get(wcId) {
    return map.get(wcId) || []
  }

  function clear(wcId) {
    map.delete(wcId)
    mainHost.delete(wcId)
  }

  function stats(wcId) {
    const mh = mainHost.get(wcId)
    const doms = {}
    let reqs = 0, cookies = 0, third = 0
    for (const e of get(wcId)) {
      reqs++
      if (e.kind === 'cookie') cookies++
      const host = e.host || 'unknown'
      if (!doms[host]) doms[host] = { req: 0, cookie: 0, third: 0 }
      doms[host].req++
      if (e.kind === 'cookie') doms[host].cookie++
      if (e.third) { doms[host].third++; third++ }
    }
    const score = Math.max(0, 100 - reqs * 0.4 - cookies * 2)
    return { mh, doms, reqs, cookies, third, score: Math.round(score) }
  }

  return { setMain, isThird, add, get, clear, stats }
}

module.exports = { DEFAULTS, readPrefsSync, writePrefsSync, initPreReady, createSettingsBackend, createRadarBackend }
