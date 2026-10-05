const { app, session } = require('electron')
const path = require('path')
const fs = require('fs')
const https = require('https')
const http = require('http')
const { execSync } = require('child_process')
const adblock = require('./adblock')

const CHROME_FULL = (process.versions && process.versions.chrome) || '131.0.0.0'
const CHROME_MAJOR = String(CHROME_FULL).split('.')[0] || '131'
// Built from the running engine's real Chromium version (never hardcoded),
// minus the Electron token. A hardcoded version would itself be a
// fingerprint signal the moment Electron upgrades underneath it.
const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + CHROME_FULL + ' Safari/537.36'

// === TRACKER BLOCKING (Privacy Badger / ClearURLs) ===
const TRACKER_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'googleadservices.com',
  'facebook.com/tr', 'facebook.net', 'connect.facebook.net',
  'doubleclick.net', 'googlesyndication.com', 'adservice.google.com',
  'analytics.twitter.com', 'platform.twitter.com',
  'scorecardresearch.com', 'quantserve.com', 'quantcast.com',
  'chartbeat.com', 'chartbeat.net', 'mixpanel.com',
  'amplitude.com', 'hotjar.com', 'fullstory.com',
  'segment.com', 'segment.io', 'heap.io',
  'optimizely.com', 'visualwebsiteoptimizer.com',
  'crazyegg.com', 'mouseflow.com', 'luckyorange.com',
  'newrelic.com', 'nr-data.net', 'sentry.io',
  'branch.io', 'adjust.com', 'appsflyer.com',
  'branch.io', 'kochava.com', 'singular.net',
  'bing.com/bar', 'bat.bing.com',
  'pinterest.com/ct/', 'snap.licdn.com',
  'tiktok.com/i18n/pixel', 'analytics.tiktok.com',
  'clarity.ms', 'bat.bing.com',
  'track Summer', 'track.summer.net'
]

const TRACKER_REGEX = TRACKER_DOMAINS.map(d => {
  const escaped = d.replace(/\./g, '\\.').replace(/\//g, '\\/')
  return new RegExp('https?://[^/]*' + escaped, 'i')
})

const URL_TRACKER_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'dclid', 'gclsrc', 'mc_cid', 'mc_eid', 'ref', 'source', '_ga', '_gl', 'yclid', 'msclkid']

function isTrackerUrl(url) {
  for (const re of TRACKER_REGEX) {
    if (re.test(url)) return true
  }
  return false
}

function cleanUrl(url) {
  try {
    const u = new URL(url)
    let changed = false
    for (const param of URL_TRACKER_PARAMS) {
      if (u.searchParams.has(param)) { u.searchParams.delete(param); changed = true }
    }
    return changed ? u.toString() : url
  } catch { return url }
}

// === HTTPS EVERYWHERE ===
const HTTPS_EXCEPTIONS = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']

function shouldUpgradeHttps(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:') return false
    if (HTTPS_EXCEPTIONS.includes(u.hostname)) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return false
    return true
  } catch { return false }
}

function upgradeUrl(url) {
  try {
    const u = new URL(url)
    u.protocol = 'https:'
    return u.toString()
  } catch { return url }
}

// === COOKIE AUTO-DELETE ===
function autoDeleteCookies(ses) {
  if (!ses) return
  ses.webRequest.onHeadersReceived({ urls: ['*://*'] }, (details, callback) => {
    callback({})
  })
}

// === FONT FINGERPRINT PROTECTION (Font Fingerprint Defender) ===
const FONT_FINGERPRINT_SCRIPT = `
(function(){
  if(!window.__kastrava_font_protected){
    window.__kastrava_font_protected=true;
    var _fonts=null;
    var _ffSeed=Math.random();
    function _getFonts(){
      if(_fonts&&Math.random()>0.1)return _fonts;
      _ffSeed=Math.random();
      var base=['Arial','Verdana','Times New Roman','Courier New','Georgia','Palatino','Garamond','Comic Sans MS','Impact','Lucida Console','Tahoma','Trebuchet MS','Century Gothic','Cambria','Calibri','Helvetica','Futura','Optima','Franklin Gothic Medium','Book Antiqua'];
      var extra=['Roboto','Open Sans','Lato','Montserrat','Source Sans Pro','Ubuntu','Noto Sans','Raleway','PT Sans','Fira Sans','Droid Sans','Oswald','Merriweather','Playfair Display','Noto Serif','IBM Plex Sans','Inter','Work Sans','Rubik','Karla'];
      _fonts=base.concat(extra);
      var swap=Math.floor(_ffSeed*_fonts.length);
      for(var i=0;i<swap;i++){
        var a=Math.floor(Math.random()*_fonts.length);
        var b=Math.floor(Math.random()*_fonts.length);
        var t=_fonts[a];_fonts[a]=_fonts[b];_fonts[b]=t;
      }
      return _fonts;
    }
    if(window.fonts&&window.fonts.check){
      var _origCheck=window.fonts.check.bind(window.fonts);
      window.fonts.check=function(f){
        var fnt=f.replace(/^\\d+\\w+\\s+/,'');
        return _getFonts().indexOf(fnt)!==-1||_origCheck(f);
      };
    }
    if(document.fonts&&document.fonts.check){
      var _docCheck=document.fonts.check.bind(document.fonts);
      document.fonts.check=function(f){
        var fnt=f.replace(/^\\d+\\w+\\s+/,'');
        return _getFonts().indexOf(fnt)!==-1||_docCheck(f);
      };
    }
    if(document.fonts&&document.fonts.values){
      var _origValues=document.fonts.values.bind(document.fonts);
      document.fonts.values=function(){
        var fonts=_origValues();
        return fonts;
      };
    }
    Object.defineProperty(navigator,'fonts',{
      get:function(){return{check:function(f){var fnt=f.replace(/^\\d+\\w+\\s+/,'');return _getFonts().indexOf(fnt)!==-1;},add:function(){},entries:function(){return _getFonts()[Symbol.iterator]();},values:function(){return _getFonts()[Symbol.iterator]();},size:_getFonts().length,has:function(f){return _getFonts().indexOf(f)!==-1},forEach:function(cb){_getFonts().forEach(cb)};};}
    });
  }
})();
`

// === COOKIE BANNER DISMISSAL (I Don't Care About Cookies) ===
const COOKIE_BANNER_SCRIPT = `
(function(){
  if(!window.__kastrava_cookie_banner_dismissed){
    window.__kastrava_cookie_banner_dismissed=true;
    var _sel=['#onetrust-reject-all-handler','#onetrust-pc-btn-handler','#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll','button#didomi-notice-disagree-button','#truste-consent-required','[data-testid="cookie-reject"]','[data-action="reject"]','.cc-deny','#gdpr-reject','button.js-reject-cookies','[aria-label="Reject cookies"]','[aria-label="Reject all cookies"]','[aria-label="Decline cookies"]','[id*="cookie"][id*="reject"]','[id*="cookie"][id*="decline"]','[id*="cookie"][id*="deny"]','[class*="cookie"][class*="reject"]','[class*="cookie"][class*="decline"]'];
    var _re=/^(reject( all)?|decline( all)?|deny( all)?|necessary only|essential only|save (my )?selection|confirm (my )?(selection|choices)|nur notwendige|alle ablehnen|tout refuser|rechazar( todo)?)$/;
    function _visible(el){if(!el||el.offsetParent===null)return false;var st=getComputedStyle(el);return st.display!=='none'&&st.visibility!=='hidden'&&st.opacity!=='0';}
    function _textReject(){
      var els=document.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"]');
      for(var k=0;k<els.length;k++){var b=els[k];var t=((b.innerText||b.value||b.getAttribute('aria-label')||'').trim().toLowerCase());if(t&&_re.test(t)&&_visible(b)){try{b.click();}catch(e){}return true;}}
      return false;
    }
    function _dismiss(){
      for(var i=0;i<_sel.length;i++){
        var btns=document.querySelectorAll(_sel[i]);
        for(var j=0;j<btns.length;j++){
          var b=btns[j];
          if(_visible(b)){try{b.click();}catch(e){}return true;}
        }
      }
      return _textReject();
    }
    function _sweep(){_dismiss();}
    if(!_sweep()){
      var _muted=new MutationObserver(function(muts){_sweep();});
      _muted.observe(document.documentElement,{childList:true,subtree:true});
      setTimeout(function(){_muted.disconnect();},20000);
    }
  }
})();
`

// === SCRIPT BLOCKING (ScriptSafe / NoScript) ===
const SCRIPT_BLOCK_STYLE = 'display:none !important'

function applyScriptBlockStyle(webContents, blockedTags) {
  if (!webContents || webContents.isDestroyed()) return
  const css = blockedTags.map(tag => tag + '{' + SCRIPT_BLOCK_STYLE + '}').join('\n')
  webContents.insertCSS(css).catch(() => {})
}

// === CDN LOCAL (Decentraleyes / LocalCDN) ===
const CDN_HOSTS = {
  'cdnjs.cloudflare.com': 'ajax.googleapis.com/ajax/libs',
  'cdn.jsdelivr.net': 'cdn.jsdelivr.net',
  'unpkg.com': 'unpkg.com',
  'ajax.googleapis.com': 'ajax.googleapis.com/ajax/libs',
  'cdn.datatables.net': 'cdn.datatables.net'
}

const LOCAL_CDN_DIR = () => path.join(app.getPath('userData'), 'data', 'cdn-cache')

function ensureCdnCacheDir() {
  const dir = LOCAL_CDN_DIR()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function downloadCdnFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const req = proto.get(url, { headers: { 'User-Agent': 'Kastrava/101' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadCdnFile(res.headers.location, dest).then(resolve, reject)
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => { try { fs.writeFileSync(dest, Buffer.concat(chunks)); resolve() } catch (e) { reject(e) } })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function tryServeLocalCdn(url) {
  try {
    const u = new URL(url)
    const host = u.hostname
    if (!CDN_HOSTS[host]) return null
    const dir = ensureCdnCacheDir()
    const cacheKey = path.join(dir, host + u.pathname.replace(/\//g, '__'))
    if (fs.existsSync(cacheKey)) {
      const data = fs.readFileSync(cacheKey)
      const ext = path.extname(u.pathname).toLowerCase()
      const types = { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' }
      return { data, type: types[ext] || 'application/octet-stream' }
    }
    await downloadCdnFile(url, cacheKey)
    const data = fs.readFileSync(cacheKey)
    const ext = path.extname(u.pathname).toLowerCase()
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' }
    return { data, type: types[ext] || 'application/octet-stream' }
  } catch { return null }
}

// === REQUEST MODIFICATION (Requestly) ===
let requestRules = []

function addRequestRule(rule) {
  requestRules.push(rule)
}

function removeRequestRule(index) {
  requestRules.splice(index, 1)
}

function getRequestRules() {
  return [...requestRules]
}

function applyRequestRules(url) {
  let modified = url
  for (const rule of requestRules) {
    if (rule.enabled && rule.type === 'redirect') {
      try {
        const re = new RegExp(rule.source)
        if (re.test(modified)) modified = modified.replace(re, rule.target)
      } catch {}
    }
    if (rule.enabled && rule.type === 'block') {
      try {
        const re = new RegExp(rule.source)
        if (re.test(url)) return null
      } catch {}
    }
    if (rule.enabled && rule.type === 'header') {
      // Headers handled in onBeforeSendHeaders
    }
  }
  return modified
}

// === MAIN PRIVACY PROTECTION SCRIPTS ===
const CANVAS_NOISE_SCRIPT = `
(function(){
  if(!window.__kastrava_canvas_protected){
    window.__kastrava_canvas_protected=true;
    var origToBlob=HTMLCanvasElement.prototype.toBlob;
    var origToDataURL=HTMLCanvasElement.prototype.toDataURL;
    var origGetImageData=CanvasRenderingContext2D.prototype.getImageData;
    function _addNoiseToDataURL(dataURL){
      try{
        var parts=dataURL.split(',');
        if(parts.length!==2)return dataURL;
        var header=parts[0];
        var b64=parts[1];
        var bytes=atob(b64);
        var arr=new Uint8Array(bytes.length);
        for(var i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);
        var noiseLen=Math.min(8,arr.length);
        for(var i=0;i<noiseLen;i++)arr[i]=arr[i]^(((Math.random()*2)|0));
        var out='';
        for(var i=0;i<arr.length;i++)out+=String.fromCharCode(arr[i]);
        return header+','+btoa(out);
      }catch(e){return dataURL;}
    }
    CanvasRenderingContext2D.prototype.getImageData=function(){
      var d=origGetImageData.apply(this,arguments);
      if(d&&d.data&&d.data.length>16){
        for(var i=0;i<Math.min(8,d.data.length);i++){
          d.data[i]=d.data[i]^(((Math.random()*2)|0));
        }
      }
      return d;
    };
    HTMLCanvasElement.prototype.toDataURL=function(){
      var dataURL=origToDataURL.apply(this,arguments);
      return _addNoiseToDataURL(dataURL);
    };
    HTMLCanvasElement.prototype.toBlob=function(cb){
      var self=this;
      var args=arguments;
      var callback=args[0];
      if(typeof callback!=='function'){
        return origToBlob.apply(self,args);
      }
      origToBlob.call(self,function(blob){
        try{
          var reader=new FileReader();
          reader.onloadend=function(){
            var noisyDataURL=_addNoiseToDataURL(reader.result);
            var parts=noisyDataURL.split(',');
            var byteString=atob(parts[1]);
            var ab=new ArrayBuffer(byteString.length);
            var ia=new Uint8Array(ab);
            for(var i=0;i<byteString.length;i++)ia[i]=byteString.charCodeAt(i);
            var blob2=new Blob([ab],{type:blob.type});
            callback(blob2);
          };
          reader.readAsDataURL(blob);
        }catch(e){
          callback(blob);
        }
      });
    };
  }
})();
`

const WEBRTC_BLOCK_SCRIPT = `
(function(){
  if(!window.__kastrava_webrtc_blocked){
    window.__kastrava_webrtc_blocked=true;
    var origRTCPeerConnection=window.RTCPeerConnection;
    if(origRTCPeerConnection){
      window.RTCPeerConnection=function(cfg,cons){
        if(cfg&&cfg.iceServers){cfg.iceServers=[];}
        return new origRTCPeerConnection(cfg,cons);
      };
      window.RTCPeerConnection.prototype=origRTCPeerConnection.prototype;
    }
    var origRTC=window.webkitRTCPeerConnection;
    if(origRTC){
      window.webkitRTCPeerConnection=function(cfg,cons){
        if(cfg&&cfg.iceServers){cfg.iceServers=[];}
        return new origRTC(cfg,cons);
      };
      window.webkitRTCPeerConnection.prototype=origRTC.prototype;
    }
  }
})();
`

const NAVIGATOR_SPOOF_SCRIPT = `
(function(){
  if(!window.__kastrava_nav_spoofed){
    window.__kastrava_nav_spoofed=true;
    Object.defineProperty(navigator,'webdriver',{get:function(){return false;}});
    Object.defineProperty(navigator,'plugins',{get:function(){return[1,2,3,4,5];}});
    Object.defineProperty(navigator,'languages',{get:function(){return['en-US','en'];}});
    Object.defineProperty(navigator,'platform',{get:function(){return'Linux x86_64';}});
    window.chrome=window.chrome||{};
    window.chrome.runtime=window.chrome.runtime||{};
    window.chrome.loadTimes=window.chrome.loadTimes||function(){return{};};
    window.chrome.csi=window.chrome.csi||function(){return{};};
    try{Object.defineProperty(navigator,'userAgentData',{get:function(){return{brands:[{brand:"Chromium",version:"${CHROME_MAJOR}"},{brand:"Not_A Brand",version:"24"},{brand:"Google Chrome",version:"${CHROME_MAJOR}"}],mobile:false,platform:"Linux",getHighEntropyValues:function(){return Promise.resolve({});}};}});}catch(e){}
    Object.defineProperty(navigator,'maxTouchPoints',{get:function(){return 0;}});
    Object.defineProperty(navigator,'userAgent',{get:function(){return '${CHROME_UA}';},configurable:true});
    // Network Information API leaks connection type, bandwidth and RTT.
    // Firefox/Safari don't implement it at all, so hiding it breaks nothing
    // well-built: the data is gone, not faked (fake values are detectable).
    Object.defineProperty(navigator,'connection',{get:function(){return undefined;},configurable:true});
    // Battery Status API leaks charge level and charging state — a known
    // fingerprinting vector with zero legitimate use in a browser UI.
    // Frozen generic full-charge profile, matching function shape exactly.
    Object.defineProperty(navigator,'getBattery',{value:function(){return Promise.resolve(Object.freeze({charging:true,chargingTime:0,dischargingTime:Number.POSITIVE_INFINITY,level:1,addEventListener:function(){},removeEventListener:function(){},dispatchEvent:function(){return false;}}));},configurable:true});
  }
})();
`

// === FEATURE STATE ===
let featureState = {
  httpsEverywhere: true,
  trackerBlocking: true,
  cookieAutoDelete: true,
  scriptBlocking: false,
  fontFingerprint: true,
  cookieBannerDismiss: true,
  cdnLocal: true
}

let scriptWhitelist = []

function loadFeatureState() {
  try {
    const dataDir = path.join(app.getPath('userData'), 'data')
    const statePath = path.join(dataDir, 'privacy-state.json')
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
      Object.assign(featureState, data.features || {})
      scriptWhitelist = data.whitelist || []
    }
  } catch {}
}

function saveFeatureState() {
  try {
    const dataDir = path.join(app.getPath('userData'), 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    const statePath = path.join(dataDir, 'privacy-state.json')
    fs.writeFileSync(statePath, JSON.stringify({ features: featureState, whitelist: scriptWhitelist }, null, 2))
  } catch {}
}

function setFeature(key, value) {
  featureState[key] = value
  saveFeatureState()
}

function getFeatures() {
  return { ...featureState }
}

function addToWhitelist(domain) {
  if (!scriptWhitelist.includes(domain)) {
    scriptWhitelist.push(domain)
    saveFeatureState()
  }
}

function removeFromWhitelist(domain) {
  scriptWhitelist = scriptWhitelist.filter(d => d !== domain)
  saveFeatureState()
}

function getWhitelist() {
  return [...scriptWhitelist]
}

// === CORE FUNCTIONS ===
function applyUserAgent(sessionObj) {
  if (!sessionObj) return
  sessionObj.setUserAgent(CHROME_UA)
}

function installWebRTCProtection(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  webContents.on('dom-ready', () => {
    webContents.executeJavaScript(WEBRTC_BLOCK_SCRIPT).catch(() => {})
  })
}

function installCanvasProtection(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  webContents.on('dom-ready', () => {
    webContents.executeJavaScript(CANVAS_NOISE_SCRIPT).catch(() => {})
  })
}

function installNavigatorSpoof(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  webContents.on('dom-ready', () => {
    webContents.executeJavaScript(NAVIGATOR_SPOOF_SCRIPT).catch(() => {})
  })
}

function installFontProtection(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  if (!featureState.fontFingerprint) return
  webContents.on('dom-ready', () => {
    webContents.executeJavaScript(FONT_FINGERPRINT_SCRIPT).catch(() => {})
  })
}

function installCookieBannerDismissal(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  if (!featureState.cookieBannerDismiss) return
  webContents.on('dom-ready', () => {
    webContents.executeJavaScript(COOKIE_BANNER_SCRIPT).catch(() => {})
  })
}

function installPrivacyProtections(webContents) {
  if (!webContents || webContents.isDestroyed()) return
  if (webContents.id === (global.mainWindow && global.mainWindow.webContents && global.mainWindow.webContents.id)) return
  installWebRTCProtection(webContents)
  installCanvasProtection(webContents)
  installNavigatorSpoof(webContents)
  installFontProtection(webContents)
  installCookieBannerDismissal(webContents)
}

function installWebviewProtection(wv) {
  if (!wv) return
  wv.addEventListener('dom-ready', () => {
    try {
      const wcId = wv.getWebContentsId()
      const wc = session.defaultSession.getAllRunningWebContents().find(c => c.id === wcId) || null
      if (wc) installPrivacyProtections(wc)
    } catch {}
  })
}

function configureWebRTC(sessionObj, mode) {
  // setWebRTCIPHandlingPolicy was removed in Electron 43+
  // Use app.commandLine.appendSwitch as the replacement
  const { app } = require('electron')
  // Remove any previously set policy switches
  app.commandLine.removeSwitch('force-webrtc-ip-handling-policy')
  if (mode === 'disable') {
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp')
  } else if (mode === 'public') {
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only')
  } else {
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default')
  }
}

// === INSTALL COMBINED PRIVACY FILTER ===
let radarCallback = null

function setRadarCallback(cb) {
  radarCallback = cb
}

function installPrivacyFilter(ses) {
  if (!ses) return

  // SINGLE unified onBeforeRequest: Ad Blocker + HTTPS + Trackers + URL Cleaning + Script Blocking + Request Rules + Radar
  ses.webRequest.onBeforeRequest({ urls: ['*://*'] }, (details, callback) => {
    // Radar tracking (fire-and-forget, don't block)
    if (radarCallback) {
      try { radarCallback(details) } catch {}
    }

    var _u=details.url||'';
    var _isCws=_u.indexOf('chrome.google.com/webstore')!==-1||_u.indexOf('chromewebstore.google.com')!==-1||_u.indexOf('clients2.google.com/service/update2/crx')!==-1;
    var _isLocal=_u.indexOf('localhost')!==-1||_u.indexOf('127.0.0.1')!==-1||_u.indexOf('0.0.0.0')!==-1||_u.indexOf('[::1]')!==-1||_u.indexOf('192.168.')!==-1||_u.indexOf('10.')!==-1;
    if(_isCws||_isLocal){callback({});return;}

    // 1. Ad blocker (EasyList/EasyPrivacy) — highest priority
    if (adblock.shouldBlock(details.url)) {
      callback({ cancel: true })
      return
    }

    // 2. Script blocking
    if (featureState.scriptBlocking && details.resourceType === 'script') {
      try {
        const u = new URL(details.url)
        const hostname = u.hostname
        const isWhitelisted = scriptWhitelist.some(w => hostname === w || hostname.endsWith('.' + w))
        if (!isWhitelisted) {
          callback({ cancel: true })
          return
        }
      } catch {}
    }

    // 3. Tracker blocking
    if (featureState.trackerBlocking && isTrackerUrl(details.url)) {
      callback({ cancel: true })
      return
    }

    // 4. Request rules (block + redirect)
    const result = applyRequestRules(details.url)
    if (result === null) {
      callback({ cancel: true })
      return
    }
    if (result !== details.url) {
      callback({ redirectURL: result })
      return
    }

    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      // 5. HTTPS Everywhere for main frames
      if (featureState.httpsEverywhere && shouldUpgradeHttps(details.url)) {
        callback({ redirectURL: upgradeUrl(details.url) })
        return
      }
      // 6. URL cleaning for main frames
      const cleaned = cleanUrl(details.url)
      if (cleaned !== details.url) {
        callback({ redirectURL: cleaned })
        return
      }
      callback({})
      return
    }

    // 7. HTTPS for sub-resources
    if (featureState.httpsEverywhere && shouldUpgradeHttps(details.url)) {
      callback({ redirectURL: upgradeUrl(details.url) })
      return
    }

    // 8. URL cleaning for sub-resources
    const cleaned = cleanUrl(details.url)
    if (cleaned !== details.url) {
      callback({ redirectURL: cleaned })
      return
    }

    callback({})
  })
}

// === WIREGUARD ===
async function startWireGuard(configPath) {
  try {
    const name = path.basename(configPath, '.conf')
    execSync(`sudo wg-quick down ${configPath} 2>/dev/null; sudo wg-quick up ${configPath}`, { timeout: 15000 })
    return { success: true, name }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function stopWireGuard(configPath) {
  try {
    execSync(`sudo wg-quick down ${configPath}`, { timeout: 10000 })
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function applyProxy(sessionObj, proxyConfig) {
  if (!sessionObj) return
  if (!proxyConfig || !proxyConfig.enabled) {
    await sessionObj.setProxy({ mode: 'direct' })
    return
  }
  const config = { mode: 'fixed_servers', proxyRules: '' }
  if (proxyConfig.type === 'socks5') {
    config.proxyRules = `socks5://${proxyConfig.host}:${proxyConfig.port}`
  } else if (proxyConfig.type === 'http') {
    config.proxyRules = `http://${proxyConfig.host}:${proxyConfig.port}`
  } else if (proxyConfig.type === 'system') {
    config.mode = 'system'
  }
  await sessionObj.setProxy(config)
}

module.exports = {
  CHROME_UA, CANVAS_NOISE_SCRIPT, WEBRTC_BLOCK_SCRIPT, NAVIGATOR_SPOOF_SCRIPT,
  applyUserAgent, installWebRTCProtection, installCanvasProtection,
  installNavigatorSpoof, installWebviewProtection, configureWebRTC,
  installPrivacyProtections, installPrivacyFilter, installFontProtection,
  installCookieBannerDismissal, loadFeatureState, saveFeatureState,
  setFeature, getFeatures, addToWhitelist, removeFromWhitelist, getWhitelist,
  addRequestRule, removeRequestRule, getRequestRules,
  startWireGuard, stopWireGuard, applyProxy,
  isTrackerUrl, shouldUpgradeHttps, upgradeUrl, cleanUrl,
  setRadarCallback
}
