// openGym brand kit: PNGs of every logo SVG (make-kit.py) and the banners, with headless Chrome.
//
//   CHROME=/path/to/chrome node scripts/brand/render-kit.mjs website/brand/kit
//
// Banners use the official lockup (logo/opengym-logo-for-dark-backgrounds.svg, outlined),
// brand green only, ink #0C0E12, and a real app screenshot from assets/screenshots.
// Text is Roboto (ROBOTO=path/to/Roboto.ttf), the app's typeface on Android.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
// puppeteer-core is not a dependency of the repo: point PUPPETEER_FROM at any package.json that has it
const require = createRequire(process.env.PUPPETEER_FROM || path.join(root, 'frontend/package.json'))
const puppeteer = require('puppeteer-core')
const out = path.resolve(process.argv[2] || 'website/brand/kit')
const chrome = process.env.CHROME
const roboto = process.env.ROBOTO
if (!chrome || !roboto) { console.error('set CHROME and ROBOTO'); process.exit(2) }

const b64 = f => fs.readFileSync(f).toString('base64')
const svgOf = f => fs.readFileSync(path.join(out, f), 'utf8').replace(/^<svg[^>]*?width="[^"]*"\s*height="[^"]*"/, m => m.replace(/width="[^"]*"\s*height="[^"]*"/, 'width="100%" height="100%"'))
const LOCKUP = svgOf('logo/opengym-logo-for-dark-backgrounds.svg')
const MARK = svgOf('logo/opengym-mark-green.svg')
const SHOT = 'data:image/png;base64,' + b64(path.join(root, 'assets/screenshots/workout.png'))
const SHOT2 = 'data:image/png;base64,' + b64(path.join(root, 'assets/screenshots/home.png'))

const css = `@font-face{font-family:R;src:url(data:font/ttf;base64,${b64(roboto)});font-weight:100 900}
*{box-sizing:border-box;margin:0}
html,body{width:var(--w);height:var(--h);overflow:hidden;background:#0c0e12;color:#eef1f6;font-family:R,sans-serif}
.glow{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(163,230,53,.16),rgba(163,230,53,0) 62%)}
.lockup{display:block}
h1{font-weight:700;letter-spacing:-.035em;line-height:1.02}
h1 em{font-style:normal;color:#a3e635}
.url{color:#8b919c;font-weight:500;letter-spacing:.01em}
.phone{position:absolute;border-radius:9% / 4.2%;background:#1b1f26;padding:1.1%;box-shadow:0 0 0 2px #2c313a,0 40px 100px rgba(0,0,0,.6);overflow:hidden}
.phone img{display:block;width:100%;border-radius:8% / 3.7%}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}`

// x, y, sizes in px of each banner; s = scale unit (1% of the height)
const BANNERS = [
  { name: 'opengym-social-1200x630', w: 1200, h: 630, kind: 'split' },
  { name: 'opengym-github-1280x640', w: 1280, h: 640, kind: 'split' },
  { name: 'opengym-discord-960x540', w: 960, h: 540, kind: 'split' },
  { name: 'opengym-x-header-1500x500', w: 1500, h: 500, kind: 'wide' },
  { name: 'opengym-linkedin-1584x396', w: 1584, h: 396, kind: 'wide' },
  { name: 'opengym-youtube-2560x1440', w: 2560, h: 1440, kind: 'safe' },
  { name: 'opengym-wallpaper-desktop-2560x1440', w: 2560, h: 1440, kind: 'wall' },
  { name: 'opengym-wallpaper-phone-1170x2532', w: 1170, h: 2532, kind: 'wallphone' },
]

function body(b) {
  const { w, h } = b
  if (b.kind === 'split') {
    const pw = h * 0.5
    return `<div class="glow" style="width:${h * 1.6}px;height:${h * 1.6}px;right:${-h * 0.5}px;top:${-h * 0.55}px"></div>
<div style="position:absolute;left:${h * 0.1}px;top:${h * 0.13}px;bottom:${h * 0.11}px;width:${w - pw - h * 0.38}px;display:flex;flex-direction:column;justify-content:space-between">
  <div class="lockup" style="width:${h * 0.5}px;height:${h * 0.5 * 238 / 868}px">${LOCKUP}</div>
  <h1 style="font-size:${h * 0.115}px">Your workouts.<br>Your weights.<br><em>Your data.</em></h1>
  <p class="url" style="font-size:${h * 0.04}px">Free and open source · iPhone, Android, Apple Watch, Wear OS, Garmin · opengym.ch</p>
</div>
<div class="phone" style="width:${pw}px;right:${h * 0.1}px;top:${h * 0.12}px;transform:rotate(4deg)"><img src="${SHOT}"></div>`
  }
  if (b.kind === 'wide') {
    return `<div class="glow" style="width:${h * 2.4}px;height:${h * 2.4}px;right:${-h * 0.6}px;top:${-h * 0.9}px"></div>
<div style="position:absolute;right:${h * 0.22}px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;text-align:right;gap:${h * 0.07}px">
  <div class="lockup" style="width:${h * 0.95}px;height:${h * 0.95 * 238 / 868}px">${LOCKUP}</div>
  <h1 style="font-size:${h * 0.15}px">Your workouts. Your weights. <em>Your data.</em></h1>
  <p class="url" style="font-size:${h * 0.065}px">Free and open source · opengym.ch</p>
</div>`
  }
  if (b.kind === 'safe') { // YouTube: everything inside the 1546 x 423 centre that every device shows
    return `<div class="glow" style="width:${w * 0.6}px;height:${w * 0.6}px;left:${w * 0.2}px;top:${h * 0.5 - w * 0.3}px"></div>
<div class="center" style="gap:34px">
  <div class="lockup" style="width:720px;height:${720 * 238 / 868}px">${LOCKUP}</div>
  <p class="url" style="font-size:44px">Your workouts. Your weights. <span style="color:#a3e635">Your data.</span></p>
</div>`
  }
  if (b.kind === 'wall') {
    return `<div class="glow" style="width:${h * 1.5}px;height:${h * 1.5}px;left:${w / 2 - h * 0.75}px;top:${-h * 0.25}px"></div>
<div class="center"><div style="width:${w * 0.16}px;height:${w * 0.16 * 174 / 352}px">${MARK}</div></div>`
  }
  // phone wallpaper: the mark a little above the middle, clear of the clock and the dock
  return `<div class="glow" style="width:${w * 1.6}px;height:${w * 1.6}px;left:${-w * 0.3}px;top:${h * 0.55 - w * 0.8}px"></div>
<div style="position:absolute;left:0;right:0;top:${h * 0.55}px;display:flex;justify-content:center"><div style="width:${w * 0.36}px;height:${w * 0.36 * 174 / 352}px;transform:translateY(-50%)">${MARK}</div></div>`
}

const browser = await puppeteer.launch({ executablePath: chrome, args: ['--no-sandbox', '--disable-gpu'] })
const page = await browser.newPage()

// 1. PNGs of the logo SVGs (transparent where the SVG is)
const sizes = { logo: [['', 1736], ['@4x', 3472]], icons: [['-1024', 1024], ['-512', 512], ['-180', 180]] }
for (const dir of ['logo', 'icons']) {
  for (const f of fs.readdirSync(path.join(out, dir)).filter(f => f.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(out, dir, f), 'utf8')
    const [vw, vh] = svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/).slice(1).map(Number)
    const list = dir === 'logo' && f.includes('mark') ? [['', 1408], ['@4x', 2816]] : sizes[dir]
    for (const [suffix, width] of list) {
      const height = Math.round(width * vh / vw)
      await page.setViewport({ width, height })
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="[^"]*"\s*height="[^"]*"/, `width="${width}" height="${height}"`)}</body></html>`)
      await page.screenshot({ path: path.join(out, dir, f.replace('.svg', `${suffix}.png`)), omitBackground: true, clip: { x: 0, y: 0, width, height } })
    }
  }
}

// 2. Banners
fs.mkdirSync(path.join(out, 'banners'), { recursive: true })
for (const b of BANNERS) {
  await page.setViewport({ width: b.w, height: b.h })
  await page.setContent(`<!doctype html><html style="--w:${b.w}px;--h:${b.h}px"><head><style>${css}</style></head><body>${body(b)}</body></html>`)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(out, 'banners', b.name + '.png'), clip: { x: 0, y: 0, width: b.w, height: b.h } })
}
await browser.close()
console.log('rendered into', out)
