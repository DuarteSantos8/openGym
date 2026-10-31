// Spoken cues (Settings → Timer alerts → Spoken cues, off by default): the timer says what it
// knows, so the phone can stay in the pocket.
//
//   rest starts      the next set: "Set 3, 80 kilos, 8 reps" (with the exercise's name first when
//                    the next set is another exercise's, as in a superset or after the last set)
//   10 s to go       "10 seconds" (rests of 20 seconds or more)
//   rest over        "Rest is over"
//   timed holds      "3", "2", "1", "Go!" through the count-in of a hold that starts by itself,
//                    and "3", "2", "1" at the end of every hold
//
// All of it in the app's language, through lib/speech.js (the phone's voice, which turns music
// down for a moment and never pauses it; the browser's elsewhere). Only while a workout runs and
// the page is on screen: a locked phone keeps the end tone and the notification it always had.
// useUI calls these at the moments above; what to say is worked out here, from the state.
import { isWarmupRow, isSideSet } from './workout-model.js'
import { modeOf, supersetUnits } from './history.js'
import { fmtNum } from './format.js'
import { t, tn, tnf, exerciseNameFor } from './i18n-core.js'
import { EXIDX } from './exercises.js'
import { viewEntry, exUnitOf } from './ex-unit.js'
import { speak, SPEECH_RATES, speechRateOf } from './speech.js'

/** Whether cues are on for this profile, and a workout is running. */
export const cuesOn = S => S?.spokenCues === true && !!S?.active

// The number a set row goes by: work sets and warm-ups are counted apart, a per-side timed pair is one.
function setNumber(sets, i) {
  const warm = isWarmupRow(sets[i])
  const n = sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
  return sets[i]?.side ? Math.ceil(n / 2) : n
}

const notDone = s => !!s && !(isSideSet(s) ? s.sides.L.done && s.sides.R.done : s.done)

/**
 * The set that comes after a rest started by entry `forIdx`: in a superset the next exercise of
 * the group that still has a set to do (round and round), else the same exercise, else the next
 * exercise down the list with one. `{ idx, i }` or null when the workout is done.
 */
export function nextSetAfter(active, forIdx) {
  const entries = active?.entries || []
  if (!entries.length) return null
  const firstOpen = idx => { const i = (entries[idx]?.sets || []).findIndex(notDone); return i >= 0 ? { idx, i } : null }
  const at = Number.isInteger(forIdx) && forIdx >= 0 && forIdx < entries.length ? forIdx : (active.cur || 0)
  const unit = supersetUnits(entries).find(u => u.includes(at)) || [at]
  if (unit.length > 1) {
    const k = unit.indexOf(at)
    for (let j = 1; j <= unit.length; j++) { const hit = firstOpen(unit[(k + j) % unit.length]); if (hit) return hit }
  } else {
    const hit = firstOpen(at)
    if (hit) return hit
  }
  for (let j = 1; j < entries.length; j++) { const hit = firstOpen((at + j) % entries.length); if (hit) return hit }
  return null
}

const weightWords = (w, unit) => (unit === 'lb' ? tnf('{0} pound', '{0} pounds', w, fmtNum(w)) : tnf('{0} kilo', '{0} kilos', w, fmtNum(w)))

/**
 * What to say for set `i` of `entry` ("Set 3, 80 kilos, 8 reps"). `name` (the exercise's) goes
 * first when given. Weights are read in the unit the exercise is shown in.
 */
export function setCueText(S, entry, i, { name = null } = {}) {
  const view = viewEntry(S, entry) || entry
  const s = view?.sets?.[i]
  if (!s) return ''
  const unit = exUnitOf(S, entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const parts = [isWarmupRow(s) ? t('Warm-up') : t('Set {0}', setNumber(view.sets, i))]
  const w = Number(s.w) || 0
  if (mode === 'cardio') {
    const min = Number(s.min) || 0
    if (min > 0) parts.push(tnf('{0} minute', '{0} minutes', min, fmtNum(min)))
  } else if (mode === 'time') {
    if (w > 0) parts.push(weightWords(w, unit))
    const sec = Number(s.sec ?? entry.target?.sec) || 0
    if (sec > 0) parts.push(tn('{0} second', '{0} seconds', sec))
  } else {
    if (w > 0) parts.push(weightWords(w, unit))
    if (isSideSet(s)) {
      const r = Number(s.sides.L.r) || 0
      if (r > 0) parts.push(tn('{0} rep per side', '{0} reps per side', r))
    } else {
      const r = Number(s.r) || 0
      if (r > 0) parts.push(tn('{0} rep', '{0} reps', r))
    }
  }
  const line = parts.join(', ')
  return name ? `${name}. ${line}` : line
}

/** The line said when a rest starts after a set of entry `forIdx`, or '' when nothing is left. */
export function restStartText(S, forIdx) {
  const next = nextSetAfter(S?.active, forIdx)
  if (!next) return ''
  const entry = S.active.entries[next.idx]
  const other = next.idx !== forIdx
  const ex = EXIDX[entry.id]
  const name = other ? (ex ? exerciseNameFor(ex) : (entry.n || '')) || null : null
  return setCueText(S, entry, next.i, { name })
}

/* ------------------------------ the moments useUI calls ------------------------------ */

let readStore = null
/** useUI hands over how to read the profile (it owns no copy of it). */
export function bindCueState(get) { readStore = get }

const live = () => {
  const S = readStore?.()
  return cuesOn(S) && !(typeof document !== 'undefined' && document.hidden) ? S : null
}
const say = (S, text, opts = {}) => {
  if (!text) return
  speak(text, { rate: SPEECH_RATES[speechRateOf(S)], onSilent: S.soundOnSilent === true, ...opts }).catch?.(() => {})
}

export const cues = {
  /** A rest began after a set of entry `forIdx`. */
  restStarted(forIdx) { const S = live(); if (S) say(S, restStartText(S, forIdx)) },
  /** A rest's second ticked: "10 seconds" once, on rests long enough for it to help. */
  restLeft(left, total) { if (left === 10 && total >= 20) { const S = live(); if (S) say(S, t('10 seconds')) } },
  /** The rest ran out on screen. */
  restOver() { const S = live(); if (S) say(S, t('Rest is over')) },
  /** A count-in or the end of a hold: a number, cutting off whatever is still being said. */
  count(n) { if (n >= 1 && n <= 3) { const S = live(); if (S) say(S, String(n), { queue: false }) } },
  /** The count-in is over and the hold begins. */
  go() { const S = live(); if (S) say(S, t('Go!'), { queue: false }) },
}

/** The line the Settings row says when tried: what a rest would announce. */
export const sampleCue = (unit = 'kg') => [t('Set {0}', 3), weightWords(unit === 'lb' ? 185 : 80, unit), tn('{0} rep', '{0} reps', 8)].join(', ')
