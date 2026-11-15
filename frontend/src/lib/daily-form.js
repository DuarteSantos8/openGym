// Daily form (v1.4.5, gm-insights): a four-tap check-in before a workout, and "go lighter" when
// the day is a rough one. Optional on every level:
//
//   - S.dailyForm: off until switched on. Undefined means never asked: the Daily form card in Stats
//     asks once (Turn it on / Not for me), and Settings → Workout → Before and during switches it
//     either way. Starting a workout is never held up by the question. Nothing asks with the Health
//     module off.
//   - every row is optional, and Skip starts the workout as planned;
//   - "go lighter" is offered only when the answers add up to a rough day, and is never picked
//     for you: "As planned" stays the default.
//
// What it stores, one entry per day, the way day notes do (lib/day-notes.js):
//
//   S.dayForm = { '2026-11-06': { sleep: 2, energy: 3, sore: 4, stress: 2, lighter: 'load', _ts }, … }
//
// Each answer is 1 to 5. Sleep and energy: 5 is great. Soreness and stress: 5 is a lot of it, so
// the score turns those two round. A stamped map (lib/sync-merge.js STAMPED_MAPS), so the phone and
// the laptop each keep the days they answered, and a day answered twice keeps the later answer.
//
// Going lighter changes today's session only, through the same handlers the Coach's mid-workout
// changes use (lib/coach-adapt.js): open work sets 10% lighter (rounded to the gym's plates, warm-ups
// re-ramped) or one open work set fewer per exercise. The session is then kept out of progression
// (lib/session-noprog.js), so an easy day neither moves the next targets up nor counts as a miss.
// The header's "Don't count for progression" shows it and can turn it back on.
import { applyAdapt } from './coach-adapt.js'
import { isWarmupRow, hasCompletedWork } from './workout-model.js'
import { setSessionNoProg } from './session-noprog.js'
import { isOn } from './modules.js'
import { setDailyFormSource } from './deload-cycle.js'

export const FORM_KEYS = ['sleep', 'energy', 'sore', 'stress']
// The two that read the other way round: 5 is bad.
const INVERTED = new Set(['sore', 'stress'])
// At or below this average (on the 1-to-5 "how good" scale) the check-in offers to go lighter.
export const ROUGH_AT = 2.5
export const LIGHTER_KINDS = ['load', 'sets']
export const LIGHTER_PCT = 10

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const rating = v => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null)

/** A stored entry read back: { sleep, energy, sore, stress, lighter } with what is missing as null, or null for none. */
export function readForm(entry) {
  if (!isMap(entry)) return null
  const out = {}
  let any = false
  for (const k of FORM_KEYS) { out[k] = rating(entry[k]); if (out[k] != null) any = true }
  if (!any) return null
  out.lighter = LIGHTER_KINDS.includes(entry.lighter) ? entry.lighter : null
  return out
}

/** The check-in of `iso`, or null. */
export const formOf = (S, iso) => readForm(isMap(S?.dayForm) ? S.dayForm[iso] : null)

/** Every answered day, oldest first: [{ d, ...form }]. */
export function formDays(S) {
  const map = isMap(S?.dayForm) ? S.dayForm : {}
  return Object.keys(map).sort().map(d => { const f = readForm(map[d]); return f ? { d, ...f } : null }).filter(Boolean)
}

/** How good a day looks, 1 (rough) to 5 (great): the mean of the answers given, soreness and stress turned round. null for none. */
export function formScore(f) {
  if (!f) return null
  const vals = FORM_KEYS.map(k => (f[k] == null ? null : INVERTED.has(k) ? 6 - f[k] : f[k])).filter(v => v != null)
  if (!vals.length) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
}

/** Whether the answers make a rough day: two answers at least, and a score at or under ROUGH_AT. */
export function isRough(f) {
  if (!f) return false
  const given = FORM_KEYS.filter(k => f[k] != null).length
  const score = formScore(f)
  return given >= 2 && score != null && score <= ROUGH_AT
}

/**
 * Whether starting a workout shows the check-in: 'ask' when it is switched on, else null (off, never
 * asked, the Health module off, or today answered already).
 */
export function checkinMode(S, today) {
  if (!S || !isOn(S, 'health') || S.dailyForm !== true) return null
  return formOf(S, today) ? null : 'ask'
}

/** Whether the Daily form card asks once whether to switch the check-in on: never asked, and training. */
export const offerCheckin = S => !!S && isOn(S, 'health') && S.dailyForm == null && (S.workouts || []).length >= 3

/** S.dayForm with `iso` set to the answers in `f`, stamped `now`. Empty answers clear the day. */
export function withForm(map, iso, f, now = Date.now()) {
  const clean = readForm(f)
  const entry = { _ts: now }
  if (clean) {
    for (const k of FORM_KEYS) if (clean[k] != null) entry[k] = clean[k]
    if (clean.lighter) entry.lighter = clean.lighter
  }
  return { ...(isMap(map) ? map : {}), [iso]: entry }
}

/**
 * Hours of sleep (from the phone's health store) as the check-in's 1-to-5: under 5 h is 1, then
 * one step per hour, 8 h and more is 5. null without a number.
 */
export function sleepRatingOf(hours) {
  const h = Number(hours)
  if (!(h > 0)) return null
  if (h < 5) return 1
  if (h < 6) return 2
  if (h < 7) return 3
  if (h < 8) return 4
  return 5
}

const openWork = entry => (entry?.sets || []).filter(s => !isWarmupRow(s) && !hasCompletedWork(s))

/**
 * The changes "go lighter" makes to `active`, in the Coach's change format (lib/coach-adapt.js):
 * 'load' takes LIGHTER_PCT off every open work set that has a weight; 'sets' drops one open work set
 * from every exercise that has two or more. Exercises with nothing to change are left alone.
 */
export function lighterChanges(active, kind) {
  const out = []
  ;(active?.entries || []).forEach((e, i) => {
    const open = openWork(e)
    if (!open.length) return
    const id = 'lighter-' + i
    if (kind === 'load') {
      const weighted = open.some(s => Number(s.w) > 0 || Number(s.sides?.L?.w) > 0)
      if (weighted) out.push({ id, type: 'weight', entry: i, exId: e.id, pct: -LIGHTER_PCT })
    } else if (kind === 'sets' && open.length >= 2) {
      out.push({ id, type: 'sets', entry: i, exId: e.id, sets: open.length - 1 })
    }
  })
  return out
}

/**
 * Applies "go lighter" to the session in the store draft `s` (mutated). Returns how many
 * exercises changed; with none, nothing happens (not even the progression pause).
 */
export function goLighter(s, kind) {
  if (!s?.active || !LIGHTER_KINDS.includes(kind)) return 0
  const changes = lighterChanges(s.active, kind)
  if (!changes.length) return 0
  const { applied } = applyAdapt(s, { kind: 'adapt', changes }, changes.map(c => c.id))
  if (!applied.length) return 0
  setSessionNoProg(s.active, true)
  s.active.lighter = kind
  return applied.length
}

/** Whether a session can be made lighter at all in this way (the check-in offers only those that can). */
export const canGoLighter = (active, kind) => lighterChanges(active, kind).length > 0

/**
 * The check-ins as the automatic deload suggestion reads them (lib/deload-cycle.js, docs/dev/
 * DELOAD_WEEKS.md): the days from `from` to `to` (inclusive) with an answer, each as its form score
 * turned into 0 (rough) to 1 (great). With the Health module off there is no daily form to read.
 */
export function dailyFormSource(S, from, to) {
  if (!S || !isOn(S, 'health')) return []
  return formDays(S).filter(f => f.d >= from && f.d <= to)
    .map(f => ({ d: f.d, score: Math.round(((formScore(f) - 1) / 4) * 100) / 100 }))
}

/** Hands the check-ins to the deload suggestion. Called once at start-up (main.jsx). */
export const registerDailyFormSource = () => setDailyFormSource(dailyFormSource)
