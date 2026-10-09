const { app, BrowserWindow, ipcMain, Menu, nativeTheme, nativeImage, clipboard, shell, dialog, protocol, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync, spawn } = require('child_process')
const backend = require('./backend')
const license = require('./license')
const privacy = require('./privacy')

// Serve the browser UI over kastrava:// instead of file:// so no
// filesystem paths leak (e.g. in DevTools titles) and the shell has a
// proper secure origin.
protocol.registerSchemesAsPrivileged([{
  scheme: 'kastrava',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}])

const preReadyPrefs = backend.initPreReady()

// Volatile RAM: never write GPU shader caches to disk either.
try { app.commandLine.appendSwitch('disable-gpu-shader-disk-cache'); } catch {}

let db
let settingsBackend
let radar
async function initDatabase() {
  try {
    const initSqlJs = require('sql.js')
    const SQL = await initSqlJs()
    const dbDir = path.join(app.getPath('userData'), 'data')
    fs.mkdirSync(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, 'kastrava.db')
    const bakPath = path.join(dbDir, 'kastrava.db.bak')
    let buffer
    try { buffer = fs.readFileSync(dbPath) } catch {}
    // A kill mid-write (or a deleted file) must never boot the user into a
    // factory-fresh profile: fall back to the last good backup.
    if (!buffer || !buffer.length) {
      try { buffer = fs.readFileSync(bakPath) } catch {}
    }
    try {
      db = new SQL.Database(buffer)
    } catch {
      try { db = new SQL.Database(fs.readFileSync(bakPath)) } catch {}
      if (!db) db = new SQL.Database()
    }
    db.run(`CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, url TEXT NOT NULL,
      pos INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, url TEXT NOT NULL,
      visited_at TEXT DEFAULT (datetime('now'))
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS top_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, url TEXT NOT NULL,
      icon TEXT, pos INTEGER DEFAULT 0
    )`)
    // Snapshot the good copy: next launch can recover from this if the
    // live file is ever truncated or deleted underneath us.
    try {
      const n = db.exec(`SELECT COUNT(*) AS c FROM settings`)[0].values[0][0]
      if (n > 0) fs.writeFileSync(bakPath, Buffer.from(fs.readFileSync(dbPath)))
    } catch {}
  } catch (e) {
    console.error('DB init error:', e)
  }
}

function all(sql, params = []) {
  if (!db) return []
  try {
    const stmt = db.prepare(sql)
    if (params.length) stmt.bind(params)
    const cols = stmt.getColumnNames()
    const rows = []
    while (stmt.step()) {
      const vals = stmt.getAsObject()
      rows.push(vals)
    }
    stmt.free()
    return rows
  } catch { return [] }
}

function run(sql, params = []) {
  if (!db) return
  try { db.run(sql, params); saveDb() } catch {}
}

function saveDb() {
  try {
    const data = db.export()
    const buf = Buffer.from(data)
    fs.writeFileSync(path.join(app.getPath('userData'), 'data', 'kastrava.db'), buf)
  } catch (e) { console.error('[DB] save error:', e) }
}

function applyNativeTheme(theme) {
  try {
    if (typeof theme === 'string' && theme.indexOf('dark') === 0) nativeTheme.themeSource = 'dark'
    else if (typeof theme === 'string' && theme.indexOf('light') === 0) nativeTheme.themeSource = 'light'
    else nativeTheme.themeSource = 'system'
  } catch (e) {
    console.error('[Theme] applyNativeTheme error:', e)
  }
}

function initBackend() {
  settingsBackend = backend.createSettingsBackend({ all, run })
  settingsBackend.load()
  applyNativeTheme(settingsBackend.get('theme'))
  radar = backend.createRadarBackend({
    send: (wcId, ev) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('radar-update', wcId, ev)
      }
    }
  })
}

let mainWindow

function sendWinState() {
  mainWindow?.webContents.send('win-state', {
    maximized: mainWindow?.isMaximized() || false,
    minimized: mainWindow?.isMinimized() || false
  })
}

function handleKastravaProto(request, callback) {
  try {
    const u = new URL(request.url)
    let p = decodeURIComponent(u.pathname)
    if (p.startsWith('/')) p = p.slice(1)
    if (!p) p = 'browser.html'
    const file = path.normalize(path.join(__dirname, p))
    if (file !== __dirname && !file.startsWith(__dirname + path.sep)) return callback({ error: -6 })
    callback({ path: file })
  } catch { callback({ error: -6 }) }
}
function createWindow() {
  if (!globalThis.__kastravaProtoRegistered) {
    globalThis.__kastravaProtoRegistered = true;
    protocol.registerFileProtocol('kastrava', handleKastravaProto);
    try {
      // The shell window runs on its own memory session: register there too,
      // otherwise kastrava:// pages fail to load in it.
      const shSes = require('electron').session.fromPartition('kastrava-shell');
      shSes.protocol.registerFileProtocol('kastrava', handleKastravaProto);
    } catch (e) { console.error('shell protocol error:', e); }
  }
  const ses = require('electron').session.fromPartition('kastrava')

  if (!globalThis.__kastravaAgRegistered) {
    globalThis.__kastravaAgRegistered = true
    // Crash leftovers: purge anything an older volatile-downloads build left
    // behind. New downloads go straight to the user's real Downloads folder
    // (a user-initiated download IS explicit save consent — hiding files in
    // a session-only area and requiring a second Save click is why users
    // reported "nothing downloads").
    try { fs.rmSync(agVolatileDir(), { recursive: true, force: true }) } catch {}
    const { session } = require('electron')
    for (const part of ['kastrava', 'kastrava-shell']) {
      try { registerAgDownloadHandler(session.fromPartition(part)) } catch {}
    }
    try { registerAgDownloadHandler(session.defaultSession) } catch {}
    ses.on('will-download', (event, item) => agDownloadRouted(item))
  }

  // Tracking Radar: live per-tab tracker monitoring
  const topHostOf = (details) => {
    try {
      const f = details.frame
      const topUrl = (f && f.top && f.top.url) || details.url
      const u = new URL(topUrl)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname
    } catch {}
    return ''
  }
  ses.webRequest.onBeforeRequest((details, callback) => {
    // Context isolation: webpages must never touch local files
    try {
      if (new URL(details.url).protocol === 'file:') return callback({ cancel: true })
    } catch {}
    // Content switches: F2 per-site shields first (a per-site "off" always
    // wins), otherwise the global JavaScript / Images switches decide.
    // Note: inline page scripts still run — same limit as ScriptSafe.
    try {
      const rt = details.resourceType
      if ((rt === 'script' || rt === 'image') && settingsBackend) {
        const shields = settingsBackend.get('siteShields') || {}
        const topHost = topHostOf(details)
        const sh = topHost && shields[topHost]
        if (sh && sh.master !== 'off' && ((rt === 'script' && sh.js === 'off') || (rt === 'image' && sh.images === 'off'))) {
          return callback({ cancel: true })
        }
        const g = settingsBackend.get(rt === 'script' ? 'jsGlobal' : 'images')
        if (g === 'off') return callback({ cancel: true })
      }
    } catch {}
    callback({})
    let host = ''
    try {
      const u = new URL(details.url)
      if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname
    } catch {}
    if (!host || !details.webContentsId) return
    if (details.resourceType === 'mainFrame') {
      radar.setMain(details.webContentsId, host)
      return
    }
    radar.add(details.webContentsId, { kind: 'req', host, t: Date.now() })
  })
  ses.webRequest.onHeadersReceived((details, callback) => {
    const rh = details.responseHeaders
    // Cookie policy: off = block all, third = first-party only, on = allow.
    const cookieMode = (settingsBackend && settingsBackend.get('cookies')) || 'off'
    const cookiesOff = cookieMode === 'off'
    let siteCookieAllow = false
    try {
      // F2 per-site shields: a site set to "allow cookies" (or shields down)
      // keeps its Set-Cookie headers despite the global block.
      if (cookiesOff && settingsBackend) {
        const shields = settingsBackend.get('siteShields') || {}
        const h = topHostOf(details)
        const sh = h && shields[h]
        siteCookieAllow = !!(sh && (sh.master === 'off' || sh.cookies === 'allow'))
      }
    } catch {}
    let hasSetCookie = false
    if (rh) {
      const filtered = {}
      for (const k in rh) {
        if (k.toLowerCase() === 'set-cookie') {
          hasSetCookie = true
          if (cookiesOff && !siteCookieAllow) continue
          if (cookieMode === 'third' && !siteCookieAllow) {
            try {
              const uh = new URL(details.url).hostname
              if (uh && uh !== topHostOf(details)) continue
            } catch { continue }
          }
        }
        filtered[k] = rh[k]
      }
      if (cookiesOff && !siteCookieAllow && hasSetCookie) {
        callback({ responseHeaders: filtered })
        return
      }
    }
    callback({})
    if (!details.webContentsId || !rh || !hasSetCookie) return
    try {
      const u = new URL(details.url)
      radar.add(details.webContentsId, { kind: 'cookie', host: u.hostname, t: Date.now() })
    } catch {}
  })
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = details.requestHeaders || {}
    if (settingsBackend) {
      if (settingsBackend.get('dnt') === 'on') requestHeaders['DNT'] = '1'
      const cm = settingsBackend.get('cookies') || 'off'
      if (cm === 'off') {
        delete requestHeaders['Cookie']
        delete requestHeaders['cookie']
      } else if (cm === 'third') {
        try {
          const uh = new URL(details.url).hostname
          if (uh && uh !== topHostOf(details)) {
            delete requestHeaders['Cookie']
            delete requestHeaders['cookie']
          }
        } catch {}
      }
      // Referrer policy: off = strip, origin = origin only, on = untouched.
      const ref = settingsBackend.get('sendReferrer') || 'off'
      if (ref === 'off') {
        delete requestHeaders['Referer']
        delete requestHeaders['Referrer']
      } else if (ref === 'origin' && (requestHeaders['Referer'] || requestHeaders['Referrer'])) {
        try {
          const top = topHostOf(details)
          const proto = new URL(details.url).protocol
          if (top) {
            requestHeaders['Referer'] = proto + '//' + top + '/'
            delete requestHeaders['Referrer']
          }
        } catch {}
      }
    }
    callback({ requestHeaders })
  })

  // Privacy by default: deny sensitive permissions, keep fullscreen
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'fullscreen') return callback(true)
    if (permission === 'geolocation') {
      return callback(settingsBackend ? settingsBackend.get('location') === 'allow' : false)
    }
    callback(false)
  })

  // Remove all stored cookies when private-cookies mode is active
  if (settingsBackend && settingsBackend.get('cookies') === 'off') {
    ses.clearStorageData({ storages: ['cookies'] }).catch(() => {})
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../static/logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      partition: 'kastrava-shell'
    }
  })

  mainWindow.loadURL('kastrava://app/browser.html')
  // privacy.js skips the shell window via this handle when injecting page
  // spoofs (canvas noise must never touch our own UI).
  global.mainWindow = mainWindow

function sendShortcut(action) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu-shortcut', action) } catch {}
}

// OS-level keyboard accelerators. The renderer's keydown handler only fires
// when the browser UI has focus; when a webpage (webview) is focused the
// guest consumes all keys. Menu accelerators fire regardless of focus.
function buildMenu() {
  const tabItems = []
  for (let i = 1; i <= 9; i++) {
    tabItems.push({ label: 'Go to Tab ' + i, accelerator: 'CommandOrControl+' + i, click: () => sendShortcut('tab' + i) })
  }
  const template = [
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CommandOrControl+T', click: () => sendShortcut('newTab') },
      { label: 'New Tab', accelerator: 'CommandOrControl+N', click: () => sendShortcut('newTab') },
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CommandOrControl+W', click: () => sendShortcut('closeTab') },
      { label: 'Reopen Closed Tab', accelerator: 'CommandOrControl+Shift+T', click: () => sendShortcut('reopenTab') }
    ]},
    { label: 'Edit', submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]},
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CommandOrControl+R', click: () => sendShortcut('reload') },
      { type: 'separator' },
      { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: () => sendShortcut('zoomIn') },
      { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: () => sendShortcut('zoomOut') },
      { label: 'Reset Zoom', accelerator: 'CommandOrControl+0', click: () => sendShortcut('zoomReset') },
      { type: 'separator' },
      { label: 'Toggle Fullscreen', accelerator: 'F11', click: () => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(!mainWindow.isFullScreen()) } catch {} } },
      { label: 'Focus Address Bar', accelerator: 'CommandOrControl+L', click: () => sendShortcut('focusOmnibox') },
      { label: 'Focus Address Bar', accelerator: 'Alt+D', click: () => sendShortcut('focusOmnibox') },
      { label: 'Find in Page', accelerator: 'CommandOrControl+F', click: () => sendShortcut('find') },
      { type: 'separator' },
      { label: 'Toggle Vertical Tabs', accelerator: 'CommandOrControl+Shift+V', click: () => sendShortcut('vtabs') }
    ]},
    { label: 'Tabs', submenu: [
      { label: 'Next Tab', accelerator: 'CommandOrControl+Tab', click: () => sendShortcut('nextTab') },
      { label: 'Previous Tab', accelerator: 'CommandOrControl+Shift+Tab', click: () => sendShortcut('prevTab') },
      { type: 'separator' },
      ...tabItems,
      { type: 'separator' },
      { label: 'Back', accelerator: 'Alt+Left', click: () => sendShortcut('back') },
      { label: 'Forward', accelerator: 'Alt+Right', click: () => sendShortcut('forward') }
    ]},
    { label: 'Tools', submenu: [
      { label: 'Bookmark This Page', accelerator: 'CommandOrControl+D', click: () => sendShortcut('bookmark') },
      { label: 'History', accelerator: 'CommandOrControl+H', click: () => sendShortcut('history') },
      { label: 'Toggle Bookmark Bar', accelerator: 'CommandOrControl+Shift+B', click: () => sendShortcut('bookmarkBar') },
      { type: 'separator' },
      { label: 'Picture-in-Picture', accelerator: 'CommandOrControl+P', click: () => sendShortcut('pip') },
      { label: 'Reader Mode', accelerator: 'CommandOrControl+Shift+R', click: () => sendShortcut('reader') },
      { label: 'Split View', accelerator: 'CommandOrControl+Shift+E', click: () => sendShortcut('split') },
      { label: 'Tracking Radar', accelerator: 'CommandOrControl+Shift+K', click: () => sendShortcut('radar') },
      { label: 'Screenshot', accelerator: 'CommandOrControl+Shift+S', click: () => sendShortcut('screenshot') },
      { label: 'Mute Tab', accelerator: 'CommandOrControl+Shift+M', click: () => sendShortcut('mute') },
      { label: 'Downloads', accelerator: 'CommandOrControl+Shift+P', click: () => sendShortcut('kastget') },
      { label: 'Developer Tools', accelerator: 'F12', click: () => sendShortcut('devtools') },
      { label: 'Inspect', accelerator: 'CommandOrControl+Shift+I', click: () => sendShortcut('devtools') },
      { type: 'separator' },
      { label: 'Settings', accelerator: 'CommandOrControl+,', click: () => sendShortcut('settings') }
    ]}
  ]
  try { Menu.setApplicationMenu(Menu.buildFromTemplate(template)) } catch (e) { console.error('menu build error:', e) }
}
  if (settingsBackend && settingsBackend.get('launchMaximized') === 'on') {
    mainWindow.maximize()
  }

  mainWindow.on('maximize', sendWinState)
  mainWindow.on('unmaximize', sendWinState)
  mainWindow.on('minimize', sendWinState)
  mainWindow.on('restore', sendWinState)

  mainWindow.on('close', () => {
    if (mainWindow && db) {
      try {
        mainWindow.webContents.send('save-session-now')
      } catch {}
    }
  })

  buildMenu()

}

function saveSessionSync(tabs) {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['session', JSON.stringify(tabs)])
}

let lastSessionData = null

// Volatile RAM: web storage lives in a memory-only session. Wipe any web
// data persisted on disk by older builds (cookies, cache, DOM storage).
function wipeLegacyWebData() {
  try {
    const base = path.join(app.getPath('userData'), 'Partitions')
    for (const name of ['kastrava', 'persist:kastrava', 'persist_kastrava']) {
      try { fs.rmSync(path.join(base, name), { recursive: true, force: true }) } catch {}
    }
  } catch {}
}

// ---- Auto-update: push force updates ----
// Per-format policy (explicit):
//   NSIS Setup .exe .... electron-updater over the GitHub latest.yml feed:
//                        launch check in ~5s, then every 30 min. A found
//                        build stops the search and prompts TWICE (Restart
//                        now / later); two defers resume the 30-min search.
//   deb / rpm / pacman . same cadence via the release API: version popup
//                        x2, download the matching package, verify exact
//                        byte size, privileged install, relaunch.
//   AppImage ............ excluded by choice (no popups, no checks)
//   Store MSIX .......... excluded (the Store updates it itself)
//   portable .exe ........ excluded (cannot self-replace)
// Unsigned builds need win.verifyUpdateCodeSignature=false, otherwise the
// electron-updater leg rejects every payload on the signature check.
let updater = null
function initAutoUpdate() {
  if (!app.isPackaged) return
  if (process.platform === 'win32') {
    if (process.windowsStore) return
    if (process.env.PORTABLE_EXECUTABLE_DIR) return
    initElectronUpdater()
    return
  }
  if (process.platform === 'linux') {
    if (process.env.APPIMAGE) return
    initLinuxSysUpdate()
  }
}
function initElectronUpdater() {
  if (!app.isPackaged) return
  try {
    const { autoUpdater } = require('electron-updater')
    updater = autoUpdater
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('error', (e) => {
      try { console.error('[update] error', String((e && e.message) || e)) } catch {}
    })
    updater.on('update-downloaded', (event, info) => {
      try { stopUpdSearch(); updReady = info || {}; updPrompts = 0; promptWinUpdate() } catch {}
    })
    const UPD_MS = 30 * 60 * 1000
    let updTimer = null, updReady = null, updPrompts = 0, updReminder = null
    const check = () => { try { updater.checkForUpdates().catch(() => {}) } catch {} }
    const stopUpdSearch = () => { if (updTimer) { clearInterval(updTimer); updTimer = null } if (updReminder) { clearTimeout(updReminder); updReminder = null } }
    const startUpdSearch = () => { stopUpdSearch(); updTimer = setInterval(check, UPD_MS) }
    const promptWinUpdate = () => {
      try {
        if (!updReady) return
        if (!mainWindow || mainWindow.isDestroyed()) {
          try { updater.quitAndInstall(false, true) } catch {}
          return
        }
        updPrompts++
        let notes = ''
        try {
          const rn = updReady && updReady.releaseNotes
          const raw = Array.isArray(rn) ? rn.map((n) => (n && n.note) || '').join('\n') : String(rn || '')
          notes = raw.replace(/\r/g, '').trim().slice(0, 500)
        } catch {}
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Kastrava update ready',
          message: 'Kastrava ' + ((updReady && updReady.version) || 'new version') + ' downloaded.'
            + (notes ? '\n\n' + notes : '') + '\n\nRestart now to apply it?' + (updPrompts > 1 ? '\n(This is the last reminder — it installs on quit.)' : ''),
          buttons: ['Restart now', 'On next quit'],
          defaultId: 0,
          cancelId: 1
        }).then(({ response }) => {
          if (response === 0) {
            setImmediate(() => { try { updater.quitAndInstall(false, true) } catch {} })
          } else if (updPrompts < 2) {
            updReminder = setTimeout(promptWinUpdate, UPD_MS)
          } else {
            startUpdSearch()
          }
        }).catch(() => {})
      } catch {}
    }
    setTimeout(check, 5000)
    startUpdSearch()
    ipcMain.handle('check-updates', async () => {
      try {
        if (updater) {
          // Already found earlier? Show it again cleanly, restart the count.
          if (updReady) { updPrompts = 0; promptWinUpdate(); return { ok: true, pending: true } }
          const res = await updater.checkForUpdates()
          // autoDownload resolves post-download, so a found build has
          // already prompted via the event above.
          if (updReady) return { ok: true, pending: true }
          let newer = false
          try {
            const v = res && res.updateInfo && res.updateInfo.version
            if (v) newer = cmpVer(v, app.getVersion()) > 0
          } catch {}
          if (!newer) {
            const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
            await dialog.showMessageBox(parent || undefined, {
              type: 'info', title: 'Kastrava updates',
              message: 'You are on the latest version (' + app.getVersion() + ').',
              buttons: ['OK'], defaultId: 0
            }).catch(() => {})
            return { ok: true, pending: false, uptodate: true }
          }
          return { ok: true, pending: false }
        }
        if (process.platform === 'linux' && !process.env.APPIMAGE) {
          linuxUpdateCheck(true)
          return { ok: true }
        }
        return { ok: false }
      } catch { return { ok: false } }
    })
  } catch (e) {
    try { console.error('[update] disabled:', String((e && e.message) || e)) } catch {}
  }
}

// Proxy (manual): applied to every session at startup from settings.
// Requires a restart after changing. Bypass stays local-only.
function proxyRules() {
  try {
    const p = settingsBackend && settingsBackend.get('proxy')
    if (p && p.enabled && p.host && p.port) {
      const type = (p.type === 'http' || p.type === 'socks5') ? p.type : 'socks5'
      return type + '://' + p.host + ':' + p.port
    }
  } catch {}
  return null
}
function applyProxyAll(session) {
  const rules = proxyRules()
  const cfg = rules
    ? { proxyRules: rules, proxyBypassRules: 'localhost,127.0.0.1' }
    : { proxyRules: 'direct://', proxyBypassRules: 'localhost,127.0.0.1' }
  for (const part of ['kastrava', 'kastrava-shell']) {
    try { session.fromPartition(part).setProxy(cfg) } catch {}
  }
  try { session.defaultSession.setProxy(cfg) } catch {}
}

// ---- Linux system packages (deb / rpm / pacman): version popup,
// download the matching package, verify exact byte size against the
// release API, privileged install, relaunch. Never runs for AppImage.
const UPDATE_REPO = 'tejaskhanna989/kastrava'
let linuxUpdateBusy = false
function cmpVer(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}
function detectSysPkg() {
  const exe = process.execPath
  const owns = (cmd, args) => {
    try { execFileSync(cmd, args, { stdio: 'pipe', timeout: 10000 }); return true } catch { return false }
  }
  try {
    if (owns('pacman', ['-Qo', exe])) return 'pacman'
    if (owns('dpkg', ['-S', exe])) return 'deb'
    if (owns('rpm', ['-qf', exe])) return 'rpm'
  } catch {}
  return null
}
function sysPkgAsset(type, assets) {
  const re = type === 'pacman' ? /^kastrava-.*-x86_64\.pkg\.tar\.zst$/
    : type === 'deb' ? /^kastrava_.*_amd64\.deb$/
    : /^kastrava-.*\.x86_64\.rpm$/
  return (assets || []).find((a) => re.test(a.name || ''))
}
function sysPkgExt(type) {
  return type === 'pacman' ? '.pkg.tar.zst' : type === 'deb' ? '.deb' : '.rpm'
}
const LIN_UPD_MS = 30 * 60 * 1000
let linTimer = null, linReminder = null, linPending = null, linPrompts = 0
function stopLinSearch() { if (linTimer) { clearInterval(linTimer); linTimer = null } if (linReminder) { clearTimeout(linReminder); linReminder = null } }
function startLinSearch() { stopLinSearch(); linTimer = setInterval(() => { linuxUpdateCheck(false) }, LIN_UPD_MS) }
async function linAskUpdate() {
  const p = linPending
  if (!p) return { response: 1 }
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  return dialog.showMessageBox(parent || undefined, {
    type: 'info',
    title: 'Kastrava update ready',
    message: 'Kastrava ' + p.tag + ' is available (you have ' + app.getVersion() + ').'
      + (p.notes ? '\n\n' + p.notes : '')
      + '\n\nDownload and install it now? System password will be asked once.'
      + (linPrompts > 0 ? '\n(This is the last reminder.)' : ''),
    buttons: ['Update now', 'Later'],
    defaultId: 0,
    cancelId: 1
  }).catch(() => ({ response: 1 }))
}
async function deferLinux() {
  linPrompts++
  if (linPrompts < 2) {
    linReminder = setTimeout(async () => {
      linReminder = null
      if (!linPending) return
      const r = await linAskUpdate()
      if (r.response === 0) { const q = linPending; linPending = null; await runLinuxInstall(q) }
      else await deferLinux()
    }, LIN_UPD_MS)
  } else {
    linPending = null
    startLinSearch()
  }
}
async function runLinuxInstall(p) {
  const { tag, asset, type } = p || {}
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  if (!tag || !asset || !asset.browser_download_url || !type) { startLinSearch(); return }
  try {
    let buf = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const data = Buffer.from(await (await fetch(asset.browser_download_url, {
          headers: { 'User-Agent': 'Kastrava' },
          signal: AbortSignal.timeout(300000)
        })).arrayBuffer())
        if (data.length && data.length === asset.size) { buf = data; break }
      } catch (e) {
        if (attempt === 2) throw e
      }
    }
    if (!buf) throw new Error('size mismatch')
    const file = path.join(os.tmpdir(), 'kastrava-update-' + Date.now() + sysPkgExt(type))
    fs.writeFileSync(file, buf, { mode: 0o600 })
    const args = type === 'pacman' ? ['pacman', '-U', '--noconfirm', file]
      : type === 'deb' ? ['dpkg', '-i', file]
      : ['rpm', '-Uvh', file]
    const code = await new Promise((resolve) => {
      try {
        const child = spawn('pkexec', args, { stdio: 'ignore' })
        child.on('error', () => resolve(-1))
        child.on('close', (c) => resolve(c))
      } catch { resolve(-1) }
    })
    try { fs.rmSync(file, { force: true }) } catch {}
    if (code !== 0) {
      await dialog.showMessageBox(parent || undefined, {
        type: 'warning', title: 'Kastrava update',
        message: 'Automatic install did not complete. Update any time with your package manager.'
      }).catch(() => {})
      startLinSearch()
      return
    }
    // Confirm the new version actually landed before offering restart —
    // a silent no-op install must never pass itself off as an update.
    let installedOk = false
    try {
      const q = type === 'pacman' ? ['pacman', ['-Q', 'kastrava']]
        : type === 'deb' ? ['dpkg-query', ['-W', '-f=${Version}', 'kastrava']]
        : ['rpm', ['-q', '--queryformat', '%{VERSION}', 'kastrava']]
      const out = execFileSync(q[0], q[1], { stdio: 'pipe', timeout: 15000 }).toString()
      const m = out.match(/(\d+\.\d+\.\d+)/)
      installedOk = !!m && cmpVer(m[1], tag) >= 0
    } catch { installedOk = true }
    if (!installedOk) {
      await dialog.showMessageBox(parent || undefined, {
        type: 'warning', title: 'Kastrava update',
        message: 'Install reported success but version ' + tag + ' was not detected. Please update with your package manager.'
      }).catch(() => {})
      startLinSearch()
      return
    }
    const { response: restart } = await dialog.showMessageBox(parent || undefined, {
      type: 'info', title: 'Kastrava updated',
      message: 'Kastrava ' + tag + ' installed. Restart now to use it?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0, cancelId: 1
    }).catch(() => ({ response: 1 }))
    if (restart === 0) {
      try { app.relaunch() } catch {}
      try { app.quit() } catch {}
    }
    startLinSearch()
  } catch (e) {
    try { console.error('[update] linux install failed:', String((e && e.message) || e)) } catch {}
    startLinSearch()
  }
}
async function linuxUpdateCheck(manual) {
  if (linuxUpdateBusy) return
  linuxUpdateBusy = true
  try {
    const type = detectSysPkg()
    if (!type) return false
    const rel = await (await fetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', {
      headers: { 'User-Agent': 'Kastrava', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20000)
    })).json()
    const tag = String((rel && rel.tag_name) || '').replace(/^v/, '')
    if (!tag || cmpVer(tag, app.getVersion()) <= 0) return false
    const asset = sysPkgAsset(type, rel.assets)
    if (!asset || !asset.browser_download_url || !asset.size) return false
    let notes = ''
    try { notes = String((rel && rel.body) || '').replace(/\r/g, '').trim().slice(0, 400) } catch {}
    stopLinSearch()
    linPending = { tag, asset, type, notes }
    linPrompts = 0
    const { response } = await linAskUpdate()
    if (response !== 0) { await deferLinux(); return true }
    linPending = null
    await runLinuxInstall({ tag, asset, type })
    return true
  } catch (e) {
    try { console.error('[update] linux check failed:', String((e && e.message) || e)) } catch {}
    return false
  } finally {
    linuxUpdateBusy = false
  }
}
function initLinuxSysUpdate() {
  setTimeout(() => { linuxUpdateCheck(false) }, 5000)
  startLinSearch()
  try {
    ipcMain.handle('check-updates', async () => {
      try {
        // A check is already running — its dialogs will present themselves.
        if (linuxUpdateBusy) return { ok: true }
        // Already found earlier? Show it again cleanly, restart the count.
        if (linPending) {
          linPrompts = 0
          const r0 = await linAskUpdate()
          if (r0.response === 0) { const q = linPending; linPending = null; await runLinuxInstall(q) }
          else await deferLinux()
          return { ok: true, pending: true }
        }
        const found = await linuxUpdateCheck(true)
        if (found) return { ok: true, pending: true }
        const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
        await dialog.showMessageBox(parent || undefined, {
          type: 'info', title: 'Kastrava updates',
          message: 'You are on the latest version (' + app.getVersion() + ').',
          buttons: ['OK'], defaultId: 0
        }).catch(() => {})
        return { ok: true, pending: false, uptodate: true }
      } catch { return { ok: false } }
    })
  } catch {}
}

app.whenReady().then(async () => {
  await initDatabase()
  initBackend()
  try { pruneHistory() } catch {}
  try { setInterval(pruneHistory, 24 * 60 * 60 * 1000) } catch {}
  wipeLegacyWebData()
  initAutoUpdate()
  // Strip the Electron token from the User-Agent on every session the app
  // uses. Without this, HTTP headers and navigator.userAgent fingerprint
  // the app as Electron on every request.
  try {
    const { session } = require('electron')
    privacy.applyUserAgent(session.fromPartition('kastrava'))
    privacy.applyUserAgent(session.fromPartition('kastrava-shell'))
    privacy.applyUserAgent(session.defaultSession)
    applyProxyAll(session)
  } catch {}

  // Human mode: per-site shields-down suspends fingerprint spoofing there
  // (CAPTCHAs, banking) while cookies/js shields keep their own rules.
  try {
    privacy.setShieldChecker((host) => {
      try {
        const m = (settingsBackend && settingsBackend.get('siteShields')) || {}
        return (host && m[host]) || null
      } catch { return null }
    })
  } catch {}
  app.on('web-contents-created', (_, wc) => {
    // Privacy spoofs (UA already set per-session below; page-level props
    // like connection/battery are neutered per document here).
    try { privacy.setWebrtcAllowed(settingsBackend && settingsBackend.get('webrtcMode') === 'allow') } catch {}
    try { privacy.installPrivacyProtections(wc) } catch {}
    // Cover any session a guest/popup ends up with, so downloads from
    // popups (payment flows, drive links, blob: URLs) can't miss the
    // will-download handler and silently do nothing.
    try { registerAgDownloadHandler(wc.session) } catch {}
    wc.setWindowOpenHandler(({ url, disposition }) => {
      try {
        const proto = new URL(url).protocol
        // Never hand local files to outside apps; mailto is safe to delegate
        if (proto === 'mailto:') {
          shell.openExternal(url)
          return { action: 'deny' }
        }
        if (proto === 'http:' || proto === 'https:' || proto === 'about:') {
          // Script popups (payment/bank redirects like Razorpay) must stay
          // real windows: the opener page talks to them via window.opener,
          // which breaks if we force them into tabs. Plain link clicks
          // (foreground/background-tab) still open as tabs.
          // about:blank is the standard precursor popup that the payment
          // page then navigates to the bank — deny it and checkout hangs.
          if (disposition === 'new-window' || disposition === 'other') {
            const isShell = mainWindow && wc === mainWindow.webContents
            return {
              action: 'allow',
              overrideBrowserWindowOptions: {
                parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
                show: true,
                autoHideMenuBar: true,
                backgroundColor: '#ffffff',
                webPreferences: {
                  contextIsolation: true,
                  nodeIntegration: false,
                  sandbox: false,
                  // Same volatile session as the opener tab — never the
                  // persistent default session (bank cookies must die too).
                  partition: isShell ? 'kastrava-shell' : 'kastrava'
                }
              }
            }
          }
          if (proto !== 'about:' && mainWindow) mainWindow.webContents.send('open-new-tab', url)
          return { action: 'deny' }
        }
      } catch {}
      return { action: 'deny' }
    })
  })

  createWindow()

  // Pick up subscription renewals: silently re-activate to fetch the
  // freshly-signed license with the extended expiry.
  license.refreshIfLicensed().catch(() => {})
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

let quitSaved = false
function pruneHistory() {
  try {
    const keep = parseInt((settingsBackend && settingsBackend.get('historyKeep')) || '0', 10) || 0
    if (keep > 0) {
      run('DELETE FROM history WHERE visited_at < ?', [Date.now() - keep * 86400000])
    }
  } catch {}
}
app.on('before-quit', () => {
  if (quitSaved) return
  quitSaved = true
  try {
    if (settingsBackend && settingsBackend.get('clearHistoryOnExit') === 'on' && db) {
      run('DELETE FROM history')
    }
  } catch {}
  // Volatile RAM: drop all in-memory web storage (cookies, cache,
  // IndexedDB, DOM storage). The OS frees the rest on exit.
  try {
    const { session } = require('electron')
    for (const part of ['kastrava', 'kastrava-shell']) {
      try { session.fromPartition(part).clearStorageData().catch(() => {}) } catch {}
      try { session.fromPartition(part).clearCache().catch(() => {}) } catch {}
    }
    try { session.defaultSession.clearStorageData().catch(() => {}) } catch {}
    try { session.defaultSession.clearCache().catch(() => {}) } catch {}
    // Downloads are real user files in ~/Downloads now — never wipe them.
    // Only purge stale volatile-downloads leftovers from older builds.
    try { fs.rmSync(agVolatileDir(), { recursive: true, force: true }) } catch {}
  } catch {}
  if (lastSessionData) {
    try { saveSessionSync(lastSessionData) } catch {}
  } else if (db) {
    try {
      const r = all('SELECT value FROM settings WHERE key = ?', ['session'])
      if (r.length && r[0].value) {
        run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['session', r[0].value])
      }
    } catch {}
  }
})

ipcMain.on('save-session-sync', (_, tabs) => {
  lastSessionData = tabs
  saveSessionSync(tabs)
})

ipcMain.handle('win-minimize', () => mainWindow?.minimize())
ipcMain.handle('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.handle('win-close', () => mainWindow?.close())
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized())
ipcMain.handle('get-settings', () => {
  return settingsBackend ? settingsBackend.getAll() : {}
})

ipcMain.handle('set-setting', (_, key, value) => {
  if (settingsBackend) settingsBackend.set(key, value)
  if (key === 'theme') applyNativeTheme(value)
  if (key === 'cookies' && value === 'off') {
    try {
      const ses = require('electron').session.fromPartition('kastrava')
      ses.cookies.remove(undefined, undefined).catch(() => {})
    } catch {}
  }
  return true
})

ipcMain.handle('set-referrer', (_, value) => {
  if (settingsBackend) settingsBackend.set('sendReferrer', value)
  return true
})

// Kastrava Premium licensing
ipcMain.handle('lic-machine', () => license.machineCode())
ipcMain.handle('lic-status', () => license.status())
ipcMain.handle('lic-activate', async (_, key) => license.activate(key))
ipcMain.handle('lic-cancel', async () => license.cancel())
// Account-bound activation: token comes from the settings DB (written at
// login), so the renderer never touches it. Same key on every device.
ipcMain.handle('lic-activate-account', async () => {
  try {
    const t = settingsBackend.get('syncToken')
    if (!t) return { ok: false, error: 'no_login', msg: 'Log in to your Kastrava account first.' }
    return await license.activateAccount(t)
  } catch { return { ok: false, error: 'server', msg: 'Activation failed.' } }
})
ipcMain.handle('lic-devices', async () => {
  try {
    const t = settingsBackend.get('syncToken')
    if (!t) return { ok: false, error: 'no_login' }
    const r = await fetch(license.API.replace(/\/$/, '') + '/api/account/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: '{}',
      signal: AbortSignal.timeout(20000)
    })
    return await r.json().catch(() => ({ ok: false }))
  } catch { return { ok: false } }
})
ipcMain.handle('lic-device-remove', async (_, { key, machine_id }) => {
  try {
    const t = settingsBackend.get('syncToken')
    if (!t) return { ok: false, error: 'no_login' }
    const r = await fetch(license.API.replace(/\/$/, '') + '/api/account/device/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify({ key, machine_id }),
      signal: AbortSignal.timeout(20000)
    })
    return await r.json().catch(() => ({ ok: false }))
  } catch { return { ok: false } }
})
ipcMain.handle('lic-verify', (_, payload, sig) => license.verifyPayload(payload, sig))

// In-app sync (Phase 2): account login + zero-knowledge push/pull.
// The renderer passes its API base (honors ?api= overrides); secrets and
// the encryption key never leave the main process or the OS keychain.
const syncEngine = require('./sync')
function syncStore() {
  return {
    get: (k) => { try { return settingsBackend.get(k) } catch { return undefined } },
    set: (k, v) => { try { settingsBackend.set(k, v) } catch {} }
  }
}
function syncData() {
  return {
    getSettings: () => { try { return settingsBackend.getAll() } catch { return {} } },
    setSetting: (k, v) => { try { settingsBackend.set(k, v) } catch {} },
    getBookmarks: () => { try { return all('SELECT title, url FROM bookmarks') } catch { return [] } },
    addBookmark: ({ title, url }) => {
      try {
        const dup = all('SELECT id FROM bookmarks WHERE url = ? LIMIT 1', [url])
        if (!dup.length) run('INSERT INTO bookmarks (title, url) VALUES (?, ?)', [title, url])
      } catch {}
    },
    licenseKey: () => { try { return license.status().key || null } catch { return null } }
  }
}
ipcMain.handle('sync-status', () => {
  try { return Object.assign({ ok: true }, syncEngine.status(syncStore(), safeStorage)) } catch { return { ok: false } }
})
ipcMain.handle('sync-login', async (_, { apiBase, email, password }) => {
  try { return await syncEngine.login(apiBase || 'https://nexufog.pp.ua', email, password, syncStore(), safeStorage) } catch { return { ok: false, msg: 'Login failed.' } }
})
ipcMain.handle('sync-login-otp', async (_, { apiBase, email, password, code, totp }) => {
  try { return await syncEngine.loginOtp(apiBase || 'https://nexufog.pp.ua', email, password, code, totp, syncStore(), safeStorage) } catch { return { ok: false, msg: 'Login failed.' } }
})
ipcMain.handle('sync-verify', async (_, { apiBase, email, password, code }) => {
  try { return await syncEngine.verifyEmail(apiBase || 'https://nexufog.pp.ua', email, password, code, syncStore(), safeStorage) } catch { return { ok: false, msg: 'Verification failed.' } }
})
ipcMain.handle('sync-logout', async () => {
  try { return await syncEngine.logout(syncStore()) } catch { return { ok: false } }
})
ipcMain.handle('sync-now', async (_, { apiBase }) => {
  try { return await syncEngine.syncNow(apiBase || 'https://nexufog.pp.ua', syncStore(), safeStorage, syncData()) } catch { return { ok: false, msg: 'Sync failed.' } }
})

ipcMain.handle('get-bookmarks', () => {
  return all('SELECT * FROM bookmarks ORDER BY pos ASC, created_at DESC')
})

ipcMain.handle('add-bookmark', (_, { title, url }) => {
  run('INSERT INTO bookmarks (title, url) VALUES (?, ?)', [title, url])
})

ipcMain.handle('is-bookmarked', (_, url) => {
  const r = all('SELECT id FROM bookmarks WHERE url = ? LIMIT 1', [url])
  return r.length ? r[0] : null
})

ipcMain.handle('remove-bookmark', (_, id) => {
  if (typeof id === 'number') {
    run('DELETE FROM bookmarks WHERE id = ?', [id])
  } else {
    run('DELETE FROM bookmarks WHERE url = ?', [id])
  }
})

ipcMain.handle('get-history', () => {
  return all('SELECT * FROM history ORDER BY visited_at DESC LIMIT 200')
})

ipcMain.handle('add-history', (_, { title, url }) => {
  run('INSERT INTO history (title, url) VALUES (?, ?)', [title, url])
  run('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY visited_at DESC LIMIT 200)')
})

ipcMain.handle('clear-history', () => {
  run('DELETE FROM history')
})

ipcMain.handle('get-top-sites', () => {
  return all('SELECT * FROM top_sites ORDER BY pos ASC')
})

ipcMain.handle('save-top-sites', (_, sites) => {
  run('DELETE FROM top_sites')
  for (const s of sites) run('INSERT INTO top_sites (title, url, icon, pos) VALUES (?, ?, ?, ?)', [s.title, s.url, s.icon || null, s.pos])
})

ipcMain.handle('save-page-icon', async (_, { url, dataUrl }) => {
  try {
    const img = nativeImage.createFromDataURL(dataUrl)
    const png = img.toPNG()
    const name = encodeURIComponent(url.replace(/[^a-z0-9]/gi, '_'))
    const dir = path.join(app.getPath('userData'), 'icons')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${name}.png`), png)
  } catch {}
})


ipcMain.handle('open-external', (_, url) => {
  try { shell.openExternal(String(url)) } catch {}
})

ipcMain.handle('open-path', (_, p) => {
  // Reveal in folder rather than launching — never auto-execute downloads.
  try { shell.showItemInFolder(String(p)) } catch {}
})

// Session restore
ipcMain.handle('save-session', (_, tabs) => {
  lastSessionData = tabs
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['session', JSON.stringify(tabs)])
})

ipcMain.handle('load-session', () => {
  const r = all('SELECT value FROM settings WHERE key = ?', ['session'])
  if (r.length && r[0].value) {
    try { return JSON.parse(r[0].value) } catch {}
  }
  return null
})

// Download manager: downloads are handled natively by Chromium and tracked here.
const agDownloads = new Map()
let agIdCounter = 0

// Registers will-download on a session. Called for every session the app
// uses (tab session, shell session, default session, popup windows) so a
// download can never silently miss its handler and appear to do nothing.
function registerAgDownloadHandler(targetSes) {
  if (!targetSes || targetSes.__agRegistered) return
  targetSes.__agRegistered = true
  targetSes.on('will-download', (event, item) => agDownloadRouted(item))
}
// "Ask where to save": synchronous picker inside the event, so the download
// never starts without a destination. Cancel aborts it. Used by every
// session (main tabs and popups alike).
function agDownloadRouted(item) {
  try {
    if (settingsBackend && settingsBackend.get('askDlLoc') === 'on') {
      const r = dialog.showSaveDialogSync(mainWindow, { defaultPath: agFinalPath(agSafeFilename(item)) })
      if (!r) { try { item.cancel() } catch {} return }
      agWillDownload(item, r)
      return
    }
  } catch {}
  agWillDownload(item)
}

// User-initiated downloads save straight to the real Downloads folder,
// like every other browser. Chromium still handles networking (cookies,
// auth, redirects) and pause/resume.
function agWillDownload(item, customPath) {
  const id = ++agIdCounter
  const fp = customPath || agFinalPath(agSafeFilename(item))
  const dl = { id, url: item.getURL(), filename: path.basename(fp), outputPath: fp, received: 0, total: 0, speed: 0, state: 'downloading', proc: null, item: null, _timer: null, _lastCheck: null, _lastBytes: 0, savedTo: fp }
  agDownloads.set(id, dl)
  attachNativeDownload(id, item)
  dl._timer = setTimeout(() => agPoll(id), 500)
}

// will-download sometimes reports an empty filename (blob:/data: URLs,
// Content-Disposition quirks). Fall back to the URL basename so setSavePath
// never receives a directory path (which fails the download with 'error').
function agSafeFilename(item) {
  let name = ''
  try { name = item.getFilename() || '' } catch {}
  name = String(name).trim()
  if (!name) {
    try {
      const u = new URL(item.getURL())
      name = path.basename(decodeURIComponent(u.pathname)) || ''
    } catch {}
  }
  if (!name || name === '/' || name === '.') name = 'download'
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'download'
}

// Volatile scratch area: downloads live here for the session only. It is
// purged at startup (crash leftovers) and wiped on exit, so website-derived
// files never persist on disk unless the user explicitly saves them.
function agVolatileDir() {
  const dir = path.join(app.getPath('userData'), 'volatile-downloads')
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return dir
}

// Real, user-visible destination (only reached via the Save action).
const realDownloadDir = () => app.getPath('downloads')

function agSend(id) {
  const d = agDownloads.get(id)
  if (!d || !mainWindow) return
  mainWindow.webContents.send('ag-update', {
    id: d.id, filename: d.filename, url: d.url,
    received: d.received, total: d.total,
    speed: d.speed, state: d.state, outputPath: d.outputPath,
    savedTo: d.savedTo || (d.state === 'done' ? d.outputPath : null)
  })
}

function agPoll(id) {
  const d = agDownloads.get(id)
  if (!d || d.state !== 'downloading') return
  try {
    const st = fs.statSync(d.outputPath)
    d.received = st.size
    const now = Date.now()
    if (d._lastCheck) {
      const dt = (now - d._lastCheck) / 1000
      const db = d.received - d._lastBytes
      d.speed = dt > 0 ? db / dt : 0
    }
    d._lastCheck = now
    d._lastBytes = d.received
    agSend(id)
  } catch {}
  d._timer = setTimeout(() => agPoll(id), 500)
}

const dlDir = () => {
  let dir = realDownloadDir()
  try {
    const custom = settingsBackend && settingsBackend.get('dlDir')
    if (custom && path.isAbsolute(custom)) {
      fs.mkdirSync(custom, { recursive: true })
      if (fs.statSync(custom).isDirectory()) dir = custom
    } else {
      fs.mkdirSync(dir, { recursive: true })
    }
  } catch {}
  return dir
}

function agFinalPath(filename, dir) {
  let p = path.join(dir || dlDir(), filename)
  if (!fs.existsSync(p)) return p
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  for (let i = 1; i < 999; i++) {
    p = path.join(dir || dlDir(), `${base} (${i})${ext}`)
    if (!fs.existsSync(p)) return p
  }
  return path.join(dir || dlDir(), `${base} (999)${ext}`)
}

function attachNativeDownload(id, item) {
  const d = agDownloads.get(id)
  if (!d) { try { item.cancel() } catch {} return }
  d.item = item
  try { item.setSavePath(d.outputPath) } catch {}
  item.on('updated', () => {
    if (!agDownloads.get(id)) return
    try { d.received = item.getReceivedBytes() } catch {}
    try { const t = item.getTotalBytes(); if (t > 0) d.total = t } catch {}
    agSend(id)
  })
  item.on('done', (_, state) => {
    if (!agDownloads.get(id)) return
    if (d.state === 'stopped' || d.state === 'paused') return
    if (state === 'completed') {
      d.received = d.total || d.received
      d.speed = 0
      d.state = 'done'
    } else {
      d.state = 'error'
    }
    agSend(id)
  })
}
ipcMain.handle('ag-pause', (_, id) => {
  const d = agDownloads.get(id)
  if (!d || d.state !== 'downloading') return
  d.state = 'paused'
  if (d.item) { try { d.item.pause() } catch {} }
  if (d._timer) { clearTimeout(d._timer); d._timer = null }
  d.speed = 0
  agSend(id)
})

ipcMain.handle('ag-resume', (_, id) => {
  const d = agDownloads.get(id)
  if (!d || d.state !== 'paused') return
  d.state = 'downloading'
  if (d.item) { try { d.item.resume() } catch {} }
  agSend(id)
  if (!d._timer) d._timer = setTimeout(() => agPoll(id), 500)
})

ipcMain.handle('ag-stop', (_, id) => {
  const d = agDownloads.get(id)
  if (!d) return
  d.state = 'stopped'
  if (d.item) { try { d.item.cancel() } catch {} }
  if (d._timer) { clearTimeout(d._timer); d._timer = null }
  d.speed = 0
  try { if (fs.existsSync(d.outputPath)) fs.unlinkSync(d.outputPath) } catch {}
  agSend(id)
})

ipcMain.handle('ag-clear', (_, id) => {
  const d = agDownloads.get(id)
  if (!d) return
  if (d._timer) clearTimeout(d._timer)
  if (d.item) { try { d.item.cancel() } catch {} }
  try { if (fs.existsSync(d.outputPath)) fs.unlinkSync(d.outputPath) } catch {}
  agDownloads.delete(id)
  mainWindow?.webContents.send('ag-cleared', id)
})

ipcMain.handle('ag-list', () => {
  return Array.from(agDownloads.values()).map(d => ({
    id: d.id, filename: d.filename, url: d.url,
    received: d.received, total: d.total, speed: d.speed, state: d.state,
    outputPath: d.state === 'done' ? d.outputPath : null
  }))
})

// Save action: downloads already live in the real Downloads folder, so this
// just confirms the path (kept for renderer compatibility — the button now
// reads "Saved ✓" immediately).
ipcMain.handle('ag-save', (_, id) => {
  const d = agDownloads.get(id)
  if (!d || !d.outputPath || !fs.existsSync(d.outputPath)) {
    return { ok: false, error: 'not_done', msg: 'Only finished downloads can be saved.' }
  }
  try {
    d.savedTo = d.outputPath
    agSend(id)
    return { ok: true, path: d.outputPath }
  } catch (e) {
    return { ok: false, error: 'copy_failed', msg: String((e && e.message) || e) }
  }
})

ipcMain.handle('web-inspect', async (_, { tabId, x, y }) => {
  try {
    if (!mainWindow) return
    const { webContents } = require('electron')
    let wc = null
    try { wc = webContents.fromId(tabId) } catch {}
    if (wc && !wc.isDestroyed()) { try { wc.inspectElement(x||0, y||0); if(!wc.isDevToolsOpened()) wc.openDevTools({mode:'detach'}); } catch {} return }
    const ses = require('electron').session.fromPartition('kastrava')
    const wcs = ses.getAllRunningWebContents()
    for (const c of wcs) { if (c.id === tabId) { try { c.inspectElement(x||0, y||0); if(!c.isDevToolsOpened()) c.openDevTools({mode:'detach'}); } catch {} break } }
  } catch {}
})
ipcMain.handle('devtools-toggle', async (_, tabId) => {
  try {
    const { webContents } = require('electron')
    let wc = null
    try { wc = webContents.fromId(tabId) } catch {}
    if (!wc || wc.isDestroyed()) {
      const ses = require('electron').session.fromPartition('kastrava')
      const wcs = ses.getAllRunningWebContents()
      for (const c of wcs) if (c.id === tabId) { wc = c; break }
    }
    if (!wc || wc.isDestroyed()) return false
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({mode:'detach'})
    return wc.isDevToolsOpened()
  } catch { return false }
})
ipcMain.handle('devtools-open', async (_, tabId) => {
  try {
    const { webContents } = require('electron')
    let wc = webContents.fromId(tabId)
    if (!wc || wc.isDestroyed()) return false
    if (!wc.isDevToolsOpened()) wc.openDevTools({mode:'detach'})
    return true
  } catch { return false }
})
ipcMain.handle('devtools-close', async (_, tabId) => {
  try {
    const { webContents } = require('electron')
    let wc = webContents.fromId(tabId)
    if (wc && !wc.isDestroyed() && wc.isDevToolsOpened()) wc.closeDevTools()
    return true
  } catch { return false }
})
// Fallback: toggle DevTools for the browser UI itself (used when the
// active tab has no inspectable guest, e.g. a blank new tab)
ipcMain.handle('devtools-self', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    const wc = mainWindow.webContents
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach' })
    return wc.isDevToolsOpened()
  } catch { return false }
})

// Tracking Radar data
ipcMain.handle('radar-get', (_, wcId) => radar ? radar.get(wcId) : [])
ipcMain.handle('radar-clear', (_, wcId) => { if (radar) radar.clear(wcId); return true })
ipcMain.handle('radar-stats', (_, wcId) => radar ? radar.stats(wcId) : { reqs: 0, cookies: 0, third: 0, doms: {}, score: 100 })

// Screenshots
ipcMain.handle('save-screenshot', async (_, { pngDataUrl }) => {
  try {
    const img = nativeImage.createFromDataURL(pngDataUrl)
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const p = path.join(app.getPath('downloads'), `Kastrava-${ts}.png`)
    fs.writeFileSync(p, img.toPNG())
    return p
  } catch { return null }
})

// Bookmark export (Netscape HTML)
ipcMain.handle('export-bookmarks', async (_, html) => {
  try {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'kastrava-bookmarks.html',
      filters: [{ name: 'HTML', extensions: ['html'] }]
    })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, html)
    return r.filePath
  } catch { return null }
})

// Bookmark import (Netscape HTML)
ipcMain.handle('import-bookmarks', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths.length) return 0
    const txt = fs.readFileSync(r.filePaths[0], 'utf-8')
    const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi
    let m, count = 0
    while ((m = re.exec(txt))) {
      const url = m[1].trim()
      const title = (m[2] || '').replace(/<[^>]+>/g, '').trim() || url
      if (/^https?:\/\//i.test(url)) {
        const exists = all('SELECT id FROM bookmarks WHERE url = ? LIMIT 1', [url])
        if (!exists.length) {
          run('INSERT INTO bookmarks (title, url) VALUES (?, ?)', [title, url])
          count++
        }
      }
    }
    return count
  } catch { return 0 }
})
