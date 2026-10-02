// Which language a profile that never picked one should be in (#303).
//
// A profile's language is a setting like any other and is synced with it, so "never chose" has
// to be a fact in the state rather than a guess: `lang: 'en'` is also what everybody who picked
// English has. `langAuto: true` marks a copy that started fresh on this build and has not had a
// language picked in Settings since. Copies older than it carry no mark and are left exactly as
// they are — including every existing profile whose `lang` is the old default.
//
// For a marked copy, the instance's DEFAULT_LANG (GET /api/config `default_lang`) comes first,
// then the first of the browser's languages this app speaks, then English.
//
// That answer is worked out where the language is used (effectiveLang) and never written back
// into the state. It depends on the device — two phones of one profile can have browsers in two
// languages — and the state is synced: a derived language stored in it would be pushed by one
// device, pulled by the other, re-derived there and pushed back, round after round. `lang` is
// only written when someone picks one in Settings, which also clears the mark.
import { LANGS } from './i18n-core.js'

const KEYS = Object.keys(LANGS)

/** A language tag ('pt-BR', 'pt_br', 'de-AT', 'en-US') as one of LANGS' keys, or null. */
export function matchLocale(tag) {
  if (typeof tag !== 'string') return null
  const want = tag.trim().replace(/_/g, '-').toLowerCase()
  if (!want) return null
  const exact = KEYS.find(k => k.toLowerCase() === want)
  if (exact) return exact
  const base = want.split('-')[0]
  return KEYS.includes(base) ? base : null
}

/** The language a copy that never chose one should be in, or null for a copy that chose. */
export function autoLang(S, config, navLangs = []) {
  if (!S || S.langAuto !== true) return null
  return matchLocale(config?.default_lang)
    || (navLangs || []).map(matchLocale).find(Boolean)
    || 'en'
}

// The instance's DEFAULT_LANG as last seen on this device, so a boot does not show the browser's
// language (or the copy's stored one) until /api/config answers and then switch. '' means the
// instance has none; null means this device has not asked yet.
const CACHE_KEY = 'gym_default_lang'
export function rememberDefaultLang(config) {
  try { localStorage.setItem(CACHE_KEY, typeof config?.default_lang === 'string' ? config.default_lang : '') } catch { /* ignore */ }
}
function cachedDefaultLang() {
  try { return localStorage.getItem(CACHE_KEY) } catch { return null }
}

/**
 * The language to show this copy in, on this device: its own `lang`, or for a copy that never
 * picked one, what autoLang says. Before the config is in, the default this device last saw
 * stands in for it; with none seen yet the copy's stored language is used unchanged.
 */
export function effectiveLang(S, config, navLangs = browserLangs()) {
  const own = (S && typeof S.lang === 'string' && S.lang) || 'en'
  if (!S || S.langAuto !== true) return own
  let cfg = config
  if (!cfg) {
    const seen = cachedDefaultLang()
    if (seen === null) return own
    cfg = { default_lang: seen }
  }
  return autoLang(S, cfg, navLangs) || own
}

export function browserLangs() {
  try {
    const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]
    return list.filter(Boolean)
  } catch { return [] }
}
