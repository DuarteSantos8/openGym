// Browser-only shell of the i18n module. The runtime-agnostic state and readers live
// in i18n-core.js (plain Node-loadable); this file adds the two pieces that genuinely need
// the browser: `setLang` (which lazy-loads locale packs via import.meta.glob) and the React
// subscription hook `useLang`.

import { useSyncExternalStore } from 'react'
import {
  LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES, DERIVED_LOCALES,
  getLang, dateLocale, t, instrFor, exerciseNameFor, exerciseNameSearchText, getVersion,
  baseLang, derivePack, _setLangState
} from './i18n-core.js'

export {
  LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES, DERIVED_LOCALES,
  getLang, dateLocale, t, instrFor, exerciseNameFor, exerciseNameSearchText
}

// Vite code-splits locale, instruction and exercise-name packs via import.meta.glob. They are
// lazy, so the production bundle ships English only until another language is selected.
const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')
const exerciseNamePacks = import.meta.glob('../exercise-names/*.js')

// React subscription bookkeeping — kept here, not in core, so core has zero React coupling.
const subs = new Set()
const notify = () => { subs.forEach(f => f()) }

export async function setLang(l) {
  if (!LANGS[l]) l = 'en'
  if (l === getLang() && getVersion() > 0) return
  // A derived locale (de-CH) ships no packs of its own: it loads its base language's and
  // transforms the strings on the way through. `l` stays the selected language throughout, so
  // dateLocale() still reports de-CH and formats numbers Swiss-style.
  const base = baseLang(l)
  let dict = {}, instr = null, exerciseNames = null
  try { dict = base === 'en' ? {} : (await localePacks['../locales/' + base + '.js']()).default } catch (e) { dict = {} }
  try { instr = base === 'en' || !INSTR_LANGS.includes(base) ? null : (await instrPacks['../instr/' + base + '.js']()).default } catch (e) { instr = null }
  try {
    exerciseNames = base === 'en' || !EXERCISE_NAME_LANGS.includes(base)
      ? null
      : (await exerciseNamePacks['../exercise-names/' + base + '.js']()).default
  } catch (e) { exerciseNames = null }
  _setLangState(l, derivePack(l, dict), derivePack(l, instr), derivePack(l, exerciseNames))
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, getVersion)
}
