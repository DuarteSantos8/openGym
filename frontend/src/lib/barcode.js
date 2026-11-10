// 1D barcodes for the gym check-in cards (issue #550), next to lib/qr.js's QR path. Hand-written
// on purpose: the app stays dependency-light, and five symbologies cover the membership cards we
// hear about. Both directions share the tables below:
//   - encodeBars(value, fmt): what the card view draws (drawBarsToCanvas), one entry per module
//   - decodeBarcodeImage(img): what the browser uses where it has no BarcodeDetector (iOS Safari),
//     after jsQR found no QR (lib/scan-web.js). The apps decode with ML Kit and never come here.
//
// fmt tokens are lib/qr.js normalizeFmt's: code128, code39, ean13, ean8, upca.

export const BAR_FMTS = ['code128', 'code39', 'ean13', 'ean8', 'upca']

/* ------------------------------------------------------------------ tables -- */

// Code 128 symbols 0..106, as bar/space widths in modules (106 is the 7-element stop).
export const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
  '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 ' +
  '312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 ' +
  '112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 ' +
  '211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 ' +
  '431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 ' +
  '241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 ' +
  '421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 ' +
  '311141 411131 211412 211214 211232 2331112').split(' ')
const START_A = 103, START_B = 104, START_C = 105, STOP = 106

// Code 39: the 43 characters plus the * delimiter. Each is 5 bars and 4 spaces, three of them
// wide; the table is built from the symbology's own regular layout rather than typed out.
const C39_CHARS = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ-. *'
const C39_BARS = [[0, 4], [1, 4], [0, 1], [2, 4], [0, 2], [1, 2], [3, 4], [0, 3], [1, 3], [2, 3]]
export const C39 = {}
C39_CHARS.split('').forEach((ch, i) => {
  const wide = [...C39_BARS[i % 10].map(b => b * 2), [3, 5, 7, 1][Math.floor(i / 10)]]
  C39[ch] = Array.from({ length: 9 }, (_, k) => wide.includes(k) ? 3 : 1)
})
for (const [ch, sp] of [['$', [1, 3, 5]], ['/', [1, 3, 7]], ['+', [1, 5, 7]], ['%', [3, 5, 7]]]) {
  C39[ch] = Array.from({ length: 9 }, (_, k) => sp.includes(k) ? 3 : 1)
}

// EAN/UPC digits as widths. L (space first) reads the same as R (bar first); G is L reversed.
const EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112']
// The leading EAN-13 digit is not drawn: it picks L or G for each of the six left digits.
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
const widths = s => s.split('').map(Number)
const rev = s => s.split('').reverse().join('')

function eanCheck(digits) {
  // weight 3 on the digit next to the check digit, alternating leftwards
  let sum = 0
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += Number(digits[i]) * w
  return (10 - (sum % 10)) % 10
}
const eanValid = v => eanCheck(v.slice(0, -1)) === Number(v[v.length - 1])

/* ---------------------------------------------------------------- encoding -- */

// Widths (alternating bar, space, starting with a bar) → modules, with a 10-module quiet zone
// either side, which readers need to find the code.
function toModules(ws) {
  const out = new Array(10).fill(0)
  ws.forEach((w, i) => { for (let k = 0; k < w; k++) out.push(i % 2 ? 0 : 1) })
  return out.concat(new Array(10).fill(0))
}

function code128Widths(value) {
  let syms
  if (/^(\d\d)+$/.test(value)) {
    syms = [START_C]
    for (let i = 0; i < value.length; i += 2) syms.push(Number(value.slice(i, i + 2)))
  } else {
    if (!/^[\x20-\x7e]+$/.test(value)) return null
    syms = [START_B, ...value.split('').map(c => c.charCodeAt(0) - 32)]
  }
  syms.push(syms.reduce((s, v, i) => s + v * Math.max(i, 1), 0) % 103, STOP)
  return syms.flatMap(s => widths(C128[s]))
}

function code39Widths(value) {
  const s = '*' + value + '*'
  if (!value || s.slice(1, -1).includes('*') || [...s].some(c => !C39[c])) return null
  // one narrow space between characters
  return [...s].flatMap((c, i) => i ? [1, ...C39[c]] : C39[c])
}

function eanWidths(value) {
  const left = value.length === 8 ? 'LLLL' : EAN_PARITY[value[0]]
  const digits = value.length === 8 ? value : value.slice(1)
  const half = digits.length / 2
  // The colours alternate throughout: guard (bar first), left digits (space first), middle guard
  // (space first), right digits (bar first), end guard.
  const ws = [1, 1, 1]
  for (let i = 0; i < half; i++) {
    const l = EAN_L[digits[i]]
    ws.push(...widths(left[i] === 'G' ? rev(l) : l))
  }
  ws.push(1, 1, 1, 1, 1)
  for (let i = half; i < digits.length; i++) ws.push(...widths(EAN_L[digits[i]]))
  ws.push(1, 1, 1)
  return ws
}

// value + fmt → array of 1 (dark) / 0 (light) modules, or null when the value cannot be drawn in
// that symbology. A card is only saved when this succeeds, so what we draw is what was scanned.
export function encodeBars(value, fmt) {
  const v = String(value || '')
  if (!v) return null
  let ws = null
  if (fmt === 'code128') ws = code128Widths(v)
  else if (fmt === 'code39') ws = code39Widths(v)
  else if (fmt === 'ean13' && /^\d{13}$/.test(v) && eanValid(v)) ws = eanWidths(v)
  else if (fmt === 'ean8' && /^\d{8}$/.test(v) && eanValid(v)) ws = eanWidths(v)
  else if (fmt === 'upca' && /^\d{12}$/.test(v) && eanValid(v)) ws = eanWidths('0' + v)
  return ws && toModules(ws)
}

// Draw onto a canvas 1 pixel high (CSS stretches it vertically), with every module the same
// whole number of pixels wide: as many as fit in `maxPx`, at least 1. Stretching 1 px per module
// to a CSS width instead made modules alternate 3 and 4 device pixels, and ML Kit could not read
// a Code 128 drawn that way. The caller sizes the canvas to canvas.width device pixels (QrCanvas).
// Black on white for the same reason as the QR: readers want contrast, not theme colours.
// Returns the module count, 0 when the value is not drawable.
export function drawBarsToCanvas(canvas, value, fmt, maxPx = 0) {
  const mods = canvas && encodeBars(value, fmt)
  if (!mods) return 0
  const k = Math.max(1, Math.floor(maxPx / mods.length))
  canvas.width = mods.length * k; canvas.height = 1
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, 1)
  ctx.fillStyle = '#000000'
  mods.forEach((m, x) => { if (m) ctx.fillRect(x * k, 0, k, 1) })
  return mods.length
}

/* ---------------------------------------------------------------- decoding -- */

// Nearest table entry for a run of measured widths, scaled so they sum to `total` modules.
// Returns the index, or -1 when even the best match is off by more than about a module.
function nearest(runs, table, total) {
  const k = total / runs.reduce((a, b) => a + b, 0)
  let best = -1, bestErr = Infinity
  for (let i = 0; i < table.length; i++) {
    const t = table[i]
    let err = 0
    for (let j = 0; j < runs.length; j++) err += Math.abs(runs[j] * k - t[j])
    if (err < bestErr) { bestErr = err; best = i }
  }
  return bestErr < 1.5 ? best : -1
}

const C128_W = C128.slice(0, STOP).map(widths)
const EAN_LW = EAN_L.map(widths)
const EAN_LGW = [...EAN_LW, ...EAN_L.map(s => widths(rev(s)))]   // index 10+ is the G form

// runs[0] is light; odd indices are dark. A code must start on a dark run with room before it.
function quietBefore(runs, i, moduleW) { return i === 1 || runs[i - 1] >= 5 * moduleW }

function decode128(runs) {
  for (let i = 1; i + 6 * 3 + 7 <= runs.length; i += 2) {
    const start = nearest(runs.slice(i, i + 6), C128_W, 11)
    if (start < START_A) continue
    if (!quietBefore(runs, i, runs.slice(i, i + 6).reduce((a, b) => a + b, 0) / 11)) continue
    const syms = [start]
    let j = i + 6, ok = false
    while (j + 6 <= runs.length) {
      const seg = runs.slice(j, j + 6)
      if (nearest(seg, [widths('233111')], 11) === 0) { ok = true; break }
      const s = nearest(seg, C128_W, 11)
      if (s < 0) break
      syms.push(s); j += 6
    }
    if (!ok || syms.length < 3) continue
    const check = syms.pop()
    if (syms.reduce((s, v, k) => s + v * Math.max(k, 1), 0) % 103 !== check) continue
    const value = read128(syms)
    if (value) return { value, fmt: 'code128' }
  }
  return null
}

// Symbol values → text across code sets A/B/C, with shift. FNC1-4 (GS1 data, extended ASCII)
// are not something we could draw back faithfully, so such a code reads as nothing.
function read128(syms) {
  let set = syms[0] - START_A, out = ''   // 0 = A, 1 = B, 2 = C
  for (let k = 1; k < syms.length; k++) {
    const s = syms[k]
    if (set === 2) {
      if (s < 100) { out += String(s).padStart(2, '0'); continue }
    } else if (s < 96) {
      out += String.fromCharCode(set === 1 ? s + 32 : s < 64 ? s + 32 : s - 64); continue
    }
    if (s === 99 && set !== 2) set = 2
    else if (s === 100 && set !== 1) set = 1
    else if (s === 101 && set !== 0) set = 0
    else if (s === 98 && set !== 2 && k + 1 < syms.length && syms[k + 1] < 96) {
      const n = syms[++k]
      out += String.fromCharCode(set === 0 ? n + 32 : n < 64 ? n + 32 : n - 64)
    } else return null
  }
  return out || null
}

function decodeEan(runs) {
  for (const n of [6, 4]) {                       // EAN-13 first, then EAN-8
    const len = 3 + n * 4 + 5 + n * 4 + 3
    for (let i = 1; i + len <= runs.length; i += 2) {
      const guard = runs.slice(i, i + 3)
      const m = (guard[0] + guard[1] + guard[2]) / 3
      if (guard.some(g => g > m * 1.8 || g < m * 0.5) || !quietBefore(runs, i, m)) continue
      let j = i + 3, parity = '', digits = ''
      for (let d = 0; d < n; d++, j += 4) {
        const d = nearest(runs.slice(j, j + 4), n === 6 ? EAN_LGW : EAN_LW, 7)
        if (d < 0) break
        digits += d % 10; parity += d < 10 ? 'L' : 'G'
      }
      if (digits.length !== n) continue
      j += 5                                        // middle guard
      for (let d = 0; d < n; d++, j += 4) {
        const r = nearest(runs.slice(j, j + 4), EAN_LW, 7)
        if (r < 0) break
        digits += r
      }
      if (digits.length !== n * 2) continue
      if (n === 4) {
        if (parity === 'LLLL' && eanValid(digits)) return { value: digits, fmt: 'ean8' }
        continue
      }
      const first = EAN_PARITY.indexOf(parity)
      const value = first + digits
      if (first >= 0 && eanValid(value)) return { value, fmt: 'ean13' }
    }
  }
  return null
}

function decode39(runs) {
  const char = seg => {
    if (seg.length < 9) return null
    const sorted = [...seg].sort((a, b) => b - a)
    // three clearly wide elements, six clearly narrow ones
    if (sorted[2] < sorted[3] * 1.5) return null
    const ws = seg.map(w => w >= sorted[2] ? 3 : 1)
    return Object.keys(C39).find(c => C39[c].every((x, k) => x === ws[k])) || null
  }
  for (let i = 1; i + 9 <= runs.length; i += 2) {
    if (char(runs.slice(i, i + 9)) !== '*') continue
    if (!quietBefore(runs, i, runs.slice(i, i + 9).reduce((a, b) => a + b, 0) / 15)) continue
    let out = '', j = i + 10
    for (;;) {
      const c = char(runs.slice(j, j + 9))
      if (!c) { out = null; break }
      if (c === '*') break
      out += c; j += 10
    }
    if (out) return { value: out, fmt: 'code39' }
  }
  return null
}

// One row of luminance (0..255) → { value, fmt } | null. Read left to right and right to left,
// so a card photographed upside down still reads.
// shortcut: one threshold per row (midpoint of its min and max), so a row with a strong light
// gradient across it fails; a per-run local threshold is the upgrade if photos keep failing.
export function decodeBarsRow(lum) {
  let lo = 255, hi = 0
  for (const v of lum) { if (v < lo) lo = v; if (v > hi) hi = v }
  if (hi - lo < 40) return null
  const mid = (lo + hi) / 2
  const runs = [0]
  let dark = false
  for (const v of lum) {
    const d = v < mid
    if (d !== dark) { runs.push(0); dark = d }
    runs[runs.length - 1]++
  }
  if (dark) runs.push(0)
  for (const r of [runs, [...runs].reverse()]) {
    const hit = decode128(r) || decodeEan(r) || decode39(r)
    if (hit) return hit
  }
  return null
}

// { data (RGBA), width, height } → { value, fmt } | null, trying a spread of rows. Code 128 and
// EAN carry a check digit; Code 39 does not, so it has to read the same on two rows to count.
export function decodeBarcodeImage(img) {
  if (!img || !img.data || !img.width || !img.height) return null
  const { data, width, height } = img
  const ROWS = 15
  const seen = {}
  for (let r = 0; r < ROWS; r++) {
    // middle row first, then fanning out: the code is usually near the centre of the frame
    const off = Math.ceil(r / 2) * (r % 2 ? 1 : -1)
    const y = Math.min(height - 1, Math.max(0, Math.round(height / 2 + off * height / (ROWS + 1))))
    const lum = new Uint8Array(width)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      lum[x] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
    }
    const hit = decodeBarsRow(lum)
    if (!hit) continue
    if (hit.fmt !== 'code39') return hit
    const key = hit.value
    if (seen[key]) return hit
    seen[key] = true
  }
  return null
}
