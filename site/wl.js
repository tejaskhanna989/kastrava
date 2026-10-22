/* Kastrava site i18n — shared runtime for all public pages.
   20 languages. Priority: manual choice (localStorage) > geo by IP (cached in
   sessionStorage per session) > browser language > English.
   Dictionaries: inline WEBSTR (index/store, en+ru) + /lang/<code>.js external
   (every non-English language, loaded synchronously during parse when known).
   Pages may define window.wlApplyExtra() for page-specific re-renders. */
(function () {
  var WL_LANGS = [
    ['en', 'English'], ['hi', 'हिन्दी'], ['ru', 'Русский'], ['ja', '日本語'],
    ['ko', '한국어'], ['zh', '中文'], ['ar', 'العربية'], ['de', 'Deutsch'],
    ['fr', 'Français'], ['es', 'Español'], ['pt', 'Português'], ['tr', 'Türkçe'],
    ['id', 'Bahasa Indonesia'], ['th', 'ไทย'],
    ['uk', 'Українська'], ['it', 'Italiano'], ['pl', 'Polski'],
    ['nl', 'Nederlands'], ['bn', 'বাংলা']
  ];
  var WL_SET = {};
  for (var i = 0; i < WL_LANGS.length; i++) WL_SET[WL_LANGS[i][0]] = WL_LANGS[i][1];

  /* country -> language (IP fallback when the browser says nothing useful) */
  var WL_C2L = {
    RU: 'ru', BY: 'ru', KZ: 'ru', UA: 'uk', JP: 'ja', KR: 'ko',
    CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh', BR: 'pt', PT: 'pt', TR: 'tr',
    ID: 'id', TH: 'th', IT: 'it', PL: 'pl', NL: 'nl',
    DE: 'de', AT: 'de', CH: 'de', FR: 'fr', BE: 'fr', ES: 'es', MX: 'es',
    AR: 'es', CL: 'es', CO: 'es', PE: 'es', VE: 'es', EC: 'es', UY: 'es',
    PY: 'es', BO: 'es', GT: 'es', DO: 'es', CU: 'es', PA: 'es', HN: 'es',
    NI: 'es', CR: 'es', SA: 'ar', AE: 'ar', EG: 'ar', IQ: 'ar', MA: 'ar',
    DZ: 'ar', JO: 'ar', LB: 'ar', OM: 'ar', QA: 'ar', KW: 'ar', BH: 'ar',
    LY: 'ar', TN: 'ar', SY: 'ar', YE: 'ar', IL: 'ar', PS: 'ar', SD: 'ar',
    MR: 'ar', SO: 'ar', DJ: 'ar', KM: 'ar', BD: 'bn', IN: 'hi'
  };

  var WL_GEO_API = 'https://api.kastrava.in/api/geo';
  var WL_LANG = 'en';
  var WL_GEO_DONE = false;

  function wlValid(l) { return l && WL_SET[l]; }

  function wlStored() {
    try {
      var l = localStorage.getItem('kas-weblang');
      if (wlValid(l)) return l;
    } catch (e) {}
    return null;
  }

  function wlNavGuess() {
    var nav = ((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
    var sub = nav.split('-')[0];
    if (wlValid(sub)) return sub;
    if (nav.indexOf('zh') === 0) return 'zh';
    if (nav.indexOf('pt') === 0) return 'pt';
    return null;
  }

  function wlSessionGeo() {
    try { return wlValid(sessionStorage.getItem('wl-geolang')) ? sessionStorage.getItem('wl-geolang') : null; }
    catch (e) { return null; }
  }

  function wlKickGeo() {
    if (WL_GEO_DONE || wlStored()) return;
    WL_GEO_DONE = true;
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    try {
      fetch(WL_GEO_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tz: tz })
      }).then(function (r) { return r.json(); }).then(function (g) {
        var lang = g && g.country && WL_C2L[g.country];
        if (!wlValid(lang)) { lang = null; WL_GEO_DONE = true; return; }
        try { sessionStorage.setItem('wl-geolang', lang); } catch (e) {}
        WL_GEO_DONE = true;
        if (lang !== WL_LANG && !wlStored()) {
          WL_LANG = lang;
          wlLoadExt(lang, function () { wlApply(); });
        }
      }).catch(function () {});
    } catch (e) {}
  }

  /* --- external dict --------------------------------------------------- */
  function wlHasDict(l) {
    if (l === 'en') return true;
    if (typeof WEBSTR_X !== 'undefined' && WEBSTR_X) return true;
    if (typeof WEBSTR !== 'undefined' && WEBSTR && WEBSTR[l]) return true;
    return false;
  }

  function wlLoadExt(l, cb) {
    if (l === 'en' || wlHasDict(l)) { cb && cb(); return; }
    var s = document.createElement('script');
    s.src = '/lang/' + l + '.js?v=1';
    s.onload = function () { cb && cb(); };
    s.onerror = function () { cb && cb(); };
    document.head.appendChild(s);
  }

  /* Synchronous load while parsing (zero flash on first paint). */
  var WL_INITIAL = wlStored() || wlSessionGeo() || wlNavGuess() || 'en';
  WL_LANG = WL_INITIAL;
  if (WL_LANG !== 'en' && document.readyState === 'loading') {
    document.write('<script src="/lang/' + WL_LANG + '.js?v=1"><\/script>');
  } else if (WL_LANG !== 'en') {
    wlLoadExt(WL_LANG);
  }

  /* --- lookup + apply --------------------------------------------------- */
  function wlDict(l) {
    var d = {};
    try { if (typeof WEBSTR_X !== 'undefined' && WEBSTR_X) d = WEBSTR_X; } catch (e) {}
    return d;
  }

  function wlT(k) {
    var l = WL_LANG;
    try {
      var x = wlDict(l);
      if (x && x[k] != null) return x[k];
    } catch (e) {}
    try {
      if (typeof WEBSTR !== 'undefined' && WEBSTR && WEBSTR[l] && WEBSTR[l][k] != null) return WEBSTR[l][k];
    } catch (e) {}
    try {
      if (typeof WEBSTR !== 'undefined' && WEBSTR && WEBSTR.en && WEBSTR.en[k] != null) return WEBSTR.en[k];
    } catch (e) {}
    return k;
  }

  function wlCat(id) { return wlT('cat_' + id); }

  function wlPick(orig, key) {
    var l = WL_LANG;
    var d = null;
    try {
      var x = wlDict(l);
      if (x && x[key] != null) d = x[key];
    } catch (e) {}
    if (d == null) {
      try {
        if (typeof WEBSTR !== 'undefined' && WEBSTR && WEBSTR[l] && WEBSTR[l][key] != null) d = WEBSTR[l][key];
      } catch (e) {}
    }
    if (d == null && l !== 'en') {
      try {
        if (typeof WEBSTR !== 'undefined' && WEBSTR && WEBSTR.en && WEBSTR.en[key] != null) d = WEBSTR.en[key];
      } catch (e) {}
    }
    if (d == null) return orig;      /* no translation: keep what's in the DOM */
    return d;
  }

  function wlOrig(el, prop) {
    var ds = prop === 'html' ? 'wlOrigHtml' : 'wlOrigA_' + prop;
    if (el.dataset[ds] == null) el.dataset[ds] = prop === 'html' ? el.innerHTML : el.getAttribute(prop);
    return el.dataset[ds];
  }

  function wlApply() {
    var l = WL_LANG;
    try {
      document.documentElement.setAttribute('lang', l);
      document.documentElement.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr');
    } catch (e) {}
    var skip = {};
    try { (window.wlSkipKeys || []).forEach(function (k) { skip[k] = 1; }); } catch (e) {}
    document.querySelectorAll('[data-wl]').forEach(function (el) {
      var key = el.getAttribute('data-wl');
      if (skip[key]) return;   /* page-managed (geo-priced hero-prem etc.) */
      el.innerHTML = wlPick(wlOrig(el, 'html'), key);
    });
    [['data-wlp', 'placeholder'], ['data-wla', 'alt'], ['data-wti', 'title'],
     ['data-wal', 'aria-label'], ['data-wld', 'content']].forEach(function (pair) {
      document.querySelectorAll('[' + pair[0] + ']').forEach(function (el) {
        var key = el.getAttribute(pair[0]);
        var prop = pair[1];
        var orig = el.dataset['wlOrigA_' + prop];
        if (orig == null) {
          orig = el.getAttribute(prop);
          if (orig == null) orig = '';
          el.dataset['wlOrigA_' + prop] = orig;
        }
        var val = wlPick(orig, key);
        el.setAttribute(prop, val);
      });
    });
    var b = document.getElementById('lang-btn');
    if (b) {
      b.textContent = l.toUpperCase();
      b.setAttribute('title', WL_SET[l] || l);
      b.setAttribute('aria-label', WL_SET[l] || l);
    }
    try { window.wlApplyExtra && window.wlApplyExtra(l); } catch (e) {}
  }

  /* --- switcher --------------------------------------------------------- */
  function wlBuildSwitcher() {
    var panel = document.createElement('div');
    panel.id = 'wl-panel';
    panel.style.cssText = 'position:fixed;right:14px;bottom:64px;background:var(--card,#14161d);border:1px solid var(--line,#2a2e39);border-radius:12px;padding:8px;display:none;grid-template-columns:1fr 1fr;gap:2px;z-index:99999;box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:320px';
    var item = document.createElement('button');
    item.style.cssText = 'text-align:left;background:none;border:none;color:var(--text,#e7e9ee);font:13px/1.5 inherit;padding:5px 10px;border-radius:7px;cursor:pointer;white-space:nowrap';
    WL_LANGS.forEach(function (pair) {
      var b2 = item.cloneNode(false);
      b2.textContent = pair[1] + '  ·  ' + pair[0].toUpperCase();
      b2.dataset.code = pair[0];
      b2.onclick = function () {
        try { localStorage.setItem('kas-weblang', pair[0]); } catch (e) {}
        WL_LANG = pair[0];
        panel.style.display = 'none';
        wlLoadExt(pair[0], function () { wlApply(); });
      };
      panel.appendChild(b2);
    });
    document.body.appendChild(panel);

    function mark() {
      panel.querySelectorAll('button').forEach(function (b2) {
        b2.style.background = b2.dataset.code === WL_LANG ? 'rgba(80,140,255,.16)' : '';
        b2.style.color = b2.dataset.code === WL_LANG ? 'var(--blue,#6ea8ff)' : '';
      });
    }
    var origApply = wlApply;
    wlApply = function () { origApply(); mark(); };
    window.wlApply = wlApply;

    function toggle() {
      mark();
      panel.style.display = panel.style.display === 'grid' ? 'none' : 'grid';
    }
    var btn = document.getElementById('lang-btn');
    if (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
      btn.style.cursor = 'pointer';
    } else {
      var fab = document.createElement('button');
      fab.id = 'wl-fab';
      fab.textContent = '🌐 ' + WL_LANG.toUpperCase();
      fab.style.cssText = 'position:fixed;right:14px;bottom:14px;background:var(--card,#14161d);border:1px solid var(--line,#2a2e39);border-radius:999px;color:var(--text,#e7e9ee);font:12px/1 inherit;font-weight:700;padding:9px 13px;cursor:pointer;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.4)';
      fab.onclick = function (e) { e.stopPropagation(); toggle(); };
      document.body.appendChild(fab);
      var origApply2 = wlApply;
      wlApply = function () { origApply2(); fab.textContent = '🌐 ' + WL_LANG.toUpperCase(); };
      window.wlApply = wlApply;
    }
    document.addEventListener('click', function (e) {
      if (panel.style.display !== 'none' && !panel.contains(e.target)) panel.style.display = 'none';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') panel.style.display = 'none';
    });
  }

  /* --- boot -------------------------------------------------------------- */
  window.wlLang = function () { return WL_LANG; };
  window.wlT = wlT;
  window.wlCat = wlCat;
  window.wlApply = wlApply;

  document.addEventListener('DOMContentLoaded', function () {
    wlBuildSwitcher();
    wlApply();
    wlKickGeo();
  });
})();
