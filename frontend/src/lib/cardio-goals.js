// Weekly cardio goals (1.4.5, owner): as many as the profile wants, each one an activity and a unit.
//
//   S.cardioGoals = [{ kind: 'any' | 'run' | 'ride' | …, unit: 'min' | 'km' | 'n', v }, …]
//
// `v` is minutes, kilometres (always km, swimming too: the sheet shows m or yd) or sessions a week.
// One goal per kind and unit; the first one is the big one on the card.
//
// The "any cardio, minutes" goal is still S.cardioGoal, the number it was before 1.4.5, so a profile
// that set 150 keeps it and an older app on another device keeps reading and writing it. The list
// holds where that goal sits, the number lives in cardioGoal: set there, it shows; 0 there, it is
// gone. withCardioGoals writes both every time.
//
// What counts for an activity: a cardio exercise by its name (the catalogue's or your own) and its
// equipment, and an activity (lib/activities.js: Health, Strava through Health, an import, by hand)
// by its sport. Everything that is cardio counts for "any". Pure, from the profile.
import { isWarmupRow } from './workout-model.js'
import { cardioMinOf } from './challenges.js'
import { doneUnits, workoutDay } from './history.js'
import { isCardio, exerciseOf } from './exercises.js'
import { kindOfName } from './cardio-kind.js'
export { kindOfName }
import { activitiesOf } from './activities.js'
import { distanceKmOf, distUnitOf } from './distance.js'
import { weekKey, weekStartOf, todayISO, isoOf } from './format.js'

export const CARDIO_KINDS = ['any', 'run', 'ride', 'swim', 'walk', 'hike', 'row', 'elliptical', 'stairs', 'rope', 'ski']
export const KIND_LABEL = {
  any: 'Any cardio', run: 'Run', ride: 'Ride', swim: 'Swim', walk: 'Walk', hike: 'Hike', row: 'Rowing',
  elliptical: 'Elliptical', stairs: 'Stair climber', rope: 'Jump rope', ski: 'Skiing',
}
export const KIND_ICON = {
  any: 'heart', run: 'figureRun', ride: 'bike', swim: 'swim', walk: 'person', hike: 'tree', row: 'arm',
  elliptical: 'machine', stairs: 'stairs', rope: 'timer', ski: 'snowflake',
}
export const GOAL_UNITS = ['min', 'km', 'n']
// A distance means nothing summed over a swim and a ride, or for stairs and a rope.
const NO_DISTANCE = new Set(['any', 'stairs', 'rope'])
export const unitsOf = kind => (NO_DISTANCE.has(kind) ? ['min', 'n'] : GOAL_UNITS)
export const GOAL_MAX = { min: 3000, km: 2000, n: 50 }
export const GOALS_MAX = 12
// What health advice keeps naming, and the first number the sheet offers.
export const SUGGESTED_MIN = 150

/* ---------------------------------------------------------------- activity ---- */

// A name to a kind lives in lib/cardio-kind.js (a leaf, so lib/history.js can ask it too).
const exOf = (S, id) => (Array.isArray(S?.customEx) ? S.customEx.find(c => c && c.id === id) : null) || exerciseOf(id) || null

/** The kind a logged entry is, from its exercise: null when it is not one of the kinds. */
export function kindOfEntry(e, S) {
  const ex = exOf(S, e?.id)
  return ex ? kindOfName(ex.n || ex.name || ex._name, ex.eq) : null
}

// Sport from lib/activities.js. Any sport that keeps you moving is cardio; yoga, climbing and
// "other" are not counted at all.
const SPORT_KIND = { run: 'run', ride: 'ride', swim: 'swim', hike: 'hike', row: 'row', ski: 'ski', football: 'any', racket: 'any', ball: 'any', dance: 'any', fight: 'any' }
export const kindOfSport = sport => SPORT_KIND[sport] || null

/** One entry's cardio: { min, km }, both 0 for an entry that is no cardio. */
export function entryCardio(e) {
  const cardio = isCardio(e?.id)
  let km = 0
  for (const s of Array.isArray(e?.sets) ? e.sets : []) {
    if (!s || isWarmupRow(s) || !doneUnits(s)) continue
    km += distanceKmOf(s)
    if (cardio && !(Number(s.km) > 0) && Number(s.m) > 0) km += Number(s.m) / 1000
  }
  return { min: cardioMinOf(e), km }
}

/* ---------------------------------------------------------------- the sums ---- */

const blank = () => ({ min: 0, km: 0, n: 0 })

/**
 * Per week, oldest first, `weeks` of them ending with the current one (the profile's first day of
 * the week): [{ week, by: { any: { min, km, n }, run: {…}, … } }]. `n` counts sessions: a workout
 * with one of the kind in it, or an activity.
 */
export function cardioWeekTotals(S, { weeks = 8, today = todayISO() } = {}) {
  const ws = weekStartOf(S)
  const now = weekKey(today, ws)
  const d = new Date(now + 'T12:00:00')
  const keys = []
  for (let i = weeks - 1; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i * 7); keys.push(isoOf(x)) }
  const per = new Map(keys.map(k => [k, {}]))
  const add = (by, kind, min, km, n) => { const o = by[kind] || (by[kind] = blank()); o.min += min; o.km += km; o.n += n }
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    const day = workoutDay(w)
    const by = day && per.get(weekKey(day, ws))
    if (!by) continue
    const seen = new Set()
    for (const e of Array.isArray(w.entries) ? w.entries : []) {
      const { min, km } = entryCardio(e)
      if (!(min > 0) && !(km > 0)) continue
      for (const kind of ['any', kindOfEntry(e, S)]) {
        if (!kind) continue
        add(by, kind, min, km, seen.has(kind) ? 0 : 1)
        seen.add(kind)
      }
    }
  }
  for (const a of activitiesOf(S)) {
    const kind = kindOfSport(a.sport)
    const by = kind && per.get(weekKey(a.d, ws))
    if (!by) continue
    add(by, 'any', a.min, a.km || 0, 1)
    if (kind !== 'any') add(by, kind, a.min, a.km || 0, 1)
  }
  return keys.map(week => ({ week, by: per.get(week) }))
}

/** What a goal has reached in one week of cardioWeekTotals. */
export const goalValue = (wk, goal) => Number(wk?.by?.[goal.kind]?.[goal.unit]) || 0

/* ---------------------------------------------------------------- the goals ---- */

const legacyOf = S => {
  const n = Math.round(Number(S?.cardioGoal))
  return Number.isFinite(n) && n > 0 && n <= GOAL_MAX.min ? n : 0
}
const isAnyMin = g => g.kind === 'any' && g.unit === 'min'
const roundV = (unit, v) => (unit === 'km' ? Math.round(v * 1000) / 1000 : Math.round(v))

/** One stored goal read back, or null for a broken one. */
export function readGoal(g) {
  if (!g || typeof g !== 'object' || !CARDIO_KINDS.includes(g.kind) || !unitsOf(g.kind).includes(g.unit)) return null
  const v = roundV(g.unit, Number(g.v))
  if (!Number.isFinite(v) || v <= 0 || v > GOAL_MAX[g.unit]) return null
  return { kind: g.kind, unit: g.unit, v }
}

/** The profile's goals, the big one first: S.cardioGoals read back with S.cardioGoal folded in. */
export function cardioGoalsOf(S) {
  const out = []
  const seen = new Set()
  for (const g of Array.isArray(S?.cardioGoals) ? S.cardioGoals : []) {
    const r = readGoal(g)
    const key = r && r.kind + '|' + r.unit
    if (!r || seen.has(key) || out.length >= GOALS_MAX) continue
    seen.add(key)
    out.push(r)
  }
  const legacy = legacyOf(S)
  const i = out.findIndex(isAnyMin)
  if (legacy && i >= 0) out[i] = { ...out[i], v: legacy }
  else if (legacy) out.unshift({ kind: 'any', unit: 'min', v: legacy })
  else if (i >= 0) out.splice(i, 1)
  return out
}

/** Writes `goals` into S (mutates it): the list, and the any-minutes goal as S.cardioGoal (0: none). */
export function withCardioGoals(S, goals) {
  const clean = []
  const seen = new Set()
  for (const g of Array.isArray(goals) ? goals : []) {
    const r = readGoal(g)
    const key = r && r.kind + '|' + r.unit
    if (!r || seen.has(key) || clean.length >= GOALS_MAX) continue
    seen.add(key)
    clean.push(r)
  }
  S.cardioGoals = clean
  S.cardioGoal = clean.find(isAnyMin)?.v || 0
  return S
}

/* --------------------------------------------------------------- on screen ---- */

const M_PER_YD = 0.9144

/** The unit a goal shows in: 'min', 'n', 'km' or 'mi', and 'm' or 'yd' for a swim. */
export function shownUnit(goal, S) {
  if (goal.unit !== 'km') return goal.unit
  const mi = distUnitOf(S) === 'mi'
  return goal.kind === 'swim' ? (mi ? 'yd' : 'm') : (mi ? 'mi' : 'km')
}

/** Stored to shown: km to km, mi, m or yd; minutes and sessions as they are. */
export function toShown(v, unit) {
  const n = Number(v) || 0
  if (unit === 'mi') return Math.round(n / 1.609344 * 10) / 10
  if (unit === 'km') return Math.round(n * 10) / 10
  if (unit === 'm') return Math.round(n * 1000)
  if (unit === 'yd') return Math.round(n * 1000 / M_PER_YD)
  return Math.round(n)
}
/** Shown back to stored. */
export function fromShown(v, unit) {
  const n = Number(v) || 0
  if (unit === 'mi') return Math.round(n * 1.609344 * 1000) / 1000
  if (unit === 'm') return n / 1000
  if (unit === 'yd') return Math.round(n * M_PER_YD) / 1000
  return n
}

// The stepper's step, and the first number a new goal gets, in its shown unit.
export const STEP = { min: 15, n: 1, km: 1, mi: 1, m: 250, yd: 250 }
const START_DIST = {
  km: { run: 10, ride: 50, walk: 15, hike: 10, row: 10, elliptical: 10, ski: 20 },
  mi: { run: 6, ride: 30, walk: 10, hike: 6, row: 6, elliptical: 6, ski: 12 },
}
/** The number a new goal of this kind starts at, in `unit` (shownUnit). */
export function suggestedShown(kind, unit) {
  if (unit === 'min') return kind === 'any' ? SUGGESTED_MIN : 60
  if (unit === 'n') return 3
  if (unit === 'm' || unit === 'yd') return 1000
  return START_DIST[unit]?.[kind] || 10
}
