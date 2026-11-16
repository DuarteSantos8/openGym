// Two small sums for Stats, both asked for on Discord and in Discussions:
//   lifetimeTotals — everything ever logged: workouts, work sets, hours in the gym, with a
//                    playful size for the total lifted ("about 9 blue whales")
//   cardioWeeks    — cardio minutes per week, this week and the ones before it, against an
//                    optional weekly goal (D#84: the 150 minutes a week health advice talks about)
// Pure, from the profile; nothing is stored.
import { doneUnits, workoutDuration } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { cardioWeekTotals } from './cardio-goals.js'
import { todayISO, fmtNum } from './format.js'
import { t } from './i18n-core.js'

// A session longer than this is a timer left running, not training: it would add a day to the hours.
const LONGEST_MS = 6 * 3600e3

/** { workouts, sets, hours } over the whole history. Imported sessions without a clock add no hours. */
export function lifetimeTotals(S) {
  const list = Array.isArray(S?.workouts) ? S.workouts : []
  let sets = 0, ms = 0
  for (const w of list) {
    for (const e of w?.entries || []) for (const s of e?.sets || []) if (s && !isWarmupRow(s)) sets += doneUnits(s)
    const d = workoutDuration(w)
    if (d >= 60000 && d <= LONGEST_MS) ms += d
  }
  return { workouts: list.length, sets, hours: ms / 3600e3 }
}

// Things of a known weight, heaviest first, in kg: the line names the first one the total
// reaches. Written without plurals ("12×"), so every language reads it the same way.
export const LIKENESS = [
  { kg: 150000, line: n => (n === 1 ? t('About as heavy as a blue whale.') : t('About {0}× a blue whale.', fmtNum(n))) },
  { kg: 6000, line: n => (n === 1 ? t('About as heavy as an elephant.') : t('About {0}× an elephant.', fmtNum(n))) },
  { kg: 1500, line: n => (n === 1 ? t('About as heavy as a car.') : t('About {0}× a car.', fmtNum(n))) },
  { kg: 400, line: n => (n === 1 ? t('About as heavy as a grand piano.') : t('About {0}× a grand piano.', fmtNum(n))) },
]
/** The line for a total in kg, or '' below a grand piano. */
export function likenessOf(kg) {
  for (const l of LIKENESS) {
    const n = Math.floor(kg / l.kg)
    if (n >= 1) return l.line(n)
  }
  return ''
}

/**
 * Cardio minutes per week, oldest first, `weeks` of them ending with the current one:
 * [{ week, min }]. The weeks are the profile's (its first day of the week). Sport logged as an
 * activity counts too since 1.4.5 (lib/cardio-goals.js cardioWeekTotals, which this reads).
 */
export function cardioWeeks(S, { weeks = 8, today = todayISO() } = {}) {
  return cardioWeekTotals(S, { weeks, today }).map(w => ({ week: w.week, min: Math.round(w.by.any?.min || 0) }))
}

/** The any-cardio goal in minutes, or 0 for none (all the goals: lib/cardio-goals.js cardioGoalsOf). */
export const cardioGoalOf = S => {
  const n = Math.round(Number(S?.cardioGoal))
  return Number.isFinite(n) && n > 0 && n <= 3000 ? n : 0
}
