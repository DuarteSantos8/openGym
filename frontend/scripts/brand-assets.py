#!/usr/bin/env python3
"""Render every raster of the brand from the one geometry: the app and web icons, the Android
launcher, the iOS icon and the launch screens of both shells.

    python3 scripts/brand-assets.py            # from frontend/; rewrites the files listed below

Needs Pillow and a Chromium (CHROME=/path/to/chrome, default: Playwright's). The G is the brand
kit's (gains-logo.js GEO: ring radius 24, stroke 8.4, groove at 25.2, 1.1 wide, in a 100 box with y
up), written here with y down. public/brand/icon.svg and resources/icon.svg are written too, and
src/brand-assets.test.js checks that what is on disk is what this draws.

Launch screens are stills: the G where the animated splash holds it (centre 38 units above the middle,
56.4 units wide), light and dark. Android: the size of each file it replaces. iOS: one 1400 pt square
per scale, centred and not scaled by the storyboard, so the G is the same size on every screen.
Every raster is drawn at its own size (no resampling of a bigger render).
"""
import glob, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw

CHROME = os.environ.get('CHROME') or next(iter(sorted(
    glob.glob('/opt/pw-browsers/chromium-*/chrome-linux*/chrome')
    + glob.glob(os.path.expanduser('~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell'))
    + glob.glob(os.path.expanduser('~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome')))), 'chromium')
FRONTEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BRAND = os.path.join(FRONTEND, 'public', 'brand')
RES = os.path.join(FRONTEND, 'android', 'app', 'src', 'main', 'res')
XCA = os.path.join(FRONTEND, 'ios', 'App', 'App', 'Assets.xcassets')

CENTRE = 'M68.39 34.57A24 24 0 1 0 74 50H51'
GROOVE = 'M69.30 33.80A25.2 25.2 0 1 0 75.2 50V48.8H52.5'
INK = '#0c0b0a'   # the tile: the app's own dark --bg
# Launch screens follow the system theme: the app's own --bg and --label of each.
IOS_SIDE = 1400   # pt: the iOS launch image, shown at its own size and centred
THEMES = {'light': ('#f5f4f1', '#1a1814'), 'dark': ('#0c0b0a', '#f7f5f2')}


def mark(fill):
    return ('<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">'
            '<rect width="100" height="100" fill="#fff"/>'
            f'<path d="{GROOVE}" fill="none" stroke="#000" stroke-width="1.1" stroke-linejoin="round"/></mask></defs>'
            f'<path mask="url(#m)" d="{CENTRE}" fill="none" stroke="{fill}" stroke-width="8.4" stroke-miterlimit="4"/>')


def svg(body, size=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"{size}>{body}</svg>'


def render(svg_text, size, transparent):
    """The SVG at size x size, through headless Chromium (no other SVG renderer is assumed)."""
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, 'a.svg'), 'w').write(svg_text)
        open(os.path.join(d, 'a.html'), 'w').write(
            f'<!doctype html><html style="margin:0;background:transparent"><body style="margin:0"><img src="a.svg" width="{size}" height="{size}" style="display:block"></body></html>')
        out = os.path.join(d, 'a.png')
        # The window is taller than the picture: headless Chromium paints the bottom rows white.
        subprocess.run([CHROME, '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                        '--default-background-color=' + ('00000000' if transparent else 'ffffffff'),
                        f'--window-size={size},{size + 200}', f'--screenshot={out}', 'file://' + os.path.join(d, 'a.html')],
                       check=True, capture_output=True)
        return Image.open(out).convert('RGBA').crop((0, 0, size, size))


def put(path, im, **kw):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, **kw)


_cache = {}


def at(svg_text, n, transparent):
    """The SVG rendered straight at n x n. Never a resize of a bigger render: LANCZOS rings, and the
    halo around the G came out darker than the tile."""
    key = (svg_text, n, transparent)
    if key not in _cache: _cache[key] = render(svg_text, n, transparent)
    return _cache[key]


def masked(im, shape):
    n = im.size[0]; s = 4
    m = Image.new('L', (n * s, n * s), 0)
    d = ImageDraw.Draw(m)
    if shape == 'circle': d.ellipse((0, 0, n * s - 1, n * s - 1), fill=255)
    else: d.rounded_rectangle((0, 0, n * s - 1, n * s - 1), radius=.224 * n * s, fill=255)
    out = im.convert('RGBA'); out.putalpha(m.resize((n, n), Image.BOX))
    return out


def hex_rgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def main():
    icon_svg = svg(f'<rect width="100" height="100" fill="{INK}"/>' + mark('#FFFFFF'))
    # The master files say 1024 so a generator reading them (@capacitor/assets) has a size to start from.
    for p in (os.path.join(BRAND, 'icon.svg'), os.path.join(FRONTEND, 'resources', 'icon.svg')):
        open(p, 'w').write(svg(icon_svg[icon_svg.index('>') + 1:-6], ' width="1024" height="1024"'))
    open(os.path.join(BRAND, 'favicon.svg'), 'w').write(svg(f'<rect width="100" height="100" rx="22.4" fill="{INK}"/>' + mark('#FFFFFF')))

    def tile(n): return at(icon_svg, n, False).convert('RGB')
    def white(n): return at(svg(mark('#FFFFFF')), n, True)   # white G on transparent, 56.4% of the side

    # web: every size is drawn at its own size
    for n in (180, 192, 512): put(os.path.join(BRAND, f'icon-{n}.png'), tile(n))
    # maskable: the same full-bleed tile, its own files (the G sits inside the 80% safe circle)
    for n in (192, 512): put(os.path.join(BRAND, f'icon-{n}-maskable.png'), tile(n))
    put(os.path.join(BRAND, 'favicon-32.png'), tile(32))
    put(os.path.join(BRAND, 'favicon.ico'), tile(48), format='ICO', sizes=[(48, 48), (32, 32), (16, 16)])
    badge = Image.new('RGBA', (96, 96), (0, 0, 0, 0))   # the G, filling most of the badge
    g = at(svg(mark('#FFFFFF')).replace('viewBox="0 0 100 100"', 'viewBox="21.8 21.8 56.4 56.4"'), 84, True)
    badge.paste(g, (6, 6), g)
    put(os.path.join(BRAND, 'badge-96.png'), badge)

    # iOS icon: no transparency
    put(os.path.join(XCA, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), tile(1024))

    # Android launcher: legacy square and round at 48 dp, adaptive foreground at 108 dp
    for d, s in {'ldpi': .75, 'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
        leg, lay = round(48 * s), round(108 * s)
        put(os.path.join(RES, f'mipmap-{d}', 'ic_launcher.png'), masked(tile(leg), 'square'))
        put(os.path.join(RES, f'mipmap-{d}', 'ic_launcher_round.png'), masked(tile(leg), 'circle'))
        put(os.path.join(RES, f'mipmap-{d}', 'ic_launcher_foreground.png'), white(lay))

    # launch screens
    def tint(theme, d):
        w = white(d)
        t = Image.new('RGBA', w.size, hex_rgb(THEMES[theme][1]) + (255,)); t.putalpha(w.split()[3])
        return t

    def launch(w, h, theme, unit):
        im = Image.new('RGB', (w, h), hex_rgb(THEMES[theme][0]))
        d = round(100 * unit)   # side of the 100 box that puts a 56.4-unit G on screen
        m = tint(theme, d)
        im.paste(m, (round(w / 2 - d / 2), round(h / 2 - 38 * unit - d / 2)), m)
        return im
    for p in glob.glob(os.path.join(RES, 'drawable*', 'splash.png')):
        w, h = Image.open(p).size
        put(p, launch(w, h, 'dark' if '-night' in p else 'light', min(w, h) / 390))   # a 390 dp short side
    # iOS: one square per scale, shown at its own size (the storyboard centres it, no scaling), so
    # the G is 56.4 pt on every screen. 1400 pt square covers the largest iPad.
    for p in glob.glob(os.path.join(XCA, 'Splash.imageset', 'Default@*.png')):
        scale = int(os.path.basename(p)[len('Default@')])
        put(p, launch(IOS_SIDE * scale, IOS_SIDE * scale, 'dark' if p.endswith('-dark.png') else 'light', scale))


if __name__ == '__main__':
    sys.exit(main())
