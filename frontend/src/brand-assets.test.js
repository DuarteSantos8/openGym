// @vitest-environment node
/* The brand's files, as the app and the native shells point at them: every icon the manifest, the
 * page and the service worker name is there, at its size and in the form its place needs (the
 * maskable icon is a full-bleed square with no alpha, the notification badge has alpha), the
 * Android launcher is complete at every density, and the launch images are all there. What the
 * generator draws is not re-drawn here; the sizes and forms are what a store or a phone checks. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const at = (...p) => join(ROOT, ...p)
const read = (...p) => readFileSync(at(...p), 'utf8')

// width, height and colour type from a PNG's IHDR (2 = RGB, 6 = RGBA)
function png(...p) {
  const b = readFileSync(at(...p))
  expect(b.subarray(1, 4).toString(), p.join('/')).toBe('PNG')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: b[25] }
}

describe('web icons', () => {
  const manifest = JSON.parse(read('public', 'manifest.json'))

  it('every manifest icon exists at the size it declares', () => {
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number)
      expect(png('public', icon.src), icon.src).toMatchObject({ w, h })
    }
  })

  it('the maskable icon is a full-bleed square: RGB, no alpha for the OS to show through', () => {
    const maskable = manifest.icons.filter(i => i.purpose.includes('maskable'))
    expect(maskable.length).toBeGreaterThan(0)
    for (const icon of maskable) expect(png('public', icon.src).type, icon.src).toBe(2)
  })

  it('no icon mixes purposes; there is a maskable at 192 and 512 and a monochrome one', () => {
    for (const icon of manifest.icons) expect(icon.purpose, icon.src).toMatch(/^(any|maskable|monochrome)$/)
    const has = (purpose, sizes) => manifest.icons.some(i => i.purpose === purpose && i.sizes === sizes)
    expect(has('maskable', '192x192') && has('maskable', '512x512')).toBe(true)
    expect(manifest.icons.some(i => i.purpose === 'monochrome')).toBe(true)
  })

  it('the Apple touch icon is full bleed too (iOS rounds it itself)', () => {
    expect(png('public', 'brand', 'icon-180.png')).toEqual({ w: 180, h: 180, type: 2 })
  })

  it('the page links only files that exist', () => {
    const html = read('index.html')
    const hrefs = [...html.matchAll(/<link [^>]*href="([^"]+)"/g)].map(m => m[1])
    expect(hrefs.length).toBeGreaterThanOrEqual(5)
    for (const href of hrefs) expect(existsSync(at('public', href)), href).toBe(true)
  })

  it('has a favicon in each form a browser asks for', () => {
    const html = read('index.html')
    expect(html).toContain('href="brand/favicon.svg"')
    expect(html).toContain('href="brand/favicon.ico"')
    expect(png('public', 'brand', 'favicon-32.png')).toMatchObject({ w: 32, h: 32 })
    // an .ico starts 00 00 01 00 and carries 16, 32 and 48 px images
    const ico = readFileSync(at('public', 'brand', 'favicon.ico'))
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3])
  })

  it('the notification badge is the G on transparent, and the worker points at it', () => {
    expect(read('public', 'sw.js')).toContain("badge: 'brand/badge-96.png'")
    expect(png('public', 'brand', 'badge-96.png')).toEqual({ w: 96, h: 96, type: 6 })
  })

  it('the native source is the web master, byte for byte', () => {
    expect(read('resources', 'icon.svg')).toBe(read('public', 'brand', 'icon.svg'))
  })
})

describe('the first frame before any script runs (index.html)', () => {
  const code = read('index.html').match(/<script>([\s\S]*?)<\/script>/)[1]
  // The script as the page runs it, over a stand-in for the parts of the browser it touches.
  const run = ({ state = null, dark = true, language = 'en' } = {}) => {
    const root = { dataset: {} }
    const win = { matchMedia: q => ({ matches: q.includes('dark') && dark }) }
    new Function('document', 'localStorage', 'navigator', 'window', 'matchMedia', code)(
      { documentElement: root }, { getItem: () => (state ? JSON.stringify(state) : null) }, { language }, win, win.matchMedia)
    return root
  }

  it('sets the theme the profile chose', () => {
    expect(run({ state: { theme: 'light' }, dark: true }).dataset.theme).toBe('light')
    expect(run({ state: { theme: 'dark' }, dark: false }).dataset.theme).toBe('dark')
  })

  it('follows the device when the profile says system, or nothing', () => {
    expect(run({ state: { theme: 'system' }, dark: false }).dataset.theme).toBe('light')
    expect(run({ state: { theme: 'system' }, dark: true }).dataset.theme).toBe('dark')
    expect(run({ dark: false }).dataset.theme).toBe('light')
    expect(run({ dark: true }).dataset.theme).toBe('dark')
  })

  it('still sets the language and direction before the theme', () => {
    const root = run({ state: { lang: 'ar' } })
    expect(root).toMatchObject({ lang: 'ar', dir: 'rtl' })
  })

  it('draws the mark inside #root', () => {
    expect(read('index.html')).toMatch(/<div id="root"><div class="boot-mark"><svg class="brand-mark"/)
  })
})

describe('the Android launcher', () => {
  const RES = ['android', 'app', 'src', 'main', 'res']
  const DENSITY = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

  it('has a legacy, a round and an adaptive foreground icon at every density', () => {
    for (const [d, s] of Object.entries(DENSITY)) {
      const legacy = Math.round(48 * s), layer = Math.round(108 * s)
      expect(png(...RES, `mipmap-${d}`, 'ic_launcher.png'), d).toMatchObject({ w: legacy, h: legacy, type: 6 })
      expect(png(...RES, `mipmap-${d}`, 'ic_launcher_round.png'), d).toMatchObject({ w: legacy, h: legacy, type: 6 })
      expect(png(...RES, `mipmap-${d}`, 'ic_launcher_foreground.png'), d).toMatchObject({ w: layer, h: layer, type: 6 })
    }
  })

  it('the adaptive icon is a colour behind the foreground, and that colour is the icon ground', () => {
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = read(...RES, 'mipmap-anydpi-v26', name)
      expect(xml, name).toContain('<background android:drawable="@color/ic_launcher_background"/>')
      expect(xml, name).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>')
    }
    expect(read(...RES, 'values', 'ic_launcher_background.xml')).toContain('<color name="ic_launcher_background">#0c0b0a</color>')
  })

  it('leaves no background layer image behind (the colour replaced it)', () => {
    for (const d of Object.keys(DENSITY)) expect(existsSync(at(...RES, `mipmap-${d}`, 'ic_launcher_background.png')), d).toBe(false)
  })

  it('has a launch image for each orientation, density and theme the theme asks for', () => {
    const dirs = readdirSync(at(...RES)).filter(d => existsSync(at(...RES, d, 'splash.png')))
    expect(dirs.length).toBeGreaterThanOrEqual(26)
    for (const d of dirs) {
      const { w, h, type } = png(...RES, d, 'splash.png')
      expect(w > 0 && h > 0, d).toBe(true)
      expect(type, d).toBeLessThanOrEqual(6)
    }
    for (const d of ['drawable', 'drawable-night']) expect(dirs, d).toContain(d)
    expect(dirs.filter(d => d.includes('-night')).length).toBe(dirs.filter(d => !d.includes('-night')).length)
  })
})

describe('the iOS shell', () => {
  const XCA = ['ios', 'App', 'App', 'Assets.xcassets']

  it('the app icon is 1024 square with no transparency', () => {
    expect(png(...XCA, 'AppIcon.appiconset', 'AppIcon-512@2x.png')).toEqual({ w: 1024, h: 1024, type: 2 })
  })

  it('every launch image the asset catalogue names is there, light and dark', () => {
    const c = JSON.parse(read(...XCA, 'Splash.imageset', 'Contents.json'))
    const names = c.images.map(i => i.filename)
    expect(names).toHaveLength(6)
    expect(names.filter(n => n.endsWith('-dark.png'))).toHaveLength(3)
    // 1400 pt square at each scale, centred by the storyboard without scaling: the G is the same size on every screen
    for (const image of c.images) {
      const scale = Number(image.scale[0])
      expect(png(...XCA, 'Splash.imageset', image.filename), image.filename).toMatchObject({ w: 1400 * scale, h: 1400 * scale })
    }
    expect(read('ios', 'App', 'App', 'Base.lproj', 'LaunchScreen.storyboard')).toContain('contentMode="center"')
  })
})
