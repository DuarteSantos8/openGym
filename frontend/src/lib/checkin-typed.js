// Typing a gym card's number by hand (views/CheckIn.jsx), only offered once a scan or a photo
// came back empty. A typo here fails silently at the turnstile, so every format gets a guard:
// EAN-13, EAN-8 and UPC-A carry their own check digit and must pass it; Code 128, Code 39 and a
// QR text have none, so they are typed twice and both have to match. The result is drawn big for
// a side-by-side look against the card before it is saved.
import { encodeBars, eanValid } from './barcode.js'

export const TYPED_FMTS = ['ean13', 'upca', 'ean8', 'code128', 'code39', 'qrcode']
const DIGITS = { ean13: 13, upca: 12, ean8: 8 }
export const QR_MAX = 512
export const BAR_MAX = 80

/** Whether the format proves itself with a check digit (no second entry needed). */
export const hasCheckDigit = fmt => fmt in DIGITS

/** What the person typed, as the code will store it: digits only for EAN/UPC, upper case for Code 39. */
export function normalizeTyped(raw, fmt) {
  const s = String(raw ?? '')
  if (hasCheckDigit(fmt)) return s.replace(/[\s-]/g, '')
  if (fmt === 'code39') return s.trim().toUpperCase()
  return s.trim()
}

/**
 * Checks a typed code. Returns { ok: true, value } or { ok: false, why } with why one of
 *   'empty'     nothing typed yet
 *   'digits'    EAN/UPC with something other than digits
 *   'length'    EAN/UPC with the wrong number of digits (`want` says how many)
 *   'check'     EAN/UPC whose last digit does not add up: a typo somewhere
 *   'chars'     a character the format cannot carry
 *   'long'      longer than the format takes (`max`)
 *   'again'     the second entry is still empty
 *   'mismatch'  the two entries differ
 */
export function checkTyped(raw, fmt, again = null) {
  const value = normalizeTyped(raw, fmt)
  if (!value) return { ok: false, why: 'empty' }
  if (hasCheckDigit(fmt)) {
    if (!/^\d+$/.test(value)) return { ok: false, why: 'digits' }
    if (value.length !== DIGITS[fmt]) return { ok: false, why: 'length', want: DIGITS[fmt] }
    if (!eanValid(value)) return { ok: false, why: 'check' }
    return encodeBars(value, fmt) ? { ok: true, value } : { ok: false, why: 'check' }
  }
  const max = fmt === 'qrcode' ? QR_MAX : BAR_MAX
  if (value.length > max) return { ok: false, why: 'long', max }
  if (fmt === 'code39' && !/^[A-Z0-9 .$/+%-]+$/.test(value)) return { ok: false, why: 'chars' }
  if (fmt === 'code128' && !/^[\x20-\x7e]+$/.test(value)) return { ok: false, why: 'chars' }
  if (fmt !== 'qrcode' && !encodeBars(value, fmt)) return { ok: false, why: 'chars' }
  const second = normalizeTyped(again, fmt)
  if (!second) return { ok: false, why: 'again' }
  if (second !== value) return { ok: false, why: 'mismatch' }
  return { ok: true, value }
}
