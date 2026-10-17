// Drive the running capture instance (scripts/lib-cdp.js, port 9444) and
// screenshot every applier product (theme / wallpaper / accents / logos) with
// the item applied. Writes site/store-assets/preview/<id>.jpg — these ARE the
// store previews (products.js points preview.img at them).
//
//   KAS_CDP_PORT=9444 node scripts/capture-previews.js
//   KAS_ONLY=theme-midnight-bloom node scripts/capture-previews.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { connect } = require('./lib-cdp.js');

const PRODUCTS = require('../server/lib/products.js').PRODUCTS;
const OUT = path.join(__dirname, '..', 'site', 'store-assets', 'preview');
fs.mkdirSync(OUT, { recursive: true });

const KINDS = ['theme', 'wallpaper', 'accents', 'logos'];
const BASE = { mode: 'dark', bg: '#141414', tbg: '#1e1e1e', tb: '#2b2b2b', om: '#141414', ac: '#4fc3f7' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HELPERS = `(() => {
  window.__ap = {
    ntp() { return document.getElementById('ntp'); },
    clearWall() { const n = document.getElementById('ntp'); if (n) n.style.background = ''; },
    theme(d) {
      try {
        settings.customThemes = (settings.customThemes || []).filter(t => t.id !== d.__id);
        settings.customThemes.push({ id: d.__id, name: d.__name, mode: d.mode, bg: d.bg, tbg: d.tbg, tb: d.tb, om: d.om, ac: d.ac });
        applyThemeKey('custom-' + d.__id);
      } catch (e) { return 'theme-err:' + e.message; }
      return 'ok';
    },
    accent(color) {
      document.documentElement.style.setProperty('--accent', color);
      try { settings.accent = color; } catch (e) {}
      return 'ok';
    },
    wallpaper(css) {
      return new Promise((res) => {
        const n = document.getElementById('ntp');
        if (!n) { res('no-ntp'); return; }
        const m = /url\\(["']?(.*?)["']?\\)/.exec(css || '');
        const done = () => { n.style.background = css; res('ok'); };
        if (m && m[1]) {
          const im = new Image();
          im.onload = done; im.onerror = done;
          im.src = m[1];
          setTimeout(done, 4000);          // never hang on a slow image
        } else { done(); }
      });
    },
    logo(url) {
      // .ntp-logo IS the <img>; applyCustomLogo sets .src directly.
      const els = document.querySelectorAll('.ntp-logo');
      if (!els.length || !url) return 'no-logo-el';
      els.forEach((im) => { im.src = url; });
      return 'set-src';
    },
    hideOverlays() {
      ['setup-wizard', 'cursor-fx', 'setup-overlay'].forEach((id) => {
        const e = document.getElementById(id);
        if (e) e.style.display = 'none';
      });
      return 'ok';
    }
  };
  return 'helpers';
})()`;

(async () => {
  const only = process.env.KAS_ONLY;
  const c = await connect();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 880, deviceScaleFactor: 1, mobile: false,
  });
  console.log('helpers:', await c.evaljs(HELPERS, false));
  console.log('overlays:', await c.evaljs('__ap.hideOverlays()', false));

  // Flush two animation frames so the compositor has a fresh, painted frame
  // before we grab the screenshot (prevents stale-background captures).
  async function flush() {
    await c.evaljs('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))', true);
  }
  // Poll until an expression is truthy (bounded), for async image/logo loads.
  async function waitFor(expr, ms = 2500, step = 80) {
    const t0 = Date.now();
    for (;;) {
      if (await c.evaljs(expr, false)) return true;
      if (Date.now() - t0 > ms) return false;
      await sleep(step);
    }
  }

  // --- content verification: did the preview actually render THIS wallpaper? ---
  // Crops the plain left strip of the NTP (background is top-left 1:1) and
  // finds the source wallpaper with lowest RMSE. If it isn't the expected slug,
  // the capture caught a stale/wrong frame → caller retries.
  const WP_MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'store-assets', 'wp', 'manifest.json')));
  const TMPV = '/tmp/opencode/_verify';
  fs.mkdirSync(TMPV, { recursive: true });
  function crop(src, w, h, x, y, out) {
    spawnSync('magick', [src, '-crop', `${w}x${h}+${x}+${y}`, '+repage', out]);
  }
  function rmse(a, b) {
    const r = spawnSync('magick', [a, b, '-metric', 'RMSE', '-compare', '-format', '%[distortion]', 'info:'], { encoding: 'utf8' });
    const txt = `${r.stdout || ''} ${r.stderr || ''}`;
    const m = txt.match(/([\d.]+(?:e[+-]?\d+)?)/i);
    return m ? Math.abs(parseFloat(m[1])) : 999;
  }
  function verifyWallpaper(slug) {
    const prev = path.join(OUT, 'wallpaper-' + slug + '.jpg');
    if (!fs.existsSync(prev)) return { ok: false, bestSlug: 'missing' };
    const pv = `${TMPV}/p_${slug}.png`;
    crop(prev, 260, 610, 0, 154, pv);      // preview absolute: NTP top 74 + 80
    let best = 999, bestSlug = null;
    for (const s of WP_MANIFEST) {
      const sp = `${TMPV}/s.png`;
      crop(path.join(__dirname, '..', 'site', 'store-assets', 'wp', s.file), 260, 610, 0, 80, sp);
      const d = rmse(pv, sp);
      if (d < best) { best = d; bestSlug = s.slug; }
    }
    return { ok: bestSlug === slug, bestSlug, best };
  }

  let items = Object.entries(PRODUCTS)
    .map(([id, p]) => ({ id, ...p }))
    .filter((p) => KINDS.includes(p.kind));
  if (process.env.KAS_KIND) items = items.filter((p) => p.kind === process.env.KAS_KIND);
  if (only) {
    const want = only.split(',').map((s) => s.trim());
    items = items.filter((p) => want.includes(p.id));
  }
  console.log('to capture:', items.length);

  let ok = 0, fail = 0;
  for (const it of items) {
    try {
      // Reset to a neutral dark base so every capture is independent.
      await c.evaljs(`__ap.theme(${JSON.stringify({ __id: '__base', __name: 'Base', ...BASE })}); __ap.clearWall();`, false);
      let applied = 'base';
      const file = path.join(OUT, it.id + '.jpg');
      if (it.kind === 'theme') {
        applied = await c.evaljs(`__ap.theme(${JSON.stringify({ __id: it.id, __name: it.name, ...it.data })}); __ap.clearWall();`, false);
        await sleep(180);
        await flush();
        await c.shot(file);
      } else if (it.kind === 'wallpaper') {
        // Wallpaper is an async image → verify content and retry on a stale/wrong frame.
        const slug = it.id.replace(/^wallpaper-/, '');
        const base = path.basename((it.data.css || '').split('"').filter(Boolean).pop() || '');
        let ver = { ok: false }, attempt = 0;
        do {
          if (attempt > 0) { await sleep(700); await c.evaljs('__ap.clearWall()', false); await sleep(150); }
          applied = await c.evaljs(`__ap.wallpaper(${JSON.stringify(it.data.css)});`, true);
          await waitFor(`getComputedStyle(document.getElementById('ntp')).backgroundImage.includes(${JSON.stringify(base)})`);
          await sleep(450);
          await flush();
          await c.shot(file);
          ver = verifyWallpaper(slug);
          attempt++;
        } while (!ver.ok && attempt < 6);
        if (!ver.ok) console.log(`\n  WALLPAPER VERIFY FAIL ${it.id}: shows ${ver.bestSlug} after ${attempt} tries`);
        else if (attempt > 1) process.stdout.write(` (fixed x${attempt})`);
      } else if (it.kind === 'accents') {
        const col = (it.data.accents || [])[0] || BASE.ac;
        applied = await c.evaljs(`__ap.accent(${JSON.stringify(col)});`, false);
        await sleep(180);
        await flush();
        await c.shot(file);
      } else if (it.kind === 'logos') {
        const url = (it.data.logos || [])[0];
        applied = await c.evaljs(`__ap.logo(${JSON.stringify(url)});`, false);
        const base = path.basename(url || '');
        await waitFor(`(()=>{const l=document.querySelector('.ntp-logo');return !!(l&&l.src&&l.src.includes(${JSON.stringify(base)}));})()`);
        await sleep(300);
        await flush();
        await c.shot(file);
      }
      const sz = fs.statSync(file).size;
      if (sz < 2000) throw new Error('tiny shot ' + sz + 'B (' + applied + ')');
      ok++;
      process.stdout.write(`\r${ok + fail}/${items.length} ok=${ok} fail=${fail}  last=${it.id}        `);
    } catch (e) {
      fail++;
      console.log(`\nFAIL ${it.id}: ${e.message}`);
    }
  }
  console.log(`\ndone: ok=${ok} fail=${fail} -> ${OUT}`);
  c.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
