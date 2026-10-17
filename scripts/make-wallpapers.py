#!/usr/bin/env python3
"""Generate real image wallpapers for the Kastrava store.

These are actual JPG images (nebulae, night skies, mountain silhouettes,
bokeh, synthwave grids, mesh gradients, textures) — not CSS gradient swatches.
Each is 1920x1080, written to site/store-assets/wp/<slug>.jpg, and a manifest
(site/store-assets/wp/manifest.json) is emitted so the catalog generator can
build wallpaper products that reference the real files.

Run:  python3 scripts/make-wallpapers.py
"""
import json
import os
import random
import subprocess
import sys

W, H = 1920, 1080
OUT = 'site/store-assets/wp'
os.makedirs(OUT, exist_ok=True)
MANIFEST = []


def run(args):
    subprocess.run(['magick'] + args, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def out_path(slug):
    return os.path.join(OUT, slug + '.jpg')


def ridge(y, seed, jag=140, peaks=6):
    """Polygon points for a mountain ridge across the bottom of the frame."""
    random.seed(seed)
    pts = ['0,%d' % H]
    n = peaks * 2
    for i in range(n + 1):
        x = int(W * i / n)
        yy = int(y - random.uniform(0, jag) - (jag if i % 2 else 0))
        pts.append('%d,%d' % (x, yy))
    pts.append('%d,%d' % (W, H))
    return 'polygon ' + ' '.join(pts)


def add_stars(layer_density=98, seed=0):
    return ('(',
            '-size', '%dx%d' % (W, H), 'xc:black', '+noise', 'Random',
            '-colorspace', 'gray', '-threshold', '%d%%' % layer_density,
            '-blur', '0x0.5', ')', '-compose', 'Screen', '-composite')


def glow(cx, cy, r, color, blur=80):
    """A soft ROUND sun/moon glow — a blurred circle on a transparent
    full-size canvas, so there is never a hard square edge."""
    return ('(',
            '-size', '%dx%d' % (W, H), 'xc:none', '-fill', color,
            '-draw', 'circle %d,%d %d,%d' % (cx, cy, cx + r, cy),
            '-blur', '0x%d' % blur, ')', '-compose', 'Screen', '-composite')


def plasma_clut(pal_stops, sky, stars=False, ridge_y=None, stretch='22%x3%', blur=3):
    """Organic plasma luminance mapped through a colour ramp (CLUT), screened
    onto a sky gradient. Used for auroras, nebulae, marble, volcanic glows."""
    slug_pal = os.path.join(OUT, '.pal.png')
    run(['-size', '256x1', 'gradient:' + '-'.join(pal_stops), slug_pal])
    core = os.path.join(OUT, '.core.png')
    run(['-size', '%dx%d' % (W, H), 'plasma:fractal', '-colorspace', 'gray',
         '-auto-level', '-contrast-stretch', stretch, slug_pal, '-clut',
         '-blur', '0x%d' % blur, core])
    args = ['-size', '%dx%d' % (W, H), 'gradient:' + '-'.join(sky), core,
            '-compose', 'Screen', '-composite']
    if stars:
        args += list(add_stars(98))
    if ridge_y:
        args += ['-fill', 'black', '-draw', ridge(ridge_y, hash(tuple(pal_stops)) & 0xffff)]
    args.append(os.path.join(OUT, '_tmp.jpg'))
    run(args)
    return '_tmp.jpg'


def emit(slug, name, blurb):
    MANIFEST.append({'slug': slug, 'name': name, 'blurb': blurb,
                     'file': slug + '.jpg'})


# ---------------------------------------------------------------- auroras ---
def aurora(slug, name, stops, sky, blurb, ridge_y=980):
    plasma_clut(stops, sky, stars=True, ridge_y=ridge_y)
    os.replace(os.path.join(OUT, '_tmp.jpg'), out_path(slug))
    emit(slug, name, blurb)


aurora('aurora-borealis', 'Aurora Borealis',
       ['#02121e', '#07372f', '#1f9e77', '#8dffd0'],
       ['#02101c', '#051626'], 'Green northern lights over a silent ridge.')
aurora('aurora-emerald', 'Emerald Drift',
       ['#02121e', '#0a4030', '#2fbf7f', '#b6ffd8'],
       ['#03111b', '#061a24'], 'Soft emerald aurora wisps across a starry sky.')
aurora('nebula-violet', 'Violet Nebula',
       ['#0a0616', '#2a1150', '#7c3aed', '#e9d5ff'],
       ['#070412', '#0d0820'], 'Deep-space violet nebula with scattered stars.')
aurora('nebula-rose', 'Rose Galaxy',
       ['#160612', '#3d1030', '#c026d3', '#fbcfe8'],
       ['#10040e', '#180818'], 'A dusty rose galaxy core blooming in the dark.')

# --------------------------------------------------------------- night sky ---
def night(slug, name, grad, blurb, moon=None, ridge_y=930, seed=1):
    args = ['-size', '%dx%d' % (W, H), 'gradient:' + '-'.join(grad)]
    args += list(add_stars(97, seed))
    if moon:
        args += list(glow(*moon, blur=60))
    args += ['-fill', 'black', '-draw', ridge(ridge_y, seed * 7),
             '-fill', 'black', '-draw', ridge(ridge_y + 70, seed * 13, jag=90, peaks=4),
             out_path(slug)]
    run(args)
    emit(slug, name, blurb)


night('starry-peak', 'Starry Peak',
      ['#0b1024', '#04060f'], 'A cold night sky over black mountain peaks.',
      seed=3)
night('moonlit-ridge', 'Moonlit Ridge',
      ['#0a1430', '#050810'], 'Moon glow behind a quiet mountain ridge.',
      moon=(380, 300, 150, '#eef4ff'), seed=5)
night('indigo-night', 'Indigo Night',
      ['#140b2e', '#06040f'], 'A deep indigo sky thick with stars.', seed=9)

# --------------------------------------------------------- sunset / dawn ----
def mountains(slug, name, sky, sun, ridges, blurb):
    args = ['-size', '%dx%d' % (W, H), 'gradient:' + '-'.join(sky)]
    if sun:
        args += list(glow(*sun, blur=70))
    for i, (color, y, jag, peaks) in enumerate(ridges):
        args += ['-fill', color, '-draw', ridge(y, 100 + i * 31, jag=jag, peaks=peaks)]
    args.append(out_path(slug))
    run(args)
    emit(slug, name, blurb)


mountains('sunset-peaks', 'Sunset Peaks',
          ['#ff9a3c', '#c0397a', '#2a1a4a'],
          (960, 540, 240, '#ffe6a8'),
          [('#3a1e4a', 760, 160, 5), ('#1c0f2e', 890, 90, 4)],
          'Warm sunset light behind layered purple peaks.')
mountains('crimson-dusk', 'Crimson Dusk',
          ['#ff6b3c', '#8a1e3c', '#1a0a20'],
          (800, 560, 230, '#ffd27a'),
          [('#4a1225', 780, 150, 6), ('#230812', 900, 80, 4)],
          'A crimson evening settling over dark hills.')
mountains('golden-dunes', 'Golden Dunes',
          ['#ffcf6b', '#e08a3c', '#5a2a1a'],
          None,
          [('#8a4a24', 800, 70, 3), ('#4a2412', 920, 50, 3)],
          'Rolling desert dunes under a golden sky.')

# ------------------------------------------------------------------ ocean ---
def ocean(slug, name, sky, water, sun, blurb):
    args = ['-size', '%dx%d' % (W, H), 'gradient:' + '-'.join(sky),
            '(', '-size', '%dx%d' % (W, H // 2), 'gradient:' + '-'.join(water),
             ')', '-gravity', 'South', '-geometry', '+0+0', '-composite']
    if sun:
        args += list(glow(*sun, blur=70))
    # wave shimmer: thin horizontal streaks
    args += ['-strokewidth', '1']
    random.seed(hash(slug) & 0xffff)
    for i in range(40):
        y = H // 2 + random.randint(6, H // 2 - 10)
        x0 = random.randint(0, W - 260)
        ln = random.randint(80, 260)
        alpha = random.randint(10, 40)
        args += ['-stroke', 'rgba(255,255,255,%d%%)' % alpha,
                 '-draw', 'line %d,%d %d,%d' % (x0, y, x0 + ln, y)]
    args += ['-blur', '0x0.4', out_path(slug)]
    run(args)
    emit(slug, name, blurb)


ocean('calm-horizon', 'Calm Horizon',
      ['#2a6fb0', '#0d3b66', '#062033'],
      ['#0a2c4a', '#04101d'],
      (960, 440, 220, '#ffe6a8'),
      'A still sea meeting a soft evening sky.')
ocean('teal-tide', 'Teal Tide',
      ['#2ab6b0', '#0d6b70', '#06303a'],
      ['#0a4a52', '#04202a'],
      (960, 440, 200, '#d8fff0'),
      'Glassy teal water under a pale morning glow.')

# ------------------------------------------------------------------ bokeh ---
def bokeh(slug, name, bg, colors, blurb, count=55):
    args = ['-size', '%dx%d' % (W, H), 'xc:' + bg]
    random.seed(hash(slug) & 0xffff)
    for _ in range(count):
        r = random.randint(28, 120)
        cx = random.randint(-40, W + 40)
        cy = random.randint(-40, H + 40)
        c = random.choice(colors)
        args += ['-fill', c, '-draw', 'circle %d,%d %d,%d' % (cx, cy, cx + r, cy)]
    args += ['-blur', '0x14', out_path(slug)]
    run(args)
    emit(slug, name, blurb)


bokeh('bokeh-city', 'City Bokeh', '#0a0a14',
      ['#ff5d5d90', '#5d9dff90', '#ffd25d90', '#5dffd290', '#c05dff90'],
      'Blurred city lights drifting out of focus.')
bokeh('bokeh-ember', 'Ember Bokeh', '#120606',
      ['#ff7a3c90', '#ff3c6e90', '#ffb03c90', '#ff5d5d90'],
      'Warm ember sparks glowing in the dark.')

# ------------------------------------------------------------------- mesh ---
def mesh(slug, name, bg, blobs, blurb):
    args = ['-size', '%dx%d' % (W, H), 'xc:' + bg]
    random.seed(hash(slug) & 0xffff)
    for color, n in blobs:
        for _ in range(n):
            rx = random.randint(500, 1000)
            cx = random.randint(-200, W + 200)
            cy = random.randint(-200, H + 200)
            args += ['(', '-size', '%dx%d' % (rx, rx), 'radial-gradient:' + color,
                     '-blur', '0x80', ')', '-gravity', 'Northwest',
                     '-geometry', '+%d+%d' % (cx - rx // 2, cy - rx // 2),
                     '-compose', 'Screen', '-composite']
    args += ['-blur', '0x10', out_path(slug)]
    run(args)
    emit(slug, name, blurb)


mesh('mesh-dawn', 'Dawn Mesh', '#0a0616',
     [('#ff9a3c-#00000000', 2), ('#c0397a-#00000000', 2), ('#3a1e6e-#00000000', 2)],
     'A soft mesh of dawn colours melting together.')
mesh('mesh-aurora', 'Aurora Mesh', '#04121a',
     [('#2fbf7f-#00000000', 2), ('#2a9df4-#00000000', 2), ('#7c3aed-#00000000', 1)],
     'Cool aurora hues blending over a dark field.')

# --------------------------------------------------------------- synthwave --
def synth(slug, name, grad, line, sun, blurb):
    horizon = 650
    mvg = ["stroke '%s' stroke-width 2 fill none" % line,
           'line 0,%d %d,%d' % (horizon, W, horizon)]
    if sun:
        cy, r = horizon - 30, 220
        mvg.append("fill '%s' stroke none" % sun)
        mvg.append('circle 960,%d 960,%d' % (cy, cy - r))
        mvg.append("fill '#1a0b2e' stroke none")  # retro gap bands
        for gy in range(cy + 10, cy + r, 26):
            mvg.append('rectangle 700,%d 1220,%d' % (gy, gy + 8))
    for x in range(-1200, 3200, 160):
        mvg.append('line %d,%d %d,%d' % (x, H, 960, horizon))
    y = horizon
    gap = 7
    while y < H:
        mvg.append('line 0,%d %d,%d' % (y, W, y))
        y += gap
        gap = int(gap * 1.4)
    args = ['-size', '%dx%d' % (W, H), 'gradient:' + '-'.join(grad),
            '-fill', 'none', '-draw', '\n'.join(mvg),
            '-blur', '0x0.4', out_path(slug)]
    run(args)
    emit(slug, name, blurb)


synth('synthwave-grid', 'Synthwave Grid',
      ['#1a0b2e', '#3d1b5e'], '#00e5ff', '#ff2d95',
      'A neon grid racing to the horizon under a magenta sun.')
synth('retro-horizon', 'Retro Horizon',
      ['#2a0b3e', '#5e1b4e'], '#ffd25d', '#ff7a3c',
      'A warm retro horizon with a golden sun sinker.')

# ------------------------------------------------------------ topographic ---
def topo(slug, name, line_color, bg, blurb):
    tmp = os.path.join(OUT, '.topo.png')
    run(['-size', '%dx%d' % (W, H), 'plasma:fractal', '-colorspace', 'gray',
         '-auto-level', '-blur', '0x6', '-posterize', '7', '-edge', '1',
         '-blur', '0x1', '-contrast-stretch', '50%x2%', tmp])
    pal = os.path.join(OUT, '.topal.png')
    run(['-size', '256x1', 'gradient:' + bg + '-' + line_color, pal])
    run([tmp, pal, '-clut', out_path(slug)])
    emit(slug, name, blurb)


topo('topo-emerald', 'Topographic', '#8dffd0', '#04120c',
     'Contour lines rippling across a dark map.')

# ------------------------------------------------------------------ swirl ---
def swirl(slug, name, pal, sky, blurb):
    run(['-size', '%dx%d' % (W, H), 'plasma:fractal', '-colorspace', 'gray',
         '-auto-level', '-swirl', '60', os.path.join(OUT, '.sw.png')])
    run(['-size', '256x1', 'gradient:' + '-'.join(pal), os.path.join(OUT, '.pal.png')])
    run([os.path.join(OUT, '.sw.png'), os.path.join(OUT, '.pal.png'), '-clut',
         '-blur', '0x2', out_path(slug)])
    emit(slug, name, blurb)


swirl('marble-flow', 'Marble Flow',
      ['#0a0a12', '#26324a', '#7c8db0', '#eef2ff'],
      None, 'Swirling marble currents in slate and silver.')

# --------------------------------------------------------------- geometric --
def arches(slug, name, bg, colors, blurb):
    args = ['-size', '%dx%d' % (W, H), 'xc:' + bg]
    random.seed(hash(slug) & 0xffff)
    cx, cy = W // 2, H + 120
    for i, c in enumerate(colors):
        r = 900 - i * 130
        args += ['-stroke', c, '-strokewidth', '30', '-fill', 'none',
                 '-draw', 'circle %d,%d %d,%d' % (cx, cy, cx + r, cy)]
    args += ['-blur', '0x1.5', out_path(slug)]
    run(args)
    emit(slug, name, blurb)


arches('neon-arches', 'Neon Arches', '#0a0a14',
       ['#ff2d95', '#ff7a3c', '#ffd25d', '#2fbf7f', '#2a9df4', '#7c3aed'],
       'Concentric neon arches rising over a dark ground.')

print('wallpapers:', len(MANIFEST))
with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(MANIFEST, f, indent=2)
print('manifest written to', os.path.join(OUT, 'manifest.json'))
