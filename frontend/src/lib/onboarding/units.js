// Units for About you: what the locale suggests, the conversions, and each ruler's scale (prototype
// v4 H_UNITS / W_UNITS). Answers go to the server in cm and kg whatever is shown (hub answers.ts).
import { t } from '../i18n-core.js'

export const KG_LB = 2.20462262
export const CM_IN = 2.54

/** Imperial where the locale is: the US, Liberia, Myanmar. The unit chip overrides it. */
export function localeUnits(language = globalThis.navigator?.language || '') {
  const imperial = /^(en-(US|LR)|my)(-|$)/i.test(language)
  return { weight: imperial ? 'lb' : 'kg', height: imperial ? 'ft' : 'cm', source: 'locale' }
}

const trim1 = n => String(Math.round(n * 10) / 10)

// Each ruler: its range and step, px per step, which ticks are tall and which labelled, where it
// starts while untouched, and how a value reads, is spoken and is labelled under its tick.
export const HEIGHT = {
  cm: {
    min: 120, max: 230, step: 1, px: 8, minor: 1, major: 5, every: 10, start: 170, big: 10,
    label: v => String(v),
    read: v => [String(v), t('cm')],
    say: v => t('{0} centimetres', v),
  },
  // Inches, shown as feet and inches.
  ft: {
    min: 47, max: 90, step: 1, px: 12, minor: 1, major: 6, every: 12, start: 67, big: 12,
    label: v => `${v / 12}′`,
    read: v => [`${Math.floor(v / 12)}′ ${v % 12}″`, ''],
    say: v => t('{0} feet {1} inches', Math.floor(v / 12), v % 12),
  },
}

export const WEIGHT = {
  kg: {
    min: 35, max: 250, step: 0.5, px: 6, minor: 1, major: 5, every: 10, start: 70, big: 10,
    label: v => String(v),
    read: v => [trim1(v), t('kg')],
    say: v => t('{0} kilograms', trim1(v)),
  },
  lb: {
    min: 77, max: 551, step: 1, px: 4, minor: 2, major: 10, every: 20, start: 154, big: 10,
    label: v => String(v),
    read: v => [String(v), t('lb')],
    say: v => t('{0} pounds', v),
  },
}

/** cm → the ruler's value in `unit` (inches for ft). */
export const heightTo = (cm, unit) => (unit === 'cm' ? Math.round(cm) : Math.round(cm / CM_IN))
/** The ruler's value in `unit` → cm. */
export const heightFrom = (v, unit) => (unit === 'cm' ? v : Math.round(v * CM_IN))
/** kg → the ruler's value in `unit`: half kilos, whole pounds. */
export const weightTo = (kg, unit) => (unit === 'kg' ? Math.round(kg * 2) / 2 : Math.round(kg * KG_LB))
/** The ruler's value in `unit` → kg, to a tenth. */
export const weightFrom = (v, unit) => (unit === 'kg' ? v : Math.round((v / KG_LB) * 10) / 10)

/**
 * What was typed for a height in `unit`, or null. cm: digits. ft: "5.7", "5'7", "5 7" are feet and
 * inches; a lone "5" is feet and "67" inches.
 */
export function parseHeight(text, unit) {
  const s = String(text).trim()
  if (unit === 'cm') {
    const n = parseInt(s.replace(/\D/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }
  const pair = s.match(/(\d+)\D+(\d+)/)
  if (pair) return Number(pair[1]) * 12 + Math.min(11, Number(pair[2]))
  const n = parseInt(s, 10)
  if (!Number.isFinite(n)) return null
  return n <= 8 ? n * 12 : n
}

/** What was typed for a weight, or null: a decimal comma or point. */
export function parseWeight(text) {
  const n = parseFloat(String(text).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** What was typed for a year, or null. */
export function parseYear(text) {
  const n = parseInt(String(text).replace(/\D/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/** The year wheel's range: a hundred years back, to fifteen years ago (the formula's youngest age). */
export const yearRange = (now = new Date()) => ({ min: now.getFullYear() - 100, max: now.getFullYear() - 15, start: 1990 })
