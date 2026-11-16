#!/usr/bin/env python3
"""openGym brand kit: every logo variant as SVG, built from the official geometry.

The mark is the five rectangles of assets/logo/opengym-mark.svg (352 x 174, square corners).
The wordmark is Liberation Sans Bold 700 at 112 with -4 letter spacing, as in the official
lockup SVGs, converted to outlines (wordmark-paths.json, made with opentype.js) so it looks
the same on machines without that font. Pixel-checked against assets/logo/opengym-logo-dark.png.
Never edit the shapes here by hand.

  python3 scripts/brand/make-kit.py <out-dir>      writes <out-dir>/logo/*.svg and icons/*.svg
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else 'website/brand/kit'

GREEN, INK, LIGHT, DARK, WHITE, ON_LIGHT = '#a3e635', '#0c0e12', '#eef1f6', '#12151b', '#ffffff', '#4d7c0f'
RECTS = '''<rect x="80" y="242" width="352" height="28"/>
    <rect x="80" y="199" width="36" height="114"/>
    <rect x="131" y="169" width="47" height="174"/>
    <rect x="334" y="169" width="47" height="174"/>
    <rect x="396" y="199" width="36" height="114"/>'''
W = json.load(open(os.path.join(HERE, 'wordmark-paths.json')))
LOCKUP_VB = '3.265 132.5 868 238'


def lockup(open_c, gym_c, mark_c, bg=None):
    bgr = f'\n  <rect x="3.265" y="132.5" width="868" height="238" fill="{bg}"/>' if bg else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="868" height="238" viewBox="{LOCKUP_VB}" role="img" aria-label="openGym">{bgr}
  <g transform="translate(60,250) scale(0.6897) translate(-80,-256)" fill="{mark_c}">
    {RECTS}
  </g>
  <path fill="{open_c}" d="{W['open']}"/>
  <path fill="{gym_c}" d="{W['gym']}"/>
</svg>
'''


def mark(c):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="352" height="174" viewBox="80 169 352 174" role="img" aria-label="openGym">
  <g fill="{c}">
    {RECTS}
  </g>
</svg>
'''


def icon(rx, bg=INK, c=GREEN):
    r = f' rx="{rx}"' if rx else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="openGym">
  <rect width="512" height="512"{r} fill="{bg}"/>
  <g fill="{c}">
    {RECTS}
  </g>
</svg>
'''


FILES = {
    'logo/opengym-logo-dark.svg': lockup(LIGHT, GREEN, GREEN, INK),
    'logo/opengym-logo-light.svg': lockup(DARK, GREEN, GREEN, WHITE),
    'logo/opengym-logo-for-dark-backgrounds.svg': lockup(LIGHT, GREEN, GREEN),
    'logo/opengym-logo-for-light-backgrounds.svg': lockup(DARK, GREEN, GREEN),
    'logo/opengym-logo-white.svg': lockup(WHITE, WHITE, WHITE),
    'logo/opengym-logo-black.svg': lockup(INK, INK, INK),
    'logo/opengym-mark-green.svg': mark(GREEN),
    'logo/opengym-mark-white.svg': mark(WHITE),
    'logo/opengym-mark-black.svg': mark(INK),
    'icons/opengym-icon-square.svg': icon(0),
    'icons/opengym-icon-rounded.svg': icon(114),
}

for name, svg in FILES.items():
    p = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(svg)
print(f'{len(FILES)} SVGs in {OUT}')
