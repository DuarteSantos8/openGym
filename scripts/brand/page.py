#!/usr/bin/env python3
"""Builds website/brand.html (opengym.ch/brand): the brand guidelines as a reference page, laid out
like a design guideline site (contents on the left, one reading column, figures, specification
tables, downloads where they belong), inside the site's own shell from about.html.
Styles: website/brand/brand.css. Behaviour: website/brand/brand.js.  Run from the repo root.
"""
import re
from PIL import Image

W, K = 'website', 'brand/kit'
VERSION, UPDATED = '1.0', '9 November 2026'
a = open(f'{W}/about.html').read()
head = a[:a.index('<main id="main"')]
foot = a[a.index('</main>') + len('</main>'):]
head = head.replace('<title>openGym: About</title>', '<title>openGym: Brand guidelines</title>')
head = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="The openGym brand guidelines: logo, colour, type, icons, voice and ready-made banners, with every file to download.">', head)
head = head.replace('content="About openGym"', 'content="openGym brand guidelines"')
head = re.sub(r'<meta property="og:description" content="[^"]*">', '<meta property="og:description" content="Logo, colour, type, icons, voice and banners of openGym, with every file to download.">', head)
head = head.replace('https://opengym.ch/about.html', 'https://opengym.ch/brand')
head = head.replace('<link rel="stylesheet" href="styles.css?v=32">', '<link rel="stylesheet" href="styles.css?v=32">\n<link rel="stylesheet" href="brand/brand.css?v=3">')

TOC = [('overview', 'Overview', []),
       ('logo', 'Logo', [('logo-construction', 'Construction'), ('logo-space', 'Clear space and size'), ('logo-versions', 'Versions'), ('logo-misuse', 'Misuse')]),
       ('colour', 'Colour', [('colour-specs', 'Specifications'), ('colour-contrast', 'Contrast')]),
       ('type', 'Typography', []), ('icons', 'App icon', []), ('imagery', 'Imagery', []), ('voice', 'Voice and tone', []),
       ('banners', 'Banners', []), ('using', 'Using the brand', []), ('changes', 'Change log', [])]
side_old = head[head.index('<p class="side-label">On this page</p>'):head.index('<p class="side-label">More</p>')]
head = head.replace(side_old, '<p class="side-label">On this page</p>\n' + ''.join(f'  <a class="side-link" href="#{i}"><b>{t}</b></a>\n' for i, t, _ in TOC) + '  ')

RECTS = '<rect x="80" y="242" width="352" height="28"/><rect x="80" y="199" width="36" height="114"/><rect x="131" y="169" width="47" height="174"/><rect x="334" y="169" width="47" height="174"/><rect x="396" y="199" width="36" height="114"/>'
def logo(f, alt='openGym logo', w=868, h=238):
    return f'<img src="{K}/logo/{f}.svg" alt="{alt}" width="{w}" height="{h}" loading="lazy">'
def dl(f, kind='logo'):
    if kind == 'logo':
        return f'<span class="bg-dl"><a href="{K}/logo/{f}.svg" download>SVG</a><a href="{K}/logo/{f}.png" download>PNG</a><a href="{K}/logo/{f}@4x.png" download>PNG 4×</a></span>'
    return f'<span class="bg-dl"><a href="{K}/icons/{f}.svg" download>SVG</a><a href="{K}/icons/{f}-1024.png" download>1024</a><a href="{K}/icons/{f}-512.png" download>512</a><a href="{K}/icons/{f}-180.png" download>180</a></span>'
def bp(title, text):
    return f'<p class="bg-bp"><b>{title}</b> {text}</p>'

nav = '<nav class="bg-toc" aria-label="Brand guidelines">' + ''.join(
    f'<a href="#{i}" class="bg-toc-a">{t}</a>' + ''.join(f'<a href="#{si}" class="bg-toc-a bg-toc-sub">{st}</a>' for si, st in subs)
    for i, t, subs in TOC) + f'<div class="bg-toc-dl"><a class="bg-btn" href="{K}/opengym-brand-kit.zip" download>Download the kit</a><a class="bg-more" href="{K}/opengym-brand-guidelines.pdf">Guidelines as PDF</a></div></nav>'

header = f'''<header class="bg-head" id="overview">
  <p class="bg-crumb"><a href="/">openGym</a> <span aria-hidden="true">›</span> Brand</p>
  <h1>Brand guidelines</h1>
  <p class="bg-lead">How openGym looks, sounds and behaves: the logo, colour, type, the app icon and the voice. Use this page when you write about openGym, build something for it or contribute to it. Every file is here to download.</p>
  <div class="bg-actions"><a class="bg-btn" href="{K}/opengym-brand-kit.zip" download>Download the kit <small>ZIP, 4 MB</small></a>
    <a class="bg-btn bg-btn-2" href="{K}/opengym-brand-guidelines.pdf">Guidelines as PDF <small>27 pages</small></a></div>
  <p class="bg-meta">Version {VERSION} · Updated {UPDATED}</p>
  <figure class="bg-fig bg-hero"><div class="bg-hero-stage">{logo('opengym-logo-for-dark-backgrounds', 'The openGym logo: the barbell mark and the word openGym')}</div></figure>
  <div class="bg-values">
    <div><b>Honest</b><span>We say what the app does and what it doesn't. No dark patterns, no fake urgency.</span></div>
    <div><b>Strong</b><span>Heavy shapes, one loud colour, big numbers. Built for a sweaty hand between two sets.</span></div>
    <div><b>Calm</b><span>Dark surfaces, plenty of space, nothing that moves without a reason.</span></div>
  </div>
</header>'''

sec_logo = f'''<section class="bg-sec" id="logo" aria-labelledby="logo-h">
  <h2 id="logo-h">Logo</h2>
  <p class="bg-intro">The logo is the barbell mark and the word openGym, side by side. It is the signature of the project and appears once on each surface.</p>
  {bp('Use the official files.', 'The letters in the files are outlines, so the logo looks the same on every computer. Never retype it, redraw it or rebuild it from parts.')}
  {bp('Keep the two colours.', '"open" takes the text colour of the background, "Gym" is always openGym green. On green and on single-colour backgrounds, use the all-black or all-white version.')}
  {bp('Spell it openGym.', 'Lower-case o, capital G, one word, also at the start of a sentence.')}
  {bp('Use the mark alone where there is no room for the word.', 'App icons, watch faces, notifications, favicons and avatars use the mark by itself.')}

  <h3 id="logo-construction">Construction</h3>
  <p>The mark is drawn on a 352 × 174 grid from five plain rectangles: one bar and four plates, centred on the bar, with square corners.</p>
  <figure class="bg-fig"><div class="bg-panel bg-panel-ink bg-construct">
    <svg viewBox="40 128 480 262" role="img" aria-label="Construction of the mark with its measurements">
      <g fill="#a3e635">{RECTS}</g>
      <g stroke="#8b919c" stroke-width="1" fill="none"><path d="M80 150H432M80 146v8M432 146v8"/><path d="M455 169V343M451 169h8M451 343h8"/><path d="M478 199V313M474 199h8M474 313h8"/><path d="M80 362H116M80 358v8M116 358v8"/><path d="M131 362H178M131 358v8M178 358v8"/></g>
      <g fill="#b7bcc6" font-size="11" font-family="system-ui,sans-serif"><text x="256" y="144" text-anchor="middle">352</text><text x="461" y="236">174</text><text x="484" y="292">114</text>
      <text x="98" y="380" text-anchor="middle">36</text><text x="154" y="380" text-anchor="middle">47</text><text x="256" y="261" text-anchor="middle" fill="#0c0e12" font-weight="700">28</text></g>
    </svg></div><figcaption>The mark on its grid. The gaps between the plates are 15 units.</figcaption></figure>
  <div class="bg-table"><table>
    <thead><tr><th>Element</th><th>Width</th><th>Height</th><th>Notes</th></tr></thead>
    <tbody><tr><td>Bar</td><td>352</td><td>28</td><td>Full width, centred vertically</td></tr>
    <tr><td>Outer plates</td><td>36</td><td>114</td><td>At 0 and 316</td></tr>
    <tr><td>Inner plates</td><td>47</td><td>174</td><td>At 51 and 254</td></tr>
    <tr><td>Mark in the logo</td><td colspan="2">1.07 × type size</td><td>0.2 × type size from the word; centre 0.36 × type size above the baseline</td></tr>
    <tr><td>Wordmark</td><td colspan="2">Liberation Sans Bold</td><td>Weight 700, letter spacing -0.036 em, outlined in every file</td></tr></tbody></table></div>

  <h3 id="logo-space">Clear space and minimum size</h3>
  <p>Leave half the height of the mark free on every side. No text, picture or edge goes inside it; the official files already include this space.</p>
  <figure class="bg-fig"><div class="bg-panel bg-panel-ink bg-space"><div class="bg-space-box">{logo('opengym-logo-dark')}</div></div>
    <figcaption>The outlined area is the logo; the dark area around it is its clear space.</figcaption></figure>
  <div class="bg-table"><table>
    <thead><tr><th>Element</th><th>Screen</th><th>Print</th></tr></thead>
    <tbody><tr><td>Logo</td><td>120 px wide</td><td>30 mm wide</td></tr>
    <tr><td>Mark alone</td><td>16 px wide</td><td>6 mm wide</td></tr>
    <tr><td>App icon</td><td>29 px</td><td>8 mm</td></tr></tbody></table></div>

  <h3 id="logo-versions">Versions</h3>
  <p>Choose the version by the background. Try it: pick a background and the right file appears.</p>
  <figure class="bg-fig bg-picker">
    <div class="bg-stage" data-bg="ink"><img class="bg-stage-photo" src="brand/preview/stage-photo.webp" alt="" width="960" height="960" loading="lazy">
      <img class="bg-stage-logo" src="{K}/logo/opengym-logo-for-dark-backgrounds.svg" alt="The logo version for the chosen background" width="868" height="238"></div>
    <div class="bg-picker-side">
      <div class="bg-tabs" role="tablist" aria-label="Background">
        <button type="button" class="bg-tab" role="tab" aria-selected="true" data-bg="ink" data-file="opengym-logo-for-dark-backgrounds" data-note="Dark backgrounds: &quot;open&quot; is light. The default.">Dark</button>
        <button type="button" class="bg-tab" role="tab" aria-selected="false" data-bg="white" data-file="opengym-logo-for-light-backgrounds" data-note="White and light backgrounds: &quot;open&quot; turns dark, &quot;Gym&quot; stays green.">White</button>
        <button type="button" class="bg-tab" role="tab" aria-selected="false" data-bg="green" data-file="opengym-logo-black" data-note="On openGym green: the all-black version.">Green</button>
        <button type="button" class="bg-tab" role="tab" aria-selected="false" data-bg="photo" data-file="opengym-logo-dark" data-note="On photographs: the dark version on its own ink plate.">Photo</button>
        <button type="button" class="bg-tab" role="tab" aria-selected="false" data-bg="mono" data-file="opengym-logo-white" data-note="Other colours and one-colour print: all white or all black.">Colour</button></div>
      <p class="bg-note" aria-live="polite">Dark backgrounds: "open" is light. The default.</p>
      <span class="bg-dl bg-dl-live"><a data-dl="svg" href="{K}/logo/opengym-logo-for-dark-backgrounds.svg" download>SVG</a><a data-dl="png" href="{K}/logo/opengym-logo-for-dark-backgrounds@4x.png" download>PNG 4×</a></span>
    </div></figure>
  <div class="bg-grid3">''' + ''.join(f'<figure class="bg-card"><div class="bg-panel" style="background:{bg}">{logo(f)}</div><figcaption><b>{t}</b><span>{d}</span>{dl(f)}</figcaption></figure>' for f, bg, t, d in [
    ('opengym-logo-dark', '#0c0e12', 'Dark', 'Ink background included'), ('opengym-logo-light', '#ffffff', 'Light', 'White background included'),
    ('opengym-logo-for-dark-backgrounds', '#262c36', 'For dark backgrounds', 'Transparent'), ('opengym-logo-for-light-backgrounds', '#eef1f6', 'For light backgrounds', 'Transparent'),
    ('opengym-logo-white', '#4d7c0f', 'All white', 'One colour'), ('opengym-logo-black', '#a3e635', 'All black', 'One colour, and on green')]) + '</div><div class="bg-grid3">' + ''.join(
    f'<figure class="bg-card"><div class="bg-panel bg-panel-mark" style="background:{bg}"><img src="{K}/logo/{f}.svg" alt="{t}" width="352" height="174" loading="lazy"></div><figcaption><b>{t}</b>{dl(f)}</figcaption></figure>' for f, bg, t in [
    ('opengym-mark-green', '#0c0e12', 'Mark, green'), ('opengym-mark-white', '#262c36', 'Mark, white'), ('opengym-mark-black', '#eef1f6', 'Mark, black')]) + '</div>'

L = f'{K}/logo/opengym-logo-for-light-backgrounds.svg'
misuse = [(f'<img src="{L}" alt="" style="width:62%;transform:scaleX(1.35)">', 'Don’t stretch or squash it.'),
          (f'<img src="{L}" alt="" style="width:78%;filter:hue-rotate(38deg) saturate(1.4)">', 'Don’t use another green.'),
          (f'<svg viewBox="80 169 352 174" style="width:46%"><g fill="#a3e635"><rect x="80" y="242" width="352" height="28" rx="14"/><rect x="80" y="199" width="36" height="114" rx="16"/><rect x="131" y="169" width="47" height="174" rx="20"/><rect x="334" y="169" width="47" height="174" rx="20"/><rect x="396" y="199" width="36" height="114" rx="16"/></g></svg>', 'Don’t round the corners or redraw it.'),
          ('<span style="font:700 26px Georgia,serif;color:#12151b">OpenGym</span>', 'Don’t retype it or change the spelling.'),
          (f'<img src="{L}" alt="" style="width:76%;transform:rotate(-12deg)">', 'Don’t rotate it.'),
          (f'<img src="{L}" alt="" style="width:76%;filter:drop-shadow(5px 5px 4px rgba(0,0,0,.45))">', 'Don’t add shadows, glows or outlines.'),
          (f'<span style="display:block;width:86%;padding:6%;background:#7c3aed"><img src="{K}/logo/opengym-logo-for-dark-backgrounds.svg" alt="" style="width:100%;display:block"></span>', 'Don’t put the two-colour logo on other colours.'),
          (f'<span style="display:flex;align-items:center;gap:14%;width:80%"><svg viewBox="80 169 352 174" style="width:34%;flex:none"><g fill="#a3e635">{RECTS}</g></svg><b style="font:700 20px system-ui;color:#12151b">open<span style="color:#a3e635">Gym</span></b></span>', 'Don’t change the spacing or sizes.')]
sec_logo += '<h3 id="logo-misuse">Misuse</h3><p>These changes break the logo, at every size and in every version.</p><div class="bg-grid4">' + ''.join(
    f'<figure class="bg-card bg-no"><div class="bg-panel" style="background:#f4f5f7">{x}</div><figcaption><span>{t}</span></figcaption></figure>' for x, t in misuse) + '</div></section>'

cols = [('openGym green', '#A3E635', '163 230 53', 'C35 M0 Y90 K0', '#0c0e12', 'Buttons, highlights, the word Gym'),
        ('Ink', '#0C0E12', '12 14 18', 'C60 M40 Y40 K100', '#eef1f6', 'Backgrounds, text on green'),
        ('Light', '#EEF1F6', '238 241 246', 'C4 M2 Y0 K2', '#12151b', 'Text on dark, light surfaces'),
        ('Dark text', '#12151B', '18 21 27', 'C70 M55 Y40 K90', '#eef1f6', 'Text on light'),
        ('Green on light', '#4D7C0F', '77 124 15', 'C70 M20 Y100 K35', '#ffffff', 'Green text and links on white'),
        ('Surface', '#1B1F26', '27 31 38', 'C75 M60 Y45 K75', '#eef1f6', 'Panels on ink'),
        ('Muted', '#8B919C', '139 145 156', 'C45 M35 Y28 K5', '#0c0e12', 'Captions on dark')]
sec_colour = f'''<section class="bg-sec" id="colour" aria-labelledby="colour-h">
  <h2 id="colour-h">Colour</h2>
  <p class="bg-intro">One green, lots of dark. openGym green carries the brand; everything else is ink, light and grey, so the green always means something.</p>
  {bp('Use green as a signal.', 'Buttons, the active state, a record, the word Gym. If everything is green, nothing is. Roughly 70 % ink, 20 % light and grey, 10 % green.')}
  {bp('Put ink on green, never white.', 'Text on a green button is #0C0E12. White on openGym green is only 1.5 : 1.')}
  {bp('Use the darker green for text on light.', 'On white and light grey, green words and links are #4D7C0F. The bright green stays for shapes there.')}
  {bp('Let people choose their own accent in the app.', 'New installs start with openGym green. The logo, the app icon and every brand surface stay openGym green whatever the user picks.')}
  <div class="bg-ratio" aria-hidden="true"><span style="flex:7;background:#0c0e12"></span><span style="flex:2;background:#c9ced8"></span><span style="flex:1;background:#a3e635"></span></div>
  <div class="bg-swatches">''' + ''.join(f'<button type="button" class="bg-sw" data-copy="{h}" style="background:{h};color:{ink}" aria-label="Copy {n}, {h}"><b>{n}</b><span>{h}</span><em class="bg-copied">Copied</em></button>' for n, h, r, c, ink, u in cols) + f'''</div>
  <h3 id="colour-specs">Specifications</h3>
  <div class="bg-table"><table><thead><tr><th>Name</th><th>HEX</th><th>RGB</th><th>CMYK</th><th>Use</th></tr></thead><tbody>''' + ''.join(
    f'<tr><td><i class="bg-chip" style="background:{h}"></i>{n}</td><td>{h}</td><td>{r}</td><td>{c}</td><td>{u}</td></tr>' for n, h, r, c, ink, u in cols) + f'''</tbody></table></div>
  <p class="bg-small">CMYK values are starting points for coated paper; openGym green lies outside CMYK and prints slightly duller, so always ask for a proof. Also as <a href="{K}/colors/opengym-colors.css" download>CSS variables</a> and <a href="{K}/colors/opengym-colors.json" download>JSON</a>.</p>
  <h3 id="colour-contrast">Contrast</h3>
  <p>Every text pair meets WCAG 2.2 AA.</p>
  <div class="bg-table"><table><thead><tr><th>Text</th><th>Background</th><th>Ratio</th><th>Level</th></tr></thead><tbody>
    <tr><td>Light #EEF1F6</td><td>Ink</td><td>17.1 : 1</td><td>AAA</td></tr><tr><td>openGym green</td><td>Ink</td><td>12.8 : 1</td><td>AAA</td></tr>
    <tr><td>Ink</td><td>openGym green</td><td>12.8 : 1</td><td>AAA</td></tr><tr><td>Muted #8B919C</td><td>Ink</td><td>6.1 : 1</td><td>AA</td></tr>
    <tr><td>Dark text #12151B</td><td>White</td><td>18.3 : 1</td><td>AAA</td></tr><tr><td>Green on light #4D7C0F</td><td>White</td><td>5.0 : 1</td><td>AA</td></tr>
    <tr><td>openGym green</td><td>White</td><td>1.5 : 1</td><td>Shapes only</td></tr></tbody></table></div>
</section>'''

sec_type = f'''<section class="bg-sec" id="type" aria-labelledby="type-h">
  <h2 id="type-h">Typography</h2>
  <p class="bg-intro">Big numbers, short words. The logo has its own typeface; everything else uses the platform's font, so the app feels native and loads nothing extra.</p>
  <figure class="bg-fig"><div class="bg-panel bg-panel-ink bg-specimen"><span class="bg-sp-1">100 kg × 5</span><span class="bg-sp-2">Your data stays on your phone.</span><span class="bg-sp-3">Plan, log and track your training. Every rep last time. 5 kg more.</span></div></figure>
  {bp('Never type the logo.', 'The wordmark is Liberation Sans Bold, outlined in the files. Use the files.')}
  {bp('Use the system font.', 'SF Pro on Apple devices, Roboto on Android and Wear OS, Segoe UI on Windows. Inter for documents, Roboto for graphics.')}
  {bp('Make numbers steady.', 'Tabular figures for weights, reps and timers, so they don’t jump while they change.')}
  {bp('Write in sentence case.', 'No all-caps headlines. Left-aligned text, at most one centred moment per screen.')}
  <div class="bg-table"><table><thead><tr><th>Style</th><th>App</th><th>Website</th><th>Weight</th><th>Tracking</th></tr></thead><tbody>
    <tr><td>Display</td><td>34–48 pt</td><td>52–132 px</td><td>Bold</td><td>-0.045 em</td></tr><tr><td>Heading</td><td>22–28 pt</td><td>32–60 px</td><td>Bold</td><td>-0.03 em</td></tr>
    <tr><td>Lead</td><td>17–19 pt</td><td>18–21 px</td><td>Regular, Semibold</td><td>0</td></tr><tr><td>Body</td><td>15–17 pt</td><td>16–17 px</td><td>Regular</td><td>0</td></tr>
    <tr><td>Small</td><td>12–13 pt</td><td>13–14 px</td><td>Regular, Semibold</td><td>0</td></tr></tbody></table></div>
</section>'''

sec_icons = f'''<section class="bg-sec" id="icons" aria-labelledby="icons-h">
  <h2 id="icons-h">App icon</h2>
  <p class="bg-intro">The mark in openGym green on ink, centred, with nothing else. The master is square; the stores and phones round the corners themselves.</p>
  <figure class="bg-fig"><div class="bg-panel bg-icons"><img src="{K}/icons/opengym-icon-rounded.svg" alt="The app icon at four sizes" width="512" height="512" style="width:30%"><img src="{K}/icons/opengym-icon-rounded.svg" alt="" width="512" height="512" style="width:17%"><img src="{K}/icons/opengym-icon-rounded.svg" alt="" width="512" height="512" style="width:9%"><img src="{K}/icons/opengym-icon-rounded.svg" alt="" width="512" height="512" style="width:5%"></div></figure>
  <div class="bg-grid2">''' + ''.join(f'<figure class="bg-card"><div class="bg-panel" style="background:#17181b"><img src="{K}/icons/{f}.svg" alt="{t}" width="512" height="512" style="width:34%"></div><figcaption><b>{t}</b>{dl(f, "icon")}</figcaption></figure>' for f, t in [('opengym-icon-square', 'Square, the master'), ('opengym-icon-rounded', 'Rounded, for web and slides')]) + '''</div>
  <div class="bg-table"><table><thead><tr><th>Platform</th><th>Format</th><th>Notes</th></tr></thead><tbody>
    <tr><td>iPhone</td><td>1024 × 1024, opaque</td><td>Nine alternate icons in the app are the user's choice</td></tr>
    <tr><td>Android</td><td>Adaptive icon, monochrome layer</td><td>The mark sits inside the 66 dp safe zone</td></tr>
    <tr><td>Apple Watch, Wear OS</td><td>Round</td><td>Mark in brand green on ink</td></tr>
    <tr><td>Garmin</td><td>70 × 70, scaled per watch</td><td>Drawn pixel-exact from the mark</td></tr>
    <tr><td>Notifications</td><td>White mark on clear</td><td>The system tints it</td></tr>
    <tr><td>Web</td><td>favicon 48, PNG 96 to 512</td><td>apple-touch-icon is the 180 px square</td></tr></tbody></table></div>
</section>'''

sec_imagery = '''<section class="bg-sec" id="imagery" aria-labelledby="imagery-h">
  <h2 id="imagery-h">Imagery</h2>
  <p class="bg-intro">The real app, real exercises, real gyms.</p>
  <p class="bg-bp"><b>Show the real app with real data.</b> Real exercise names, believable weights, a plan that adds up. Dark mode first, no fake hands or 3D tilts.</p>
  <p class="bg-bp"><b>Photograph training, not bodies.</b> Real gyms, real equipment, natural light. No stock smiles, posed models or before-and-after pictures.</p>
  <aside class="bg-callout"><b>Exercise media are licensed.</b> The exercise animations and pictures come from Gym visual and are licensed for openGym only. Up to 180 × 180 px may appear on the web, in the demo and in self-hosted servers; higher resolutions only inside the apps from the stores. Never copy them out of openGym, hotlink them, or use them with AI.</aside>
</section>'''

sec_voice = '''<section class="bg-sec" id="voice" aria-labelledby="voice-h">
  <h2 id="voice-h">Voice and tone</h2>
  <p class="bg-intro">Talk like a good training partner: direct, encouraging, a little witty.</p>
  <p class="bg-bp"><b>Be human.</b> Short sentences, plain words, "you" and "we".</p>
  <p class="bg-bp"><b>Be honest.</b> Say what it does. No "revolutionary", no fake urgency, no shaming a missed day.</p>
  <p class="bg-bp"><b>Keep the mechanics.</b> openGym, always. No em dashes in app texts, store texts or posts. Digits for weights and reps, in the user's unit.</p>
  <div class="bg-grid2 bg-say">
    <div class="bg-yes"><b>Like this</b><span>Heavier than ever. No pressure.</span><span>Every rep last time. 5 kg more.</span><span>Your data stays on your phone.</span></div>
    <div class="bg-nope"><b>Not like this</b><span>Unlock your ultimate fitness potential today!</span><span>Error 0x81: operation failed</span><span>You missed 3 workouts.</span></div>
  </div>
</section>'''

bn = [('opengym-social-1200x630', 'Social share', '1200 × 630'), ('opengym-github-1280x640', 'GitHub preview', '1280 × 640'),
      ('opengym-discord-960x540', 'Discord', '960 × 540'), ('opengym-x-header-1500x500', 'X header', '1500 × 500'),
      ('opengym-linkedin-1584x396', 'LinkedIn', '1584 × 396'), ('opengym-youtube-2560x1440', 'YouTube', '2560 × 1440'),
      ('opengym-wallpaper-desktop-2560x1440', 'Desktop wallpaper', '2560 × 1440'), ('opengym-wallpaper-phone-1170x2532', 'Phone wallpaper', '1170 × 2532')]
def dims(f):
    im = Image.open(f'{W}/brand/preview/{f}.webp'); return im.width, im.height
sec_banners = '''<section class="bg-sec" id="banners" aria-labelledby="banners-h">
  <h2 id="banners-h">Banners</h2>
  <p class="bg-intro">Ready-made for the usual places, with a real screen from the app.</p>
  <div class="bg-ix"><ul class="bg-ix-list">''' + ''.join(f'''<li><a class="bg-ix-row" href="{K}/banners/{f}.png" download data-preview="brand/preview/{f}.webp"><img class="bg-ix-thumb" src="brand/preview/{f}.webp" alt="{t} banner" loading="lazy" width="{dims(f)[0]}" height="{dims(f)[1]}"><span class="bg-ix-name">{t}</span><span class="bg-ix-size">{s}</span></a></li>''' for f, t, s in bn) + f'''</ul>
  <div class="bg-ix-frame" aria-hidden="true"><img alt="" src="brand/preview/{bn[0][0]}.webp" width="880" height="462"></div></div>
</section>'''

sec_using = '''<section class="bg-sec" id="using" aria-labelledby="using-h">
  <h2 id="using-h">Using the brand</h2>
  <p class="bg-intro">Free to use when you write about openGym, link to it or build something for it.</p>
  <div class="bg-table"><table><thead><tr><th>You may</th><th>Please don't</th></tr></thead><tbody>
    <tr><td>Use the logo and banners in articles, videos, talks and reviews</td><td>Make it look like openGym made, sponsors or endorses your product</td></tr>
    <tr><td>Say "works with openGym" for an integration</td><td>Use the name or mark in your product's name, icon or domain</td></tr>
    <tr><td>Fork the code under the AGPL-3.0</td><td>Ship a fork under the openGym name; give it its own</td></tr></tbody></table></div>
  <p>The source code is AGPL-3.0; the name and logo are not part of the code licence and are used as described here. Questions: <a href="mailto:contact@duarte-santos.ch">contact@duarte-santos.ch</a> or <a href="https://discord.gg/e62jY6fwVb" rel="noopener">Discord</a>. When in doubt, ask. The answer is usually yes.</p>
</section>
<section class="bg-sec" id="changes" aria-labelledby="changes-h">
  <h2 id="changes-h">Change log</h2>
  <div class="bg-table"><table><thead><tr><th>Date</th><th>Change</th></tr></thead><tbody>
    <tr><td>9 November 2026</td><td>First edition: one green for logo and interface, outlined wordmark files, design principles, voice, banners.</td></tr></tbody></table></div>
</section>'''

main = f'<main id="main" class="wrap bg">\n{nav}\n<article class="bg-doc">\n{header}\n{sec_logo}\n{sec_colour}\n{sec_type}\n{sec_icons}\n{sec_imagery}\n{sec_voice}\n{sec_banners}\n{sec_using}\n</article>\n</main>'
foot = foot.replace('<a href="about.html">About</a>', '<a href="about.html">About</a>\n    <a href="brand">Brand</a>')
foot = foot.replace('</body>', '<script src="brand/brand.js?v=3" defer></script>\n</body>')
open(f'{W}/brand.html', 'w').write(head + main + foot)
print('brand.html written')
