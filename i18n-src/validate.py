#!/usr/bin/env python3
"""Validate every i18n artifact across site / desktop / Android.

Run after translation agents finish. Exit 0 = green.
"""
import json, os, re, subprocess, sys, glob
import xml.etree.ElementTree as ET

ROOT = '/home/tejas/Projects/antersurf'
SITE_LANGS = ['hi', 'ru', 'ja', 'ko', 'zh', 'ar', 'de', 'fr', 'es', 'pt',
              'tr', 'id', 'th', 'uk', 'it', 'pl', 'nl', 'bn']
DESKTOP_LANGS = [c for c in SITE_LANGS if c != 'ru']   # ru is inline in STR
ANDROID_DIRS = {c: c for c in SITE_LANGS if c != 'ru'}  # values-<dir>

SITE_PAGES = ['index', 'store', 'privacy', 'terms', 'refunds', 'contact', 'authors']

TAG_RE = re.compile(r'</?([a-zA-Z][a-zA-Z0-9]*)')
PH_RE = re.compile(r'%\d+\$[sd]|%s|%d')
# Tags that are real inline formatting (safe inside innerHTML). Anything
# else in a value is *literal text* that was &lt;-escaped in the page
# (e.g. pri47 "Kastrava/<version>") — translations must keep it escaped,
# because a raw <version> would render as an invisible unknown element.
KNOWN_TAGS = {'b', 'i', 'em', 'br', 'a', 'span', 'u', 'strong', 'code',
              'small', 'sup', 'sub'}
RAW_UNKNOWN_RE = re.compile(r'</?([a-zA-Z][a-zA-Z0-9]*)')


def tags_of(s):
    return sorted(t.lower() for t in TAG_RE.findall(s) if t.lower() in KNOWN_TAGS)


def pseudo_raw(s):
    return sorted({t.lower() for t in RAW_UNKNOWN_RE.findall(s)
                   if t.lower() not in KNOWN_TAGS})


def ph_of(s):
    return sorted(PH_RE.findall(s))


def node_keys(path, expr):
    # eval() the file in the -e scope: `var WEBSTR_X=...` would be
    # module-scoped under require() and invisible to expr.
    r = subprocess.run(['node', '-e',
                        'try{eval(require("fs").readFileSync(%r,"utf8"));console.log(JSON.stringify(%s))}catch(e){console.error(e.message);process.exit(1)}'
                        % (path, expr)],
                       capture_output=True, text=True)
    if r.returncode:
        return None, r.stderr.strip()[:200]
    return json.loads(r.stdout), None


def main():
    errs, warns = [], []
    site_src = json.load(open(ROOT + '/i18n-src/site.en.json'))
    desk_src = json.load(open(ROOT + '/i18n-src/desktop.en.json'))
    and_src = json.load(open(ROOT + '/i18n-src/android.en.json'))

    # --- site dict files -------------------------------------------------
    for code in SITE_LANGS:
        p = '%s/site/lang/%s.js' % (ROOT, code)
        if not os.path.exists(p):
            errs.append('site %s: MISSING file %s' % (code, p))
            continue
        d, err = node_keys(p, 'WEBSTR_X')
        if err:
            errs.append('site %s: parse error: %s' % (code, err))
            continue
        miss = [k for k in site_src if k not in d]
        extra = [k for k in d if k not in site_src]
        if miss:
            errs.append('site %s: %d missing keys: %s%s' % (code, len(miss), miss[:8], '…' if len(miss) > 8 else ''))
        if extra:
            warns.append('site %s: extra keys: %s' % (code, extra[:5]))
        empty = [k for k in site_src if k in d and not str(d[k]).strip()]
        if empty:
            errs.append('site %s: empty values: %s' % (code, empty[:5]))
        html_keys = [k for k in site_src if '<' in site_src[k]]
        bad = [k for k in html_keys if k in d and tags_of(site_src[k]) != tags_of(str(d[k]))]
        if bad:
            errs.append('site %s: HTML tag mismatch: %s' % (code, bad[:5]))
        raw_pseudo = [(k, pseudo_raw(str(d[k]))) for k in site_src
                      if k in d and pseudo_raw(str(d[k]))]
        if raw_pseudo:
            errs.append('site %s: unescaped literal <tag> in values (renders '
                        'invisible): %s' % (code, raw_pseudo[:5]))

    # --- desktop dict files ---------------------------------------------
    for code in DESKTOP_LANGS:
        p = '%s/static/locales/%s.json' % (ROOT, code)
        if not os.path.exists(p):
            errs.append('desktop %s: MISSING %s' % (code, p))
            continue
        try:
            d = json.load(open(p))
        except Exception as e:
            errs.append('desktop %s: bad JSON: %s' % (code, e))
            continue
        miss = [k for k in desk_src if k not in d]
        if miss:
            errs.append('desktop %s: missing keys: %s' % (code, miss[:8]))
        empty = [k for k in desk_src if k in d and not str(d[k]).strip()]
        if empty:
            errs.append('desktop %s: empty: %s' % (code, empty[:5]))

    # --- android resources ----------------------------------------------
    for code, dirn in ANDROID_DIRS.items():
        p = '%s/android/app/src/main/res/values-%s/strings.xml' % (ROOT, dirn)
        if not os.path.exists(p):
            errs.append('android %s: MISSING %s' % (code, p))
            continue
        try:
            root = ET.parse(p).getroot()
        except Exception as e:
            errs.append('android %s: XML parse: %s' % (code, e))
            continue
        got = {}
        dup = []
        for e in root.findall('string'):
            n = e.get('name')
            if n in got:
                dup.append(n)
            got[n] = ''.join(e.itertext())
        if dup:
            errs.append('android %s: duplicate names: %s' % (code, dup[:5]))
        miss = [k for k in and_src if k not in got]
        if miss:
            errs.append('android %s: missing strings: %s%s' % (code, miss[:8], '…' if len(miss) > 8 else ''))
        bad_ph = []
        for k, v in and_src.items():
            if k in got and ph_of(v['xml']) != ph_of(got[k]):
                bad_ph.append(k)
        if bad_ph:
            errs.append('android %s: placeholder mismatch: %s' % (code, bad_ph[:8]))

    # --- runtime wiring sanity -------------------------------------------
    for page in SITE_PAGES:
        raw = open('%s/site/%s.html' % (ROOT, page)).read()
        if '/wl.js' not in raw:
            errs.append('page %s: wl.js include missing' % page)
        # every used key must exist in the translator source
        used = re.findall(r'data-wl(?:p|a|ti|al|d)?="([^"]+)"', raw)
        unknown = sorted({k for k in used if k not in site_src})
        if unknown:
            errs.append('page %s: keys not in site.en.json: %s' % (page, unknown[:8]))
    if not os.path.exists(ROOT + '/site/wl.js'):
        errs.append('site/wl.js missing')

    raw = open(ROOT + '/src/browser.html').read()
    for code, _ in [('en', 0)] + [(c, 0) for c in DESKTOP_LANGS]:
        if code == 'en':
            continue
        if '"%s"' % code not in raw and "'%s'" % code not in raw:
            warns.append('browser.html LANG_LIST may lack %s' % code)

    lc = open(ROOT + '/android/app/src/main/res/xml/locale_config.xml').read()
    for code in SITE_LANGS:
        if 'android:name="%s"' % code not in lc:
            errs.append('locale_config.xml missing %s' % code)

    for w in warns:
        print('WARN ', w)
    for e in errs:
        print('ERROR', e)
    print('---')
    print('%d errors, %d warnings' % (len(errs), len(warns)))
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
