// Per-exercise rows for the Strength view: best estimated 1RM from the user's own logged
// sets, the retained-strength decay that applies to the exercise, and the expected CURRENT
// 1RM (= estimate x retained strength). Muscle mapping is catalogue-first (EXIDX), exactly
// like the fatigue/strength maps - so the decay a row shows always matches the muscle the
// map shows - falling back to the workout entry's logged snapshot (muscleWeights) for
// exercises no longer in the catalogue.
import { best1RM } from './onerm.js'
import { strengthOf } from './recovery.js'
import { musclesOf } from './muscles.js'
import { EXIDX } from './exercises.js'
import { historyUnitCompatible } from './workout-model.js'

const round1 = value => Math.round(value * 10) / 10

function snapshotWeights(entry) {
  const catalogue = entry && typeof entry === 'object' ? EXIDX[entry.id] : null
  if (catalogue) {
    const weights = musclesOf(catalogue)
    if (Object.keys(weights).length) return weights
  }
  const direct = entry && typeof entry === 'object' ? entry.muscleWeights : null
  if (direct && typeof direct === 'object' && !Array.isArray(direct) && Object.keys(direct).length) {
    return direct
  }
  return musclesOf(entry)
}

// Highest-weight muscle of an exercise - the one whose decay governs the exercise's
// expected current 1RM when no muscle is selected on the map.
export function primaryMuscleOf(entry) {
  const weights = snapshotWeights(entry)
  let best = null
  for (const [slug, weight] of Object.entries(weights)) {
    if (!best || weight > best.weight) best = { slug, weight }
  }
  return best
}

function exerciseName(entry) {
  // Imported history often has no name snapshot (entries are { id, sets, topW }) - the
  // catalogue (or the registered custom) is the canonical name source.
  const ex = entry && typeof entry === 'object' ? EXIDX[entry.id] : null
  if (ex?.n) return ex.n
  return entry && typeof entry === 'object' && entry.n ? entry.n : null
}

function firstEntryWithId(S, id) {
  for (const workout of S?.workouts || []) {
    if (!historyUnitCompatible(workout, S.unit)) continue
    const entry = (workout.entries || []).find(e => e.id === id)
    if (entry) return entry
  }
  return null
}

/**
 * Strength rows for every exercise with an estimate: best estimated 1RM (work sets only,
 * warm-ups excluded), the estimate's date, the exercise's primary muscle, that muscle's
 * retained strength, and the expected current 1RM (estimate x decay). Sorted by expected
 * current 1RM, strongest first. Exercises without a usable estimate are omitted - a made-up
 * number is worse than no number.
 */
export function strengthExerciseRows(S, now) {
  const workouts = S?.workouts || []
  const strength = strengthOf(workouts, now)
  const ids = [...new Set(workouts.flatMap(w => (w.entries || []).map(e => e.id)))]
  const rows = []
  for (const id of ids) {
    const best = best1RM(S, id)
    if (!best) continue
    const entry = firstEntryWithId(S, id)
    const primary = primaryMuscleOf(entry)
    const decay = primary ? (strength[primary.slug] ?? 0.5) : 0.5
    rows.push({
      id,
      name: exerciseName(entry) || id,
      est: best.est,
      estDate: best.d,
      primary: primary ? primary.slug : null,
      decay,
      current: round1(best.est * decay),
    })
  }
  return rows.sort((a, b) => b.current - a.current || String(a.name).localeCompare(String(b.name)))
}

/**
 * Strength rows for the exercises whose logged snapshot includes `slug`, each with its
 * muscle weight (1 = primary, 0.4 = secondary), the estimate, and the expected current 1RM
 * under THAT muscle's decay - the map's selected muscle is the one whose decay is shown.
 */
export function strengthExerciseRowsForMuscle(S, now, slug) {
  const workouts = S?.workouts || []
  const strength = strengthOf(workouts, now)
  const decay = strength[slug] ?? 0.5
  const seen = new Map()
  for (const workout of workouts) {
    if (!historyUnitCompatible(workout, S.unit)) continue
    for (const entry of workout.entries || []) {
      if (seen.has(entry.id)) continue
      const weights = snapshotWeights(entry)
      const weight = weights[slug]
      if (!weight) continue
      const best = best1RM(S, entry.id)
      if (!best) continue
      const primary = primaryMuscleOf(entry)
      seen.set(entry.id, {
        id: entry.id,
        name: exerciseName(entry) || entry.id,
        weight,
        primary: primary ? primary.slug : null,
        est: best.est,
        estDate: best.d,
        decay,
        current: round1(best.est * decay),
      })
    }
  }
  return [...seen.values()].sort((a, b) => b.current - a.current || String(a.name).localeCompare(String(b.name)))
}
