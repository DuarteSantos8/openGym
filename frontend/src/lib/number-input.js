// What a number field shows and what it reads back, in the language's own notation.
//
// The text around a field is formatted by Intl for the UI language (lib/format.js fmtNum), so a
// German set row read "72,5 kg" next to a field holding "72.5". The field now shows the same
// decimal separator as that text, taken from the same Intl locale (dateLocale()), so the two can
// never disagree: German, Russian or French get a comma, English a point, and Arabic, Persian,
// Bengali and Swiss German keep the Latin digits and the point the app already prints for them.
//
// Only what is on screen changes. A field hands its owner a plain JavaScript number exactly as
// before, and the draft it keeps while typing stays in canonical form ("72.5").
import { dateLocale } from './i18n-core.js'

const seps = new Map()
/** { decimal, group } as Intl writes numbers for `locale` (default: the UI language's). */
export function numberSeparators(locale = dateLocale()) {
  let s = seps.get(locale)
  if (!s) {
    s = { decimal: '.', group: ',' }
    try {
      for (const p of new Intl.NumberFormat(locale).formatToParts(12345.6)) {
        if (p.type === 'decimal') s.decimal = p.value
        if (p.type === 'group') s.group = p.value
      }
    } catch { /* an engine without the locale: the plain point */ }
    // A field is one line of Latin digits; a separator from another script (or a digit system the
    // app does not print) would not match the text beside it, which uses nu-latn throughout.
    if (!/^[.,]$/.test(s.decimal)) s.decimal = '.'
    seps.set(locale, s)
  }
  return s
}
export const decimalSeparator = locale => numberSeparators(locale).decimal

/** A canonical number string ("72.5", "33.") as the field shows it in this language ("72,5", "33,"). */
export function localiseNumber(s, locale) {
  const text = String(s ?? '')
  if (!/^-?\d*\.?\d*$/.test(text)) return text
  const d = decimalSeparator(locale)
  return d === '.' ? text : text.replace('.', d)
}

// Every decimal digit block a keyboard can produce (Arabic-Indic, Persian, Devanagari, Bengali,
// Thai, full-width): the zero of each, nine more follow it.
const ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0e50, 0xff10]
const latinDigits = s => s.replace(/[٠-٩۰-۹०-९০-৯๐-๙０-９]/g, c => {
  const cp = c.codePointAt(0)
  return String(cp - ZEROS.find(z => cp >= z && cp <= z + 9))
})

/**
 * What was typed or pasted into a number field, as a canonical string: Latin digits and at most
 * one ".", or "" for nothing. A trailing separator survives ("33." while the 5 is still coming).
 *
 * Typing (`bulk` false): "," and "." both mean the decimal separator, in every language, since a
 * phone's decimal pad follows the device region and not the app language. The first one counts,
 * a second is dropped as it is typed.
 *
 * A paste or anything else that arrives in one go (`bulk` true) may carry thousands separators:
 *   "1.234,5" and "1,234.5"  the last separator is the decimal one, the others group  -> 1234.5
 *   "1.234.567", "1,234,567" one kind repeated in threes groups                       -> 1234567
 *   "1,234" in English, "1.234" in German: this language's own grouping sign in front of
 *                            exactly three digits groups                              -> 1234
 * Anything else with one separator is a decimal ("72,5" pasted into the English app is 72.5).
 * Spaces, apostrophes and the Arabic thousands sign only ever group and are dropped.
 */
export function canonicalNumber(raw, { bulk = false, locale } = {}) {
  let s = latinDigits(String(raw ?? ''))
    .replace(/٫/g, '.')                    // Arabic decimal separator
    .replace(/[^0-9.,]/g, '')
  if (bulk) {
    const dots = s.split('.').length - 1
    const commas = s.split(',').length - 1
    if (dots && commas) {
      const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
      s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1)
    } else if (dots + commas > 1) {
      if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '')
    } else if (dots + commas === 1) {
      const { decimal, group } = numberSeparators(locale)
      const sep = dots ? '.' : ','
      if (sep === group && sep !== decimal && /^[1-9]\d{0,2}[.,]\d{3}$/.test(s)) s = s.replace(sep, '')
    }
  }
  s = s.replace(/,/g, '.')
  const i = s.indexOf('.')
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '')
  return s
}
