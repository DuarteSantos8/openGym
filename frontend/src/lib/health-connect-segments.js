// ExerciseSegment data for Health Connect 1.1.0. Catalogue ids, never display names: translations,
// custom names and compound movements must not silently turn into a different exercise.
// These tokens are mapped to AndroidX constants by HealthConnectPlugin.segmentType.
import { canonicalExId } from './exercises.js'
import { dropsOf, hasCompletedWork, isSideSet, modeForSet } from './workout-model.js'

export const SEGMENT_EXERCISES = {
  bench_press: ['0025', '0033', '0047', '0289'],                 // barbell flat/decline/incline, dumbbell
  deadlift: ['0032', '0085', '0966', '0967'],                   // conventional / Romanian, alternate views
  squat: ['0042', '0043', '0413', '0878', '1461', '1462'],      // front/back, dumbbell, alternate views
  barbell_shoulder_press: ['1162', '1165'],                    // standing military press
  shoulder_press: ['0404', '0405'],                           // seated dumbbell press
  arm_curl: ['0031', '0294'],                                 // barbell / dumbbell curl, no side assumed
  dumbbell_row: ['0293', '5661', '6146'],                      // bent over, chest supported, against wall
  dumbbell_front_raise: ['0309', '0310', '3428'],
  dumbbell_lateral_raise: ['0334'],
  lat_pull_down: ['0197', '0198', '2330'],
  leg_extension: ['0585', '1873'],
  leg_curl: ['0586', '0599', '8604'],
  leg_press: ['2951'],
  lunge: ['0336', '3341'],
  crunch: ['0274', '0275', '0831', '0832'],
  sit_up: ['0735', '0736', '3679'],
  pull_up: ['0017', '0253', '0651', '0652', '0841', '1326'],    // assisted, neutral, chin-up, weighted
  plank: ['0463', '5159'],                                    // static front plank only
  kettlebell_swing: ['0549'],
  burpee: ['1160'],
}
const BY_ID = new Map(Object.entries(SEGMENT_EXERCISES).flatMap(([type, ids]) => ids.map(id => [id, type])))

// Health Connect uses a signed Int for repetitions. Invalid counts mean "not recorded" (0),
// never rounded or wrapped into a claim about how many reps were done.
function repetitionsOf(set) {
  const rows = isSideSet(set) ? [set.sides.L, set.sides.R].filter(s => s.done === true) : [set]
  const counts = rows.flatMap(s => [s.r, ...dropsOf(s).map(d => d?.r)]).map(Number)
  if (counts.some(n => !Number.isInteger(n) || n < 0)) return 0
  const total = counts.reduce((a, b) => a + b, 0)
  return total <= 2147483647 ? total : 0
}

/**
 * One segment per completed row, including warm-ups. A drop-set's reps include its drops;
 * rest-pause r already includes every burst. Per-side rows share one tick, so only their
 * completed limbs are summed into that row, without inventing separate side times.
 *
 * Ordinary sets have a completion tick, not a start: their interval is the logging window
 * since the previous completed row (or session start), including any rest. Timed/cardio rows use
 * their logged seconds/minutes. We do not infer rep tempo or distribute untimed history over a session.
 * Missing/out-of-range/duplicate ticks and durations that do not fit keep only the session/notes.
 */
export function exerciseSegments(w, type) {
  if (type !== 'strength_training') return []
  const start = Number(w.start), end = Number(w.end)
  const rows = (w.entries || []).flatMap(entry => (entry.sets || [])
    .filter(set => hasCompletedWork(set) && Number.isSafeInteger(set.at) && set.at > start && set.at <= end)
    .map(set => ({ entry, set })))
    .sort((a, b) => a.set.at - b.set.at)
  const out = []
  let previous = start
  for (let i = 0; i < rows.length; i++) {
    const { entry, set } = rows[i]
    const from = previous
    previous = set.at
    // A shared tick cannot tell two sets apart in time. Omit both rather than arbitrarily
    // crediting one exercise with the other's interval or producing overlapping segments.
    if (rows[i - 1]?.set.at === set.at || rows[i + 1]?.set.at === set.at) continue
    const mode = modeForSet(set, entry.target)
    const duration = mode === 'time' ? Number(set.sec) * 1000 : Number(set.min) * 60000
    const segmentStart = mode === 'reps' ? from : set.at - duration
    if (!Number.isSafeInteger(segmentStart) || segmentStart < from || segmentStart >= set.at) continue
    // Cardio types (walking, biking, ...) are incompatible with a strength session in 1.1.0.
    // UNKNOWN is valid there and keeps the row without mislabelling it as weightlifting.
    const segmentType = mode === 'cardio' ? 'unknown' : BY_ID.get(canonicalExId(entry.id)) || 'unknown'
    out.push({ start: segmentStart, end: set.at, type: segmentType, repetitions: mode === 'reps' ? repetitionsOf(set) : 0 })
  }
  return out
}
