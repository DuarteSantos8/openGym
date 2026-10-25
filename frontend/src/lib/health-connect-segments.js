// One Health Connect segment per usable completed set. These are log events, not rep-tempo data.
import { EXIDX, canonicalExId, isAssisted } from './exercises.js'
import { dropsOf, hasCompletedWork, isSideSet, modeForSet } from './workout-model.js'
import { entryDbLoad, isOneArm } from './dumbbells.js'
import { segmentTypeFor } from './health-connect-mapping.js'
export { SEGMENT_EXERCISES } from './health-connect-mapping.js'

const completedSides = set => isSideSet(set)
  ? [set.sides.L, set.sides.R].filter(s => s.done === true) : [set]
const number = value => value == null || value === '' ? NaN : Number(value)

// Rest-pause r already includes the activation and bursts. Drops are additional reps.
export function repetitionsOf(set) {
  const counts = completedSides(set).flatMap(s => [s.r, ...dropsOf(s).map(d => d?.r)]).map(number)
  if (counts.some(n => !Number.isInteger(n) || n < 0)) return 0
  const total = counts.reduce((a, b) => a + b, 0)
  return total <= 2147483647 ? total : 0
}

const LOAD_EQUIPMENT = new Set(['barbell', 'olympic barbell', 'ez barbell', 'trap bar', 'dumbbell',
  'kettlebell', 'cable', 'leverage machine', 'smith machine', 'sled machine', 'weighted',
  'weight plate', 'sandbag', 'landmine', 'macebell', 'medicine ball'])

// HC has one mass, not assistance, left/right loads or a load sequence. Never average them.
// Bodyweight w is added external mass; it never includes the athlete's body mass.
export function segmentWeightKg(entry, set, workout, unit = 'kg') {
  const ex = EXIDX[canonicalExId(entry.id)] || entry.exercise || {}
  if (isAssisted(ex) || entry.target?.assisted === true || ex.eq === 'assisted') return null
  if (ex.eq === 'band' || ex.eq === 'resistance band') return null
  const bodyweight = entry.target?.bodyweight === true || ex.eq === 'body weight'
  if (!bodyweight && !LOAD_EQUIPMENT.has(ex.eq)) return null
  const values = []
  for (const side of completedSides(set)) {
    for (const row of [side, ...dropsOf(side)]) {
      const w = number(row.w)
      const u = row.unit ?? side.unit ?? set.unit ?? entry.target?.unit ?? entry.unit ?? workout.unit ?? unit
      if (!(w > 0) || !['kg', 'lb'].includes(u)) return null
      values.push(u === 'lb' ? w * 0.45359237 : w)
    }
  }
  if (!values.length || values.some(w => Math.abs(w - values[0]) > 0.000001)) return null
  let kg = values[0]
  if (ex.eq === 'dumbbell' || ex.eq === 'kettlebell') {
    const meaning = entryDbLoad(entry)
    const single = isSideSet(set) || isOneArm({ ...entry.target, id: entry.id })
    if (meaning === 'as' && !single) return null // legacy entry never said per bell or total
    if (meaning === 'each' && !single) kg *= 2
  }
  return Number.isFinite(kg) && kg <= 2500 ? Math.round(kg * 1000000) / 1000000 : null
}

// RIR↔RPE exists for openGym charts, but HC specifies Borg CR10. Export explicit RPE only.
// A scalar "harder side" aggregate is not an RPE for both asymmetric sides.
export function segmentRpe(set) {
  const values = completedSides(set).map(s => number(s.rpe))
  return values.length && values.every(v => Number.isFinite(v) && v >= 0 && v <= 10 && v === values[0])
    ? values[0] : null
}

/**
 * Untimed sets get a 1 ms technical interval ending at their completion tick: HC requires
 * start < end, but openGym did not measure a lifting start. Never include the preceding rest.
 * Equal ticks use adjacent 1 ms slots ending at that tick, preserving source order.
 * Timed/cardio rows use their recorded duration only when it fits without overlap.
 * Missing ticks are omitted, never spread evenly over a session or assigned invented times.
 */
export function exerciseSegments(w, type, { unit = 'kg', extended = true } = {}) {
  const start = number(w?.start), end = number(w?.end)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return []
  const rows = (w.entries || []).flatMap(entry => (entry.sets || [])
    .map((set, setIndex) => ({ entry, set, setIndex }))
    .filter(({ set }) => hasCompletedWork(set) && Number.isSafeInteger(set.at) && set.at > start && set.at <= end))
    .sort((a, b) => a.set.at - b.set.at)
  const out = []
  let previous = start
  for (let i = 0; i < rows.length;) {
    let groupEnd = i + 1
    while (groupEnd < rows.length && rows[groupEnd].set.at === rows[i].set.at) groupEnd++
    for (let j = i; j < groupEnd; j++) {
      const { entry, set, setIndex } = rows[j]
      const mode = modeForSet(set, entry.target)
      const segmentEnd = set.at - (groupEnd - j - 1)
      // A unilateral timed row can carry the recorded duration on each completed limb.
      const duration = mode === 'time'
        ? (isSideSet(set) ? completedSides(set).reduce((n, s) => n + number(s.sec), 0) : number(set.sec)) * 1000
        : number(set.min) * 60000
      const segmentStart = mode === 'reps' ? segmentEnd - 1 : segmentEnd - duration
      if (!Number.isSafeInteger(segmentStart) || segmentStart < previous || segmentStart >= segmentEnd) continue
      const segment = { start: segmentStart, end: segmentEnd, type: segmentTypeFor(entry, mode),
        repetitions: mode === 'reps' ? repetitionsOf(set) : 0 }
      if (extended) {
        segment.setIndex = setIndex
        const kg = mode === 'cardio' ? null : segmentWeightKg(entry, set, w, unit)
        const rpe = segmentRpe(set)
        if (kg != null) segment.weightKg = kg
        if (rpe != null) segment.rpe = rpe
      }
      out.push(segment)
      previous = segmentEnd
    }
    i = groupEnd
  }
  return out
}
