#!/usr/bin/env python3
"""openGym brand guidelines: the full handbook as print HTML (A4 portrait, Inter, same document style
as the HQ weekly report). render-book.mjs prints it to website/brand/kit/opengym-brand-guidelines.pdf.

  INTER_DIR=/path/with/inter-latin-{400,600,700}.woff2 python3 scripts/brand/book.py <kit-dir> > book.html
"""
import base64, os, re, sys

KIT = sys.argv[1] if len(sys.argv) > 1 else 'website/brand/kit'
INTER = os.environ.get('INTER_DIR', '')
VERSION, DATE = '1.0', '9 November 2026'
GREEN, INK, LIGHT, DARK, ONL, SURF, MUTED = '#a3e635', '#0c0e12', '#eef1f6', '#12151b', '#4d7c0f', '#1b1f26', '#8b919c'

def fonts():
    out = []
    for w in (400, 600, 700):
        f = os.path.join(INTER, f'inter-latin-{w}.woff2')
        if os.path.exists(f):
            out.append(f'@font-face{{font-family:Inter;font-weight:{w};src:url(data:font/woff2;base64,{base64.b64encode(open(f, "rb").read()).decode()}) format("woff2")}}')
    return '\n'.join(out)

def svg(name, extra=''):
    s = open(os.path.join(KIT, name)).read()
    return re.sub(r'width="[^"]*"\s*height="[^"]*"', f'width="100%" {extra}', s, count=1)

RECTS = '<rect x="80" y="242" width="352" height="28"/><rect x="80" y="199" width="36" height="114"/><rect x="131" y="169" width="47" height="174"/><rect x="334" y="169" width="47" height="174"/><rect x="396" y="199" width="36" height="114"/>'
def mark(c, w='100%', style=''):
    return f'<svg viewBox="80 169 352 174" width="{w}" style="display:block;{style}"><g fill="{c}">{RECTS}</g></svg>'
def img(path, style=''):
    return f'<img src="{path}" style="display:block;{style}">'

CSS = fonts() + f'''
@page {{ size: A4; margin: 18mm 16mm 18mm;
  @top-left {{ content: "openGym brand guidelines"; font: 600 7pt/1 Inter, sans-serif; color: #9aa0ad; letter-spacing: .02em; }}
  @top-right {{ content: "Version {VERSION} · {DATE}"; font: 7pt/1 Inter, sans-serif; color: #9aa0ad; }}
  @bottom-left {{ content: "opengym.ch/brand"; font: 7pt/1 Inter, sans-serif; color: #9aa0ad; }}
  @bottom-right {{ content: "Page " counter(page) " of " counter(pages); font: 7pt/1 Inter, sans-serif; color: #9aa0ad; }} }}
@page cover {{ size: A4; margin: 0; @top-left {{ content: none }} @top-right {{ content: none }} @bottom-left {{ content: none }} @bottom-right {{ content: none }} }}
@page chapter {{ size: A4; margin: 0; @top-left {{ content: none }} @top-right {{ content: none }} @bottom-left {{ content: none }} @bottom-right {{ content: none }} }}
:root {{ --ink:#15171c; --ink-2:#3b404b; --muted:#6b7180; --faint:#9aa0ad; --rule:#e3e6ec; --rule-soft:#eff1f5; --tint:#f6f7f9; --lime:{GREEN}; --lime-ink:{ONL}; }}
* {{ box-sizing: border-box; }}
html {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
body {{ margin: 0; color: var(--ink); font: 9.2pt/1.55 Inter, sans-serif; font-variant-numeric: tabular-nums; }}
.cover {{ page: cover; width: 100vw; height: 100vh; background: {INK}; color: {LIGHT}; position: relative; overflow: hidden; break-after: page; }}
.chap {{ page: chapter; width: 100vw; height: 100vh; background: {INK}; color: {LIGHT}; position: relative; overflow: hidden; break-before: page; break-after: page; }}
.page {{ break-before: page; }}
.flow {{ margin-bottom: 16pt; }}
.sec {{ break-after: avoid; }} .lead {{ break-after: avoid; }} h3 {{ break-after: avoid; }}
table {{ break-inside: auto; }} tr {{ break-inside: avoid; }}
.keep {{ break-inside: avoid; }}
h1 {{ font-size: 26pt; line-height: 1.08; letter-spacing: -.03em; margin: 0 0 6pt; font-weight: 700; }}
h2 {{ font-size: 15pt; letter-spacing: -.02em; margin: 0 0 4pt; font-weight: 700; line-height: 1.2; }}
h3 {{ font-size: 10pt; margin: 14pt 0 4pt; font-weight: 700; }}
p {{ margin: 0 0 6pt; max-width: 150mm; }}
.lead {{ font-size: 11pt; color: var(--ink-2); line-height: 1.5; margin-bottom: 10pt; }}
.sec {{ display: flex; align-items: baseline; gap: 8pt; border-bottom: 1.5px solid var(--ink); padding-bottom: 5pt; margin: 0 0 12pt; }}
.sec .n {{ font-size: 8pt; font-weight: 700; color: var(--lime-ink); letter-spacing: .08em; }}
.sec + .lead {{ margin-top: -4pt; }}
.kicker {{ font-size: 7pt; letter-spacing: .12em; text-transform: uppercase; color: var(--lime-ink); font-weight: 700; }}
.muted {{ color: var(--muted); }} .small {{ font-size: 7.6pt; }}
table {{ width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; }}
th {{ text-align: left; font-size: 6.6pt; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); font-weight: 700; padding: 3pt 8pt 3pt 0; border-bottom: 1px solid var(--rule); }}
td {{ padding: 4pt 8pt 4pt 0; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }}
td b {{ font-weight: 600; }}
.grid2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10pt 14pt; }}
.grid3 {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 8pt; }}
.grid4 {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 7pt; }}
.panel {{ border-radius: 4pt; display: flex; align-items: center; justify-content: center; padding: 12pt; }}
.cap {{ font-size: 7.4pt; color: var(--muted); margin-top: 3pt; line-height: 1.35; }}
.cap b {{ color: var(--ink); font-weight: 600; }}
.sw {{ border-radius: 4pt; height: 30mm; padding: 6pt 8pt; display: flex; flex-direction: column; justify-content: flex-end; font-size: 7.4pt; line-height: 1.35; }}
.sw b {{ font-size: 9.5pt; }}
.no {{ position: relative; overflow: hidden; }}
.no::after {{ content: ""; position: absolute; inset: 0; background: linear-gradient(to top right, transparent calc(50% - .5pt), #c2253c calc(50% - .5pt), #c2253c calc(50% + .5pt), transparent calc(50% + .5pt)); }}
.ok {{ font-size: 7pt; font-weight: 700; color: var(--lime-ink); }} .bad {{ font-size: 7pt; font-weight: 700; color: #c2253c; }}
.toc td {{ font-size: 10pt; padding: 5pt 8pt 5pt 0; }} .toc td.n {{ width: 12mm; color: var(--lime-ink); font-weight: 700; }}
.toc td.p {{ text-align: right; color: var(--muted); width: 18mm; }}
.callout {{ background: var(--tint); border-left: 2.5pt solid var(--lime); padding: 7pt 10pt; margin: 8pt 0 12pt; font-size: 8.6pt; }}
.chip {{ display: inline-block; background: var(--tint); padding: 1.5pt 6pt; border-radius: 99px; margin: 0 3pt 3pt 0; font-size: 8pt; }}
'''

P = []
def add(h): P.append(h)
def section(n, title, lead='', new=False):
    add(f'<div class="flow{" page" if new else ""}"><div class="sec"><span class="n">{n}</span><h2>{title}</h2></div>' + (f'<p class="lead">{lead}</p>' if lead else ''))
def end(): add('</div>')
def chapter(n, title, line):
    add(f'''<section class="chap"><div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 22%,rgba(163,230,53,.16),rgba(163,230,53,0) 42%)"></div>
<div style="position:absolute;left:18mm;right:18mm;bottom:28mm"><p style="color:{GREEN};font-weight:700;font-size:11pt;letter-spacing:.06em;margin:0 0 8pt">{n}</p>
<p style="font-size:44pt;font-weight:700;letter-spacing:-.04em;line-height:1;margin:0 0 10pt;max-width:none">{title}</p>
<p style="font-size:12pt;color:#b7bcc6;max-width:120mm;margin:0">{line}</p></div>
<div style="position:absolute;right:18mm;top:20mm;width:22mm;opacity:.9">{mark(GREEN)}</div></section>''')

# ---- cover
add(f'''<section class="cover"><div style="position:absolute;inset:0;background:radial-gradient(circle at 76% 28%,rgba(163,230,53,.2),rgba(163,230,53,0) 46%)"></div>
<div style="position:absolute;left:18mm;top:20mm;width:62mm">{svg('logo/opengym-logo-for-dark-backgrounds.svg')}</div>
<div style="position:absolute;right:-30mm;top:70mm;width:190mm;opacity:.95">{mark(GREEN)}</div>
<div style="position:absolute;left:18mm;right:18mm;bottom:26mm">
<p style="color:{GREEN};font-weight:700;letter-spacing:.12em;font-size:8pt;text-transform:uppercase;margin:0 0 8pt">Brand guidelines</p>
<p style="font-size:46pt;font-weight:700;letter-spacing:-.04em;line-height:.98;margin:0 0 12pt;max-width:none">Your workouts.<br>Your weights.<br><span style="color:{GREEN}">Your data.</span></p>
<p style="font-size:9pt;color:#9aa0ad;margin:0">Version {VERSION} · {DATE} · opengym.ch/brand</p></div></section>''')

# ---- document info + contents
add(f'''<div><div class="sec"><span class="n">00</span><h2>About this document</h2></div>
<p class="lead">This handbook describes how openGym looks, sounds and behaves: the logo, the colours, the type, the app icon, the voice and the way the brand is applied in the apps, on the website and in the stores. It is the reference for everyone who builds, writes about or contributes to openGym.</p>
<div class="grid2"><div><table>
<tr><th colspan="2">Document</th></tr>
<tr><td class="muted">Title</td><td><b>openGym brand guidelines</b></td></tr>
<tr><td class="muted">Version</td><td>{VERSION}</td></tr><tr><td class="muted">Date</td><td>{DATE}</td></tr>
<tr><td class="muted">Owner</td><td>Duarte Santos, openGym maintainer</td></tr>
<tr><td class="muted">Applies to</td><td>Apps (iPhone, Android, Apple Watch, Wear OS, Garmin), website, store listings, social media, print</td></tr>
<tr><td class="muted">Downloads</td><td>opengym.ch/brand</td></tr></table></div>
<div><table><tr><th>Version</th><th>Date</th><th>Change</th></tr>
<tr><td>1.0</td><td>9 Nov 2026</td><td>First complete edition: one green (#A3E635) for logo and interface, outlined wordmark files, design principles, voice.</td></tr></table>
<div class="callout"><b>The one rule.</b> Use the official files from opengym.ch/brand. Never redraw, retype or recolour the logo.</div></div></div>
<h3 style="margin-top:16pt">Contents</h3>
<table class="toc">
<tr><td class="n">01</td><td>Brand foundations</td><td class="muted">Mission, values, personality, audience</td></tr>
<tr><td class="n">02</td><td>Logo</td><td class="muted">Construction, proportions, clear space, sizes, versions, misuse</td></tr>
<tr><td class="n">03</td><td>Colour</td><td class="muted">Palette, specifications, contrast, proportions</td></tr>
<tr><td class="n">04</td><td>Typography</td><td class="muted">Wordmark, interface type, scale, numbers</td></tr>
<tr><td class="n">05</td><td>Icons and platform marks</td><td class="muted">App icon, alternates, notifications, watches</td></tr>
<tr><td class="n">06</td><td>Design principles</td><td class="muted">Interface, motion, performance, accessibility</td></tr>
<tr><td class="n">07</td><td>Imagery</td><td class="muted">Screenshots, exercise media and its licence, photography</td></tr>
<tr><td class="n">08</td><td>Voice and tone</td><td class="muted">How openGym writes, in 25 languages</td></tr>
<tr><td class="n">09</td><td>Applications</td><td class="muted">Stores, banners, social, website, merchandise</td></tr>
<tr><td class="n">10</td><td>Using the brand</td><td class="muted">Permissions, licences, files, contact</td></tr></table></div>''')

# ---- 01 foundations
chapter('01', 'Brand foundations', 'What openGym stands for, and why it looks the way it does.')
section('01.1', 'Mission and promise', 'A free, open-source gym and body-weight tracker that respects the people who use it.')
add('''<div class="grid2"><div><h3>Mission</h3><p>Help people train with a plan and see their progress, without paying a subscription, creating an account or giving their data away.</p>
<h3>Promise</h3><p>Your workouts. Your weights. Your data. Everything stays on the phone or on a server the user runs, nothing is sold, nothing is tracked. The code is public under the AGPL-3.0.</p>
<h3>Positioning</h3><p>openGym is the gym tracker that is as polished as the paid apps and as honest as open source. It is not a social network, not a coaching marketplace and not an advertising product.</p></div>
<div><h3>Audience</h3><table><tr><th>Who</th><th>What they want</th></tr>
<tr><td><b>Lifters</b></td><td>Fast logging between sets, real progression, records, plate maths.</td></tr>
<tr><td><b>Beginners</b></td><td>A ready plan, clear exercise demos, friendly guidance.</td></tr>
<tr><td><b>Privacy-minded people</b></td><td>No account, no tracking, export everything, self-hosting.</td></tr>
<tr><td><b>Contributors</b></td><td>Readable code, translations, a project that ships every two weeks.</td></tr></table></div></div>''')
add('''<h3>Values</h3><div class="grid3">
<div class="panel" style="background:#0c0e12;color:#eef1f6;flex-direction:column;align-items:flex-start;justify-content:flex-end;height:36mm"><b style="font-size:13pt;color:#a3e635">Honest</b><span class="small" style="color:#b7bcc6">We say what the app does and what it does not. No dark patterns, no fake urgency.</span></div>
<div class="panel" style="background:#a3e635;color:#0c0e12;flex-direction:column;align-items:flex-start;justify-content:flex-end;height:36mm"><b style="font-size:13pt">Strong</b><span class="small">Heavy shapes, one loud colour, big numbers. Built for a sweaty hand between two sets.</span></div>
<div class="panel" style="background:#eef1f6;color:#12151b;flex-direction:column;align-items:flex-start;justify-content:flex-end;height:36mm"><b style="font-size:13pt">Calm</b><span class="small">Dark surfaces, lots of space, nothing that moves without a reason.</span></div></div>
<h3>Personality</h3><table><tr><th>openGym is</th><th>openGym is not</th></tr>
<tr><td>A good training partner: direct, encouraging, a little witty</td><td>A drill sergeant, a hype machine, a medical authority</td></tr>
<tr><td>Precise and fast</td><td>Busy, decorated or playful for its own sake</td></tr>
<tr><td>Generous: free, open, exportable</td><td>A funnel to a paid plan</td></tr></table>''')
end()

# ---- 02 logo
chapter('02', 'Logo', 'A barbell from five rectangles, and the word openGym.')
section('02.1', 'The logo', 'The logo is a lockup of the mark and the wordmark. It is the primary signature of openGym and appears once per surface.')
add(f'''<div class="panel keep" style="background:{INK};height:70mm;margin-bottom:8pt"><div style="width:120mm">{svg('logo/opengym-logo-for-dark-backgrounds.svg')}</div></div>
<div class="grid2"><div><h3>The mark</h3><p>A barbell built from five plain rectangles: one bar and four plates. It stands for the one object every gym has. It works alone wherever there is no room for the word: app icons, watch faces, notifications, favicons, avatars.</p></div>
<div><h3>The wordmark</h3><p><b>open</b> in the text colour and <b style="color:{ONL}">Gym</b> in openGym green, set in Liberation Sans Bold. The two colours tell the name's story: an open project about the gym. The spelling is always <b>openGym</b>: lower-case o, capital G, one word.</p></div></div>''')
end()
section('02.2', 'Construction', 'The mark is drawn on a 352 × 174 unit grid from these numbers and nothing else. Corners are square.', new=True)
add(f'''<div class="keep"><div class="panel" style="background:{INK};height:92mm;padding:10pt 16pt">
<svg viewBox="40 128 480 262" width="100%">
<defs><pattern id="gr" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#1f232b" stroke-width=".6"/></pattern></defs>
<rect x="40" y="128" width="480" height="262" fill="url(#gr)"/>
<g fill="{GREEN}">{RECTS}</g>
<g stroke="#8b919c" stroke-width=".8" fill="none"><path d="M80 150H432M80 146v8M432 146v8"/><path d="M455 169V343M451 169h8M451 343h8"/><path d="M475 199V313M471 199h8M471 313h8"/><path d="M80 362H116M80 358v8M116 358v8"/><path d="M131 362H178M131 358v8M178 358v8"/><path d="M116 380H131M116 376v8M131 376v8"/></g>
<g fill="#b7bcc6" font-family="Inter" font-size="10"><text x="256" y="144" text-anchor="middle">352</text><text x="460" y="232">174</text><text x="480" y="292">114</text>
<text x="98" y="375" text-anchor="middle">36</text><text x="154" y="375" text-anchor="middle">47</text><text x="138" y="393">15</text><text x="256" y="261" text-anchor="middle" fill="#0c0e12" font-weight="700">bar 352 × 28</text></g></svg></div>
<table><tr><th>Element</th><th>Width</th><th>Height</th><th>Position (from the left)</th></tr>
<tr><td><b>Bar</b></td><td>352</td><td>28</td><td>0, centred vertically</td></tr>
<tr><td><b>Outer plates</b></td><td>36</td><td>114</td><td>0 and 316</td></tr>
<tr><td><b>Inner plates</b></td><td>47</td><td>174</td><td>51 and 254, 15 units from the outer plates</td></tr></table></div>
<p class="small muted">Everything is centred on the bar. The mark is symmetrical on both axes. Source file: assets/logo/opengym-mark.svg in the repository.</p>''')
end()
section('02.3', 'Lockup proportions', 'The relation between mark and wordmark is fixed. Use the files; these numbers are for checking and for rare rebuilds by the maintainers.')
add(f'''<div class="panel keep" style="background:#f6f7f9;height:56mm;margin-bottom:8pt"><div style="width:130mm">{svg('logo/opengym-logo-for-light-backgrounds.svg')}</div></div>
<table class="keep"><tr><th>Measure</th><th>Value</th><th>In the files (type size 112)</th></tr>
<tr><td><b>Mark height</b></td><td>1.07 × the type size</td><td>120 units</td></tr>
<tr><td><b>Gap between mark and word</b></td><td>0.2 × the type size</td><td>23 units</td></tr>
<tr><td><b>Vertical position</b></td><td>The mark's centre sits 0.36 × the type size above the baseline</td><td>40 units</td></tr>
<tr><td><b>Wordmark</b></td><td>Liberation Sans Bold, weight 700, letter spacing -0.036 em (-4 at 112)</td><td>Outlined in every file</td></tr></table>''')
end()
section('02.4', 'Clear space and minimum size')
add(f'''<div class="grid2"><div><h3>Clear space</h3><p>Leave half the height of the mark free on every side. No text, edge, picture or other logo goes inside it. The official files already include this space.</p>
<div class="panel" style="background:{INK};height:46mm;padding:0"><div style="position:relative;width:92mm">{svg('logo/opengym-logo-dark.svg')}<div style="position:absolute;inset:0;outline:.6pt dashed rgba(163,230,53,.8);outline-offset:-6.1mm"></div></div></div>
<p class="cap">The dashed line marks the logo; the dark area around it is the clear space.</p></div>
<div><h3>Minimum size</h3><table><tr><th>Element</th><th>Screen</th><th>Print</th></tr>
<tr><td><b>Logo (lockup)</b></td><td>120 px wide</td><td>30 mm wide</td></tr>
<tr><td><b>Mark alone</b></td><td>16 px wide</td><td>6 mm wide</td></tr>
<tr><td><b>App icon</b></td><td>29 px (iOS Settings)</td><td>8 mm</td></tr></table>
<div style="display:flex;align-items:center;gap:12pt;margin-top:10pt"><div style="width:30mm">{svg('logo/opengym-logo-for-light-backgrounds.svg')}</div><span class="cap">30 mm</span><div style="width:6mm">{mark(GREEN)}</div><span class="cap">6 mm</span></div>
<p class="small muted" style="margin-top:8pt">Below these sizes, use the mark alone. At 16 px and smaller the outer plates may merge with the bar; that is acceptable for favicons only.</p></div></div>''')
end()
section('02.5', 'Logo versions', 'Six versions cover every background. Pick by the background, not by taste.')
vers = [('logo/opengym-logo-dark.svg', INK, 'Dark (default)', 'opengym-logo-dark', 'Ink background built in. First choice.'),
        ('logo/opengym-logo-light.svg', '#ffffff', 'Light', 'opengym-logo-light', 'White background built in.'),
        ('logo/opengym-logo-for-dark-backgrounds.svg', '#2b3340', 'Transparent, for dark', 'opengym-logo-for-dark-backgrounds', 'Your own dark backgrounds.'),
        ('logo/opengym-logo-for-light-backgrounds.svg', '#eef1f6', 'Transparent, for light', 'opengym-logo-for-light-backgrounds', 'Your own light backgrounds.'),
        ('logo/opengym-logo-white.svg', ONL, 'All white', 'opengym-logo-white', 'One colour, coloured backgrounds.'),
        ('logo/opengym-logo-black.svg', GREEN, 'All black', 'opengym-logo-black', 'One colour, and on openGym green.')]
add('<div class="grid2">' + ''.join(f'<div class="keep"><div class="panel" style="background:{bg};height:30mm;border:.5pt solid #e3e6ec"><div style="width:62mm">{svg(f)}</div></div><p class="cap"><b>{t}</b> · {d}<br>{fn}.svg / .png</p></div>' for f, bg, t, fn, d in vers) + '</div>')
end()
section('02.6', 'Backgrounds')
add('''<table><tr><th>Background</th><th>Use</th><th>Why</th></tr>
<tr><td><b>Ink, black, dark grey</b></td><td>Dark logo or transparent for dark</td><td>The home ground of the brand. Highest contrast for the green.</td></tr>
<tr><td><b>White, light grey</b></td><td>Light logo or transparent for light</td><td>"open" turns dark #12151B; "Gym" stays green as a shape.</td></tr>
<tr><td><b>openGym green</b></td><td>All black</td><td>Green on green disappears.</td></tr>
<tr><td><b>Other colours</b></td><td>All white or all black, whichever has more contrast</td><td>The two-colour logo fights other colours.</td></tr>
<tr><td><b>Photographs</b></td><td>The dark logo, on its own ink plate</td><td>A busy picture must never cut through the letters.</td></tr></table>''')
add(f'''<div class="grid4" style="margin-top:6pt">
<div><div class="panel" style="background:#000;height:22mm"><div style="width:34mm">{svg('logo/opengym-logo-for-dark-backgrounds.svg')}</div></div><p class="ok">✓ Dark</p></div>
<div><div class="panel" style="background:#fff;height:22mm;border:.5pt solid #e3e6ec"><div style="width:34mm">{svg('logo/opengym-logo-for-light-backgrounds.svg')}</div></div><p class="ok">✓ Light</p></div>
<div><div class="panel" style="background:{GREEN};height:22mm"><div style="width:34mm">{svg('logo/opengym-logo-black.svg')}</div></div><p class="ok">✓ On green: all black</p></div>
<div><div class="panel no" style="background:{GREEN};height:22mm"><div style="width:34mm">{svg('logo/opengym-logo-for-light-backgrounds.svg')}</div></div><p class="bad">✗ Green on green</p></div></div>''')
end()
section('02.7', 'Misuse', 'These changes break the logo. They apply to every version and every size.')
L = 'logo/opengym-logo-for-light-backgrounds.svg'
d = [(f'<div style="width:30mm;transform:scaleX(1.4)">{svg(L)}</div>', 'Stretch or squash'),
     (f'<div style="width:36mm">{svg(L).replace(GREEN, "#30d158")}</div>', 'Use another green'),
     (f'<div style="width:20mm"><svg viewBox="80 169 352 174"><g fill="{GREEN}"><rect x="80" y="242" width="352" height="28" rx="14"/><rect x="80" y="199" width="36" height="114" rx="16"/><rect x="131" y="169" width="47" height="174" rx="20"/><rect x="334" y="169" width="47" height="174" rx="20"/><rect x="396" y="199" width="36" height="114" rx="16"/></g></svg></div>', 'Round the corners or redraw'),
     (f'<p style="font:700 16pt Georgia,serif;margin:0">OpenGym</p>', 'Retype it or change the spelling'),
     (f'<div style="width:36mm;transform:rotate(-12deg)">{svg(L)}</div>', 'Rotate it'),
     (f'<div style="width:36mm;filter:drop-shadow(1.5mm 1.5mm 1mm rgba(0,0,0,.45))">{svg(L)}</div>', 'Add shadows, glows or outlines'),
     (f'<div style="background:linear-gradient(135deg,#a3e635,#22c55e,#0ea5e9);padding:3mm;border-radius:2mm"><div style="width:32mm">{svg("logo/opengym-logo-for-dark-backgrounds.svg")}</div></div>', 'Busy or colourful backgrounds'),
     (f'<div style="display:flex;align-items:center;gap:5mm"><div style="width:14mm">{mark(GREEN)}</div><p style="font:700 12pt Inter;margin:0">open<span style="color:{GREEN}">Gym</span></p></div>', 'Change spacing or proportions')]
add('<div class="grid4">' + ''.join(f'<div class="keep"><div class="panel no" style="background:#f6f7f9;height:26mm">{x}</div><p class="cap">{t}</p></div>' for x, t in d) + '</div>')
add('''<h3>Co-branding</h3><p>Next to another logo, openGym keeps its clear space and is never larger or smaller than the partner logo by more than a third. Separate the two with space, never with a line. Do not combine the mark with another symbol into a new sign.</p>''')
end()

# ---- 03 colour
chapter('03', 'Colour', 'One green, lots of dark.')
section('03.1', 'Palette', 'openGym green carries the brand. Everything else is ink, light and grey, so the green always means something.')
cols = [('openGym green', '#A3E635', '163 230 53', 'C35 M0 Y90 K0', INK, 'Buttons, highlights, the word Gym, active states, charts'),
        ('Ink', '#0C0E12', '12 14 18', 'C60 M40 Y40 K100', LIGHT, 'Backgrounds, text on green'),
        ('Light', '#EEF1F6', '238 241 246', 'C4 M2 Y0 K2', DARK, 'Text on dark, light surfaces'),
        ('Dark text', '#12151B', '18 21 27', 'C70 M55 Y40 K90', LIGHT, 'Text and "open" on light'),
        ('Green on light', '#4D7C0F', '77 124 15', 'C70 M20 Y100 K35', '#ffffff', 'Green text and links on white'),
        ('Surface', '#1B1F26', '27 31 38', 'C75 M60 Y45 K75', LIGHT, 'Cards and panels on ink'),
        ('Muted', '#8B919C', '139 145 156', 'C45 M35 Y28 K5', INK, 'Captions, secondary text on dark')]
add('<div class="grid4" style="margin-bottom:8pt">' + ''.join(f'<div class="sw keep" style="background:{h};color:{ink};{"border:.5pt solid #e3e6ec;" if h in ("#EEF1F6",) else ""}"><b>{n}</b>{h}</div>' for n, h, r, c, ink, u in cols[:4]) + '</div>')
add('<div class="grid3" style="margin-bottom:10pt">' + ''.join(f'<div class="sw keep" style="background:{h};color:{ink};height:20mm"><b>{n}</b>{h}</div>' for n, h, r, c, ink, u in cols[4:]) + '</div>')
add('<table class="keep"><tr><th>Name</th><th>HEX</th><th>RGB</th><th>CMYK (print)</th><th>Use</th></tr>' + ''.join(f'<tr><td><b>{n}</b></td><td>{h}</td><td>{r}</td><td>{c}</td><td>{u}</td></tr>' for n, h, r, c, ink, u in cols) + '</table>')
add('<p class="small muted">CMYK values are starting points for coated paper; openGym green is outside the CMYK gamut and prints slightly duller. Always ask for a proof. On screens, HEX is the reference.</p>')
end()
section('03.2', 'Contrast and accessibility', 'Every text colour pair meets WCAG 2.2 AA (4.5 : 1 for text, 3 : 1 for large text and shapes).')
add('''<table><tr><th>Foreground</th><th>Background</th><th>Contrast</th><th>Rating</th><th>Use</th></tr>
<tr><td><b>Light #EEF1F6</b></td><td>Ink #0C0E12</td><td>17.1 : 1</td><td>AAA</td><td>Body text on dark</td></tr>
<tr><td><b>openGym green</b></td><td>Ink #0C0E12</td><td>12.8 : 1</td><td>AAA</td><td>Highlights, green text on dark</td></tr>
<tr><td><b>Ink #0C0E12</b></td><td>openGym green</td><td>12.8 : 1</td><td>AAA</td><td>Text on green buttons (never white)</td></tr>
<tr><td><b>Muted #8B919C</b></td><td>Ink #0C0E12</td><td>6.1 : 1</td><td>AA</td><td>Captions on dark</td></tr>
<tr><td><b>Dark text #12151B</b></td><td>White</td><td>18.3 : 1</td><td>AAA</td><td>Body text on light</td></tr>
<tr><td><b>Green on light #4D7C0F</b></td><td>White</td><td>5.0 : 1</td><td>AA</td><td>Green text and links on light</td></tr>
<tr><td><b>openGym green</b></td><td>White</td><td>1.5 : 1</td><td class="bad">Fails</td><td>Shapes only, never text</td></tr></table>
<div class="callout">White text on openGym green fails contrast (1.5 : 1). Text on a green button is always ink.</div>''')
add(f'''<h3>Proportions</h3><div style="display:flex;height:14mm;border-radius:3pt;overflow:hidden;margin:4pt 0 4pt"><div style="flex:7;background:{INK};color:{LIGHT};padding:3pt 6pt;font-size:7.5pt">Ink 70 %</div><div style="flex:2;background:#d6dbe4;padding:3pt 6pt;font-size:7.5pt">Light and grey 20 %</div><div style="flex:1;background:{GREEN};padding:3pt 6pt;font-size:7.5pt">Green 10 %</div></div>
<p>Green is a signal. If everything is green, nothing is. In the app, people may choose their own accent colour; the logo, the app icon and every brand surface stay openGym green. New installs start with openGym green.</p>''')
end()

# ---- 04 type
chapter('04', 'Typography', 'Big numbers, short words.')
section('04.1', 'Typefaces')
add('''<table><tr><th>Role</th><th>Typeface</th><th>Where</th></tr>
<tr><td><b>Wordmark</b></td><td>Liberation Sans Bold (outlined in the logo files)</td><td>Only inside the logo. Never type the logo out.</td></tr>
<tr><td><b>Interface</b></td><td>The platform's own font: SF Pro (Apple), Roboto (Android, Wear OS), Segoe UI (Windows)</td><td>Apps and the website. Native, fast, nothing to download.</td></tr>
<tr><td><b>Documents and graphics</b></td><td>Inter (documents, reports), Roboto (store graphics, banners)</td><td>PDFs, slides, banners rendered as images.</td></tr>
<tr><td><b>Garmin</b></td><td>The watch's built-in fonts</td><td>Memory on the watch is too small for custom fonts.</td></tr></table>''')
add('''<h3>Type scale</h3><table><tr><th>Step</th><th>App (pt)</th><th>Website (px)</th><th>Weight</th><th>Tracking</th><th>Use</th></tr>
<tr><td><b>Display</b></td><td>34–48</td><td>52–132 (fluid)</td><td>700</td><td>-0.045 em</td><td>Hero headlines, big numbers</td></tr>
<tr><td><b>Heading</b></td><td>22–28</td><td>32–60 (fluid)</td><td>700</td><td>-0.03 em</td><td>Section titles</td></tr>
<tr><td><b>Lead</b></td><td>17–19</td><td>18–21</td><td>400–600</td><td>0</td><td>Intros, important lines</td></tr>
<tr><td><b>Body</b></td><td>15–17</td><td>16–17</td><td>400</td><td>0</td><td>Running text, line height 1.45–1.6</td></tr>
<tr><td><b>Small</b></td><td>12–13</td><td>13–14</td><td>400–600</td><td>0</td><td>Captions, notes. Never smaller than 12 pt.</td></tr></table>''')
add(f'''<div class="panel keep" style="background:{INK};color:{LIGHT};flex-direction:column;align-items:flex-start;padding:14pt 16pt;margin-top:6pt">
<span style="font-size:40pt;font-weight:700;letter-spacing:-.04em;line-height:1">100 kg × 5</span>
<span style="font-size:17pt;font-weight:700;letter-spacing:-.03em;margin-top:6pt">Your data stays on your phone.</span>
<span style="font-size:10pt;color:#b7bcc6;margin-top:4pt">Plan, log and track your training. Every rep last time. 5 kg more.</span></div>
<h3>Rules</h3><p>Sentence case everywhere, no all-caps headlines. Tabular figures for weights, reps and timers so they don't jump while they change. Few sizes with big steps between them. Left-aligned text; centre at most one moment per screen. Text scales with the phone's text size setting (Dynamic Type, Android font scale).</p>''')
end()

# ---- 05 icons
chapter('05', 'Icons and platform marks', 'The mark, wherever there is no room for the word.')
section('05.1', 'App icon', 'The mark in openGym green on ink, centred, nothing else. The master is square; the stores and phones round the corners themselves.')
add(f'''<div style="display:flex;gap:12pt;align-items:flex-end;margin:6pt 0 10pt">
<div style="width:44mm">{svg('icons/opengym-icon-rounded.svg')}</div><div style="width:26mm">{svg('icons/opengym-icon-rounded.svg')}</div>
<div style="width:14mm">{svg('icons/opengym-icon-rounded.svg')}</div><div style="width:8mm">{svg('icons/opengym-icon-rounded.svg')}</div>
<div style="width:44mm;margin-left:10pt">{svg('icons/opengym-icon-square.svg')}</div></div>
<table><tr><th>Platform</th><th>Format</th><th>Notes</th></tr>
<tr><td><b>iPhone</b></td><td>1024 × 1024 opaque, plus 9 alternate icons</td><td>Alternates (Light, Mono, Neon, Orange, Pink, Sky, Violet, seasonal) are the user's choice in the app.</td></tr>
<tr><td><b>Android</b></td><td>Adaptive icon (foreground + background), monochrome layer</td><td>The mark sits inside the 66 dp safe zone.</td></tr>
<tr><td><b>Apple Watch, Wear OS</b></td><td>Round, mark on ink</td><td>Same mark, brand green.</td></tr>
<tr><td><b>Garmin</b></td><td>70 × 70 launcher, scaled per watch</td><td>Drawn pixel-exact from the mark.</td></tr>
<tr><td><b>Web</b></td><td>favicon.ico 48, PNG 96/180/192/512</td><td>apple-touch-icon is the 180 px square.</td></tr></table>''')
add(f'''<h3>Small marks</h3><div class="grid3">
<div class="keep"><div class="panel" style="background:#2b3340;height:24mm"><div style="width:22mm">{mark('#ffffff')}</div></div><p class="cap"><b>Notification icon</b> · white mark on clear, the system tints it.</p></div>
<div class="keep"><div class="panel" style="background:#000;height:24mm;border-radius:99px;width:24mm;margin:auto"><div style="width:14mm">{mark(GREEN)}</div></div><p class="cap" style="text-align:center"><b>Watch complication</b> · green mark where the face shows colour.</p></div>
<div class="keep"><div class="panel" style="background:{INK};height:24mm"><div style="width:14mm">{mark(GREEN)}</div></div><p class="cap"><b>Dynamic Island, Live Activity</b> · the mark in brand green, never an icon dumbbell.</p></div></div>
<p class="small muted">Content icons (a dumbbell for "workout", a flame for streaks) are interface symbols, not the logo. They may use the user's accent colour.</p>''')
end()

# ---- 06 principles
chapter('06', 'Design principles', 'How openGym feels in the hand.')
section('06.1', 'Principles', 'Inspiration means principles, not copying anyone. openGym always looks like openGym.')
add('''<table><tr><th style="width:20%">Area</th><th style="width:15%">Inspired by</th><th>What it means for openGym</th></tr>
<tr><td><b>Minimalism</b></td><td>Muji</td><td>One accent colour, no decoration without a job. If it can go, it goes.</td></tr>
<tr><td><b>Typography</b></td><td>Pentagram</td><td>Few sizes, a strong headline scale, tight tracking, confident numbers.</td></tr>
<tr><td><b>Interface</b></td><td>Linear</td><td>Dark, precise, calm surfaces separated by tone, fast to operate with one hand.</td></tr>
<tr><td><b>Motion</b></td><td>Apple</td><td>Soft spring motion that explains where things come from and go to.</td></tr>
<tr><td><b>Micro-interactions</b></td><td>Framer</td><td>Every control answers a press within 100 ms: scale, fill, a haptic tick.</td></tr>
<tr><td><b>Onboarding</b></td><td>Duolingo</td><td>Three friendly steps to the first workout. Ask only what is needed; celebrate the first set.</td></tr>
<tr><td><b>Search and filters</b></td><td>Airbnb</td><td>Filter chips on top, a live result count, results change as you tap.</td></tr>
<tr><td><b>Docs and dashboards</b></td><td>Notion</td><td>Clean side navigation, readable blocks, everything findable.</td></tr>
<tr><td><b>Landing pages</b></td><td>Stripe</td><td>A clear story from top to bottom, the product shown big, generous space.</td></tr></table>''')
add('''<h3>Interface rules</h3><div class="grid2"><div><table>
<tr><td><b>Grid</b></td><td>4 pt base; 16–20 pt screen margins on phones</td></tr>
<tr><td><b>Corners</b></td><td>Interface: 12 / 20 / 28 pt. The logo and mark: always square.</td></tr>
<tr><td><b>Surfaces</b></td><td>Separated by a tone step (ink → surface), not by lines or shadows</td></tr>
<tr><td><b>Touch targets</b></td><td>44 pt minimum, 56 pt for the main workout controls</td></tr></table></div><div><table>
<tr><td><b>Motion</b></td><td>200–400 ms, spring easing; transform and opacity only</td></tr>
<tr><td><b>Reduce motion</b></td><td>Always respected: movement becomes a cross-fade or nothing</td></tr>
<tr><td><b>Dark first</b></td><td>Designed on ink, then checked on light</td></tr>
<tr><td><b>Languages</b></td><td>Layouts hold at 25 languages and the largest text size</td></tr></table></div></div>''')
add('''<h3>Performance and battery</h3><p>A training app runs for an hour with the screen on. No animation loops when nothing changes, no tracking or analytics in the app, images sized for the screen, live widgets and watch updates only when something happens. On the website: static pages, small images (WebP), no third-party scripts beyond self-hosted, cookieless statistics.</p>''')
end()

# ---- 07 imagery
chapter('07', 'Imagery', 'The real app, real exercises, real gyms.')
section('07.1', 'Screenshots and exercise media')
add('''<div class="grid2"><div><h3>Screenshots</h3><p>Show the real app with realistic data: real exercise names, believable weights, a plan that adds up. Dark mode first. Phones without device frames or in a simple dark frame; never with fake hands or 3D tilts. Status bar clean: 9:41, full battery.</p>
<h3>Photography</h3><p>If photos are used: real gyms, real equipment, natural light, dark and calm in tone. No stock smiles, no posed fitness models, no before-and-after bodies. The product is the training, not a body ideal.</p></div>
<div><h3>Exercise media: licence</h3><div class="callout" style="margin-top:0">The exercise animations and pictures are licensed from Gym visual for openGym only.
<ul style="margin:4pt 0 0;padding-left:12pt"><li>Up to 180 × 180 px may appear in the repository, on the website, in the demo and in self-hosted servers.</li>
<li>Higher resolutions only inside the app packages delivered by the app stores.</li>
<li>Never copy them out of openGym, hotlink them, or use them to train or prompt AI.</li>
<li>In marketing material, use them at 180 px at most.</li></ul></div></div></div>''')
end()

# ---- 08 voice
chapter('08', 'Voice and tone', 'Talk like a good training partner.')
section('08.1', 'How openGym writes')
add('''<div class="grid2"><div><table>
<tr><td><b>Human</b></td><td>Short sentences, plain words, "you" and "we".</td></tr>
<tr><td><b>A little witty</b></td><td>A wink, not a stand-up show. Never at the user's expense.</td></tr>
<tr><td><b>Honest</b></td><td>Say what it does. No "revolutionary", no fake urgency, no dark patterns.</td></tr>
<tr><td><b>Encouraging</b></td><td>Celebrate progress, never shame a missed day.</td></tr>
<tr><td><b>Short</b></td><td>Release notes and replies: one or two sentences where that is enough.</td></tr></table></div>
<div><h3>Like this</h3><span class="chip">Heavier than ever. No pressure.</span><span class="chip">Every rep last time. 5 kg more.</span><span class="chip">Your data stays on your phone.</span><span class="chip">Rest is training too.</span>
<h3>Not like this</h3><span class="chip" style="text-decoration:line-through">Unlock your ultimate fitness potential today!</span><span class="chip" style="text-decoration:line-through">Error 0x81: operation failed</span><span class="chip" style="text-decoration:line-through">You missed 3 workouts.</span></div></div>
<h3>Mechanics</h3><table>
<tr><td><b>Name</b></td><td>openGym, always. Never OpenGym, Opengym or open gym, also at the start of a sentence.</td></tr>
<tr><td><b>Punctuation</b></td><td>No em dashes (—) in app texts, store texts or posts. Use a full stop, a comma or a colon.</td></tr>
<tr><td><b>Case</b></td><td>Sentence case for buttons, titles and menus.</td></tr>
<tr><td><b>Numbers</b></td><td>Digits for weights, reps and times (5 kg, 3 × 10). The user's unit, kg or lb, everywhere.</td></tr>
<tr><td><b>Languages</b></td><td>25 languages. Translations sound native, not translated; a missing word is better than a wrong one.</td></tr></table>''')
end()

# ---- 09 applications
chapter('09', 'Applications', 'The brand in the stores, on social media and in the world.')
section('09.1', 'Formats', 'Every format below is ready-made at opengym.ch/brand.')
add(f'''<div class="grid2" style="margin-bottom:8pt"><div>{img('banners/opengym-social-1200x630.png', 'width:100%;border-radius:3pt')}<p class="cap"><b>Social share</b> · 1200 × 630</p></div>
<div>{img('banners/opengym-github-1280x640.png', 'width:100%;border-radius:3pt')}<p class="cap"><b>GitHub preview</b> · 1280 × 640</p></div>
<div>{img('banners/opengym-x-header-1500x500.png', 'width:100%;border-radius:3pt')}<p class="cap"><b>X header</b> · 1500 × 500</p></div>
<div>{img('banners/opengym-discord-960x540.png', 'width:100%;border-radius:3pt')}<p class="cap"><b>Discord</b> · 960 × 540</p></div></div>
<table class="keep"><tr><th>Where</th><th>Format</th><th>Content</th></tr>
<tr><td><b>App Store</b></td><td>Screenshots 1320 × 2868 (6.9")</td><td>Real screens, one message per screenshot; no "free" claims in captions (review rules).</td></tr>
<tr><td><b>Google Play</b></td><td>Feature graphic 1024 × 500, screenshots</td><td>Logo left, one line, a real screen right.</td></tr>
<tr><td><b>Connect IQ (Garmin)</b></td><td>Hero 1440 × 720, cover 500 × 500, screens &lt; 150 KB</td><td>Watch screens from the simulator, brand green.</td></tr>
<tr><td><b>Social and community</b></td><td>See the banner set</td><td>LinkedIn 1584 × 396, YouTube 2560 × 1440, wallpapers.</td></tr>
<tr><td><b>Merchandise</b></td><td>Vector files</td><td>Bottle bands and shirts use the one-colour logos; print green as a spot colour where possible.</td></tr></table>''')
end()

# ---- 10 use
chapter('10', 'Using the brand', 'Permissions, licences and contact.')
section('10.1', 'Permissions and licences')
add('''<table><tr><th>You may</th><th>Please don't</th></tr>
<tr><td>Use the logo and banners in articles, videos, talks and reviews about openGym</td><td>Make it look like openGym made, sponsors or endorses your product</td></tr>
<tr><td>Show "works with openGym" for an integration or a self-hosted setup</td><td>Use the name or mark in your product's name, app icon or domain</td></tr>
<tr><td>Use screenshots of the app</td><td>Use the exercise media outside openGym (see 07)</td></tr>
<tr><td>Fork the code under the AGPL-3.0</td><td>Ship a fork under the openGym name or logo; give it its own name</td></tr></table>
<h3>Licences at a glance</h3><table>
<tr><td><b>Source code</b></td><td>AGPL-3.0-or-later (github.com/DuarteSantos8/openGym)</td></tr>
<tr><td><b>Name and logo</b></td><td>Not covered by the code licence. Use as described here.</td></tr>
<tr><td><b>Exercise media</b></td><td>Licensed from Gym visual for openGym only</td></tr></table>
<h3>Files</h3><table>
<tr><td><b>Logo</b></td><td>logo/: dark, light, for dark backgrounds, for light backgrounds, white, black, mark in green, white, black. SVG, PNG and PNG 4×.</td></tr>
<tr><td><b>Icons</b></td><td>icons/: square and rounded app icon, SVG and 1024, 512, 180 px.</td></tr>
<tr><td><b>Colours</b></td><td>colors/: opengym-colors.css (CSS variables) and opengym-colors.json.</td></tr>
<tr><td><b>Banners</b></td><td>banners/: eight formats as PNG.</td></tr></table>
<h3>Contact</h3><p>Questions about the brand or a use not covered here: contact@duarte-santos.ch, or the openGym Discord. When in doubt, ask first. The answer is usually yes.</p>''')
end()

# ---- back cover
add(f'''<section class="chap"><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10mm">
<div style="width:90mm">{svg('logo/opengym-logo-for-dark-backgrounds.svg')}</div>
<p style="color:#9aa0ad;font-size:9pt;margin:0">opengym.ch · github.com/DuarteSantos8/openGym</p></div></section>''')

print(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>openGym brand guidelines</title><style>{CSS}</style></head><body>{"".join(P)}</body></html>')
