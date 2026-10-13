#!/usr/bin/env python3
"""Kastrava Store catalog generator: 700 data-only products.
Kinds: theme, accents, logos, wallpaper, cursor, combo.
  free tier (10): claimable by any login.
  premium tier: Premium members claim free, others pay once.
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


def add(pid, name, kind, price, blurb, preview, data):
    assert pid not in seen and name not in seen, (pid, name)
    seen.add(pid)
    seen.add(name)
    products.append(dict(id=pid, name=name, kind=kind, price_paise=price,
                          blurb=blurb, preview=preview, data=data))


def seednum(s):
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)


# --- 10 free tier: 3 hand originals + 7 generated ---
add('theme-midnight-bloom', 'Midnight Bloom', 'theme', 0, 'Deep violet night with a lavender accent.',
    {'bg': '#0d0a1a', 'ac': '#b388ff'},
    {'mode': 'dark', 'bg': '#0d0a1a', 'tbg': '#16122b', 'tb': '#1e1840', 'om': '#0d0a1a', 'ac': '#b388ff'})
add('theme-arctic-mist', 'Arctic Mist', 'theme', 0, 'Pale frost light theme, easy on the eyes.',
    {'bg': '#eef3f6', 'ac': '#0288d1'},
    {'mode': 'light', 'bg': '#eef3f6', 'tbg': '#f7fafc', 'tb': '#ffffff', 'om': '#eef3f6', 'ac': '#0288d1'})
add('accent-neon-pack', 'Neon Accents', 'accents', 0, 'Six loud accent colors for any theme.',
    {'bg': '#101010', 'ac': '#ff2d95'},
    {'accents': ['#ff2d95', '#00e5ff', '#b6ff2e', '#ffab00', '#7c4dff', '#ff5252']})

name_pool = [a + ' ' + b for a in ADJ for b in NOUN]
ni = 0
while len([p for p in products if p['price_paise'] == 0]) < 10:
    name = name_pool[ni]
    ni += 1
    if name in seen:
        continue
    h = seednum(name)
    dark = (h % 2) == 0
    hue = h % 360
    data = dark_theme(hue, 22, (hue + 150) % 360) if dark else light_theme(hue, 18, (hue + 210) % 360)
    add('theme-' + name.lower().replace(' ', '-'), name, 'theme', 0,
        'Community %s theme.' % ('dark' if dark else 'light'),
        {'bg': data['bg'], 'ac': data['ac']}, data)

# --- logo packs (free + premium) ---
add('logos-warm-pack', 'Warm Logo Pack', 'logos', 4900,
    'Ember, amber, rose and grape app badges.',
    {'bg': '#7a1f1f', 'ac': '#ffffff'},
    {'logos': [LOGO_URL % x for x in ['ember', 'amber', 'rose', 'grape']]})
add('logos-cool-pack', 'Cool Logo Pack', 'logos', 4900,
    'Ocean, teal, forest and slate app badges.',
    {'bg': '#123a6d', 'ac': '#ffffff'},
    {'logos': [LOGO_URL % x for x in ['ocean', 'teal', 'forest', 'slate']]})
add('logos-full-set', 'Full Logo Set', 'logos', 9900,
    'All eight app badges in one pack.',
    {'bg': '#101010', 'ac': '#b388ff'},
    {'logos': [LOGO_URL % x for x in LOGO_FILES]})

prices = [2900, 4900, 9900]
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
        add('accents-' + aname.lower().replace(' ', '-'), aname, 'accents', prices[slot % 3],
            'Six harmonious accents.', {'bg': '#101010', 'ac': accents[0]}, {'accents': accents})
    elif slot % 14 == 12:
        c1, c2 = hx(h % 360, 60, 12), hx((h + 60) % 360, 65, 30)
        wname = name + ' Wallpaper'
        if wname in seen:
            continue
        css = 'linear-gradient(135deg, %s, %s)' % (c1, c2)
        add('wallpaper-' + wname.lower().replace(' ', '-'), wname, 'wallpaper', prices[slot % 3],
            'Gradient new-tab backdrop.', {'bg': c1, 'ac': c2}, {'css': css})
    elif slot % 14 == 11:
        cc = hx(h % 360, 90, 60)
        cname = name + ' Cursor'
        if cname in seen:
            continue
        svg = ("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>"
               "<circle cx='12' cy='12' r='7' fill='%s'/></svg>" % cc).replace('#', '%23')
        add('cursor-' + cname.lower().replace(' ', '-'), cname, 'cursor', prices[slot % 3],
            'Color-dot pointer set.', {'bg': '#101010', 'ac': cc},
            {'cursors': {'default': svg, 'pointer': svg}})
    else:
        dark = (h % 3) != 2
        hue = h % 360
        sat = 16 + (h % 5) * 4
        data = dark_theme(hue, sat, (hue + 140 + h) % 360) if dark else light_theme(hue, sat, (hue + 200 + h) % 360)
        add('theme-' + name.lower().replace(' ', '-'), name, 'theme', prices[slot % 3],
            'Hand-tuned %s theme.' % ('dark' if dark else 'light'),
            {'bg': data['bg'], 'ac': data['ac']}, data)

# --- combo packs (bundle ids that exist by now) ---
theme_ids = [p['id'] for p in products if p['kind'] == 'theme' and p['price_paise'] != 0][:40]
combos = [('combo-night-shift', 'Night Shift Bundle', 'Ten dark themes, one price.', 19900, theme_ids[0:10]),
          ('combo-daybreak', 'Daybreak Bundle', 'Ten light themes, one price.', 19900,
           [p['id'] for p in products if p['kind'] == 'theme' and p['data'].get('mode') == 'light' and p['price_paise'] != 0][:10]),
          ('combo-full-spectrum', 'Full Spectrum', 'Twenty themes across every hue.', 29900, theme_ids[10:30]),
          ('combo-creator', 'Creator Combo', 'Themes, accents and wallpapers for setup lovers.', 14900,
           [p['id'] for p in products if p['kind'] == 'accents' and p['price_paise'] != 0][:3] +
           [p['id'] for p in products if p['kind'] == 'wallpaper'][:3] +
           theme_ids[30:36])]
for pid, name, blurb, price, members in combos:
    members = [m for m in members if m in seen]
    if len(members) < 3:
        continue
    first = next(p for p in products if p['id'] == members[0])
    add(pid, name, 'combo', price, blurb,
        {'bg': first['preview']['bg'], 'ac': first['preview']['ac']},
        {'items': members})

assert len(products) >= 700, len(products)
free_n = len([p for p in products if p['price_paise'] == 0])
print('total:', len(products), 'free:', free_n)

lines = ["// Kastrava Store catalog: data-only products (theme, accents, logos,",
         "// wallpaper, cursor, combo). No code execution, no binaries.",
         "// tier free = claimable by any login; tier premium = Premium members",
         "// claim free, others pay once. Combos grant every member item.",
         "'use strict'", "",
         "const PRODUCTS = {"]
for p in products:
    tier = 'free' if p['price_paise'] == 0 else 'premium'
    entry = dict(name=p['name'], kind=p['kind'], tier=tier, price_paise=p['price_paise'],
                 blurb=p['blurb'], preview=p['preview'], data=p['data'])
    lines.append("  '%s': %s," % (p['id'], json.dumps(entry, separators=(',', ':'))))
lines += ["};", "",
          "function get(id) {",
          "  return PRODUCTS[String(id || '')] || null",
          "}", "",
          "function catalog() {",
          "  return Object.entries(PRODUCTS).map(([id, p]) => {",
          "    const pv = { bg: p.preview.bg, ac: p.preview.ac }",
          "    if (p.data) {",
          "      if (p.kind === 'theme') { pv.tbg = p.data.tbg; pv.tb = p.data.tb; pv.mode = p.data.mode }",
          "      else if (p.kind === 'accents') { pv.accents = p.data.accents }",
          "      else if (p.kind === 'logos') { pv.logos = p.data.logos }",
          "      else if (p.kind === 'wallpaper') { pv.css = p.data.css }",
          "      else if (p.kind === 'combo') { pv.n = (p.data.items || []).length }",
          "    }",
          "    return {",
          "      id, name: p.name, kind: p.kind, tier: p.tier, price_paise: p.price_paise,",
          "      free: p.price_paise === 0, blurb: p.blurb, preview: pv",
          "    }",
          "  })",
          "}", "",
          "module.exports = { PRODUCTS, get, catalog }", ""]
open('server/lib/products.js', 'w').write('\n'.join(lines))
print('products.js written')
