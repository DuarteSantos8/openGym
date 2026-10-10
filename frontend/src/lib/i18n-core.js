// Runtime-agnostic core of the i18n module: state, constants and readers (t, dateLocale,
// instrFor, exerciseNameFor, getLang). Plain Node-loadable — the browser-only pieces
// (import.meta.glob lazy
// loads, the React subscription hook) live in i18n.js and re-export from here.

export const LANGS = {
  en: 'English', de: 'Deutsch', 'de-CH': 'Deutsch (Schweiz)', es: 'Español', fr: 'Français',
  it: 'Italiano', pt: 'Português (Portugal)', 'pt-BR': 'Português (Brasil)', pl: 'Polski',
  tr: 'Türkçe', ru: 'Русский', uk: 'Українська', zh: '简体中文', 'zh-TW': '繁體中文',
  ko: '한국어', hi: 'हिन्दी', bn: 'বাংলা', th: 'ไทย', hu: 'Magyar', ar: 'العربية'
}
// Languages with exercise instructions / names, generated from catalogue/i18n by
// scripts/catalogue/build.mjs. A pack can be partial; what it lacks shows in English.
import { INSTR_LANGS, EXERCISE_NAME_LANGS } from './catalogue-langs.js'
export { INSTR_LANGS, EXERCISE_NAME_LANGS }
// Languages rendered right-to-left; i18n.js setLang applies the direction from this.
export const RTL_LANGS = new Set(['ar'])
export const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', 'de-CH': 'de-CH', es: 'es-ES', fr: 'fr-FR', it: 'it-IT',
  pt: 'pt-PT', 'pt-BR': 'pt-BR',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA', zh: 'zh-CN', 'zh-TW': 'zh-TW', ko: 'ko-KR', hi: 'hi-IN', bn: 'bn-BD-u-nu-latn', th: 'th-TH', hu: 'hu-HU', ar: 'ar-u-nu-latn'
}

// Locales derived from another language by a pure text transform rather than carried as their
// own pack. Swiss Standard German has no ß — every one is written ss — so de-CH is de with a
// single substitution. Deriving it keeps one German source of truth: a hand-maintained de-CH
// would be 98.7% identical to de.js (16 of 1265 values differ), and check-locales.mjs would
// then require every future German string to be written twice, forever.
//
// The transform is exact in this direction ONLY. Going back needs vowel length — "Maße" and
// "Masse" both collapse to "Masse" — so de is always the base and never the derivative.
//
// Note this covers orthography, not vocabulary: a Swiss-specific word choice (Velo for
// Fahrrad) would need a real pack. None of the current strings contain one.
export const DERIVED_LOCALES = {
  'de-CH': { base: 'de', transform: s => s.replace(/ß/g, 'ss') }
}

// The language whose packs a locale actually loads: a derived locale reads its base's, every
// other language its own. Used for the INSTR_LANGS/EXERCISE_NAME_LANGS membership tests too,
// so de-CH gains instructions and exercise names exactly when de does, with no second entry
// to remember to add.
export const baseLang = l => DERIVED_LOCALES[l]?.base || l

// Applies a derived locale's transform to a loaded pack, returning it unchanged for a language
// that is not derived. Packs are trees of strings: the locale pack is flat { source: target },
// instruction packs are { exId: [steps] }, exercise-name packs { exId: name }.
export function derivePack(l, pack) {
  const transform = DERIVED_LOCALES[l]?.transform
  if (!transform || !pack) return pack
  const walk = v =>
    typeof v === 'string' ? transform(v)
      : Array.isArray(v) ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, inner]) => [k, walk(inner)]))
          : v
  return walk(pack)
}

let lang = 'en'                 // set only by _setLangState, called from i18n.js setLang
let dict = {}                   // current locale pack (empty = English fallback)
let instr = null                // { exId: [steps] } for the current language, null = English
let exerciseNames = null        // { exId: translated name }, null = original catalogue name
let enInstr = null              // { exId: [steps] } in English, loaded on first need (instr/en.js)
let descs = null                // { exId: description } for the current language, when it has any
let enDescs = null              // { exId: description } in English (exercise-desc/en.js)
let detailsLoader = null        // registered by i18n.js; fetches the two English packs above
let detailsAsked = false
let enParens = true               // whether translated names show the English original in parentheses
let enOnly = false                // whether translated names are replaced entirely by the English original
let version = 0                 // bumped on every setLang; drives the React subscription selector

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'
export const getVersion = () => version

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  // A plural key (an object of forms, read by tn()) reached through plain t() — a call site
  // that was not moved to tn(). Pick a form rather than crash on replaceAll.
  if (v && typeof v === 'object') {
    const forms = v
    v = (typeof args[0] === 'number' && forms[pluralCategory(args[0])]) || forms.other || forms.many || forms.one || s
  }
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}

/* ------------------------------------------------------------------ plurals --
   English has two forms and the source strings are the keys, so a count used to be
   written `t(n === 1 ? '{0} set' : '{0} sets', n)` and every pack inherited that
   two-way split. Russian, Ukrainian and Polish have three (1 подход, 2 подхода,
   5 подходов) and Arabic six, so those packs could only pick the least wrong of two
   — "2 подходов" — or dodge the grammar entirely, which is why the Russian pack
   reads "Упражнений: {0}" where a person would say "2 упражнения".

   The rule itself comes from the platform, the same way fmtAgo takes relative time
   from Intl.RelativeTimeFormat: no pack carries a rule, only its own forms. A pack
   answers a plural key with either a plain string (unchanged, still correct for every
   two-form language) or an object keyed by CLDR category:

     '{0} sets': { one: '{0} подход', few: '{0} подхода', many: '{0} подходов' }

   Keys stay the English plural, so a pack that says nothing new behaves as before. */
const pluralCategory = n => {
  try { return new Intl.PluralRules(dateLocale()).select(n) }
  catch { return n === 1 ? 'one' : 'other' }
}

/**
 * A translated count. `one` and `other` are the English source strings, as written at
 * the call site today; `n` picks the form. A pack entry that is an object supplies the
 * forms of the target language, falling back through `other` to the English pair.
 */
export function tn(one, other, n, ...rest) {
  const forms = dict[other]
  if (forms && typeof forms === 'object') {
    const form = forms[pluralCategory(n)] || forms.other || forms.many || forms.one
    if (form) {
      let v = form
      const args = [n, ...rest]
      for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
      return v
    }
  }
  return t(n === 1 ? one : other, n, ...rest)
}

// The English steps and descriptions of 5,000+ exercises are too big to sit in the bundle every
// screen loads, so they come in their own chunk the first time an exercise's details are shown.
// Until it lands the readers return nothing, and the loader's notify re-renders whoever asked.
const askDetails = () => {
  if (detailsAsked || !detailsLoader) return
  detailsAsked = true
  detailsLoader()
}

// A load that failed: the next reader to ask after a pause tries again, and so does the browser
// coming back online. Not at once: every render asks, and offline every try fails at once.
let retryTimer = null
let onOnline = null
function clearRetry() {
  clearTimeout(retryTimer)
  retryTimer = null
  if (onOnline && typeof globalThis.removeEventListener === 'function') globalThis.removeEventListener('online', onOnline)
  onOnline = null
}
export function _detailsFailed(retryMs = 20000) {
  clearRetry()
  retryTimer = setTimeout(() => { clearRetry(); detailsAsked = false }, retryMs)
  if (typeof globalThis.addEventListener === 'function') {
    onOnline = () => { clearRetry(); detailsAsked = false; askDetails() }
    globalThis.addEventListener('online', onOnline)
  }
}

// Instructions for an exercise in the current language (English steps as fallback). `st` on the
// exercise itself still wins over nothing: a custom exercise or an older plan file carries its own.
export const instrFor = ex => {
  if (ex?._ov?.st) return ex._ov.st
  const own = instr && instr[ex.id]
  if (own) return own
  if (!enInstr) askDetails()
  return (enInstr && enInstr[ex.id]) || ex.st || []
}

// Whether the steps instrFor shows are in the current language rather than the English fallback.
export const instrTranslated = ex => !!(ex?._ov?.st || (instr && ex && instr[ex.id]))

// A sentence or two on what the exercise is, in the current language when someone has written
// it, otherwise in English. Empty for exercises nobody has described yet and for custom ones.
export const descFor = ex => {
  if (!ex) return ''
  if (Object.hasOwn(ex._ov || {}, 'desc')) return ex._ov.desc
  const own = descs && descs[ex.id]
  if (own) return own
  if (!enDescs) askDetails()
  return (enDescs && enDescs[ex.id]) || ex.desc || ''
}

// i18n.js hands over the loader here; core itself never imports a chunk.
export function _setDetailsLoader(fn) { detailsLoader = fn; detailsAsked = false; clearRetry() }

// Called once the English packs (and the language's descriptions, if any) have loaded. A pack
// that did not come (offline, before the worker had it) stays missing, not empty: an empty one
// would show no steps until the next reload. `forLang` is the language the descriptions were
// loaded for: switched away from while they loaded, they are not this language's and are not
// kept (the English packs are the same for every language). False then, and the caller loads
// the current language's own.
export function _setDetails(newEnInstr, newEnDescs, newDescs, forLang = lang) {
  enInstr = newEnInstr || enInstr
  enDescs = newEnDescs || enDescs
  if (enInstr && enDescs) clearRetry()
  const current = forLang === lang
  if (current) descs = lang === 'en' ? null : (newDescs || null)
  version++
  return current
}

// Built-in catalogue names are bilingual when a translated name pack is active. A pack need not
// be complete: German covers the equipment exercises and not the body-weight ones, and an
// exercise the pack has no entry for keeps its English title, one exercise at a time.
// User-created exercises have no entry in the pack and keep their exact chosen name.
export const exerciseNameFor = ex => {
  // Same reasoning as instrFor: an override to a built-in's name is the resolved, intentional
  // value — show it as-is rather than letting the pack (or the loanword parenthetical logic
  // below, which exists only to compare a pack translation against the pristine English name)
  // second-guess it.
  if (ex?._ov?.n) return ex._ov.n
  // A language that chose "English names only" sees the canonical catalogue title, not the
  // translation — and never the parenthetical either. Custom exercises keep their exact name.
  if (enOnly) return ex?.n || ''
  const translated = exerciseNames && ex && exerciseNames[ex.id]
  if (!translated) return ex?.n || ''
  // Some names (Burpee, Pilates, brand/model terms) are the established term in the target
  // language too. Repeating an identical loanword in parentheses adds noise rather than
  // context. Compared in the active language's own casing rules, not hardcoded to one —
  // this only ever differs from ordinary casing for languages with locale-specific rules
  // (e.g. Turkish dotless i), which does not include any language shipped here today.
  return translated.toLocaleLowerCase(lang) === ex.n.toLocaleLowerCase('en')
      || !enParens
    ? translated
    : `${translated} (${ex.n})`
}

// Exercise-name packs written in the language's own casing. German capitalises its nouns and
// lower-cases the adjectives in front of them ("Assistiertes hängendes Knieheben"), which
// title-casing on top would undo. Every other pack is stored lower-case, the way EXDB stores
// the English names ("supino com barra"). Left without the title-casing English gets, those
// read all lower-case in every list, card and history row. A new pack goes here only when it
// carries real casing; i18n-core.test.js checks this list against the packs themselves.
export const CASED_NAME_LANGS = ['de']

// EXDB stores English names lower-case and the UI title-cases them with CSS. A pack in
// CASED_NAME_LANGS carries its own casing and must not be cased again on top, so the class that
// does the title-casing stays off its translated names. A lower-case pack is title-cased like
// English. That is decided per exercise, not only per language: German covers only part of the
// catalogue, and an exercise it has no entry for shows its lower-case English title, which still
// needs the casing ("push-up" would otherwise sit between "Bankdrücken" and "Kniebeuge"). A custom
// exercise has no pack entry either and keeps the casing it always had, and so does every
// exercise while "English names only" is on, since exerciseNameFor then shows the English title.
// Callers spread this onto the element that holds exerciseNameFor(ex)'s output, nothing else —
// muscle and equipment labels next to it are t() strings and keep their own capitalize.
export const exerciseNameClass = ex => (!enOnly && exerciseNames && ex && exerciseNames[ex.id]
  && CASED_NAME_LANGS.includes(baseLang(lang)) ? '' : 'capitalize')

// Search both the localized and canonical English title without changing persisted data.
export const exerciseNameSearchText = ex => {
  const translated = exerciseNames && ex && exerciseNames[ex.id]
  return translated ? `${translated} ${ex.n}` : (ex?.n || '')
}

// Called by i18n.js's setLang once the locale pack has been loaded — kept here rather than
// exported as setLang because loading packs requires import.meta.glob, which is Vite-only.
// `dict`, `instr` and `exerciseNames` may be null to reset to their English fallbacks.
export function _setLangState(newLang, newDict, newInstr, newExerciseNames, showEn = true, enOnlyFlag = false) {
  const was = lang
  lang = LANGS[newLang] ? newLang : 'en'
  // The old language's descriptions are not this one's: English until its own have loaded.
  if (lang !== was) descs = null
  dict = lang === 'en' ? {} : (newDict || {})
  instr = lang === 'en' || !INSTR_LANGS.includes(baseLang(lang)) ? null : (newInstr || null)
  exerciseNames = lang === 'en' || !EXERCISE_NAME_LANGS.includes(baseLang(lang))
    ? null
    : (newExerciseNames || null)
  enParens = !!showEn
  enOnly = !!enOnlyFlag
  version++
  return version
}
