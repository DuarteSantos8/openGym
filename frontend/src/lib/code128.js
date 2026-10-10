// Code 128 encoding for gym check-in cards (see views/CheckIn.jsx, components/CardCode.jsx).
//
// Many gyms print a 1D Code 128 barcode on the membership card (the club app's "Access Card"
// screen shows one too), and a laser turnstile reader cannot read a QR code. Like lib/qr.js we
// only store the card's value; the bars are regenerated from it here every time it is shown.
//
// Pure and dependency-free: encodeCode128(value) returns the run widths (in modules, starting
// with a bar and alternating bar/space) for the full symbol - start code, data, checksum, stop.
// The caller adds the quiet zones and draws it.

// Bar/space widths of the 107 Code 128 symbols, by symbol value. Every data symbol is 11 modules
// wide (three bars, three spaces); the stop pattern (106) is 13 (four bars, three spaces).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const STOP = 106

export { PATTERNS as CODE128_PATTERNS }

// Code set B covers printable ASCII (space..DEL); set C packs two digits per symbol, so an
// all-digit value of even length (membership numbers usually are) uses C and comes out half as
// wide. Returns null for anything Code 128 B cannot carry (control characters, non-ASCII).
export function code128Symbols(value) {
  const s = String(value ?? '')
  if (!s) return null
  let symbols
  if (/^\d+$/.test(s) && s.length % 2 === 0) {
    symbols = [START_C]
    for (let i = 0; i < s.length; i += 2) symbols.push(Number(s.slice(i, i + 2)))
  } else {
    symbols = [START_B]
    for (const ch of s) {
      const c = ch.codePointAt(0)
      if (c < 32 || c > 127) return null
      symbols.push(c - 32)
    }
  }
  let sum = symbols[0]
  for (let i = 1; i < symbols.length; i++) sum += i * symbols[i]
  symbols.push(sum % 103, STOP)
  return symbols
}

// value → run widths in modules (bar, space, bar, ... ending on the stop's final bar), or null
// when the value can't be encoded.
export function encodeCode128(value) {
  const symbols = code128Symbols(value)
  if (!symbols) return null
  const runs = []
  for (const sym of symbols) for (const w of PATTERNS[sym]) runs.push(Number(w))
  return runs
}
