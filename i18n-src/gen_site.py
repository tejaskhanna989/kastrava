#!/usr/bin/env python3
"""Generate data-wl markup for plain site pages + merged translation source.

Parses with html.parser (convert_charrefs=False) and splices wrappers into the
ORIGINAL string using getpos() offsets, so raw HTML outside splice points stays
byte-identical. Produces i18n-src/site.en.json (flat key -> English source) for
translators, covering page keys + existing index/store keys + cat_* labels.
"""
import json, re, subprocess, html as htmllib
from html.parser import HTMLParser

SRC = '/home/tejas/Projects/antersurf/site'
OUT = '/home/tejas/Projects/antersurf/i18n-src'

PAGES = {  # file -> key prefix
    'privacy': 'pri', 'terms': 'ter', 'refunds': 'ref',
    'contact': 'con', 'authors': 'aut',
}
SKIP_TAGS = {'script', 'style', 'noscript', 'textarea', 'code', 'pre', 'svg'}
ATTR_MAP = {'placeholder': 'data-wlp', 'alt': 'data-wla',
            'title': 'data-wti', 'aria-label': 'data-wal'}
LETTER = re.compile(r'[^\W\d_]', re.UNICODE)
WS = re.compile(r'\s+')
NOISE = re.compile(r'^([^\s@]+@[^\s@]+|https?://\S+)$')


def norm(s):
    return WS.sub(' ', htmllib.unescape(s)).strip()


class Gen(HTMLParser):
    def __init__(self, raw, prefix, extra):
        super().__init__(convert_charrefs=False)
        self.raw, self.prefix, self.extra = raw, prefix, extra
        self.splices = []          # (abs_start, abs_end, replacement)
        self.run = []              # contiguous text-event spans
        self.skip = {}             # tag -> depth
        self.keys = {}             # key -> source
        self.txtkey = {}           # normalized source -> key
        self.n = 0
        self._title_at = None
        self._title_text = ''

    def feed(self, data):
        self.line_off = [0]
        for i, ch in enumerate(data):
            if ch == '\n':
                self.line_off.append(i + 1)
        super().feed(data)

    def abspos(self):
        line, col = self.getpos()
        return self.line_off[line - 1] + col

    def _key_for(self, text, allow_reuse=True):
        t = norm(text)
        k = (self.extra.get(t) if allow_reuse else None) or self.txtkey.get(t)
        if k:
            return k
        self.n += 1
        k = '%s%d' % (self.prefix, self.n)
        self.txtkey[t] = k
        self.keys[k] = t
        return k

    def _flush(self):
        if not self.run:
            return
        s, e = self.run[0][0], self.run[-1][1]
        self.run = []
        raw = self.raw[s:e]
        text = norm(raw)
        if not text or not LETTER.search(text) or NOISE.match(text):
            return
        ws1 = raw[:len(raw) - len(raw.lstrip())]
        ws2 = raw[len(raw.rstrip()):]
        key = self.extra.get(text) or self.txtkey.get(text) or self._key_for(text, allow_reuse=False)
        if key not in self.keys and key not in self.extra.values():
            self.keys.setdefault(key, text)
        self.splices.append((s, e, '%s<span data-wl="%s">%s</span>%s' % (ws1, key, raw.strip(), ws2)))

    def _push(self, rawlen):
        p = self.abspos()
        self.run.append((p, p + rawlen))

    # ---- events --------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        self._flush()
        ad = dict(attrs)
        if ad.get('class', '').find('no-i18n') >= 0:
            self.skip[tag] = self.skip.get(tag, 0) + 1
            return
        if tag in SKIP_TAGS:
            self.skip[tag] = self.skip.get(tag, 0) + 1
            return
        if self.skip:
            return
        p, st = self.abspos(), self.get_starttag_text()
        if not st:
            return
        if tag == 'title':
            self.skip['title'] = self.skip.get('title', 0) + 1
            self._title_at = (p, p + len(st))
            return
        newst = st
        if tag == 'meta' and ad.get('name') == 'description' and ad.get('content') \
                and LETTER.search(ad['content']):
            key = self._key_for(ad['content'])
            newst = newst.replace('content="%s"' % ad['content'],
                                  'content="%s" data-wld="%s"' % (ad['content'], key), 1)
        for aname, aval in list(ad.items()):
            if aname not in ATTR_MAP or not aval or not LETTER.search(aval):
                continue
            key = self._key_for(aval)
            if ATTR_MAP[aname] in newst:
                continue
            m = re.search(r'\b%s="([^"]*)"' % re.escape(aname), newst)
            if not m:
                continue
            newst = newst[:m.end(1)] + '" %s="%s' % (ATTR_MAP[aname], key) + newst[m.end(1):]
        if newst != st:
            self.splices.append((p, p + len(st), newst))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        self._flush()
        if tag in self.skip:
            self.skip[tag] = max(0, self.skip[tag] - 1)
            if not self.skip[tag]:
                del self.skip[tag]
            if tag == 'title' and self._title_at:
                s, e = self._title_at
                self._title_at = None
                text = norm(self._title_text)
                self._title_text = ''
                if text and LETTER.search(text):
                    key = self._key_for(text)
                    self.splices.append((s, e, self.raw[s:e].replace(
                        '<title', '<title data-wl="%s"' % key, 1)))
                else:
                    self._title_text = ''
        if self.skip:
            return

    def handle_data(self, data):
        if self.skip.get('title'):
            self._title_text += data
            return
        if self.skip:
            return
        self._push(len(data))

    def handle_entityref(self, name):
        if self.skip:
            return
        self._push(len(name) + 2)

    def handle_charref(self, name):
        if self.skip:
            return
        self._push(len(name) + 3)


def load_inline_en():
    out = {}
    for page in ('index', 'store'):
        raw = open('%s/%s.html' % (SRC, page), encoding='utf-8').read()
        i = raw.find('WEBSTR={')
        if i < 0:
            continue
        stmt = raw[i:raw.find('\n', i)]
        js = stmt + '\nconsole.log(JSON.stringify(WEBSTR.en))'
        r = subprocess.run(['node', '-e', js], capture_output=True, text=True)
        if r.returncode == 0:
            out[page] = json.loads(r.stdout)
        else:
            print('node extract failed for', page, r.stderr[:300])
    return out


def main():
    inline = load_inline_en()
    extra = {}
    for keys in inline.values():
        for k, v in keys.items():
            if '<' in v:
                continue
            t = norm(v)
            if t and LETTER.search(t):
                extra.setdefault(t, k)

    allkeys, report = {}, {}
    for page, prefix in PAGES.items():
        path = '%s/%s.html' % (SRC, page)
        raw = open(path, encoding='utf-8').read()
        g = Gen(raw, prefix, extra)
        g.feed(raw)
        g.close()
        g._flush()
        out, seen = raw, set()
        for s, e, rep in sorted(g.splices, key=lambda x: -x[0]):
            if (s, e) in seen:
                print('WARN duplicate splice range %s %d-%d' % (page, s, e))
                continue
            seen.add((s, e))
            if out[s:e] != raw[s:e]:
                print('WARN overlap %s at %d (skipped)' % (page, s))
                continue
            out = out[:s] + rep + out[e:]
        open(path, 'w', encoding='utf-8').write(out)
        allkeys.update(g.keys)
        report[page] = len(g.keys)

    for keys in inline.values():
        for k, v in keys.items():
            allkeys.setdefault(k, norm(v))
    allkeys.setdefault('apkr_note', 'Russian edition — interface locked to Russian.')
    for cid, lbl in [('all', 'All'), ('theme', 'Themes'), ('accents', 'Accents'),
                     ('logos', 'Logos'), ('wallpaper', 'Wallpapers'), ('combo', 'Combos')]:
        allkeys.setdefault('cat_' + cid, lbl)

    json.dump(allkeys, open('%s/site.en.json' % OUT, 'w'), ensure_ascii=False,
              indent=1, sort_keys=True)
    print('wrapped per page:', report, '| total translator keys:', len(allkeys))


if __name__ == '__main__':
    main()
