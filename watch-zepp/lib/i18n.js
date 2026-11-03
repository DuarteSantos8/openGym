// The watch speaks the app's language (the phone sends it with every snapshot, watch-sync.js
// watchExtras), not the watch's own; until the phone has said, the watch's language if it is one of
// ours (page/i18n/<locale>.po names it), else English. Words from lib/strings.js (zepp-strings.mjs).
import { STRINGS } from './strings.js'

let lang = 'en'

/** One of ours for a code like "de", "pt-BR", "zh-Hant" or "zh_TW"; null when we have none. */
export function ours (code) {
  if (typeof code !== 'string' || !code) return null
  const c = code.replace('_', '-')
  if (STRINGS[c]) return c
  if (/^zh-(TW|HK|MO|Hant)/i.test(c)) return 'zh-TW'
  if (/^pt-BR/i.test(c)) return 'pt-BR'
  const base = c.split('-')[0].toLowerCase()
  return STRINGS[base] ? base : null
}

export function setLang (code) { lang = ours(code) || lang; return lang }
export const getLang = () => lang

/** The word `key` in the current language, {0} {1} filled from `args`; English, then the key, when missing. */
export function t (key, ...args) {
  const s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? String(args[i]) : m)) : s
}

/** Right to left (Arabic): the text widgets are aligned to the other side. */
export const rtl = () => lang === 'ar'
