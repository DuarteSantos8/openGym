TASK:
Make one minimal change only in frontend/src/lib/i18n-core.js: append zh and zh-TW to the EXERCISE_NAME_LANGS array. Complete Chinese exercise-name packs will be added separately by the primary agent. Do not change any other logic, defaults, functions, or arrays. Return minimal unified diff.

PROJECT CONTEXT:

--- FILE: frontend/src/lib/i18n-core.js ---
// Runtime-agnostic core of the i18n module: state, constants and readers (t, dateLocale,
// instrFor, exerciseNameFor, getLang). Plain Node-loadable 鈥?the browser-only pieces
// (import.meta.glob lazy
// loads, the React subscription hook) live in i18n.js and re-export from here.

export const LANGS = {
  en: 'English', de: 'Deutsch', 'de-CH': 'Deutsch (Schweiz)', es: 'Espa帽ol', fr: 'Fran莽ais',
  it: 'Italiano', pt: 'Portugu锚s (Portugal)', 'pt-BR': 'Portugu锚s (Brasil)', pl: 'Polski',
  tr: 'T眉rk莽e', ru: '袪褍褋褋泻懈泄', uk: '校泻褉邪褩薪褋褜泻邪', zh: '绠€浣撲腑鏂?, 'zh-TW': '绻侀珨涓枃',
  ko: '頃滉淡鞏?, hi: '啶灌た啶ㄠ啶︵', th: '喙勦笚喔?, hu: 'Magyar', ar: '丕賱毓乇亘賷丞'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'zh-TW', 'hi', 'pl', 'ko', 'pt-BR', 'hu', 'ar']
export const EXERCISE_NAME_LANGS = ['pt-BR', 'hu', 'de', 'es', 'ru', 'it', 'fr']
// Languages rendered right-to-left; i18n.js setLang applies the direction from this.
export const RTL_LANGS = new Set(['ar'])
export const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', 'de-CH': 'de-CH', es: 'es-ES', fr: 'fr-FR', it: 'it-IT',
  pt: 'pt-PT', 'pt-BR': 'pt-BR',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA', zh: 'zh-CN', 'zh-TW': 'zh-TW', ko: 'ko-KR', hi: 'hi-IN', th: 'th-TH', hu: 'hu-HU', ar: 'ar-u-nu-latn'
}

// Locales derived from another language by a pure text transform rather than carried as their
// own pack. Swiss Standard German has no 脽 鈥?every one is written ss 鈥?so de-CH is de with a
// single substitution. Deriving it keeps one German source of truth: a hand-maintained de-CH
// would be 98.7% identical to de.js (16 of 1265 values differ), and check-locales.mjs would
// then require every future German string to be written twice, forever.
//
// The transform is exact in this direction ONLY. Going back needs vowel length 鈥?"Ma脽e" and
// "Masse" both collapse to "Masse" 鈥?so de is always the base and never the derivative.
//
// Note this covers orthography, not vocabulary: a Swiss-specific word choice (Velo for
// Fahrrad) would need a real pack. None of the current strings contain one.
export const DERIVED_LOCALES = {
  'de-CH': { base: 'de', transform: s => s.replace(/脽/g, 'ss') }
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
let enParens = true               // whether translated names show the English original in parentheses
let enOnly = false                // whether translated names are replaced entirely by the English original
let version = 0                 // bumped on every setLang; drives the React subscription selector

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'
export const getVersion = () => version

// Translate a source string; {0},{1}鈥?are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  // A plural key (an object of forms, read by tn()) reached through plain t() 鈥?a call site
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
   two-way split. Russian, Ukrainian and Polish have three (1 锌芯写褏芯写, 2 锌芯写褏芯写邪,
   5 锌芯写褏芯写芯胁) and Arabic six, so those packs could only pick the least wrong of two
   鈥?"2 锌芯写褏芯写芯胁" 鈥?or dodge the grammar entirely, which is why the Russian pack
   reads "校锌褉邪卸薪械薪懈泄: {0}" where a person would say "2 褍锌褉邪卸薪械薪懈褟".

   The rule itself comes from the platform, the same way fmtAgo takes relative time
   from Intl.RelativeTimeFormat: no pack carries a rule, only its own forms. A pack
   answers a plural key with either a plain string (unchanged, still correct for every
   two-form language) or an object keyed by CLDR category:

     '{0} sets': { one: '{0} 锌芯写褏芯写', few: '{0} 锌芯写褏芯写邪', many: '{0} 锌芯写褏芯写芯胁' }

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

// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

// Built-in catalogue names are bilingual when a translated name pack is active. A pack need not
// be complete: German covers the equipment exercises and not the body-weight ones, and an
// exercise the pack has no entry for keeps its English title, one exercise at a time.
// User-created exercises have no entry in the pack and keep their exact chosen name.
export const exerciseNameFor = ex => {
  // A language that chose "English names only" sees the canonical catalogue title, not the
  // translation 鈥?and never the parenthetical either. Custom exercises keep their exact name.
  if (enOnly) return ex?.n || ''
  const translated = exerciseNames && ex && exerciseNames[ex.id]
  if (!translated) return ex?.n || ''
  // Some names (Burpee, Pilates, brand/model terms) are the established term in the target
  // language too. Repeating an identical loanword in parentheses adds noise rather than
  // context. Compared in the active language's own casing rules, not hardcoded to one 鈥?
  // this only ever differs from ordinary casing for languages with locale-specific rules
  // (e.g. Turkish dotless i), which does not include any language shipped here today.
  return translated.toLocaleLowerCase(lang) === ex.n.toLocaleLowerCase('en')
      || !enParens
    ? translated
    : `${translated} (${ex.n})`
}

// Exercise-name packs written in the language's own casing. German capitalises its nouns and
// lower-cases the adjectives in front of them ("Assistiertes h盲ngendes Knieheben"), which
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
// needs the casing ("push-up" would otherwise sit between "Bankdr眉cken" and "Kniebeuge"). A custom
// exercise has no pack entry either and keeps the casing it always had, and so does every
// exercise while "English names only" is on, since exerciseNameFor then shows the English title.
// Callers spread this onto the element that holds exerciseNameFor(ex)'s output, nothing else 鈥?
// muscle and equipment labels next to it are t() strings and keep their own capitalize.
export const exerciseNameClass = ex => (!enOnly && exerciseNames && ex && exerciseNames[ex.id]
  && CASED_NAME_LANGS.includes(baseLang(lang)) ? '' : 'capitalize')

// Search both the localized and canonical English title without changing persisted data.
export const exerciseNameSearchText = ex => {
  const translated = exerciseNames && ex && exerciseNames[ex.id]
  return translated ? `${translated} ${ex.n}` : (ex?.n || '')
}

// Called by i18n.js's setLang once the locale pack has been loaded 鈥?kept here rather than
// exported as setLang because loading packs requires import.meta.glob, which is Vite-only.
// `dict`, `instr` and `exerciseNames` may be null to reset to their English fallbacks.
export function _setLangState(newLang, newDict, newInstr, newExerciseNames, showEn = true, enOnlyFlag = false) {
  lang = LANGS[newLang] ? newLang : 'en'
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

--- END FILE: frontend/src/lib/i18n-core.js ---

