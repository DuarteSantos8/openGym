#!/usr/bin/env python3
"""Builds website/brand.html (opengym.ch/brand) inside the site's own shell (about.html: head, nav,
contents drawer, footer). Content and layout live here; styles in website/brand/brand.css, behaviour
in website/brand/brand.js.  Run from the repo root: python3 scripts/brand/page.py
"""
import re
from PIL import Image

W = 'website'
K = 'brand/kit'
a = open(f'{W}/about.html').read()
head = a[:a.index('<main id="main"')]
foot = a[a.index('</main>') + len('</main>'):]

head = head.replace('<title>openGym: About</title>', '<title>openGym: Brand kit</title>')
head = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="The openGym logo, icons, colours and banners to download, with the brand guide: how to use them and what to avoid.">', head)
head = head.replace('content="About openGym"', 'content="openGym brand kit"')
head = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="Logos, icons, colours, banners and the brand guide of openGym, free to download.">', head)
head = head.replace('https://opengym.ch/about.html', 'https://opengym.ch/brand.html')
side_old = head[head.index('<p class="side-label">On this page</p>'):head.index('<p class="side-label">More</p>')]
head = head.replace(side_old, '''<p class="side-label">On this page</p>
  <a class="side-link" href="#logo"><b>Logo</b><span>The right version for any background</span></a>
  <a class="side-link" href="#colours"><b>Colours</b><span>One green, lots of dark</span></a>
  <a class="side-link" href="#icons"><b>Icons</b><span>The mark and the app icon</span></a>
  <a class="side-link" href="#banners"><b>Banners</b><span>Social, GitHub, Discord, wallpapers</span></a>
  <a class="side-link" href="#use"><b>Using it</b><span>Do this, please don't do that</span></a>
  ''')
head = head.replace('<link rel="stylesheet" href="styles.css?v=32">', '<link rel="stylesheet" href="styles.css?v=32">\n<link rel="stylesheet" href="brand/brand.css?v=2">')

RECTS = '<rect x="80" y="242" width="352" height="28"/><rect x="80" y="199" width="36" height="114"/><rect x="131" y="169" width="47" height="174"/><rect x="334" y="169" width="47" height="174"/><rect x="396" y="199" width="36" height="114"/>'
mark = lambda cls='': f'<svg class="{cls}" viewBox="80 169 352 174" aria-hidden="true"><g fill="currentColor">{RECTS}</g></svg>'

# ---- hero: the mark at enormous scale; its four plates are the way into the page
plates = [('logo', 'Logo', 'o'), ('colours', 'Colours', 'i'), ('icons', 'Icons', 'i'), ('banners', 'Banners', 'o')]
plate_html = ''.join(f'<a class="bk-plate bk-plate-{k}" href="#{h}"><span>{t}</span></a>' for h, t, k in plates)
hero = f'''<header class="bk-hero">
  <div class="bk-hero-text">
    <h1>openGym brand kit</h1>
    <ul class="bk-count" aria-label="In the kit">
      <li><a href="#logo"><b>9</b> logo files</a></li><li><a href="#colours"><b>7</b> colours</a></li>
      <li><a href="#icons"><b>2</b> app icons, 3 sizes</a></li><li><a href="#banners"><b>8</b> banners</a></li>
      <li><a href="brand/kit/opengym-brand-guidelines.pdf"><b>27</b> page brand guidelines</a></li></ul>
    <p class="bk-lead">The logo, icons, colours and banners, free to use when you write about openGym or build something for it.</p>
    <div class="bk-actions">
      <a class="bk-btn" href="{K}/opengym-brand-kit.zip" download>Download everything <small>ZIP, 4 MB</small></a>
      <a class="bk-link" href="{K}/opengym-brand-guidelines.pdf">Brand guidelines (PDF)</a>
    </div>
  </div>
  <div class="bk-bell" role="navigation" aria-label="Brand kit sections">
    <span class="bk-bar"></span>{plate_html}
  </div>
</header>'''

# ---- logo: the live thing. Pick a background, get the right file.
bgs = [
    ('ink', '#0c0e12', 'Dark', 'opengym-logo-for-dark-backgrounds', 'On dark backgrounds the word "open" is light. This is the default.'),
    ('white', '#ffffff', 'White', 'opengym-logo-for-light-backgrounds', 'On white and light backgrounds "open" turns dark. "Gym" stays green.'),
    ('green', '#a3e635', 'Green', 'opengym-logo-black', 'On the green itself, the logo goes all ink.'),
    ('photo', 'url', 'Photo', 'opengym-logo-dark', 'On photos, use the logo on its own ink plate so it never fights the picture.'),
    ('mono', '#4d7c0f', 'One colour', 'opengym-logo-white', 'For one-colour printing and coloured backgrounds: all white, or all black.'),
]
tabs = ''.join(f'<button type="button" class="bk-tab" role="tab" aria-selected="{"true" if i == 0 else "false"}" data-bg="{k}" data-file="{f}" data-note="{n}">{t}</button>' for i, (k, c, t, f, n) in enumerate(bgs))
logo = f'''<section id="logo" class="bk-logo" aria-labelledby="logo-h">
  <div class="bk-stage" data-bg="ink">
    <img class="bk-stage-photo" src="brand/preview/stage-photo.webp" alt="" width="960" height="960" loading="lazy">
    <img class="bk-stage-logo" src="{K}/logo/opengym-logo-for-dark-backgrounds.svg" alt="The openGym logo on the chosen background" width="868" height="238">
  </div>
  <div class="bk-logo-side">
    <div class="bk-tabs" role="tablist" aria-label="Background">{tabs}</div>
    <div>
      <h2 id="logo-h">Pick your background</h2>
      <p class="bk-note" aria-live="polite">{bgs[0][4]}</p>
    </div>
    <div class="bk-cells">
      <a class="bk-cell bk-cell-ink" data-dl="svg" href="{K}/logo/opengym-logo-for-dark-backgrounds.svg" download>SVG<small>for print and web</small></a>
      <a class="bk-cell" data-dl="png" href="{K}/logo/opengym-logo-for-dark-backgrounds@4x.png" download>PNG<small>3472 px wide</small></a>
    </div>
  </div>
</section>'''

# ---- colours: one printed spec sheet, tap a row to copy
cols = [('openGym green', '#A3E635', '163 230 53', 'Buttons, highlights, the word Gym'),
        ('Ink', '#0C0E12', '12 14 18', 'Backgrounds, text on green'),
        ('Light', '#EEF1F6', '238 241 246', 'Text on dark'),
        ('Dark text', '#12151B', '18 21 27', 'Text on light'),
        ('Green on light', '#4D7C0F', '77 124 15', 'Green text on white, 5 to 1'),
        ('Surface', '#1B1F26', '27 31 38', 'Panels on ink'),
        ('Muted', '#8B919C', '139 145 156', 'Captions and notes')]
rows = ''.join(f'''<li><button type="button" class="bk-row" data-copy="{h}"><i style="background:{h}"></i><span class="bk-row-name">{n}<small>{u}</small></span><span class="bk-row-hex">{h}<small>RGB {r}</small></span><em class="bk-copied">Copied</em></button></li>''' for n, h, r, u in cols)
colours = f'''<section id="colours" class="bk-colours" aria-labelledby="colours-h">
  <div class="bk-sheet">
    <div class="bk-ratio" aria-hidden="true"><span style="flex:7;background:#0c0e12"></span><span style="flex:2;background:#c9ced8"></span><span style="flex:1;background:#a3e635"></span></div>
    <h2 id="colours-h">One green, lots of dark</h2>
    <p class="bk-sheet-note">Roughly 70 ink, 20 light, 10 green. Tap a colour to copy it.</p>
    <ul class="bk-rows">{rows}</ul>
    <p class="bk-sheet-foot">Also as <a href="{K}/colors/opengym-colors.css" download>CSS variables</a> and <a href="{K}/colors/opengym-colors.json" download>JSON</a>. Green text on white uses #4D7C0F: the bright green is for shapes there, never for words.</p>
  </div>
</section>'''

# ---- icons: a specimen wall of square tiles
tiles = [
    ('svg', 'logo/opengym-mark-green.svg', '#000000', 'Mark, green'),
    ('img', 'icons/opengym-icon-rounded.svg', '#1b1f26', 'App icon'),
    ('svg', 'logo/opengym-mark-black.svg', '#a3e635', 'Mark, black'),
    ('word', 'Gym', '#eef1f6', 'The green half'),
    ('svg', 'logo/opengym-mark-white.svg', '#4d7c0f', 'Mark, white'),
    ('word', '#A3E635', '#0c0e12', 'openGym green'),
    ('img', 'icons/opengym-icon-square.svg', '#eef1f6', 'Icon, square master'),
    ('tiny', '', '#1b1f26', 'At 16 px'),
]
def tile(kind, f, bg, cap):
    ink = '#0c0e12' if bg in ('#a3e635', '#eef1f6') else '#eef1f6'
    if kind == 'word':
        inner = f'<b style="color:#a3e635">{f}</b>' if bg != '#eef1f6' else f'<b style="color:#4d7c0f">{f}</b>'
        href = f'{K}/colors/opengym-colors.css' if f.startswith('#') else f'{K}/logo/opengym-logo-for-dark-backgrounds.svg'
    elif kind == 'tiny':
        inner = '<span class="bk-tiny">' + mark() + mark() + mark() + '</span>'
        href = f'{K}/icons/opengym-icon-rounded-180.png'
    else:
        inner = f'<img src="{K}/{f}" alt="" loading="lazy" width="352" height="174">'
        href = f'{K}/{f}'
    cls = ' bk-tile-icon' if 'icons/' in f else ''
    return f'<a class="bk-tile{cls}" href="{href}" download style="background:{bg};color:{ink}">{inner}<span class="bk-tile-cap">{cap}</span></a>'
icons = f'''<section id="icons" class="bk-icons" aria-labelledby="icons-h">
  <div class="bk-icons-head"><h2 id="icons-h">The mark, small and large</h2>
  <p>Five rectangles on a 352 by 174 grid, square corners. Tap a tile to download it; every size and format is in the ZIP.</p></div>
  <div class="bk-wall">{"".join(tile(*t) for t in tiles)}</div>
</section>'''

# ---- banners: index with preview
bn = [('opengym-social-1200x630', 'Social share', '1200 × 630'), ('opengym-github-1280x640', 'GitHub preview', '1280 × 640'),
      ('opengym-discord-960x540', 'Discord', '960 × 540'), ('opengym-x-header-1500x500', 'X header', '1500 × 500'),
      ('opengym-linkedin-1584x396', 'LinkedIn', '1584 × 396'), ('opengym-youtube-2560x1440', 'YouTube', '2560 × 1440'),
      ('opengym-wallpaper-desktop-2560x1440', 'Desktop wallpaper', '2560 × 1440'), ('opengym-wallpaper-phone-1170x2532', 'Phone wallpaper', '1170 × 2532')]
def dims(f):
    im = Image.open(f'{W}/brand/preview/{f}.webp'); return im.width, im.height
rows_b = ''.join(f'''<li><a class="bk-ix-row" href="{K}/banners/{f}.png" download data-preview="brand/preview/{f}.webp">
  <span class="bk-ix-name">{t}</span><span class="bk-ix-size">{s}</span>
  <img class="bk-ix-thumb" src="brand/preview/{f}.webp" alt="{t} banner, {s}" loading="lazy" width="{dims(f)[0]}" height="{dims(f)[1]}"></a></li>''' for f, t, s in bn)
banners = f'''<section id="banners" class="bk-banners" aria-labelledby="banners-h">
  <h2 id="banners-h">Banners, ready to post</h2>
  <div class="bk-ix">
    <ul class="bk-ix-list">{rows_b}</ul>
    <div class="bk-ix-frame" aria-hidden="true"><img alt="" src="brand/preview/{bn[0][0]}.webp" width="880" height="462"></div>
  </div>
</section>'''

# ---- using it: accent field, the rules and the one action
use = f'''<section id="use" class="bk-use" aria-labelledby="use-h">
  <div class="bk-use-text">
    <h2 id="use-h">Use it well</h2>
    <p>Free for articles, videos, community projects and integrations. Please don't make it look like openGym made or endorses your product.</p>
  </div>
  <div class="bk-rules">
    <div><h3>Do</h3><ul>
      <li>Use the files as they are.</li><li>Keep the green "Gym" and the square corners.</li>
      <li>Leave half the mark's height free around it.</li><li>Spell it openGym: lower-case o, capital G.</li></ul></div>
    <div><h3>Please don't</h3><ul>
      <li>Stretch, rotate or redraw it.</li><li>Recolour it or use another green.</li>
      <li>Type it out in another font.</li><li>Add shadows, glows or outlines.</li></ul></div>
    <a class="bk-btn bk-btn-ink" href="{K}/opengym-brand-kit.zip" download>Download everything <small>ZIP, 4 MB</small></a>
  </div>
</section>
<div class="bk-close" aria-hidden="true">{mark("bk-close-mark")}</div>'''

main = f'<main id="main" class="bk">\n{hero}\n{logo}\n{colours}\n{icons}\n{banners}\n{use}\n</main>'
foot = foot.replace('<a href="about.html">About</a>', '<a href="about.html">About</a>\n    <a href="brand.html">Brand</a>')
foot = foot.replace('</body>', '<script src="brand/brand.js?v=2" defer></script>\n</body>')
open(f'{W}/brand.html', 'w').write(head + main + foot)
print('brand.html written')
