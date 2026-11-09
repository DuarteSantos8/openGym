#!/usr/bin/env python3
"""openGym brand guide as HTML (A4 landscape pages); render-guide.mjs prints it to PDF.

  python3 scripts/brand/guide.py <kit-dir> > guide.html
"""
import os, re, sys, base64

KIT = sys.argv[1] if len(sys.argv) > 1 else 'website/brand/kit'
ROBOTO = os.environ.get('ROBOTO', '')


def svg(name, w=None, h=None):
    s = open(os.path.join(KIT, name)).read()
    size = (f'width="{w}"' if w else '') + (f' height="{h}"' if h else '')
    return re.sub(r'width="[^"]*"\s*height="[^"]*"', size or 'width="100%"', s, count=1)


MARK = lambda c, h: f'''<svg viewBox="80 169 352 174" height="{h}" style="display:block"><g fill="{c}">
<rect x="80" y="242" width="352" height="28"/><rect x="80" y="199" width="36" height="114"/>
<rect x="131" y="169" width="47" height="174"/><rect x="334" y="169" width="47" height="174"/>
<rect x="396" y="199" width="36" height="114"/></g></svg>'''

font = f"@font-face{{font-family:R;src:url(data:font/ttf;base64,{base64.b64encode(open(ROBOTO,'rb').read()).decode()});font-weight:100 900}}" if ROBOTO else ''

CSS = font + '''
@page{size:297mm 210mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:R,Roboto,sans-serif;color:#12151b;font-size:10.5pt;line-height:1.5}
.page{width:297mm;height:210mm;padding:16mm 18mm;position:relative;overflow:hidden;page-break-after:always;background:#fff}
.page.dark{background:#0c0e12;color:#eef1f6}
.kicker{font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:#4d7c0f;font-weight:600}
.dark .kicker{color:#a3e635}
h1{font-size:40pt;font-weight:700;letter-spacing:-.035em;line-height:1.02;margin:4mm 0 6mm}
h2{font-size:24pt;font-weight:700;letter-spacing:-.03em;line-height:1.08;margin:3mm 0 5mm}
h3{font-size:11pt;font-weight:700;margin:0 0 1.5mm}
p{max-width:150mm}
.muted{color:#5b616b}.dark .muted{color:#8b919c}
.foot{position:absolute;left:18mm;right:18mm;bottom:9mm;display:flex;justify-content:space-between;font-size:8pt;color:#8b919c}
.grid{display:grid;gap:6mm}
.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.tile{border-radius:3mm;padding:7mm;display:flex;align-items:center;justify-content:center;min-height:38mm}
.cap{font-size:8.5pt;margin-top:2mm}.cap b{font-weight:600}
.sw{border-radius:3mm;height:34mm;padding:4mm;display:flex;flex-direction:column;justify-content:flex-end;font-size:9pt}
.sw b{font-size:11pt}
table{border-collapse:collapse;width:100%;font-size:9.5pt}
td,th{text-align:left;padding:2mm 3mm;border-bottom:.3mm solid #e3e6ea;vertical-align:top}
th{font-weight:600;color:#5b616b;font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em}
.dark td,.dark th{border-color:#23272e}
.no{position:relative}.no:after{content:"";position:absolute;inset:0;background:linear-gradient(to top right,transparent calc(50% - .4mm),#e5484d calc(50% - .4mm),#e5484d calc(50% + .4mm),transparent calc(50% + .4mm))}
.chip{display:inline-block;padding:1mm 3mm;border-radius:99px;background:#f1f3f5;font-size:8.5pt;margin:0 1mm 1mm 0}
'''

GREEN, INK, LIGHT, DARK, ONL = '#a3e635', '#0c0e12', '#eef1f6', '#12151b', '#4d7c0f'
pages = []
n = [0]


def page(content, dark=False, title=''):
    n[0] += 1
    pages.append(f'<section class="page{" dark" if dark else ""}">{content}<div class="foot"><span>openGym brand guide · {title}</span><span>{n[0]}</span></div></section>')


# 1 cover
page(f'''<div style="position:absolute;inset:0;background:radial-gradient(circle at 78% 30%,rgba(163,230,53,.18),rgba(163,230,53,0) 45%)"></div>
<div style="position:relative;height:100%;display:flex;flex-direction:column;justify-content:space-between">
  <div style="width:96mm">{svg('logo/opengym-logo-for-dark-backgrounds.svg')}</div>
  <div><p class="kicker">Brand guide · November 2026</p>
  <h1 style="font-size:54pt">Your workouts.<br>Your weights.<br><span style="color:{GREEN}">Your data.</span></h1>
  <p class="muted">How openGym looks, sounds and moves. Logos, colours, type, icons and banners to download at opengym.ch/brand</p></div>
</div>''', dark=True, title='Cover')

# 2 brand in one page
page(f'''<p class="kicker">The brand</p><h2>A gym tracker that respects you.</h2>
<div class="grid g2" style="margin-top:4mm">
<div><p>openGym is a free, open-source gym and body-weight tracker for iPhone, Android, Apple Watch, Wear OS and Garmin. No subscription, no account needed, no telemetry. The brand says the same thing: honest, calm, strong.</p>
<h3 style="margin-top:7mm">Three words</h3>
<table><tr><td><b>Honest</b></td><td>We say what the app does and what it does not. No dark patterns, no fake urgency.</td></tr>
<tr><td><b>Strong</b></td><td>Heavy shapes, one loud colour, big numbers. Built for a sweaty hand between two sets.</td></tr>
<tr><td><b>Calm</b></td><td>Dark surfaces, lots of space, nothing that moves without a reason.</td></tr></table></div>
<div><h3>The pieces</h3><table>
<tr><th>Element</th><th>What it is</th></tr>
<tr><td>Mark</td><td>A barbell from five plain rectangles. Square corners, never rounded.</td></tr>
<tr><td>Wordmark</td><td>open + <span style="color:{ONL};font-weight:700">Gym</span>, bold. Spelled <b>openGym</b>: lower-case o, capital G, one word.</td></tr>
<tr><td>Colour</td><td>One green, <b>openGym green #A3E635</b>, on ink #0C0E12.</td></tr>
<tr><td>Type</td><td>Liberation Sans Bold in the logo only. The system font everywhere else.</td></tr>
<tr><td>Voice</td><td>Human, short, a little witty.</td></tr></table></div></div>''', title='The brand')

# 3 mark construction
page(f'''<p class="kicker">Logo</p><h2>The mark</h2>
<div class="grid g2"><div class="tile" style="background:{INK};min-height:110mm;position:relative">
<svg viewBox="40 130 470 252" style="width:100%">
<defs><pattern id="g" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#1d2129" stroke-width=".6"/></pattern></defs>
<rect x="40" y="130" width="470" height="252" fill="url(#g)"/>
<g fill="{GREEN}"><rect x="80" y="242" width="352" height="28"/><rect x="80" y="199" width="36" height="114"/><rect x="131" y="169" width="47" height="174"/><rect x="334" y="169" width="47" height="174"/><rect x="396" y="199" width="36" height="114"/></g>
<g stroke="#8b919c" stroke-width=".8" fill="none"><path d="M80 150H432"/><path d="M80 146v8M432 146v8"/><path d="M450 169V343"/><path d="M446 169h8M446 343h8"/></g>
<g fill="#8b919c" font-family="R" font-size="11"><text x="256" y="144" text-anchor="middle">352</text><text x="458" y="260">174</text>
<text x="98" y="365" text-anchor="middle">36</text><text x="154" y="365" text-anchor="middle">47</text><text x="256" y="292" text-anchor="middle">bar 28</text>
<text x="98" y="190" text-anchor="middle">114</text><text x="154" y="162" text-anchor="middle">174</text></g></svg></div>
<div><p>Five rectangles on a 352 × 174 grid: a full-width bar (352 × 28), two outer plates (36 × 114) and two inner plates (47 × 174). Everything is centred on the bar. Corners are square.</p>
<p style="margin-top:4mm">The mark stands for the barbell, the one thing every gym has. It is drawn from these numbers and nothing else: never redraw it, never add collars, handles or rounded plates.</p>
<h3 style="margin-top:7mm">Where the mark is used alone</h3>
<p>App icons, watch faces and complications, notification icons, favicons, social avatars. Anywhere there is no room for the word.</p></div></div>''', title='The mark')

# 4 lockup, clear space, min size
page(f'''<p class="kicker">Logo</p><h2>The logo, its space and its smallest size</h2>
<div class="grid g2"><div>
<div class="tile" style="background:{INK};min-height:62mm;padding:0">
<div style="position:relative;width:118mm">{svg('logo/opengym-logo-dark.svg')}
<div style="position:absolute;inset:0;outline:.4mm dashed rgba(163,230,53,.6);outline-offset:-7.7mm"></div></div></div>
<p class="cap">The dashed line is the logo; the dark area around it is its clear space.</p></div>
<div><table>
<tr><td><b>Proportions</b></td><td>Mark height 1.07 × the type size, 0.2 × the type size away from the word. The mark's centre sits 0.36 × the type size above the baseline.</td></tr>
<tr><td><b>Clear space</b></td><td>Half the height of the mark on every side. Nothing else goes inside it.</td></tr>
<tr><td><b>Smallest size</b></td><td>Logo: 120 px or 30 mm wide. Mark alone: 16 px or 6 mm wide.</td></tr>
<tr><td><b>Wordmark</b></td><td>Liberation Sans Bold, 700, letter spacing -0.036 em. Use the files, which have the letters as outlines. Never type the logo out in another font.</td></tr></table>
<div style="display:flex;gap:6mm;align-items:center;margin-top:8mm"><div style="width:30mm">{svg('logo/opengym-logo-for-light-backgrounds.svg')}</div><span class="muted cap">30 mm</span>
<div style="width:6mm">{MARK(GREEN, '3mm')}</div><span class="muted cap">6 mm</span></div></div></div>''', title='Logo')

# 5 variants
v = [('logo/opengym-logo-dark.svg', INK, 'Logo on dark', 'The default. Ink background, light "open".'),
     ('logo/opengym-logo-light.svg', '#ffffff', 'Logo on light', 'White background, dark "open". Keep the green "Gym".'),
     ('logo/opengym-logo-for-dark-backgrounds.svg', '#2b3340', 'Transparent, for dark', 'For your own dark backgrounds.'),
     ('logo/opengym-logo-for-light-backgrounds.svg', '#f1f3f5', 'Transparent, for light', 'For your own light backgrounds.'),
     ('logo/opengym-logo-white.svg', '#4d7c0f', 'All white', 'One-colour printing, photos with a dark badge, coloured backgrounds.'),
     ('logo/opengym-logo-black.svg', '#d9dde3', 'All black', 'One-colour printing on light paper, engraving, stamps.')]
cells = ''.join(f'<div><div class="tile" style="background:{bg};border:.3mm solid #e3e6ea"><div style="width:62mm">{svg(f)}</div></div><p class="cap"><b>{t}</b> · {d}</p></div>' for f, bg, t, d in v)
page(f'<p class="kicker">Logo</p><h2>Versions</h2><div class="grid g3">{cells}</div>', title='Logo versions')

# 6 colours
page(f'''<p class="kicker">Colour</p><h2>One green. Lots of dark.</h2>
<div class="grid g4" style="margin-top:2mm">
<div class="sw" style="background:{GREEN};color:{INK}"><b>openGym green</b>#A3E635 · RGB 163 230 53</div>
<div class="sw" style="background:{INK};color:{LIGHT}"><b>Ink</b>#0C0E12 · RGB 12 14 18</div>
<div class="sw" style="background:{LIGHT};color:{DARK};border:.3mm solid #e3e6ea"><b>Light</b>#EEF1F6 · RGB 238 241 246</div>
<div class="sw" style="background:{DARK};color:{LIGHT}"><b>Dark text</b>#12151B · RGB 18 21 27</div></div>
<div class="grid g4" style="margin-top:5mm">
<div class="sw" style="background:{ONL};color:#fff;height:22mm"><b>Green on light</b>#4D7C0F</div>
<div class="sw" style="background:#1b1f26;color:{LIGHT};height:22mm"><b>Surface</b>#1B1F26</div>
<div class="sw" style="background:#8b919c;color:{INK};height:22mm"><b>Muted</b>#8B919C</div>
<div class="sw" style="background:#fff;color:{DARK};border:.3mm solid #e3e6ea;height:22mm"><b>White</b>#FFFFFF</div></div>
<table style="margin-top:7mm"><tr><th>Pair</th><th>Contrast</th><th>Use</th></tr>
<tr><td>Green on ink</td><td>12.8 : 1</td><td>Buttons, highlights, the word Gym, charts. Text on a green button is ink, never white.</td></tr>
<tr><td>Light on ink</td><td>17.1 : 1</td><td>Body text on dark.</td></tr>
<tr><td>Green #4D7C0F on white</td><td>5.0 : 1</td><td>Green text and links on light backgrounds. #A3E635 on white is only 1.5 : 1, so use it there for shapes, never for text.</td></tr>
<tr><td>Muted on ink</td><td>6.1 : 1</td><td>Secondary text, captions.</td></tr></table>
<p class="muted cap" style="margin-top:3mm">Roughly 70 % ink, 20 % light and grey, 10 % green. Green is a signal: if everything is green, nothing is. In the app people may pick their own accent colour; the logo always stays openGym green.</p>''', title='Colour')

# 7 type
page(f'''<p class="kicker">Type</p><h2>Big numbers, short words.</h2>
<div class="grid g2"><div>
<p style="font-size:56pt;font-weight:700;letter-spacing:-.04em;line-height:1">100 kg × 5</p>
<p style="font-size:26pt;font-weight:700;letter-spacing:-.03em;line-height:1.1;margin-top:5mm">Your data stays on your phone.</p>
<p style="font-size:13pt;margin-top:5mm">Plan, log and track your training. Body text is regular, 15 to 17 px on screens, with room to breathe.</p>
<p class="muted cap" style="margin-top:3mm">Caption · Muted · 12 to 13 px</p></div>
<div><table>
<tr><td><b>Logo</b></td><td>Liberation Sans Bold, as outlines in the files. Only for the wordmark.</td></tr>
<tr><td><b>Everything else</b></td><td>The device's own font: SF Pro on Apple, Roboto on Android, Segoe UI on Windows. On graphics: Roboto.</td></tr>
<tr><td><b>Headings</b></td><td>Bold 700, letter spacing -0.03 to -0.04 em, tight line height (1.0 to 1.1). Few sizes, big steps between them.</td></tr>
<tr><td><b>Numbers</b></td><td>Tabular figures for weights, reps and timers, so they don't jump while they change.</td></tr>
<tr><td><b>Case</b></td><td>Sentence case everywhere. No ALL CAPS headlines, small spaced caps only for little labels.</td></tr></table></div></div>''', title='Type')

# 8 icons
ic = ''.join(f'<div style="text-align:center"><div style="width:{s}mm;margin:0 auto">{svg("icons/opengym-icon-rounded.svg")}</div><p class="cap muted">{s} mm</p></div>' for s in (40, 24, 14, 8))
page(f'''<p class="kicker">App icon</p><h2>The icon</h2>
<div class="grid g2"><div style="display:flex;gap:8mm;align-items:flex-end">{ic}</div>
<div><p>The mark in openGym green on ink, centred, nothing else. The stores and the phone round the corners themselves, so the master file is square (opengym-icon-square). The rounded version is for places that show it as it is, like websites and slides.</p>
<p style="margin-top:4mm">Alternate app icons in the app (other colours) are the user's choice. Everywhere else, use this one.</p>
<div style="display:flex;gap:5mm;margin-top:8mm;align-items:center">
<div style="width:26mm;background:{INK};border-radius:4mm;padding:5mm 3mm">{MARK(GREEN, '9mm')}</div><span class="cap muted">Watch and notification icons: the mark alone, white or green, on clear.</span></div></div></div>''', title='App icon')

# 9 don'ts
d = [(f'<div style="width:34mm;transform:scaleX(1.45)">{svg("logo/opengym-logo-for-light-backgrounds.svg")}</div>', 'Stretch or squash it'),
     (f'<div style="width:50mm">{svg("logo/opengym-logo-for-light-backgrounds.svg").replace("#a3e635", "#30d158")}</div>', 'Use another green'),
     (f'<div style="width:22mm"><svg viewBox="80 169 352 174"><g fill="{GREEN}"><rect x="80" y="242" width="352" height="28" rx="14"/><rect x="80" y="199" width="36" height="114" rx="14"/><rect x="131" y="169" width="47" height="174" rx="18"/><rect x="334" y="169" width="47" height="174" rx="18"/><rect x="396" y="199" width="36" height="114" rx="14"/></g></svg></div>', 'Round the corners'),
     (f'<p style="font:700 22pt Georgia,serif;color:{DARK}">OpenGym</p>', 'Retype it, change the spelling'),
     (f'<div style="width:50mm;transform:rotate(-12deg)">{svg("logo/opengym-logo-for-light-backgrounds.svg")}</div>', 'Rotate it'),
     (f'<div style="width:50mm;filter:drop-shadow(2mm 2mm 1.5mm rgba(0,0,0,.45))">{svg("logo/opengym-logo-for-light-backgrounds.svg")}</div>', 'Add shadows, glows or outlines'),
     (f'<div style="background:linear-gradient(135deg,#a3e635,#22c55e,#0ea5e9);padding:4mm;border-radius:2mm"><div style="width:46mm">{svg("logo/opengym-logo-for-dark-backgrounds.svg")}</div></div>', 'Put it on busy or colourful backgrounds'),
     (f'<div style="display:flex;align-items:center;gap:6mm"><div style="width:18mm">{MARK(GREEN, "9mm")}</div><p style="font:700 16pt R;color:{DARK}">open<span style="color:{GREEN}">Gym</span></p></div>', 'Change the spacing or the mark size')]
cells = ''.join(f'<div><div class="tile no" style="background:#f6f7f9;min-height:32mm">{x}</div><p class="cap">{t}</p></div>' for x, t in d)
page(f'<p class="kicker">Logo</p><h2>Please don\'t</h2><div class="grid g4">{cells}</div><p class="muted cap" style="margin-top:4mm">On photos and colourful backgrounds, put the logo on an ink badge (a rounded #0C0E12 pill) instead.</p>', title="Don'ts")

# 10 design principles
page(f'''<p class="kicker">Design</p><h2>How openGym feels</h2>
<table><tr><th style="width:22%">Area</th><th style="width:18%">Inspired by</th><th>What it means for us</th></tr>
<tr><td><b>Minimalism</b></td><td>Muji</td><td>One accent colour, no decoration without a job. If it can go, it goes.</td></tr>
<tr><td><b>Typography</b></td><td>Pentagram</td><td>Few sizes, strong headline scale, tight letter spacing, big confident numbers.</td></tr>
<tr><td><b>Interface</b></td><td>Linear</td><td>Dark, precise, thin lines, calm surfaces, fast. Keyboard and one-hand friendly.</td></tr>
<tr><td><b>Motion</b></td><td>Apple</td><td>Soft spring motion that explains where things come from. Everything respects "reduce motion".</td></tr>
<tr><td><b>Micro-interactions</b></td><td>Framer</td><td>Buttons, chips and toggles react on press within 100 ms. Small, quick, never in the way.</td></tr>
<tr><td><b>Onboarding</b></td><td>Duolingo</td><td>Three friendly steps to the first workout. Ask only what's needed, celebrate the first set.</td></tr>
<tr><td><b>Search and filters</b></td><td>Airbnb</td><td>Filter chips on top, a live result count, results change as you tap.</td></tr>
<tr><td><b>Dashboards and docs</b></td><td>Notion</td><td>Clean side navigation, readable blocks, everything findable.</td></tr>
<tr><td><b>Landing pages</b></td><td>Stripe</td><td>A clear story from top to bottom, the product shown big, generous space.</td></tr>
<tr><td><b>Performance</b></td><td>(ours)</td><td>Fast and light on the battery: no needless animation loops, no tracking scripts, images sized for the screen.</td></tr></table>
<p class="muted cap" style="margin-top:3mm">Inspiration means principles, not copying anyone's look. openGym always looks like openGym.</p>''', title='Design principles')

# 11 voice
page(f'''<p class="kicker">Voice</p><h2>Talk like a good training partner.</h2>
<div class="grid g2"><div><table>
<tr><td><b>Human</b></td><td>Short sentences, plain words, "you" and "we".</td></tr>
<tr><td><b>A little witty</b></td><td>A wink, not a stand-up show. Never at the user's expense.</td></tr>
<tr><td><b>Honest</b></td><td>Say what it does. No "revolutionary", no fake urgency.</td></tr>
<tr><td><b>Spelling</b></td><td>openGym, always. No em dashes in app texts or posts: use a full stop, a comma or a colon.</td></tr></table></div>
<div><h3>Like this</h3>
<p class="chip">Heavier than ever. No pressure.</p><p class="chip">Every rep last time. 5 kg more.</p><p class="chip">Your data stays on your phone.</p>
<h3 style="margin-top:6mm">Not like this</h3>
<p class="chip" style="text-decoration:line-through">Unlock your ultimate fitness potential today!</p><p class="chip" style="text-decoration:line-through">Error 0x81: operation failed</p></div></div>''', title='Voice')

# 12 banners + download
page(f'''<p class="kicker">Downloads</p><h2>Everything is at opengym.ch/brand</h2>
<div class="grid g2"><div><img src="banners/opengym-social-1200x630.png" style="width:100%;border-radius:2mm">
<div class="grid g2" style="margin-top:4mm;gap:4mm"><img src="banners/opengym-x-header-1500x500.png" style="width:100%;border-radius:2mm"><img src="banners/opengym-discord-960x540.png" style="width:100%;border-radius:2mm"></div></div>
<div><table>
<tr><td><b>Logos</b></td><td>SVG and PNG: dark, light, transparent, white, black, the mark alone.</td></tr>
<tr><td><b>Icons</b></td><td>Square and rounded, 1024, 512 and 180 px, plus SVG.</td></tr>
<tr><td><b>Banners</b></td><td>Social share 1200×630, GitHub 1280×640, Discord 960×540, X 1500×500, LinkedIn 1584×396, YouTube 2560×1440, wallpapers for desktop and phone.</td></tr>
<tr><td><b>Colours</b></td><td>CSS variables and JSON.</td></tr>
<tr><td><b>Use</b></td><td>Free to use when you write about openGym, link to it or build something for it. Please don't make it look like we made or endorse your product.</td></tr></table></div></div>''', title='Downloads')

print(f'<!doctype html><html><head><meta charset="utf-8"><title>openGym brand guide</title><style>{CSS}</style></head><body>{"".join(pages)}</body></html>')
