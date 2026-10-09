const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.invoke('win-minimize'),
  maximize: () => ipcRenderer.invoke('win-maximize'),
  close: () => ipcRenderer.invoke('win-close'),
  isMaximized: () => ipcRenderer.invoke('win-is-maximized'),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (k, v) => ipcRenderer.invoke('set-setting', k, v),
  setReferrer: (v) => ipcRenderer.invoke('set-referrer', v),

  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (b) => ipcRenderer.invoke('add-bookmark', b),
  removeBookmark: (id) => ipcRenderer.invoke('remove-bookmark', id),

  getHistory: () => ipcRenderer.invoke('get-history'),
  addHistory: (h) => ipcRenderer.invoke('add-history', h),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  getTopSites: () => ipcRenderer.invoke('get-top-sites'),
  saveTopSites: (s) => ipcRenderer.invoke('save-top-sites', s),




  savePageIcon: (d) => ipcRenderer.invoke('save-page-icon', d),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openPath: (p) => ipcRenderer.invoke('open-path', p),

  saveSession: (tabs) => ipcRenderer.invoke('save-session', tabs),
  saveSessionSync: (tabs) => ipcRenderer.send('save-session-sync', tabs),
  loadSession: () => ipcRenderer.invoke('load-session'),

  onWinState: (cb) => { ipcRenderer.on('win-state', (_, s) => cb(s)); ipcRenderer.invoke('win-is-maximized').then(m => cb({maximized: m, minimized: false})) },

  onOpenNewTab: (cb) => ipcRenderer.on('open-new-tab', (_, url) => cb(url)),

  onMenuShortcut: (cb) => ipcRenderer.on('menu-shortcut', (_, a) => cb(a)),

  onSaveSessionNow: (cb) => ipcRenderer.on('save-session-now', () => cb()),

  // Downloads (handled natively by Chromium, tracked via IPC)
  agPause: (id) => ipcRenderer.invoke('ag-pause', id),
  agResume: (id) => ipcRenderer.invoke('ag-resume', id),
  agStop: (id) => ipcRenderer.invoke('ag-stop', id),
  agClear: (id) => ipcRenderer.invoke('ag-clear', id),
  agList: () => ipcRenderer.invoke('ag-list'),
  agSave: (id) => ipcRenderer.invoke('ag-save', id),
  onAgUpdate: (cb) => ipcRenderer.on('ag-update', (_, d) => cb(d)),
  onAgCleared: (cb) => ipcRenderer.on('ag-cleared', (_, id) => cb(id)),

  log: (msg) => ipcRenderer.invoke('log', msg),

  webInspect: (o) => ipcRenderer.invoke('web-inspect', o),
  devtoolsToggle: (id) => ipcRenderer.invoke('devtools-toggle', id),
  devtoolsSelf: () => ipcRenderer.invoke('devtools-self'),
  devtoolsOpen: (id) => ipcRenderer.invoke('devtools-open', id),
  devtoolsClose: (id) => ipcRenderer.invoke('devtools-close', id),

  // Screenshots
  saveScreenshot: (d) => ipcRenderer.invoke('save-screenshot', d),

  // Bookmarks import/export
  exportBookmarks: (html) => ipcRenderer.invoke('export-bookmarks', html),
  importBookmarks: () => ipcRenderer.invoke('import-bookmarks'),

  // Tracking Radar
  radarGet: (wcId) => ipcRenderer.invoke('radar-get', wcId),
  radarClear: (wcId) => ipcRenderer.invoke('radar-clear', wcId),
  radarStats: (wcId) => ipcRenderer.invoke('radar-stats', wcId),
  onRadarUpdate: (cb) => ipcRenderer.on('radar-update', (_, wcId, ev) => cb(wcId, ev)),
  onCaptchaFound: (cb) => ipcRenderer.on('captcha-found', (_, host) => cb(host)),
  licMachine: () => ipcRenderer.invoke('lic-machine'),
  licStatus: () => ipcRenderer.invoke('lic-status'),
  licActivate: (key) => ipcRenderer.invoke('lic-activate', key),
  licCancel: () => ipcRenderer.invoke('lic-cancel'),
  licActivateAccount: () => ipcRenderer.invoke('lic-activate-account'),
  licDevices: () => ipcRenderer.invoke('lic-devices'),
  licDeviceRemove: (d) => ipcRenderer.invoke('lic-device-remove', d),

  // In-app sync (Phase 2): login + push/pull. Key material stays main-side.
  syncStatus: () => ipcRenderer.invoke('sync-status'),
  syncLogin: (d) => ipcRenderer.invoke('sync-login', d),
  syncLoginOtp: (d) => ipcRenderer.invoke('sync-login-otp', d),
  syncVerify: (d) => ipcRenderer.invoke('sync-verify', d),
  syncLogout: () => ipcRenderer.invoke('sync-logout'),
  syncNow: (d) => ipcRenderer.invoke('sync-now', d),

  // Auto-update (NSIS installer + AppImage; no-op elsewhere)
  checkUpdates: () => ipcRenderer.invoke('check-updates')
})
