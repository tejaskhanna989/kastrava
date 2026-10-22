#!/usr/bin/env python3
"""Batch-fill locales beyond the curated 20 — run from an unblocked network.

The curated set (en, hi, ru, ja, ko, zh, ar, de, fr, es, pt, tr, vi, id, th,
uk, it, pl, nl, bn) is translated by hand/model. This script generates the
rest of the ~105 supported locales mechanically, then a human spot-checks.

    python3 batchfill.py list                 # candidate locales not yet shipped
    python3 batchfill.py run fr-FQ ca          # fill specific codes now
    python3 batchfill.py all                   # every candidate missing on disk
    python3 batchfill.py check                 # validate everything already filled

Backends:
  gtx     Google Translate (unofficial, no key, default)   --backend gtx
  openai  OpenAI-compatible chat API   OPENAI_API_KEY + optional OPENAI_BASE_URL
          optional OPENAI_MODEL (default gpt-4o-mini)

Correctness strategy — placeholders, HTML tags and brand terms NEVER enter the
translator: each source string is split into protected tokens vs. free text,
only free text is translated, then the pieces are reassembled byte-exact.
That makes %1$s, <b>, Kastrava etc. survive any backend. Results are cached
in i18n-src/batch-cache.jsonl so reruns resume cheaply.

Emits, per locale, exactly what the curated agents produce:
  site/lang/<code>.js
  static/locales/<code>.json
  android/app/src/main/res/values-<dir>/strings.xml
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.expanduser('~/Projects/antersurf')
CACHE_PATH = os.path.join(ROOT, 'i18n-src', 'batch-cache.jsonl')

# ---------------------------------------------------------------- sources
def load_sources():
    site = json.load(open(os.path.join(ROOT, 'i18n-src', 'site.en.json')))
    desk = json.load(open(os.path.join(ROOT, 'i18n-src', 'desktop.en.json')))
    andr = json.load(open(os.path.join(ROOT, 'i18n-src', 'android.en.json')))
    return site, desk, andr

# ---------------------------------------------------------------- masking
# Protected: placeholders, HTML tags, URLs/emails, brand/technical terms.
PROTECTED = [
    r'%\d+\$[sd]', r'%s', r'%d',                      # Android placeholders
    r'</?[a-zA-Z][^>\s]*(?:\s[^>]*)?>',               # HTML tags (site values)
    r'&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);',  # XML/HTML entities
    r'https?://[^\s<>"\',;]+', r'[\w.+-]+@[\w.-]+\.\w+',
    r'KastravaSearch', r'Kastrava', r'GPLv3', r'GPL',
    r'Chromium', r'Electron', r'DevTools', r'Razorpay', r'PayPal',
    r'DuckDuckGo', r'Ecosia', r'GitHub', r'AppImage', r'APK',
    r'Linux', r'Windows', r'Android', r'\bPremium\b',
    r'v\d+\.\d+\.\d+', r'KAS-[A-Z0-9-]{4,}',
    r'₹[\d.,]+', r'\$[\d.,]+(?:/mo|/day)?',
]
PROT_RE = re.compile('|'.join('(?:%s)' % p for p in PROTECTED))
LETTER_RE = re.compile(r'[^\W\d_]', re.UNICODE)


def split_protected(text):
    """[(True, protected) | (False, free_text)] preserving order."""
    out, pos = [], 0
    for m in PROT_RE.finditer(text):
        if m.start() > pos:
            out.append((False, text[pos:m.start()]))
        out.append((True, m.group(0)))
        pos = m.end()
    if pos < len(text):
        out.append((False, text[pos:]))
    return out


def assemble(parts, translated):
    """Rebuild: protected parts verbatim; letter-bearing free parts consumed
    from `translated` (same order as collected by translate_strings);
    letterless free parts (pure punctuation/whitespace) stay untouched."""
    out, i = [], 0
    for prot, val in parts:
        if prot:
            out.append(val)
        elif LETTER_RE.search(val):
            out.append(translated[i] if i < len(translated) else val)
            i += 1
        else:
            out.append(val)
    return ''.join(out)

# ---------------------------------------------------------------- backends
class GtxBackend:
    """Unofficial Google Translate endpoint — no key, one string per call."""
    name = 'gtx'

    def _call(self, tl, text):
        url = ('https://translate.googleapis.com/translate_a/single'
               '?client=gtx&sl=en&tl=%s&dt=t&q=%s'
               % (urllib.parse.quote(tl), urllib.parse.quote(text)))
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode('utf-8'))
        return ''.join(seg[0] for seg in data[0] if seg and seg[0])

    def translate_batch(self, code, texts):
        out = []
        base = code.split('-')[0]
        tl = code                      # region codes first (zh-TW, pt-PT, es-419 …)
        for t in texts:
            last = None
            for attempt in range(5):
                try:
                    out.append(self._call(tl, t))
                    break
                except Exception as e:  # noqa: BLE001 — retry, then base lang
                    last = e
                    if tl != base and attempt == 1:
                        tl = base      # endpoint rejected the region tag
                    time.sleep(1.5 * (attempt + 1))
            else:
                raise RuntimeError('gtx failed for %r: %s' % (t, last))
            time.sleep(0.12)
        return out


class OpenAIBackend:
    """OpenAI-compatible chat backend — batched, needs OPENAI_API_KEY."""
    name = 'openai'

    def __init__(self):
        self.key = os.environ.get('OPENAI_API_KEY')
        if not self.key:
            sys.exit('OPENAI_API_KEY not set')
        self.base = os.environ.get('OPENAI_BASE_URL', 'https://api.openai.com/v1')
        self.model = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')

    def translate_batch(self, code, texts):
        out = []
        CH = 40  # strings per request
        for i in range(0, len(texts), CH):
            chunk = texts[i:i + CH]
            payload = {
                'model': self.model,
                'temperature': 0.2,
                'messages': [
                    {'role': 'system', 'content':
                        'You localize browser UI strings. Return ONLY a JSON '
                        'array, same length/order as input, every element the '
                        'translation of the corresponding string into the '
                        'target language. Keep placeholders, <tags>, brand '
                        'names and numbers exactly as given. No commentary.'},
                    {'role': 'user', 'content':
                        json.dumps({'target_language': code, 'strings': chunk},
                                   ensure_ascii=False)},
                ],
            }
            req = urllib.request.Request(
                self.base + '/chat/completions',
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json',
                         'Authorization': 'Bearer ' + self.key})
            last = None
            for attempt in range(5):
                try:
                    with urllib.request.urlopen(req, timeout=90) as r:
                        data = json.loads(r.read().decode('utf-8'))
                    content = data['choices'][0]['message']['content']
                    m = re.search(r'\[.*\]', content, re.S)
                    arr = json.loads(m.group(0))
                    if len(arr) != len(chunk):
                        raise ValueError('length mismatch')
                    out.extend(str(x) for x in arr)
                    break
                except Exception as e:  # noqa: BLE001
                    last = e
                    time.sleep(2.0 * (attempt + 1))
            else:
                raise RuntimeError('openai batch failed: %s' % last)
            time.sleep(0.3)
        return out

# ---------------------------------------------------------------- cache
class Cache:
    def __init__(self):
        self.data = {}
        if os.path.exists(CACHE_PATH):
            with open(CACHE_PATH, encoding='utf-8') as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                        self.data[rec['k']] = rec['v']
                    except Exception:  # noqa: BLE001
                        continue
        self.fh = open(CACHE_PATH, 'a', encoding='utf-8')

    @staticmethod
    def key(code, text):
        return hashlib.sha1((code + '\x00' + text).encode('utf-8')).hexdigest()

    def get_many(self, code, texts):
        """(needed_texts, cached_map)"""
        need, have = [], {}
        for t in texts:
            k = self.key(code, t)
            if k in self.data:
                have[t] = self.data[k]
            else:
                need.append(t)
        return need, have

    def put(self, code, text, value):
        k = self.key(code, text)
        self.data[k] = value
        self.fh.write(json.dumps({'k': k, 'v': value}, ensure_ascii=False) + '\n')
        self.fh.flush()

# ---------------------------------------------------------------- core
def translate_strings(backend, cache, code, strings):
    """strings: list of EN source strings -> dict en->translated.

    Splits every string into protected/free parts, batch-translates all unique
    free segments (cached), reassembles."""
    seg_owner = {}          # free segment -> [source strings needing it]
    parts_map = {}          # source string -> parts
    for s in strings:
        parts = split_protected(s)
        parts_map[s] = parts
        for prot, val in parts:
            if not prot and LETTER_RE.search(val):
                seg_owner.setdefault(val, []).append(s)

    need, have = cache.get_many(code, list(seg_owner.keys()))
    translated_segs = dict(have)
    if need:
        got = backend.translate_batch(code, need)
        for seg, val in zip(need, got):
            cache.put(code, seg, val)
            translated_segs[seg] = val

    result = {}
    for s, parts in parts_map.items():
        free = [v for prot, v in parts
                if not prot and LETTER_RE.search(v)]
        translated = [translated_segs.get(v, v) for v in free]
        result[s] = assemble(parts, translated)
    return result


FORMAT_TAGS = {'b', 'i', 'em', 'br', 'a', 'span', 'u', 'strong', 'code',
               'small', 'sup', 'sub'}


def escape_pseudo(value):
    """Source text can carry literal tokens like <version> (from &lt; in the
    page). Applied via innerHTML, a raw <version> renders as an invisible
    unknown element — re-escape every tag that isn't real formatting."""
    def repl(m):
        name = re.match(r'</?([a-zA-Z][a-zA-Z0-9]*)', m.group(0)).group(1).lower()
        if name in FORMAT_TAGS:
            return m.group(0)
        return m.group(0).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return re.sub(r'</?[a-zA-Z][^>]*>', repl, value)


def emit_site(code, t):
    keys = sorted(t.keys())
    body = 'var WEBSTR_X={' + ','.join(
        '%s:%s' % (json.dumps(k), json.dumps(escape_pseudo(t[k]), ensure_ascii=False))
        for k in keys) + '};'
    path = os.path.join(ROOT, 'site', 'lang', code + '.js')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body + '\n')
    return path


def emit_desktop(code, t):
    path = os.path.join(ROOT, 'static', 'locales', code + '.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(t, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    return path


def android_dir(code):
    """pt-BG -> pt-rBG style resource qualifier."""
    if '-' in code:
        base, reg = code.split('-', 1)
        return '%s-r%s' % (base, reg.upper() if len(reg) == 2 else reg)
    return code


def xml_escape(s):
    """Escape bare &, <, > for Android string text while leaving existing
    entities (&amp;, &#39; …) intact — MT never sees them (they're masked)."""
    s = re.sub(r'&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)', '&amp;', s)
    return s.replace('<', '&lt;').replace('>', '&gt;')


def emit_android(code, src, t):
    """Full strings.xml in source order; `t` maps string NAME -> translated
    inner XML (placeholders were masked around MT, so they arrive verbatim)."""
    lines = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>']
    for name, v in src.items():
        text = xml_escape(t.get(name, v['xml']))
        fmt = ' formatted="%s"' % v['formatted'] if v.get('formatted') else ''
        lines.append('    <string name="%s"%s>%s</string>' % (name, fmt, text))
    lines.append('</resources>')
    path = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res',
                        'values-' + android_dir(code), 'strings.xml')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    return path


def validate_locale(code):
    """Return list of problems (empty = green) for one filled locale."""
    errs = []
    site, desk, andr = load_sources()
    p = os.path.join(ROOT, 'site', 'lang', code + '.js')
    if os.path.exists(p):
        js = open(p, encoding='utf-8').read()
        m = re.match(r'var WEBSTR_X=(\{.*\});?\s*$', js, re.S)
        try:
            d = json.loads(m.group(1))
            miss = [k for k in site if k not in d]
            if miss:
                errs.append('site: %d missing e.g. %s' % (len(miss), miss[:5]))
        except Exception as e:  # noqa: BLE001
            errs.append('site: parse: %s' % e)
    else:
        errs.append('site: file missing')

    p = os.path.join(ROOT, 'static', 'locales', code + '.json')
    if os.path.exists(p):
        try:
            d = json.load(open(p))
            miss = [k for k in desk if k not in d]
            if miss:
                errs.append('desktop: missing %s' % miss[:5])
        except Exception as e:  # noqa: BLE001
            errs.append('desktop: parse: %s' % e)
    else:
        errs.append('desktop: file missing')

    p = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res',
                     'values-' + android_dir(code), 'strings.xml')
    if os.path.exists(p):
        try:
            root = ET.parse(p).getroot()
            got = {e.get('name'): ''.join(e.itertext())
                   for e in root.findall('string')}
            miss = [k for k in andr if k not in got]
            if miss:
                errs.append('android: missing %s' % miss[:5])
            ph = lambda x: sorted(re.findall(r'%\d+\$[sd]|%s|%d', x))  # noqa: E731
            bad = [k for k in andr if k in got and ph(andr[k]['xml']) != ph(got[k])]
            if bad:
                errs.append('android: placeholders %s' % bad[:5])
        except Exception as e:  # noqa: BLE001
            errs.append('android: parse: %s' % e)
    else:
        errs.append('android: file missing')
    return errs

# ---------------------------------------------------------------- locales
# Candidates beyond the curated 20. Region-tagged codes map to Android
# values-<base>-r<REG> dirs automatically (android_dir()).
CANDIDATES = [
    'af', 'am', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'da', 'de',
    'el', 'en-GB', 'es-419', 'et', 'eu', 'fa', 'fi', 'fil', 'fr-CA', 'ga',
    'gl', 'gu', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'is', 'it', 'ja',
    'jv', 'ka', 'kk', 'km', 'kn', 'ky', 'lo', 'lt', 'lv', 'mk', 'ml',
    'mn', 'mr', 'ms', 'my', 'ne', 'nl', 'no', 'nb', 'nn', 'or', 'pa',
    'pl', 'ps', 'pt-PT', 'ro', 'ru', 'si', 'sk', 'sl', 'sq', 'sr', 'sv',
    'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl', 'tr', 'uk', 'ur', 'uz',
    'vi', 'zh', 'zh-TW', 'zu',
]
SHIPPED = {'en', 'hi', 'ru', 'ja', 'ko', 'zh', 'ar', 'de', 'fr', 'es',
           'pt', 'tr', 'vi', 'id', 'th', 'uk', 'it', 'pl', 'nl', 'bn'}

# Checklist printed after a fill run — the app runtimes must be extended by
# hand (one line each) before users can pick the new language.
CHECKLIST = """
After filling locales, wire them up (one line each):
  src/browser.html   LANG_LIST        add ["<code>","<native name>"]
  site/wl.js         WL_LANGS         add ['<code>','<native name>']
  site/wl.js         WL_C2L           add country codes that should auto-map
  android .../LocaleHelper.kt   LANGS add "<code>" to "<native name>"
  android .../res/xml/locale_config.xml  <locale android:name="<code>"/>
  (optional) Chrome/Firefox follow-up lists: update AGENT.md validation counts
Then: npm run build:dev && python3 i18n-src/validate.py && deploy site/lang/.
"""


def get_backend(name):
    return GtxBackend() if name == 'gtx' else OpenAIBackend()


def do_run(backend_name, codes):
    site, desk, andr = load_sources()
    backend = get_backend(backend_name)
    cache = Cache()
    print('backend=%s  locales=%d  cache=%d entries'
          % (backend.name, len(codes), len(cache.data)))
    for code in codes:
        t0 = time.time()
        # 1. website (flat strings)
        site_t = translate_strings(backend, cache, code, list(site.values()))
        site_by_key = {k: site_t[v] for k, v in site.items()}
        p1 = emit_site(code, site_by_key)
        # 2. desktop
        desk_t = translate_strings(backend, cache, code, list(desk.values()))
        desk_by_key = {k: desk_t[v] for k, v in desk.items()}
        p2 = emit_desktop(code, desk_by_key)
        # 3. android (inner XML; placeholders masked before MT, restored after)
        and_xml = [v['xml'] for v in andr.values()]
        and_t = translate_strings(backend, cache, code, and_xml)
        and_by_name = {k: and_t[v['xml']] for k, v in andr.items()}
        p3 = emit_android(code, andr, and_by_name)
        errs = validate_locale(code)
        status = 'OK' if not errs else ('ISSUES: ' + '; '.join(errs))
        print('  %-8s %.1fs  %s' % (code, time.time() - t0, status))
    print(CHECKLIST)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('action', choices=['list', 'run', 'all', 'check'])
    ap.add_argument('codes', nargs='*')
    ap.add_argument('--backend', default='gtx', choices=['gtx', 'openai'])
    args = ap.parse_args()

    if args.action == 'list':
        for c in CANDIDATES:
            if c in SHIPPED:
                continue
            p = os.path.join(ROOT, 'site', 'lang', c + '.js')
            print('%-8s %s' % (c, 'filled' if os.path.exists(p) else ''))
        return

    if args.action == 'check':
        bad = 0
        for c in CANDIDATES:
            if c in SHIPPED:
                continue
            p = os.path.join(ROOT, 'site', 'lang', c + '.js')
            if not os.path.exists(p):
                continue
            errs = validate_locale(c)
            if errs:
                bad += 1
                print('%-8s %s' % (c, '; '.join(errs)))
            else:
                print('%-8s OK' % c)
        print('%d locales with issues' % bad)
        return

    if args.action == 'run':
        if not args.codes:
            sys.exit('run needs at least one code (see: list)')
        do_run(args.backend, args.codes)
    else:  # all
        codes = [c for c in CANDIDATES
                 if c not in SHIPPED
                 and not os.path.exists(os.path.join(ROOT, 'site', 'lang', c + '.js'))]
        if not codes:
            print('nothing to do — every candidate is filled')
            return
        do_run(args.backend, codes)


if __name__ == '__main__':
    main()
