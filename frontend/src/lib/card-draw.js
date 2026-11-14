// What every shared picture of openGym has in common: the two formats, the light and dark looks
// and the logo in the corner. Pure drawing, no DOM: the workout card (lib/workout-card.js, after a
// workout and in History) and Your year (lib/wrapped-cards.js) both paint with it, and
// lib/share-image.js gets the picture out of the app. No exercise picture or clip is ever drawn
// on a card (the licence keeps those inside the app, NOTICE.md).

// 9:16 for Stories and Reels, 1:1 for a feed or a chat.
export const FORMATS = { story: { width: 1080, height: 1920 }, square: { width: 1080, height: 1080 } }
export const FORMAT_IDS = Object.keys(FORMATS)
export const STYLE_IDS = ['dark', 'light']
export const SITE = 'opengym.ch'

/**
 * The colours of a card, the app's own (index.css) in a fixed light or dark look, whatever the
 * app shows right now. `acc` is the accent, as a hex or rgb colour; on light paper a bright accent
 * is too faint to read as text, so text in the accent (`accText`) is the accent darkened there.
 */
// "#rgb", "#rrggbb", "rgb(…)" or "rgba(…)" as [r, g, b, a]; null for anything else.
export function parseColor(value) {
  const s = String(value || '').trim()
  let m = s.match(/^#([0-9a-f]{3,8})$/i)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = i => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(p => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)))
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
}
// CSS color-mix(in srgb, a p%, b): p of `a` over the rest of `b`, as an rgb() string. A canvas
// is handed plain rgb, so the card does not depend on how a WebView parses color-mix().
export function mixColor(a, b, p) {
  const x = parseColor(a)
  const y = parseColor(b)
  if (!x || !y) return x ? a : b
  const ch = i => Math.round(x[i] * p + y[i] * (1 - p))
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
}

export function cardPalette(style, acc = '#30d158') {
  const light = style === 'light'
  const a = parseColor(acc) ? acc : '#30d158'
  return light
    ? { bg: '#f2f2f7', surface: '#ffffff', tile: '#f2f2f7', label: '#000000', label2: '#6c6c70', acc: a, accText: mixColor(a, '#000000', 0.62), sep: '#e5e5ea', light: true }
    : { bg: '#000000', surface: '#1c1c1e', tile: '#2c2c2e', label: '#ffffff', label2: '#98989f', acc: a, accText: a, sep: '#38383a', light: false }
}

// The dumbbell of the app icon (public/icon-512.png) on a 208×72 grid, centred on 0,0.
const MARK = [[-72, -10, 144, 20], [-80, -36, 20, 72], [-104, -25, 17, 50], [60, -36, 20, 72], [87, -25, 17, 50]]
export const MARK_ASPECT = 208 / 72

/** The logo mark, `h` high, its left edge at x (its right edge for rtl), centred on y. */
export function drawMark(ctx, x, y, h, color) {
  const s = h / 72
  ctx.save()
  ctx.translate(x + 104 * s, y)
  ctx.scale(s, s)
  ctx.fillStyle = color
  for (const [rx, ry, rw, rh] of MARK) { roundRect(ctx, rx, ry, rw, rh, 7); ctx.fill() }
  ctx.restore()
}

/**
 * The footer every card ends with: the mark, "openGym" with "Gym" in the accent, and the site at
 * the other end. `y` is the text's baseline. Drawn left to right whatever the language: it is a
 * logo, and a logo does not mirror.
 */
export function drawBrand(ctx, { x, y, width, colors, family, size = 40 }) {
  const markH = size * 0.78
  drawMark(ctx, x, y - size * 0.36, markH, colors.acc)
  let tx = x + markH * MARK_ASPECT + size * 0.4
  ctx.direction = 'ltr'
  ctx.textAlign = 'left'
  ctx.font = `800 ${size}px ${family}`
  ctx.fillStyle = colors.label
  ctx.fillText('open', tx, y)
  tx += ctx.measureText('open').width
  ctx.fillStyle = colors.accText || colors.acc
  ctx.fillText('Gym', tx, y)
  ctx.font = `600 ${Math.round(size * 0.72)}px ${family}`
  ctx.fillStyle = colors.label2
  ctx.textAlign = 'right'
  ctx.fillText(SITE, x + width, y)
  ctx.textAlign = 'left'
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

