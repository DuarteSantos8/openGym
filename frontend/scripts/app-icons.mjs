#!/usr/bin/env node
/* The alternate home-screen icons (Settings → Look & Home → App icon), drawn from
 * src/lib/app-icon-variants.js and the dumbbell in resources/icon.svg.
 *
 * The glyph is five rectangles, so this draws them itself (4x4 to 8x8 samples per pixel for the
 * edges) and writes the PNGs with node:zlib: no sharp or resvg to install, and the same bytes on
 * every machine, which the test checks. A variant with `art` (Halloween) is a hand-made SVG
 * instead, drawn by the small renderer below (rect, circle, line, polyline, polygon, one radial
 * gradient). Written per variant:
 *   resources/icons/<id>.svg                                  the source (the glyph ones only)
 *   public/app-icons/<id>.png                                 112 px preview for the settings row
 *   ios/App/App/Assets.xcassets/AppIcon-<Name>.appiconset/    1024 px, opaque (Apple refuses alpha)
 * In 1.4.3 the picker is on the iPhone only, so there are no Android launcher files here (1.4.4
 * adds them). The default icon keeps the files @capacitor/assets made for it (docs/MOBILE.md);
 * only its preview comes from here.
 *
 * Usage: node scripts/app-icons.mjs            write everything
 *        node scripts/app-icons.mjs --check    exit 1 when a committed file differs from a fresh draw */
import { deflateSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ICON_VARIANTS } from '../src/lib/app-icon-variants.js'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const PREVIEW = 112
export const IOS_SIZE = 1024

/** The glyph's rectangles, in the 512 grid of resources/icon.svg: one source for every icon. */
export function glyph(svg = readFileSync(join(ROOT, 'resources/icon.svg'), 'utf8')) {
  const g = svg.match(/<g[^>]*>([\s\S]*?)<\/g>/)?.[1] || ''
  return [...g.matchAll(/<rect\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/g)]
    .map(m => m.slice(1, 5).map(Number))
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

/** One icon `size` px square: the background, the glyph on it, optionally cut to a circle. */
export function draw(v, size, { round = false, rects = glyph() } = {}) {
  if (v.art) return drawArt(readFileSync(join(ROOT, v.art), 'utf8'), size)
  const k = size <= 256 ? 8 : 4
  const bg = rgb(v.bg), fg = rgb(v.fg)
  const ch = round ? 4 : 3
  const out = Buffer.alloc(size * size * ch)
  const scale = 512 / size
  // Per sample row, the glyph's spans across it: the inner loop then only compares numbers.
  const spans = []
  for (let s = 0; s < size * k; s++) {
    const gy = (s + 0.5) / k * scale
    spans.push(rects.filter(([, ry, , rh]) => gy >= ry && gy < ry + rh).map(([rx, , rw]) => [rx, rx + rw]))
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let inside = 0, on = 0
    for (let sy = 0; sy < k; sy++) {
      const py = y + (sy + 0.5) / k
      const row = spans[y * k + sy]
      for (let sx = 0; sx < k; sx++) {
        const px = x + (sx + 0.5) / k
        if (round) {
          const dx = px - size / 2, dy = py - size / 2
          if (dx * dx + dy * dy > (size / 2) * (size / 2)) continue
        }
        inside++
        const gx = px * scale
        for (const [a, b] of row) if (gx >= a && gx < b) { on++; break }
      }
    }
    const o = (y * size + x) * ch
    const a = inside ? on / inside : 0
    for (let c = 0; c < 3; c++) out[o + c] = Math.round(bg[c] + (fg[c] - bg[c]) * a)
    if (round) out[o + 3] = Math.round(255 * inside / (k * k))
  }
  return png(size, size, out, ch)
}

// --- the hand-made icons: a renderer for the little SVG they are allowed to use ---
// Painted back to front like SVG: each sample takes the colour of the topmost shape covering it.
// Strokes are capsules (round caps and joins), polygons fill even-odd, and a fill may be the one
// userSpaceOnUse radialGradient with two stops. Coordinates in the 512 viewBox.

const num = (a, k, d = 0) => (a[k] === undefined ? d : Number(a[k]))
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
const pts = s => s.trim().split(/[\s,]+/).map(Number).reduce((o, n, i) => (i % 2 ? o[o.length - 1].push(n) : o.push([n]), o), [])

/** The SVG as a list of shapes, each { hit(x, y), color(x, y), box }: what drawArt paints. */
export function scene(svg) {
  const grads = {}
  for (const m of svg.matchAll(/<radialGradient\b([^>]*)>([\s\S]*?)<\/radialGradient>/g)) {
    const a = attrs(m[1])
    const stops = [...m[2].matchAll(/<stop\b([^>]*)\/>/g)].map(s => attrs(s[1]))
    grads[a.id] = { cx: num(a, 'cx'), cy: num(a, 'cy'), r: num(a, 'r'), c0: rgb(stops[0]['stop-color']), c1: rgb(stops[stops.length - 1]['stop-color']) }
  }
  const paint = f => {
    const g = /^url\(#(.+)\)$/.exec(f)
    if (!g) { const c = rgb(f); return () => c }
    const { cx, cy, r, c0, c1 } = grads[g[1]]
    return (x, y) => {
      const t = Math.min(1, Math.hypot(x - cx, y - cy) / r)
      return [0, 1, 2].map(i => c0[i] + (c1[i] - c0[i]) * t)
    }
  }
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const stack = [{}]
  const shapes = []
  for (const m of body.matchAll(/<(\/?)(\w+)\b([^>]*?)(\/?)>/g)) {
    const [, close, name, raw, self] = m
    if (name === 'svg') continue
    if (name === 'g') { close ? stack.pop() : stack.push({ ...stack[stack.length - 1], ...attrs(raw) }); continue }
    if (close) continue
    const a = { ...stack[stack.length - 1], ...attrs(raw) }
    if (!self) throw new Error(`app icon art: <${name}> must close itself`)
    if (name === 'rect') {
      const x = num(a, 'x'), y = num(a, 'y'), w = num(a, 'width'), h = num(a, 'height')
      shapes.push({ box: [x, y, x + w, y + h], hit: (px, py) => px >= x && px < x + w && py >= y && py < y + h, color: paint(a.fill) })
    } else if (name === 'circle') {
      const cx = num(a, 'cx'), cy = num(a, 'cy'), r = num(a, 'r')
      shapes.push({ box: [cx - r, cy - r, cx + r, cy + r], hit: (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r, color: paint(a.fill) })
    } else if (name === 'line' || name === 'polyline') {
      const p = name === 'line' ? [[num(a, 'x1'), num(a, 'y1')], [num(a, 'x2'), num(a, 'y2')]] : pts(a.points)
      const hw = num(a, 'stroke-width', 1) / 2
      const segs = p.slice(1).map((q, i) => [p[i], q])
      const xs = p.map(q => q[0]), ys = p.map(q => q[1])
      shapes.push({
        box: [Math.min(...xs) - hw, Math.min(...ys) - hw, Math.max(...xs) + hw, Math.max(...ys) + hw],
        hit: (px, py) => segs.some(([[x1, y1], [x2, y2]]) => {
          const dx = x2 - x1, dy = y2 - y1
          const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)))
          return (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2 <= hw * hw
        }),
        color: paint(a.stroke),
      })
    } else if (name === 'polygon') {
      const p = pts(a.points)
      const xs = p.map(q => q[0]), ys = p.map(q => q[1])
      shapes.push({
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        hit: (px, py) => {
          let inside = false
          for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
            const [xi, yi] = p[i], [xj, yj] = p[j]
            if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside
          }
          return inside
        },
        color: paint(a.fill),
      })
    } else throw new Error(`app icon art: no <${name}> in the renderer`)
  }
  return shapes.reverse()   // topmost first
}

/** A hand-made icon `size` px square, opaque (iOS), 4x4 samples per pixel. */
export function drawArt(svg, size) {
  const shapes = scene(svg)
  const k = 4, scale = 512 / size
  const out = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    // Only the shapes this pixel row can touch.
    const y0 = y * scale, y1 = (y + 1) * scale
    const row = shapes.filter(s => s.box[1] <= y1 && s.box[3] >= y0)
    for (let x = 0; x < size; x++) {
      const x0 = x * scale, x1 = (x + 1) * scale
      const here = row.filter(s => s.box[0] <= x1 && s.box[2] >= x0)
      const sum = [0, 0, 0]
      for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++) {
        const px = (x + (sx + 0.5) / k) * scale, py = (y + (sy + 0.5) / k) * scale
        const s = here.find(sh => sh.hit(px, py))
        const c = s ? s.color(px, py) : [0, 0, 0]
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]
      }
      const o = (y * size + x) * 3
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(sum[c] / (k * k))
    }
  }
  return png(size, size, out, 3)
}

// --- PNG, the bare minimum: IHDR, one IDAT, IEND; filter 0 on every row ---
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(w, h, pixels, ch) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2   // 8 bit, RGBA or RGB
  const raw = Buffer.alloc(h * (w * ch + 1))
  for (let y = 0; y < h; y++) pixels.copy(raw, y * (w * ch + 1) + 1, y * w * ch, (y + 1) * w * ch)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Width, height and whether the PNG has an alpha channel, read from its header. */
export function pngInfo(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: buf[25] === 6 || buf[25] === 4 }
}

const svgOf = (v, rects) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <!-- openGym app icon "${v.id}", written by scripts/app-icons.mjs (the glyph of resources/icon.svg). -->
  <rect width="512" height="512" fill="${v.bg}"/>
  <g fill="${v.fg}">
${rects.map(([x, y, w, h]) => `    <rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('\n')}
  </g>
</svg>
`

const iosContents = `{
  "images" : [
    {
      "filename" : "icon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`

/** Every file this script owns, as [path relative to frontend/, () => contents]: drawn on demand. */
export function files(rects = glyph()) {
  const out = []
  for (const v of APP_ICON_VARIANTS) {
    out.push([`public/app-icons/${v.id}.png`, () => draw(v, PREVIEW, { rects })])
    if (v.id === 'default') continue
    if (!v.art) out.push([`resources/icons/${v.id}.svg`, () => svgOf(v, rects)])
    const set = `ios/App/App/Assets.xcassets/${v.ios}.appiconset`
    out.push([`${set}/Contents.json`, () => iosContents])
    out.push([`${set}/icon-1024.png`, () => draw(v, IOS_SIZE, { rects })])
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check')
  const bad = []
  for (const [rel, make] of files()) {
    const p = join(ROOT, rel)
    const body = make()
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    if (check) {
      if (!existsSync(p) || !readFileSync(p).equals(buf)) bad.push(rel)
      continue
    }
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, buf)
  }
  if (bad.length) { console.error('app icons out of date (run node scripts/app-icons.mjs):\n  ' + bad.join('\n  ')); process.exit(1) }
  console.log(check ? 'app icons up to date' : 'app icons written')
}
