import { entriesForExercise, workoutAt, workoutDay, workoutVolume, countsWarmups, countsBodyweight } from './history.js'
import { bodyLoadOf, bodyweightFor } from './bw-load.js'
import { exView, exUnitOf } from './ex-unit.js'
import { exerciseOf, isAssisted } from './exercises.js'
import { dropsOf, isSideSet, isWarmupRow, modeForSet } from './workout-model.js'
import { isoOf } from './format.js'

const completedReps = s => s?.done === true && (Number(s.r) > 0 || dropsOf(s).some(d => Number(d?.r) > 0))
const repsSets = s => isSideSet(s)
  ? Number(!!completedReps(s.sides.L)) + Number(!!completedReps(s.sides.R))
  : Number(!!completedReps(s))
// Keep the existing equipment/share rules, with the assistance meaning saved then.
const bodyLoadForEntry = e => bodyLoadOf({ ...exerciseOf(e.id), assisted: isAssisted(e) })

/** Read-only volume for one exercise, one point per session in its pinned unit.
 * Windows include today and the preceding days - 1 local days. Unattributable
 * legacy sessions are counted as missing details, never as this exercise's volume.
 */
export function exerciseVolumeSeries(S, exId, { days = 0, now = Date.now() } = {}) {
  const result = { unit: exUnitOf(S, exId), points: [], included: 0, excluded: 0,
    reasons: { timedOrCardio: 0, noVolume: 0, missingDetails: 0 } }
  if (!exId) return result
  const XS = exView(S, exId)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - days + 1)
  const from = isoOf(start), today = isoOf(new Date(now))
  const warmups = countsWarmups(S)
  const exclude = reason => { result.excluded++; result.reasons[reason]++ }
  for (const w of XS?.workouts || []) {
    const d = workoutDay(w), t = workoutAt(w)
    if (!d || !Number.isFinite(t) || (days && (d < from || d > today))) continue
    if (!Array.isArray(w.entries) || !w.entries.length) { exclude('missingDetails'); continue }
    const occurrences = entriesForExercise(w, exId)
    if (!occurrences.length) continue
    // Saved entry/target overrides define what the logged weight meant then.
    // Assistance is not lifted volume, even beside ordinary work in one session.
    const entries = occurrences.filter(e => !isAssisted(e))
    if (!entries.length) { exclude('noVolume'); continue }
    if (entries.every(e => !Array.isArray(e.sets) || !e.sets.length)) { exclude('missingDetails'); continue }
    const reps = entries.map(e => ({ ...e, sets: (e.sets || []).filter(s => modeForSet(s, e.target || e) === 'reps') }))
    if (!reps.some(e => e.sets.length)) { exclude('timedOrCardio'); continue }
    const counted = reps.map(e => ({ ...e, sets: e.sets.filter(s => (warmups || !isWarmupRow(s)) && repsSets(s) > 0) }))
    const sets = counted.reduce((n, e) => n + e.sets.reduce((sum, s) => sum + repsSets(s), 0), 0)
    const bodyweight = countsBodyweight(S) ? bodyweightFor(w, XS) : 0
    const y = workoutVolume({ ...w, entries: counted }, { warmups, bodyweight, bodyLoadFor: bodyLoadForEntry })
    if (!(y > 0) || !Number.isFinite(y)) { exclude('noVolume'); continue }
    result.points.push({ t, d, y, sets })
  }
  result.points.sort((a, b) => a.t - b.t)
  result.included = result.points.length
  return result
}
