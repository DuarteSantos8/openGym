// Formatting + date helpers (ported from the vanilla app, unit taken from the store where needed).
import { dateLocale, t, exerciseNameFor, exerciseNameClass } from './i18n-core.js'
export const todayISO = () => {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
export const isoOf = d =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

export const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function fmtDate(iso, long, withYear = false) {
  const d = new Date(iso + 'T12:00:00')
  const options = long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }
  if (withYear) options.year = 'numeric'
  return d.toLocaleDateString(dateLocale(), options)
}
// A span of days, e.g. an import's first and last workout. The year is shown when the span
// crosses one or lies outside the current year: "3 Feb – 21 Dec" over two years read as one.
export function fmtDateRange(from, to, long, now = new Date()) {
  if (!from) return ''
  const last = to || from
  const year = String(now.getFullYear())
  const withYear = from.slice(0, 4) !== last.slice(0, 4) || from.slice(0, 4) !== year
  return from === last ? fmtDate(from, long, withYear) : fmtDate(from, long, withYear) + ' – ' + fmtDate(last, long, withYear)
}
// In the UI language: the Latin h, m and min stood inside Arabic and Ukrainian rows.
export function fmtDur(ms) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? t('{0}h {1}m', Math.floor(m / 60), m % 60) : t('{0} min', m)
}
// Imported history has no clock — an unknown duration is left out rather than shown as "0 min".
export const durPart = ms => (ms >= 60000 ? [fmtDur(ms)] : [])
// Numbers follow the UI language, like the dates above — a hardcoded locale put Swiss
// apostrophes ("7'535 kg") in front of every user, in every language.
// Exercise names are stored lower-case and shown through CSS `capitalize`; text that has no
// element of its own (a toast) capitalises here instead.
export const capWords = s => String(s || '').replace(/(^|[\s(\-\/])(\p{Ll})/gu, (m, pre, ch) => pre + ch.toUpperCase())
// An exercise's display name as plain text, cased the way its element would be on screen
// (exerciseNameClass): for a toast, a dialog title or a picker label, which have no element of
// their own to put the class on.
export const exerciseNameText = ex => (exerciseNameClass(ex) ? capWords(exerciseNameFor(ex)) : exerciseNameFor(ex))
/* How many decimals a weight is shown with. One is enough for plate-loadable numbers, but a
 * per-side figure from kg plates lands on .25 and .75 and reading those as .3 and .8 is the
 * complaint in issue #139 — as is microplate work. The setting is read here rather than passed
 * through sixty-odd call sites, the same way the date locale is; App.jsx pushes it whenever
 * `S.wdec` changes.
 *
 * It only ever adds precision that is really there: a whole number still prints whole, and
 * 62.5 is 62.5 either way. Nothing rounds differently in storage — this is display only.
 */
let decimals = 1
export const setWeightDecimals = n => { decimals = n === 2 ? 2 : 1 }
export const weightDecimals = () => decimals
export const fmtNum = n => {
  const p = decimals === 2 ? 100 : 10
  return (Math.round(n * p) / p).toLocaleString(dateLocale(), { maximumFractionDigits: decimals })
}
// Plate sizes keep their quarter: 1.25 and 21.25 are real numbers on a plate and a bar.
export const fmtPlate = n => (Math.round(n * 100) / 100).toLocaleString(dateLocale())
// Volume stays in the profile's unit throughout: the old shorthand turned anything over
// 10 000 into "t", which is wrong for a pound profile and made one list mix "18.8t" with
// "7'535 kg" — two numbers you can't compare at a glance.
export const fmtVol = (v, unit) => fmtNum(v) + ' ' + unit
// Plural forms are not automatic when the English string is the key.
export const exCount = n => t(n === 1 ? '{0} exercise' : '{0} exercises', n)
export const routineCount = n => t(n === 1 ? '{0} routine' : '{0} routines', n)
export const changeCount = n => t(n === 1 ? '{0} change' : '{0} changes', n)
// The Sets tile of the finish summary: all the sets logged, then how many of them were work sets.
export const setsWorkCount = (n, work) => t(n === 1 ? '{0} set · {1} work' : '{0} sets · {1} work', n, work)

// "5 minutes ago", "yesterday", "now" — in the UI language, from the platform's own rules
// (Intl.RelativeTimeFormat), so no pack has to carry a word for every unit and plural. Used for
// when this device last synced; a time in the future (a clock set back since) reads as now.
export function fmtAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  const [n, unit] = s < 60 ? [0, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 86400), 'day']
  try { return new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' }).format(-n, unit) }
  catch { return new Date(ts).toLocaleString(dateLocale()) }
}

// Whole calendar days from `iso` (a logged session's day) back to `now`. Noon on both
// sides, so a workout late yesterday is one day ago just after midnight, and a DST
// shift cannot turn one day into zero or two. Null when `iso` is not a date.
export function daysBefore(iso, now = new Date()) {
  const then = new Date(iso + 'T12:00:00')
  const today = new Date(now)
  if (Number.isNaN(then.getTime()) || Number.isNaN(today.getTime())) return null
  today.setHours(12, 0, 0, 0)
  return Math.round((today - then) / 86400000)
}

function relTime(n, unit, numeric) {
  try { return new Intl.RelativeTimeFormat(dateLocale(), { numeric }).format(-n, unit) }
  catch { return null }
}

// How long ago a training day was, for the "Last time" / "Best set" line (#363).
// The calendar date made you subtract from today; this reads the gap in the UI
// language the same way "Last synced" does (Intl.RelativeTimeFormat), so no pack
// grows a word for week or month.
//
// A day that is not an exact week (under a month) or an exact 30-day month stays
// in days — "8 days ago", "38 days ago" — which is the count the line was missing.
// An exact 7 days is "1 week ago", an exact 30 is "1 month ago". A year or more
// goes back to the date: a best set from two years ago is a date, and "400 days
// ago" is not how anyone recalls it. A day in the future (the clock is wrong)
// stays a date too. fmtAgo is left alone — sync times are minutes and hours.
export function fmtTrainingAgo(iso, now = new Date()) {
  const days = daysBefore(iso, now)
  if (days == null || days < 0 || days >= 365) return fmtDate(iso)
  if (days < 7) return relTime(days, 'day', days < 2 ? 'auto' : 'always') || fmtDate(iso)
  if (days < 30 && days % 7 === 0) return relTime(days / 7, 'week', 'always') || fmtDate(iso)
  if (days >= 30 && days % 30 === 0) return relTime(days / 30, 'month', 'always') || fmtDate(iso)
  return relTime(days, 'day', 'always') || fmtDate(iso)
}

/* ---------------------------------------------------------------- week start --
   Where a week begins is a local convention, not a fact: most of Europe starts on
   Monday, most of the Americas and much of Asia on Sunday. The app used to assume
   Monday everywhere — the Plan list, the Home strip, the calendar grid and every
   "this week" total. It is now S.weekStart, a getDay() index, and every one of those
   places asks these helpers instead of writing the assumption down again.

   Only 1 and 0 are offered in the UI, but the helpers work for any weekday, so a
   Saturday start (parts of the Middle East) would need a locale string and nothing
   else. */
export const MONDAY = 1
export const SUNDAY = 0
/** The profile's first weekday, defaulting to Monday for every state written before this. */
export const weekStartOf = S => (S?.weekStart === SUNDAY ? SUNDAY : MONDAY)
/** getDay() indices in display order — [1..6,0] for a Monday start, [0..6] for a Sunday one. */
export const weekOrder = (ws = MONDAY) => Array.from({ length: 7 }, (_, i) => (ws + i) % 7)
/** How many days a weekday sits past the start of its week. 0..6, so it doubles as a column. */
export const weekDayOffset = (day, ws = MONDAY) => (day - ws + 7) % 7

/** The Date (noon local, so DST cannot shift the day) that starts the week `iso` falls in. */
export function startOfWeek(iso, ws = MONDAY) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - weekDayOffset(d.getDay(), ws))
  return d
}

/**
 * A key that is equal for two dates in the same week: the ISO date of the week's first day.
 *
 * Only ever compared or used as a map key — never shown, never stored — so it does not need
 * to be an ISO week number, and being one would be a liability here: "2026-35" is defined
 * Monday-first, and there is no Sunday-first equivalent to fall back to.
 */
export const weekKey = (iso, ws = MONDAY) => isoOf(startOfWeek(iso, ws))

export const localTZ = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
// What each accent is called, for a screen reader (Settings' swatches carry no text).
export const ACCENT_NAMES = { lime: 'Green', sky: 'Blue', orange: 'Orange', violet: 'Purple', pink: 'Pink', red: 'Red', teal: 'Teal', gold: 'Yellow' }
export const ACCENTS = { lime: '#30d158', sky: '#0a84ff', orange: '#ff9f0a', violet: '#bf5af2', pink: '#ff375f', red: '#ff453a', teal: '#40c8e0', gold: '#ffd60a' }
// Text drawn on top of that swatch. Matches the --on-acc values in index.css.
export const ACCENT_INK = { lime: '#000000', sky: '#ffffff', orange: '#000000', violet: '#ffffff', pink: '#ffffff', red: '#ffffff', teal: '#000000', gold: '#000000' }
// Android color int, opaque. JS bitwise ops are signed, so the high bit is cleared back to unsigned.
export const argb = hex => (0xff000000 | parseInt(hex.slice(1), 16)) >>> 0