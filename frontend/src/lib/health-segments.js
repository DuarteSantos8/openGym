// The sets of a finished workout as Health Connect exercise segments (Android): each set its own
// slice of the session with what was done and how many reps, so an app reading the session sees
// "bench press, 8 reps" instead of one long block of strength training. Idea and first version by
// @finngrr (#816).
//
// Health Connect only knows a few dozen moves (ExerciseSegment.EXERCISE_SEGMENT_TYPE_*), so a
// catalogue exercise is matched by its English name and equipment, first match wins, and anything
// else is plain weightlifting. Only for strength sessions, where every one of these types is
// allowed; the native side drops the segments rather than the workout if Health Connect disagrees.
//
// When: a set is stamped with `at` when ticked, the moment it was over. Its length is its own time
// for a hold, else a few seconds a rep, and it never reaches back past the set before it or the
// session's start. Sets without a stamp (older workouts, imports) give no segment.
import { EXIDX } from './exercises.js'
import { hasCompletedWork, isSideSet, dropsOf, modeForEntry } from './workout-model.js'

export const SEC_PER_REP = 3.5
const MIN_MS = 10_000
const MAX_MS = 3 * 60_000
export const MAX_REPS = 10_000

// [name test, equipment test or null, segment type]. The native side maps each to its constant.
const BY_NAME = [
  [/\b(split squat|lunges?)\b/, null, 'lunge'],
  [/hip thrust|glute bridge/, null, 'hip_thrust'],
  [/leg press/, null, 'leg_press'],
  [/(leg|hamstring) curl/, null, 'leg_curl'],
  [/leg extension/, null, 'leg_extension'],
  [/deadlift/, null, 'deadlift'],
  [/\bsquat\b(?! thrust)/, null, 'squat'],
  [/bench press/, null, 'bench_press'],
  [/(lat )?pull ?down/, null, 'lat_pull_down'],
  [/pull-?ups?\b|chin-?ups?\b/, null, 'pull_up'],
  [/(shoulder|overhead|military) press/, /barbell/, 'barbell_shoulder_press'],
  [/(shoulder|overhead|military) press/, null, 'shoulder_press'],
  [/lateral raise/, /dumbbell/, 'dumbbell_lateral_raise'],
  [/lateral raise/, null, 'lateral_raise'],
  [/front raise/, /dumbbell/, 'dumbbell_front_raise'],
  [/front raise/, null, 'front_raise'],
  [/\brow\b/, /dumbbell/, 'dumbbell_row'],
  [/triceps? extension/, /dumbbell/, 'dumbbell_triceps_extension_two_arm'],
  [/triceps? extension/, null, 'double_arm_triceps_extension'],
  [/\bcurl\b/, null, 'arm_curl'],
  [/back extension|hyperextension/, null, 'back_extension'],
  [/kettlebell swing/, null, 'kettlebell_swing'],
  [/\bplank\b/, null, 'plank'],
  [/leg raise/, null, 'leg_raise'],
  [/\bcrunch/, null, 'crunch'],
  [/sit-?up/, /bench|decline/, 'bench_sit_up'],
  [/sit-?up/, null, 'sit_up'],
  [/burpee/, null, 'burpee'],
  [/jumping jack/, null, 'jumping_jack'],
  [/mountain climber/, null, 'mountain_climber'],
]
export const SEGMENT_TYPES = [...new Set([...BY_NAME.map(r => r[2]), 'weightlifting'])]

/** The segment type of one exercise: a catalogue one by its name, your own by its name too. */
export function segmentType(id, customEx = []) {
  const ex = EXIDX[id] || (customEx || []).find(c => c && c.id === id)
  const n = String(ex?.n || '').toLowerCase()
  const eq = String(ex?.eq || '').toLowerCase()
  const hit = BY_NAME.find(([re, eqRe]) => re.test(n) && (!eqRe || eqRe.test(eq) || eqRe.test(n)))
  return hit ? hit[2] : 'weightlifting'
}

const pos = v => (Number(v) > 0 ? Number(v) : 0)

// Reps and seconds of one ticked row, both sides of a per-side set and its drops included.
function work(s) {
  const parts = isSideSet(s) ? [s.sides.L, s.sides.R].filter(x => x?.done !== false) : [s]
  let reps = 0, sec = 0
  for (const p of parts) {
    reps += pos(p.r)
    sec += pos(p.sec)
    for (const d of dropsOf(p)) reps += pos(d.r)
  }
  // Health Connect counts repetitions in an int: a typo of 1e12 reps is capped, not overflowed.
  return { reps: Math.min(MAX_REPS, Math.round(reps)), sec: Math.min(MAX_MS / 1000, sec) }
}

/**
 * The segments of a finished workout: [{ start, end, type, reps }], in order, inside the session
 * and never overlapping. Cardio rows give none (they are not strength moves).
 */
export function workoutSegments(w, customEx = []) {
  const start = Number(w?.start), end = Number(w?.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(start > 0) || !(end > start)) return []
  const rows = []
  for (const e of w.entries || []) {
    if (modeForEntry(e) === 'cardio') continue
    const type = segmentType(e.id, customEx)
    for (const s of e.sets || []) {
      if (!hasCompletedWork(s) || !Number.isFinite(Number(s.at))) continue
      if (pos(s.min) || pos(s.speed)) continue
      const { reps, sec } = work(s)
      if (!reps && !sec) continue
      const len = Math.min(MAX_MS, Math.max(MIN_MS, sec ? sec * 1000 : reps * SEC_PER_REP * 1000))
      rows.push({ at: Number(s.at), len, type, reps })
    }
  }
  rows.sort((a, b) => a.at - b.at)
  const out = []
  let floor = start
  for (const r of rows) {
    const to = Math.min(end, r.at)
    const from = Math.max(floor, to - r.len)
    if (to - from < 1000) continue
    out.push({ start: Math.round(from), end: Math.round(to), type: r.type, reps: r.reps })
    floor = to
  }
  return out
}
