#!/usr/bin/env python3
"""Kastrava Store catalog generator: 700 data-only products.
Kinds: theme, accents, logos, wallpaper, cursor, combo.
  free tier (5): claimable by any login.
  pro tier (10): Premium members claim free, others pay once.
  premium tier: Premium members claim free, others pay once
    (INR Rs150-300 via Razorpay, USD $5-10 via PayPal).
Run:  python3 scripts/make-store-catalog.py   (writes server/lib/products.js)
"""
import colorsys
import hashlib
import json


def hx(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h / 360.0, l / 100.0, s / 100.0)
    return '#%02x%02x%02x' % (round(r * 255), round(g * 255), round(b * 255))


def dark_theme(hue, sat, accent_hue):
    bg = hx(hue, sat, 5)
    return dict(mode='dark', bg=bg, tbg=hx(hue, sat + 5, 9),
                tb=hx(hue, sat + 5, 13), om=bg, ac=hx(accent_hue, 85, 62))


def light_theme(hue, sat, accent_hue):
    bg = hx(hue, sat, 94)
    return dict(mode='light', bg=bg, tbg=hx(hue, sat, 97),
                tb='#ffffff', om=bg, ac=hx(accent_hue, 75, 42))


ADJ = ['Ember', 'Glacier', 'Onyx', 'Solar', 'Abyssal', 'Crimson', 'Verdant', 'Cobalt', 'Amber', 'Violet',
       'Silent', 'Neon', 'Golden', 'Frozen', 'Copper', 'Jade', 'Storm', 'Velvet', 'Cinder', 'Tidal',
       'Lunar', 'Mellow', 'Electric', 'Rustic', 'Polar', 'Dusky', 'Radiant', 'Hollow', 'Primal', 'Sable',
       'Ivory', 'Obsidian', 'Pewter', 'Saffron', 'Indigo', 'Magenta', 'Cyan', 'Ochre', 'Umber', 'Viridian',
       'Hazy', 'Brisk', 'Misty', 'Gilded', 'Shadow', 'Bright', 'Murky', 'Serene', 'Wild', 'Astral']
NOUN = ['Dusk', 'Drift', 'Forge', 'Mist', 'Bloom', 'Tide', 'Peak', 'Hollow', 'Grove', 'Circuit',
        'Harbor', 'Mesa', 'Aurora', 'Cavern', 'Meadow', 'Reef', 'Summit', 'Glade', 'Nightfall', 'Daybreak',
        'Frostline', 'Emberfall', 'Cloudbreak', 'Stonefield', 'Brook', 'Cinder', 'Thicket', 'Marsh', 'Canyon', 'Lagoon',
        'Prairie', 'Tundra', 'Volcano', 'Waterfall', 'Zephyr', 'Oasis', 'Dune', 'Fjord', 'Geyser', 'Atoll',
        'Bayou', 'Butte', 'Cove', 'Delta', 'Estuary', 'Fen', 'Glen', 'Heath', 'Inlet', 'Jungle']

LOGO_FILES = ['ember', 'ocean', 'forest', 'grape', 'amber', 'teal', 'rose', 'slate']
LOGO_URL = 'https://store.kastrava.pp.ua/assets/logo-%s.png'

products = []
seen = set()


def add(pid, name, kind, price_paise, price_usd, blurb, preview, data, pro_free=False):
    assert pid not in seen and name not in seen, (pid, name)
    seen.add(pid)
    seen.add(name)
    products.append(dict(id=pid, name=name, kind=kind, price_paise=price_paise,
                           price_usd=price_usd,
                          blurb=blurb, preview=preview, data=data, pro_free=pro_free))


def seednum(s):
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)


# --- free tier (5): 3 hand originals + 2 generated ---
add('theme-midnight-bloom', 'Midnight Bloom', 'theme', 0, 0, 'Deep violet night with a lavender accent.',
    {'bg': '#0d0a1a', 'ac': '#b388ff'},
    {'mode': 'dark', 'bg': '#0d0a1a', 'tbg': '#16122b', 'tb': '#1e1840', 'om': '#0d0a1a', 'ac': '#b388ff'})
add('theme-arctic-mist', 'Arctic Mist', 'theme', 0, 0, 'Pale frost light theme, easy on the eyes.',
    {'bg': '#eef3f6', 'ac': '#0288d1'},
    {'mode': 'light', 'bg': '#eef3f6', 'tbg': '#f7fafc', 'tb': '#ffffff', 'om': '#eef3f6', 'ac': '#0288d1'})
add('accent-neon-pack', 'Neon Accents', 'accents', 0, 0, 'Six loud accent colors for any theme.',
    {'bg': '#101010', 'ac': '#ff2d95'},
    {'accents': ['#ff2d95', '#00e5ff', '#b6ff2e', '#ffab00', '#7c4dff', '#ff5252']})

name_pool = [a + ' ' + b for a in ADJ for b in NOUN]
ni = 0
while len([p for p in products if p['price_paise'] == 0]) < 5:
    name = name_pool[ni]
    ni += 1
    if name in seen:
        continue
    h = seednum(name)
    dark = (h % 2) == 0
    hue = h % 360
    data = dark_theme(hue, 22, (hue + 150) % 360) if dark else light_theme(hue, 18, (hue + 210) % 360)
    add('theme-' + name.lower().replace(' ', '-'), name, 'theme', 0, 0,
        'Community %s theme.' % ('dark' if dark else 'light'),
        {'bg': data['bg'], 'ac': data['ac']}, data)

# --- logo packs ---
add('logos-warm-pack', 'Warm Logo Pack', 'logos', 19900, 6,
    'Ember, amber, rose and grape app badges.',
    {'bg': '#7a1f1f', 'ac': '#ffffff'},
    {'logos': [LOGO_URL % x for x in ['ember', 'amber', 'rose', 'grape']]})
add('logos-cool-pack', 'Cool Logo Pack', 'logos', 19900, 6,
    'Ocean, teal, forest and slate app badges.',
    {'bg': '#123a6d', 'ac': '#ffffff'},
    {'logos': [LOGO_URL % x for x in ['ocean', 'teal', 'forest', 'slate']]})
add('logos-full-set', 'Full Logo Set', 'logos', 29900, 10,
    'All eight app badges in one pack.',
    {'bg': '#101010', 'ac': '#b388ff'},
    {'logos': [LOGO_URL % x for x in LOGO_FILES]})

INR_TIERS = [15000, 19900, 24900, 29900]
USD_TIERS = [5, 6, 8, 10]
idx = 0
for name in name_pool:
    if len(products) >= 696 or name in seen:
        continue
    h = seednum('p' + name)
    slot = idx
    idx += 1
    if slot % 14 == 13:
        base = h % 360
        accents = [hx((base + j * 32) % 360, 85, 60) for j in range(6)]
        aname = name + ' Accents'
        if aname in seen:
            continue
        add('accents-' + aname.lower().replace(' ', '-'), aname, 'accents', INR_TIERS[slot % 4], USD_TIERS[slot % 4],
            'Six harmonious accents.', {'bg': '#101010', 'ac': accents[0]}, {'accents': accents})
    elif slot % 14 == 12:
        c1, c2 = hx(h % 360, 60, 12), hx((h + 60) % 360, 65, 30)
        wname = name + ' Wallpaper'
        if wname in seen:
            continue
        css = 'linear-gradient(135deg, %s, %s)' % (c1, c2)
        add('wallpaper-' + wname.lower().replace(' ', '-'), wname, 'wallpaper', INR_TIERS[slot % 4], USD_TIERS[slot % 4],
            'Gradient new-tab backdrop.', {'bg': c1, 'ac': c2}, {'css': css})
    elif slot % 14 == 11:
        cc = hx(h % 360, 90, 60)
        cname = name + ' Cursor'
        if cname in seen:
            continue
        svg = ("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>"
               "<circle cx='12' cy='12' r='7' fill='%s'/></svg>" % cc).replace('#', '%23')
        add('cursor-' + cname.lower().replace(' ', '-'), cname, 'cursor', INR_TIERS[slot % 4], USD_TIERS[slot % 4],
            'Color-dot pointer set.', {'bg': '#101010', 'ac': cc},
            {'cursors': {'default': svg, 'pointer': svg}})
    else:
        dark = (h % 3) != 2
        hue = h % 360
        sat = 16 + (h % 5) * 4
        data = dark_theme(hue, sat, (hue + 140 + h) % 360) if dark else light_theme(hue, sat, (hue + 200 + h) % 360)
        add('theme-' + name.lower().replace(' ', '-'), name, 'theme', INR_TIERS[slot % 4], USD_TIERS[slot % 4],
            'Hand-tuned %s theme.' % ('dark' if dark else 'light'),
            {'bg': data['bg'], 'ac': data['ac']}, data)

# --- combo packs (bundle ids that exist by now) ---
theme_ids = [p['id'] for p in products if p['kind'] == 'theme' and p['price_paise'] != 0][:40]
combos = [('combo-night-shift', 'Night Shift Bundle', 'Ten dark themes, one price.', 49900, 15, theme_ids[0:10]),
          ('combo-daybreak', 'Daybreak Bundle', 'Ten light themes, one price.', 49900, 15,
           [p['id'] for p in products if p['kind'] == 'theme' and p['data'].get('mode') == 'light' and p['price_paise'] != 0][:10]),
          ('combo-full-spectrum', 'Full Spectrum', 'Twenty themes across every hue.', 99900, 25, theme_ids[10:30]),
          ('combo-creator', 'Creator Combo', 'Themes, accents and wallpapers for setup lovers.', 29900, 10,
           [p['id'] for p in products if p['kind'] == 'accents' and p['price_paise'] != 0][:3] +
           [p['id'] for p in products if p['kind'] == 'wallpaper'][:3] +
           theme_ids[30:36])]
for pid, name, blurb, price_inr, price_usd, members in combos:
    members = [m for m in members if m in seen]
    if len(members) < 3:
        continue
    first = next(p for p in products if p['id'] == members[0])
    add(pid, name, 'combo', price_inr, price_usd, blurb,
        {'bg': first['preview']['bg'], 'ac': first['preview']['ac']},
        {'items': members})

assert len(products) >= 700, len(products)
pro_marked = 0
for p in products:
    if pro_marked >= 10:
        break
    if p['kind'] == 'theme' and p['price_paise'] != 0 and not p['pro_free']:
        p['pro_free'] = True
        pro_marked += 1
add('catalogue-pass', 'Full Catalogue Pass', 'pass', 899900, 999,
    'Every store item, 30 days. Manual renewal.',
    {'bg': '#16130e', 'ac': '#ffb300'}, {'days': 30})
# --- exact-look preview images (faithful Kastrava UI mockups) ---
PREVIEW_URL = 'https://store.kastrava.pp.ua/assets/preview-%s.svg'


def _esc(t):
    return str(t).replace('&', '&amp;').replace('<', '&lt;')


def svg_wrap(inner):
    return ("<svg xmlns='http://www.w3.org/2000/svg' width='420' height='260' viewBox='0 0 420 260'>" +
            inner + '</svg>')


def svg_theme(d):
    bg, tbg, tb, ac = d['bg'], d['tbg'], d['tb'], d['ac']
    fg = '#14110b' if d.get('mode') == 'light' else '#f3eee4'
    dim = '#8a8474' if d.get('mode') == 'light' else '#9d9484'
    return svg_wrap(
        "<rect width='420' height='260' fill='%s'/>" % bg +
        "<rect width='420' height='34' fill='%s'/>" % tbg +
        "<circle cx='16' cy='17' r='5' fill='#ff5f57'/><circle cx='32' cy='17' r='5' fill='#febc2e'/><circle cx='48' cy='17' r='5' fill='#28c840'/>" +
        "<rect x='70' y='8' width='130' height='26' rx='8' fill='%s'/>" % tb +
        "<rect x='206' y='8' width='90' height='26' rx='8' fill='%s' opacity='.55'/>" % tbg +
        "<rect width='420' height='40' y='34' fill='%s'/>" % tb +
        "<circle cx='22' cy='54' r='7' fill='none' stroke='%s' stroke-width='2'/>" % dim +
        "<circle cx='44' cy='54' r='7' fill='none' stroke='%s' stroke-width='2'/>" % dim +
        "<rect x='64' y='44' width='250' height='20' rx='10' fill='%s'/>" % bg +
        "<circle cx='330' cy='54' r='9' fill='%s'/>" % ac +
        "<circle cx='210' cy='130' r='30' fill='none' stroke='%s' stroke-width='5'/>" % ac +
        "<text x='210' y='190' text-anchor='middle' font-family='monospace' font-size='26' fill='%s'>09:41</text>" % fg +
        ''.join("<rect x='%d' y='206' width='52' height='40' rx='9' fill='%s'/><circle cx='%d' cy='220' r='7' fill='%s'/>" % (96 + i * 60, tbg, 122 + i * 60, ac if i == 0 else dim)
                 for i in range(4)))


def svg_accents(accents):
    dots = ''.join("<circle cx='%d' cy='110' r='26' fill='%s'/>" % (48 + i * 64, c) for i, c in enumerate(accents[:6]))
    bars = ''.join("<rect x='%d' y='170' width='52' height='10' rx='5' fill='%s'/>" % (22 + i * 64, c) for i, c in enumerate(accents[:6]))
    return svg_wrap(
        "<rect width='420' height='260' fill='#141414'/>" +
        "<rect width='420' height='40' fill='#1e1e1e'/>" +
        "<rect x='16' y='12' width='220' height='16' rx='8' fill='#2c2c2c'/>" +
        "<circle cx='388' cy='20' r='10' fill='%s'/>" % accents[0] + dots + bars +
        "<text x='210' y='238' text-anchor='middle' font-family='monospace' font-size='15' fill='#9a98b3'>6 accents - one for every mood</text>")


def svg_logos(logos):
    imgs = ''.join("<image href='%s' x='%d' y='80' width='80' height='80'/>" % (u, 30 + i * 95) for i, u in enumerate(logos[:4]))
    return svg_wrap(
        "<rect width='420' height='260' fill='#0d0d0d'/>" +
        "<text x='210' y='48' text-anchor='middle' font-family='monospace' font-size='17' fill='#f4f2ff'>Kastrava logo pack</text>" +
        imgs)


def svg_wallpaper(css):
    import re
    cols = re.findall(r'#[0-9a-fA-F]{6}', css)
    c1 = cols[0] if len(cols) > 0 else '#222'
    c2 = cols[1] if len(cols) > 1 else c1
    return svg_wrap(
        "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
        "<stop offset='0' stop-color='%s'/><stop offset='1' stop-color='%s'/>" % (c1, c2) +
        '</linearGradient></defs>' +
        "<rect width='420' height='260' fill='url(#g)'/>" +
        "<rect width='420' height='34' fill='rgba(0,0,0,.35)'/>" +
        "<rect x='70' y='8' width='130' height='26' rx='8' fill='rgba(255,255,255,.25)'/>" +
        "<rect width='420' height='40' y='34' fill='rgba(0,0,0,.3)'/>" +
        "<rect x='64' y='44' width='250' height='20' rx='10' fill='rgba(255,255,255,.3)'/>" +
        "<circle cx='210' cy='160' r='28' fill='none' stroke='rgba(255,255,255,.85)' stroke-width='5'/>")


def svg_cursor(ac):
    return svg_wrap(
        "<rect width='420' height='260' fill='#141414'/>" +
        "<rect width='420' height='40' fill='#1e1e1e'/>" +
        "<rect x='16' y='12' width='220' height='16' rx='8' fill='#2c2c2c'/>" +
        "<circle cx='150' cy='150' r='34' fill='%s' opacity='.28'/>" % ac +
        "<circle cx='150' cy='150' r='16' fill='%s'/>" % ac +
        "<path d='M250 120 L250 170 L262 158 L270 176 L278 172 L270 154 L282 154 Z' fill='%s'/>" % ac +
        "<text x='210' y='232' text-anchor='middle' font-family='monospace' font-size='15' fill='#9a98b3'>pointer + dot, matched set</text>")


def svg_combo(bg, ac, n):
    cards = ''.join("<rect x='%d' y='%d' width='150' height='110' rx='12' fill='%s' stroke='%s' stroke-width='2'/>" % (80 + i * 55, 70 + i * 22, bg, ac) for i in range(3))
    return svg_wrap(
        "<rect width='420' height='260' fill='#101018'/>" + cards +
        "<rect x='140' y='112' width='140' height='36' rx='18' fill='rgba(0,0,0,.65)'/>" +
        "<text x='210' y='137' text-anchor='middle' font-family='monospace' font-size='19' fill='#fff'>%d in 1</text>" % n)


def svg_pass():
    return svg_wrap(
        "<rect width='420' height='260' fill='#16130e'/>" +
        "<rect x='60' y='50' width='300' height='160' rx='16' fill='none' stroke='#ffb300' stroke-width='3'/>" +
        "<circle cx='130' cy='130' r='26' fill='none' stroke='#ffb300' stroke-width='4'/>" +
        "<rect x='170' y='122' width='130' height='8' rx='4' fill='#ffb300'/>" +
        "<rect x='170' y='140' width='90' height='8' rx='4' fill='#8a8474'/>" +
        "<text x='210' y='88' text-anchor='middle' font-family='monospace' font-size='17' fill='#ffb300'>FULL CATALOGUE</text>")


def build_previews():
    import os
    outdir = 'site/store-assets'
    os.makedirs(outdir, exist_ok=True)
    n = 0
    for prod in products:
        pid = prod['id']
        kind = prod['kind']
        d = prod['data'] or {}
        try:
            if kind == 'theme':
                svg = svg_theme(d)
            elif kind == 'accents':
                svg = svg_accents(d.get('accents') or [prod['preview']['ac']])
            elif kind == 'logos':
                svg = svg_logos(d.get('logos') or [])
            elif kind == 'wallpaper':
                svg = svg_wallpaper(d.get('css') or '')
            elif kind == 'cursor':
                svg = svg_cursor(prod['preview']['ac'])
            elif kind == 'combo':
                svg = svg_combo(prod['preview']['bg'], prod['preview']['ac'], len(d.get('items') or []))
            elif kind == 'pass':
                svg = svg_pass()
            else:
                continue
            with open(os.path.join(outdir, 'preview-' + pid + '.svg'), 'w') as f:
                f.write(svg)
            prod['preview']['img'] = PREVIEW_URL % pid
            n += 1
        except Exception as e:
            print('preview fail', pid, e)
    print('previews:', n)


build_previews()
free_n = len([p for p in products if p['price_paise'] == 0])
print('total:', len(products), 'free:', free_n)

lines = ["// Kastrava Store catalog: data-only products (theme, accents, logos,",
         "// wallpaper, cursor, combo). No code execution, no binaries.",
         "// tier free = claimable by any login; tier premium = Premium members",
         "// claim free, others pay once. Combos grant every member item.",
         "'use strict'", "",
         "const PRODUCTS = {"]
for p in products:
    tier = 'free' if p['price_paise'] == 0 else ('pro' if p['pro_free'] else 'premium')
    entry = dict(name=p['name'], kind=p['kind'], tier=tier, price_paise=p['price_paise'],
                 price_usd=p['price_usd'], pro_free=p['pro_free'],
                 blurb=p['blurb'], preview=p['preview'], data=p['data'])
    lines.append("  '%s': %s," % (p['id'], json.dumps(entry, separators=(',', ':'))))
lines += ["};", "",
          "function get(id) {",
          "  return PRODUCTS[String(id || '')] || null",
          "}", "",
          "function catalog() {",
          "  return Object.entries(PRODUCTS).map(([id, p]) => {",
          "    const pv = { bg: p.preview.bg, ac: p.preview.ac, img: p.preview.img || null }",
          "    if (p.data) {",
          "      if (p.kind === 'theme') { pv.tbg = p.data.tbg; pv.tb = p.data.tb; pv.mode = p.data.mode }",
          "      else if (p.kind === 'accents') { pv.accents = p.data.accents }",
          "      else if (p.kind === 'logos') { pv.logos = p.data.logos }",
          "      else if (p.kind === 'wallpaper') { pv.css = p.data.css }",
          "      else if (p.kind === 'combo') { pv.n = (p.data.items || []).length }",
          "    }",
          "    return {",
          "      id, name: p.name, kind: p.kind, tier: p.tier, price_paise: p.price_paise,",
          "      price_usd: p.price_usd, pro_free: !!p.pro_free,",
          "      free: p.price_paise === 0, blurb: p.blurb, preview: pv",
          "    }",
          "  })",
          "}", "",
          "module.exports = { PRODUCTS, get, catalog }", ""]
open('server/lib/products.js', 'w').write('\n'.join(lines))
print('products.js written')
