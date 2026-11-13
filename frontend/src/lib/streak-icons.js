// Your own streak flame and freeze (Settings → Look & Home → Icons): one of openGym's icons or any
// emoji, in place of the drawn flame and the snowflake. Stored in the synced state as
// S.flameIcon and S.freezeIcon, two separate settings so a change to one on the phone and to the
// other on the desktop both survive a merge:
//   { k: 'icon', v: '<Icon name>', c: '#rrggbb' }   one of the curated icons below
//   { k: 'emoji', v: '<one emoji>', c: '#rrggbb' }  any emoji
// Missing means the default (the drawn flame, the snowflake, or their emoji with Icons on Emoji).
//
// `c` is the symbol's main colour. Everything that tints around the symbol (the flame's ink on the
// progress bar and the party, the frozen week's wash in the calendar, the freeze chips) is worked
// out from it here (tintsFor), once per theme, so a pink heart gets a pink wash and a readable pink
// ink in light and in dark mode, whatever the accent. An emoji's colour is sampled on the device
// that picked it (sampleEmojiColor) and stored with it, so the other devices show the same tint
// even where their emoji font draws it a little differently.
//
// Only the app shows the choice. The watches and the widgets draw their own flame from the
// streak's number (lib/watch-sync.js, lib/widgets.js) and keep it.

export const FLAME_DEFAULT = '#ff8a1f'
export const FREEZE_DEFAULT = '#64d2ff'

// The curated sets: icon name and the colour it is drawn in. The first of each is the default.
export const FLAME_CHOICES = [
  { v: 'flame', c: FLAME_DEFAULT, def: true },
  { v: 'bolt', c: '#ffc93c' },
  { v: 'starFill', c: '#ffd60a' },
  { v: 'heart', c: '#ff375f' },
  { v: 'rocket', c: '#0a84ff' },
  { v: 'crown', c: '#f5b301' },
  { v: 'trophy', c: '#ffb020' },
  { v: 'sun', c: '#ff9f0a' },
  { v: 'dumbbell', c: '#30d158' },
  { v: 'kettlebell', c: '#bf5af2' },
  // The festive flame, the advent calendar's present (door 24, in the Christmas chunk). Always a
  // valid pick so a worn one shows on every device; offered in the picker only to someone who
  // opened door 24 or wears it already (pickerChoices).
  { v: 'flameHat', c: '#ff5a5f', prize: 'advent' },
]
export const FREEZE_CHOICES = [
  { v: 'snowflake', c: FREEZE_DEFAULT, def: true },
  { v: 'shield', c: '#0a84ff' },
  { v: 'cloud', c: '#8fb8ff' },
  { v: 'moon', c: '#5e5ce6' },
  { v: 'hourglass', c: '#bf5af2' },
  { v: 'heart', c: '#ff375f' },
  { v: 'tree', c: '#30d158' },
  { v: 'gift', c: '#ff453a' },
]
export const choicesFor = kind => (kind === 'freeze' ? FREEZE_CHOICES : FLAME_CHOICES)
export const keyFor = kind => (kind === 'freeze' ? 'freezeIcon' : 'flameIcon')
export const FESTIVE_FLAME = FLAME_CHOICES.find(ch => ch.prize === 'advent')

/** The picks the picker offers: every curated one, a prize only once it is earned or worn. */
export function pickerChoices (S, kind) {
  const worn = S?.[keyFor(kind)]?.v
  const advent = Array.isArray(S?.advent?.opened) && S.advent.opened.map(Number).includes(24)
  return choicesFor(kind).filter(ch => !ch.prize || ch.v === worn || (ch.prize === 'advent' && advent))
}

const HEX = /^#[0-9a-f]{6}$/i
const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/** The first emoji in what was typed or pasted ("🌟 nice" → "🌟"), or '' when there is none. */
export function firstEmoji (text) {
  const s = String(text ?? '').trim()
  if (!s) return ''
  const parts = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map(x => x.segment)
    : Array.from(s)
  for (const g of parts) if (PICTO.test(g) && g.length <= 16) return g
  return ''
}

/** A stored choice, cleaned, or null for the default. Anything malformed falls back to the default. */
export function iconChoice (S, kind) {
  const v = S?.[keyFor(kind)]
  if (!v || typeof v !== 'object' || typeof v.v !== 'string') return null
  if (v.k === 'icon') {
    const ch = choicesFor(kind).find(x => x.v === v.v)
    if (!ch || ch.def) return null
    return { k: 'icon', v: ch.v, c: ch.c }
  }
  if (v.k === 'emoji') {
    const e = firstEmoji(v.v)
    if (!e || e !== v.v) return null
    return { k: 'emoji', v: e, c: HEX.test(v.c) ? v.c.toLowerCase() : (kind === 'freeze' ? FREEZE_DEFAULT : FLAME_DEFAULT) }
  }
  return null
}

// --- colour ---
const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const toHex = rgb => '#' + rgb.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
export const luminance = rgb => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
export function contrast (a, b) {
  const x = luminance(typeof a === 'string' ? toRgb(a) : a), y = luminance(typeof b === 'string' ? toRgb(b) : b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
function rgbToHsl ([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function hslToRgb ([h, s, l]) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

// The surfaces the tints sit on: the card in each theme (index.css --surface).
const CARD = { dark: '#1c1c1e', light: '#ffffff' }
// Thin lines and glyphs need 3:1 against the card (the bar, a snowflake chip, the week's mark).
const INK_MIN = 3

/** The symbol's colour moved just far enough in lightness to keep 3:1 on the card of that theme. */
export function inkFor (hex, theme) {
  const base = HEX.test(hex) ? hex : FLAME_DEFAULT
  const card = CARD[theme === 'light' ? 'light' : 'dark']
  let [h, s, l] = rgbToHsl(toRgb(base))
  const step = theme === 'light' ? -0.02 : 0.02
  let rgb = toRgb(base)
  for (let i = 0; i < 60 && contrast(rgb, card) < INK_MIN; i++) {
    l = Math.max(0, Math.min(1, l + step))
    rgb = hslToRgb([h, s, l])
  }
  return toHex(rgb)
}

/** The CSS colours for one symbol, per theme: ink (lines, glyphs), soft (a wash), glow (a halo). */
export function tintsFor (hex) {
  const out = {}
  for (const theme of ['dark', 'light']) {
    const ink = inkFor(hex, theme)
    const [r, g, b] = toRgb(ink)
    out[theme] = {
      ink,
      soft: `rgba(${r},${g},${b},${theme === 'light' ? 0.12 : 0.16})`,
      glow: `rgba(${r},${g},${b},${theme === 'light' ? 0.22 : 0.3})`,
    }
  }
  return out
}

/**
 * The stylesheet that puts a chosen flame's and freeze's tints in place of the defaults
 * (index.css --streak-ink, --flame-soft, --frost, --frost-soft), or '' with both on the default.
 * App.jsx writes it into one <style> element.
 */
export function tintCss (S) {
  const f = iconChoice(S, 'flame'), z = iconChoice(S, 'freeze')
  if (!f && !z) return ''
  const rules = { dark: [], light: [] }
  if (f) { const t = tintsFor(f.c); for (const th of ['dark', 'light']) rules[th].push(`--streak-ink:${t[th].ink}`, `--flame-soft:${t[th].soft}`, `--flame-glow:${t[th].glow}`, `--flame-own:${f.c}`) }
  if (z) { const t = tintsFor(z.c); for (const th of ['dark', 'light']) rules[th].push(`--frost:${t[th].ink}`, `--frost-soft:${t[th].soft}`, `--freeze-own:${z.c}`) }
  return `:root:not([data-theme="light"]){${rules.dark.join(';')}}\n:root[data-theme="light"]{${rules.light.join(';')}}`
}

/**
 * An emoji's main colour, by drawing it on a small canvas and keeping the most common saturated
 * hue (12 hue buckets, each pixel weighted by its saturation and opacity); a grey emoji gives its
 * average grey. `makeCanvas` is for the tests. null where nothing can be drawn (no canvas, or the
 * font has no such emoji); the caller then keeps the default colour.
 */
export function sampleEmojiColor (emoji, makeCanvas = defaultCanvas) {
  const e = firstEmoji(emoji)
  if (!e) return null
  let px
  try {
    const cv = makeCanvas(40)
    const ctx = cv && cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.clearRect(0, 0, 40, 40)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = '32px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
    ctx.fillText(e, 20, 22)
    px = ctx.getImageData(0, 0, 40, 40).data
  } catch { return null }
  return dominantColor(px)
}
const defaultCanvas = size => {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = size; c.height = size; return c
}

/** The pixel colour that stands for an RGBA buffer (see sampleEmojiColor), or null if it is empty. */
export function dominantColor (px) {
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  let grey = { w: 0, r: 0, g: 0, b: 0 }
  for (let i = 0; i + 3 < px.length; i += 4) {
    const a = px[i + 3] / 255
    if (a < 0.5) continue
    const rgb = [px[i], px[i + 1], px[i + 2]]
    const [h, s, l] = rgbToHsl(rgb)
    // Highlights and deep shadows say little about what colour the thing is.
    const sat = l < 0.08 || l > 0.95 ? 0 : s
    const into = sat < 0.18 ? grey : buckets[Math.floor(h / 30) % 12]
    const w = sat < 0.18 ? a : a * sat
    into.w += w; into.r += rgb[0] * w; into.g += rgb[1] * w; into.b += rgb[2] * w
  }
  const top = buckets.reduce((m, b) => (b.w > m.w ? b : m), { w: 0 })
  // A colourful emoji with a few white or black bits is still that colour.
  const pick = top.w > 0 && top.w >= grey.w * 0.15 ? top : grey
  if (!pick.w) return null
  return toHex([pick.r / pick.w, pick.g / pick.w, pick.b / pick.w])
}

// A few emoji to tap instead of typing one (the field takes any).
export const EMOJI_IDEAS = {
  flame: ['🔥', '⚡️', '🌟', '💪', '🚀', '❤️', '🏆', '🌶️'],
  freeze: ['❄️', '🧊', '🛡️', '☃️', '💤', '🐧', '💎', '🌙'],
}

/** What S.flameIcon / S.freezeIcon becomes for a pick: an icon of the set, or an emoji with its colour. */
export function pickValue (kind, pick, sample = sampleEmojiColor) {
  if (!pick) return null
  if (pick.k === 'icon') {
    const ch = choicesFor(kind).find(x => x.v === pick.v)
    return !ch || ch.def ? null : { k: 'icon', v: ch.v, c: ch.c }
  }
  const e = firstEmoji(pick.v)
  if (!e) return null
  return { k: 'emoji', v: e, c: sample(e) || (kind === 'freeze' ? FREEZE_DEFAULT : FLAME_DEFAULT) }
}
