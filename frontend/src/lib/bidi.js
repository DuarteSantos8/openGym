// Numbers in a right-to-left page (Arabic, Persian). A set reads "25 kg × 10" in every language,
// but digits and "×" have no direction of their own: dropped as they are into an Arabic line the
// bidi algorithm turns the run round, "kg × 10 25", and "22.5×12" becomes "12×22.5". Each such
// expression goes out as its own isolated run, so it keeps its left-to-right order whatever
// surrounds it, and the separators between them still follow the page.
//
// Strings carry the Unicode isolates (LRI/FSI … PDI), which the DOM, a canvas and a pasted text
// all honour; React can use <Bidi> for the same as a <bdi>. In a left-to-right language every
// helper here returns its input untouched, so nothing changes for anyone else.
import { getLang, baseLang, RTL_LANGS } from './i18n-core.js'

export const LRI = '⁦'
export const RLI = '⁧'
export const FSI = '⁨'
export const PDI = '⁩'
const OPENERS = new Set([LRI, RLI, FSI])
const MARKS = /[⁦-⁩‎‏‪-‮]/g

// Arabic and Hebrew letters, the presentation forms included. A set summary with one in it is a
// per-side set in Arabic ("يسار 15×8 · يمين 15×7"): forced left to right, its side words stood
// on the wrong side of their numbers. Such a run is still isolated, first-strong (FSI), and the
// numbers inside it have runs of their own (ltrRun).
export const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/

/** Whether the app is showing a right-to-left language right now. */
export const rtlLang = () => RTL_LANGS.has(baseLang(getLang()))

/** The `dir` a <bdi> around `text` takes: its own (auto) with RTL letters in it, else ltr. */
export const isoDir = text => (RTL_LETTER.test(String(text ?? '')) ? 'auto' : 'ltr')

/** Isolates closed that a cut (an ellipsis) left open, so they do not run into what follows. */
export function balanceIso(text) {
  let open = 0
  for (const ch of String(text ?? '')) {
    if (OPENERS.has(ch)) open++
    else if (ch === PDI && open > 0) open--
  }
  return String(text ?? '') + PDI.repeat(open)
}

/** `text` as a left-to-right run of its own (LRI … PDI) in a right-to-left language. */
export const ltrRun = (text, rtl = rtlLang()) => (rtl && text !== '' && text != null ? LRI + balanceIso(text) + PDI : text)

/**
 * `text` isolated in a right-to-left language: left to right (LRI) when it is numbers and Latin,
 * first-strong (FSI) when it has Arabic or Persian words in it. Empty and LTR stay as they are.
 */
export function isoRun(text, rtl = rtlLang()) {
  if (!rtl || text === '' || text == null) return text
  const s = String(text)
  return (RTL_LETTER.test(s) ? FSI : LRI) + balanceIso(s) + PDI
}

/** The text without any direction marks: for the native surfaces, which lay text out themselves. */
export const stripBidi = text => (typeof text === 'string' ? text.replace(MARKS, '') : text)
