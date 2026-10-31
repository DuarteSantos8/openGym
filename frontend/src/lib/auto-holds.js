// Timed holds that run themselves (Settings → Workout → "Timed holds start by themselves").
//
// Without it a hold waits for its play button after every rest. With it the chain goes on its
// own: the rest ends (or a hold's set is ticked with no rest after it), the next timed set counts
// in (3, 2, 1, with the Timer alerts' sound and buzz), the hold starts, at 0 its set is ticked
// with the planned time, the set's rest starts, and round again. The two sides of a per-side hold
// keep their short switch pause, and a superset keeps its own turn order: the chain only ever
// starts the set the workout screen would lead to next (lib/workout-keys.js nextOpenSet).
//
// Only the decisions live here; the timers are store/useUI.js's (rest, count-in, hold) and the
// ticking is views/Workout.jsx's own tick. Every phase is a start and an end in wall-clock time,
// never a count of intervals, so a phone that was locked or asleep catches up from the clock: a
// hold that ran out meanwhile is logged with its planned seconds, at the time it ended, and its
// rest is as far along as it would have been.
import { nextOpenSet } from './workout-keys.js'
import { isWarmupRow } from './workout-model.js'
import { ownSetRest, restSecFor, sideRestFor, warmupRestSecFor } from './supersetFlow.js'
import { pyramidRestFor } from './pyramid.js'
import { supersetUnits } from './history.js'

/** The count-in before a hold that starts by itself, in seconds: 3, 2, 1, go. */
export const COUNT_IN_SEC = 3

/** A hold with no seconds of its own holds this long (Workout.jsx startTimed does the same). */
export const DEFAULT_HOLD_SEC = 45

/**
 * Whether holds start by themselves for an exercise in the running workout. The exercise's own
 * choice (`target.autoHold`, true or false, from its settings) wins over the profile's; "Stop
 * auto" (`active.autoHoldsOff`) ends it for the rest of this workout, whatever either says. A
 * saved workout being edited, or one entered after the fact, runs nothing.
 */
export function autoHoldsFor (S, target) {
  const A = S && S.active
  if (!A || A.autoHoldsOff === true || A.editingWorkoutId || A.backfill) return false
  if (target && target.autoHold === true) return true
  if (target && target.autoHold === false) return false
  return S.autoHolds === true
}

/** Whether any exercise of the running workout could run its holds by itself. */
export function autoHoldsAnywhere (S, isTimed) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries)) return false
  return A.entries.some((e, idx) => isTimed(idx) && autoHoldsFor(S, e && e.target))
}

/** How long a hold of this row lasts: a plan put aside by a hold that did not finish, else its seconds. */
export function holdPlanSec (row) {
  if (!row) return DEFAULT_HOLD_SEC
  const plan = (!row.done && Number(row.planSec)) || Number(row.sec) || DEFAULT_HOLD_SEC
  return Math.max(1, Math.round(plan))
}

/**
 * The hold the chain starts next: `{ idx, i, id, plan, current }` (entry, set, exercise id, its
 * seconds, and whether it is in the exercise marked current), or null when the next thing to do
 * is not a timed set that starts by itself. A reps set, a per-side reps row or an exercise with
 * auto off ends the chain there: the workout goes on as it always did.
 */
export function nextAutoHold (S, isTimed) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries) || !A.entries.length) return null
  const next = nextOpenSet(A.entries, A.cur)
  if (!next || next.side) return null
  const e = A.entries[next.idx]
  if (!e || !isTimed(next.idx) || !autoHoldsFor(S, e.target)) return null
  return { idx: next.idx, i: next.i, id: e.id, plan: holdPlanSec(e.sets[next.i]), current: !!next.current }
}

/**
 * Seconds left of a phase (`{ endsAt, left, paused }`) at `now`: what a paused one holds, else
 * what its end says. Rounded up, so a count-in reads 3, 2, 1 and only then 0 (go).
 */
export function phaseLeft (ph, now = Date.now()) {
  if (!ph) return 0
  if (ph.paused) return Math.max(0, Math.round(ph.left || 0))
  return Math.max(0, Math.ceil((ph.endsAt - now) / 1000))
}

/**
 * A paused phase carries on: its end moves out by however long it was held. Returns the new end.
 * Pause does not count, so the hold logs what was actually held and the rest is as long as planned.
 */
export function resumedEnd (ph, now = Date.now()) {
  return now + Math.max(0, Math.round(ph && ph.left || 0)) * 1000
}

/**
 * What a hold logs: the planned seconds when it ran out (`early` false), else the seconds actually
 * held up to `now`, paused time left out (the end moved out by it). Never under one second for a
 * hold you ended yourself, never over the plan unless it ran into overtime.
 */
export function heldSec (wk, now = Date.now(), { early = true, overtimeMax = 0 } = {}) {
  if (!wk) return 0
  const total = Math.max(1, Math.round(wk.total || 0))
  if (!early) return total
  const left = wk.paused ? Math.round(wk.left || 0) : Math.round((wk.endsAt - now) / 1000)
  return Math.max(1, Math.min(total + Math.max(0, overtimeMax), total - left))
}

/**
 * Whether the chain should wait before it counts in: a sheet is open on top (the effort picker, a
 * note, the exercise's settings) or a field has the keyboard. A hold never starts under a sheet
 * someone is typing in; the count-in waits held at 3 and goes on once the sheet is closed.
 */
export function shouldWait ({ sheets = 0, activeTag = '', editable = false } = {}) {
  if (sheets > 0) return true
  return editable || activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT'
}

/* ---------- the cues the phone books for a locked screen ---------- */

const restAfterRow = (S, entries, idx, i) => {
  const e = entries[idx]
  const rows = e.sets
  const rest = restSecFor(entries, [idx], S.restSec, { idx, sec: pyramidRestFor(e.target, rows, i) })
  const own = ownSetRest(rows[i])
  return own ?? warmupRestSecFor(e, i, rest, S.warmupRestSec)
}

/**
 * The holds of the same exercise after `from` (`{ idx, i }`, the hold now counting in or running),
 * as the chain will run them if nobody touches anything: `[{ i, restBefore, plan, kind }]`, where
 * restBefore is the rest (or the switch pause, `kind: 'switch'`) between the previous hold's end
 * and this one's count-in. The phone books an alert for each, so a locked phone still says when to
 * get ready and when to stop. Kept to one plain exercise: a superset, another exercise or a set
 * that is not a timed one ends the forecast (the page books again as soon as it runs).
 */
export function forecastHolds (S, from, { isTimed, switchSec = 10, max = 4 } = {}) {
  const A = S && S.active
  if (!A || !from || !Array.isArray(A.entries)) return []
  const entries = A.entries
  const e = entries[from.idx]
  if (!e || !isTimed(from.idx) || !autoHoldsFor(S, e.target)) return []
  const units = supersetUnits(entries)
  const unit = units.find(u => u.includes(from.idx))
  if (!unit || unit.length > 1) return []
  const rows = e.sets
  const out = []
  let i = from.i
  for (let k = 0; k < max; k++) {
    const j = rows.findIndex((r, n) => n > i && r && !r.done)
    if (j < 0) break
    const row = rows[i], next = rows[j]
    if (next.sides) break
    const side = r => (r && !isWarmupRow(r) ? r.side : null)
    const pair = side(row) === 'L' && side(next) === 'R' && j === i + 1
    const restAfter = restAfterRow(S, entries, from.idx, i)
    let restBefore = restAfter, kind = null
    if (pair) {
      const pause = sideRestFor(e.target, { timed: true, restAfter, switchSec, ownSec: ownSetRest(row) })
      restBefore = pause > 0 ? pause : 0
      kind = 'switch'
    }
    out.push({ i: j, restBefore: Math.max(0, Math.round(restBefore || 0)), plan: holdPlanSec(next), kind })
    i = j
  }
  return out
}

/**
 * The alerts a locked phone rings for the chain, from the end of the phase now running
 * (`first`, ms since 1970) on: `{ at, cues: [{ dt, title }] }`, each cue `dt` ms after `at`.
 * `start` is what the first end is: 'rest' (the count-in begins, then the hold), 'countin' (the
 * hold begins) or 'hold' (it ends, then the forecast holds follow). `words` are the titles, already
 * in the app's language: { ready(name), go(name), done(name) }.
 */
export function chainCues ({ start, at, name, plan, forecast = [], words, maxCues = 12 }) {
  const cues = []
  let dt = 0
  const push = (ms, title) => { dt += ms; cues.push({ dt, title }) }
  let title
  if (start === 'rest') {
    title = words.ready(name)
    push(COUNT_IN_SEC * 1000, words.go(name))
    push(plan * 1000, words.done(name))
  } else if (start === 'countin') {
    title = words.go(name)
    push(plan * 1000, words.done(name))
  } else {
    title = words.done(name)
  }
  for (const f of forecast) {
    if (cues.length + 3 > maxCues) break
    push(f.restBefore * 1000, words.ready(name))
    push(COUNT_IN_SEC * 1000, words.go(name))
    push(f.plan * 1000, words.done(name))
  }
  return { at, title, cues }
}
