/* A routine someone describes ("squat 3 x 12, plank 3 x 25 s, on Tuesday and Friday") as the
   routine the Plan screen would have saved. Pure: it reads the profile and returns what to add,
   it never touches it, so the MCP tool and its tests share one definition of "a valid routine".

   Names are the LLM's to spell; this resolves them against the library the way log_workout does
   (resolveExercise) and hands back every problem at once, with candidates, so one round trip
   to the user settles them all. */
import { resolveExercise } from './log-workout.js'
import { isCardio } from './exercises.js'
import { uid } from './format.js'

export const ROUTINE_LIMITS = { maxExercises: 40, maxSets: 20, maxReps: 1000, maxSec: 6 * 3600, maxRestSec: 3600 }

const DAY_NUMBERS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
const int = v => (typeof v === 'number' && Number.isInteger(v) ? v : null)

/** A weekday as getDay() numbers it (Sunday = 0), from a number or an English name; else null. */
export function weekdayOf(day) {
  if (typeof day === 'number') return Number.isInteger(day) && day >= 0 && day <= 6 ? day : null
  const k = String(day ?? '').trim().toLowerCase()
  return Object.hasOwn(DAY_NUMBERS, k) ? DAY_NUMBERS[k] : null
}

const nameKey = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The routine exercises a list of descriptions stands for, in order. Every problem goes into
 * `problems` (with the index of the description it is about), and the exercises that were fine
 * are returned anyway: the caller refuses the whole routine when `problems` is not empty.
 */
function buildExercises(S, exercises, problems, field = 'exercises') {
  const ex = []
  if (!exercises.length) problems.push({ field, problem: 'the routine needs at least one exercise' })
  if (exercises.length > ROUTINE_LIMITS.maxExercises) problems.push({ field, problem: `at most ${ROUTINE_LIMITS.maxExercises} exercises` })

  exercises.forEach((e, i) => {
    const at = { exercise: e.exercise, index: i }
    const r = resolveExercise(S, e.exercise)
    if (r.problem) return problems.push({ ...at, problem: r.problem, ...(r.candidates ? { candidates: r.candidates } : {}) })
    if (isCardio(r.id)) return problems.push({ ...at, problem: 'cardio by time and speed is not supported here; add it in the app' })
    const sets = int(e.sets)
    if (sets == null || sets < 1 || sets > ROUTINE_LIMITS.maxSets) return problems.push({ ...at, problem: `sets must be a whole number from 1 to ${ROUTINE_LIMITS.maxSets}` })
    const hasReps = e.reps != null, hasSec = e.seconds != null
    if (hasReps === hasSec) return problems.push({ ...at, problem: 'give reps for a rep exercise or seconds for a hold, one of the two' })
    const out = { id: r.id, sets }
    if (hasSec) {
      const sec = int(e.seconds)
      if (sec == null || sec < 1 || sec > ROUTINE_LIMITS.maxSec) return problems.push({ ...at, problem: `seconds must be a whole number from 1 to ${ROUTINE_LIMITS.maxSec}` })
      out.mode = 'time'
      out.sec = sec
    } else {
      const reps = int(e.reps)
      if (reps == null || reps < 1 || reps > ROUTINE_LIMITS.maxReps) return problems.push({ ...at, problem: `reps must be a whole number from 1 to ${ROUTINE_LIMITS.maxReps}` })
      out.reps = reps
    }
    if (e.weight != null) {
      if (typeof e.weight !== 'number' || !Number.isFinite(e.weight) || e.weight < 0) return problems.push({ ...at, problem: 'weight must be a number of 0 or more' })
      if (e.weight > 0) out.weight = e.weight
    }
    if (e.rest_sec != null) {
      const rest = int(e.rest_sec)
      if (rest == null || rest < 1 || rest > ROUTINE_LIMITS.maxRestSec) return problems.push({ ...at, problem: `rest_sec must be a whole number from 1 to ${ROUTINE_LIMITS.maxRestSec}` })
      out.restSec = rest
    }
    ex.push(out)
  })
  return ex
}

/**
 * Build the routine `input` describes against profile `S`, without touching it.
 *
 * `input`: { name, emoji?, days?: [0..6 | 'tuesday'], exercises: [{ exercise, sets,
 *   reps? | seconds?, weight?, rest_sec? }] }
 *
 * Returns { routine, week, duplicate? } or { problems }. `week` is the weekday plan after the
 * routine is added: days it names gain its id, days it does not name are left as they are.
 */
export function buildRoutine(S, input, { newId = uid } = {}) {
  const problems = []
  const name = String(input.name ?? '').trim()
  if (!name) problems.push({ field: 'name', problem: 'the routine needs a name' })

  const days = []
  for (const d of input.days || []) {
    const n = weekdayOf(d)
    if (n == null) problems.push({ field: 'days', input: d, problem: 'not a weekday: use 0 (Sunday) to 6 (Saturday) or an English name' })
    else if (!days.includes(n)) days.push(n)
  }

  const ex = buildExercises(S, input.exercises || [], problems)

  if (problems.length) return { problems }

  // Same name already planned: the same description twice must not stack a second copy.
  const existing = (S.routines || []).find(r => r && nameKey(r.name) === nameKey(name))
  if (existing) return { duplicate: { id: existing.id, name: existing.name } }

  const routine = { id: newId(), name, ...(input.emoji ? { emoji: input.emoji } : {}), ex }
  const week = { ...(S.week || {}) }
  for (const d of days) week[d] = [...[].concat(week[d] || []), routine.id]
  return { routine, week, days }
}

/** Add a routine built by buildRoutine to the draft profile `S`, in place. */
export function appendRoutine(S, built) {
  S.routines = S.routines || []
  S.routines.push(built.routine)
  S.week = built.week
  return built.routine
}

/** The routine a reference names: its id, else its name when exactly one has it. */
export function findRoutine(S, ref) {
  const text = String(ref ?? '').trim()
  if (!text) return { problem: 'no routine named' }
  const all = (S.routines || []).filter(r => r && r.id)
  const byId = all.find(r => r.id === text)
  if (byId) return { routine: byId }
  const named = all.filter(r => nameKey(r.name) === nameKey(text))
  if (named.length === 1) return { routine: named[0] }
  const candidates = (named.length ? named : all).map(r => ({ id: r.id, name: r.name }))
  return { problem: named.length ? 'several routines have this name; pass one id' : 'no routine matches', candidates }
}

/**
 * Change a routine against profile `S`, without touching it.
 *
 * `input`: { routine, name?, emoji?, days?, exercises?, add_exercises?, remove_exercises? }
 *   - name / emoji: renamed or re-iconed ('' clears the emoji)
 *   - days: the routine's weekdays from now on (replaces its old ones; [] takes it off the week;
 *     other routines on those days stay). Omit to leave the week alone.
 *   - exercises: the whole new list, in order. An exercise the routine already had keeps what
 *     the description does not mention (progression rule, own rest, superset…).
 *   - add_exercises: appended after the current ones. remove_exercises: names or ids to drop.
 *   `exercises` replaces the list, so it cannot come with add_exercises or remove_exercises.
 *
 * Returns { routine, week, days, changed } (the edited copies, `S` untouched) or { problems }.
 */
export function editRoutine(S, input) {
  const problems = []
  const found = findRoutine(S, input.routine)
  if (found.problem) return { problems: [{ field: 'routine', problem: found.problem, ...(found.candidates ? { candidates: found.candidates } : {}) }] }
  const old = found.routine
  const changed = []
  const next = { ...old, ex: (old.ex || []).map(e => ({ ...e })) }

  if (input.name != null) {
    const name = String(input.name).trim()
    if (!name) problems.push({ field: 'name', problem: 'the routine needs a name' })
    else if ((S.routines || []).some(r => r && r.id !== old.id && nameKey(r.name) === nameKey(name))) problems.push({ field: 'name', problem: 'another routine already has this name' })
    else if (name !== old.name) { next.name = name; changed.push('name') }
  }
  if (input.emoji != null) {
    if (input.emoji === '') { if (old.emoji) { delete next.emoji; changed.push('emoji') } }
    else if (input.emoji !== old.emoji) { next.emoji = input.emoji; changed.push('emoji') }
  }

  const replacing = input.exercises != null
  if (replacing && (input.add_exercises?.length || input.remove_exercises?.length)) {
    problems.push({ field: 'exercises', problem: 'exercises replaces the whole list: use add_exercises and remove_exercises to change part of it, not together with it' })
  } else if (replacing) {
    const built = buildExercises(S, input.exercises, problems)
    const pool = (old.ex || []).map(e => ({ ...e }))
    next.ex = built.map(b => {
      const i = pool.findIndex(e => e.id === b.id)
      if (i < 0) return b
      const [kept] = pool.splice(i, 1)
      // The description's mode decides: a plank that was timed and is now reps must not keep its seconds.
      const { sec, mode, reps, ...rest } = kept
      return { ...rest, ...b }
    })
    changed.push('exercises')
  } else {
    if (input.remove_exercises?.length) {
      const drop = new Set()
      input.remove_exercises.forEach((ref, i) => {
        const r = resolveExercise(S, ref)
        if (r.problem) return problems.push({ field: 'remove_exercises', exercise: ref, index: i, problem: r.problem, ...(r.candidates ? { candidates: r.candidates } : {}) })
        if (!next.ex.some(e => e.id === r.id)) return problems.push({ field: 'remove_exercises', exercise: ref, index: i, problem: 'the routine does not have this exercise' })
        drop.add(r.id)
      })
      next.ex = next.ex.filter(e => !drop.has(e.id))
      changed.push('remove_exercises')
    }
    if (input.add_exercises?.length) {
      const add = buildExercises(S, input.add_exercises, problems, 'add_exercises')
      for (const a of add) if (next.ex.some(e => e.id === a.id)) problems.push({ field: 'add_exercises', exercise: a.id, problem: 'the routine already has this exercise: use exercises to change its numbers' })
      next.ex = [...next.ex, ...add]
      changed.push('add_exercises')
    }
    if (!next.ex.length) problems.push({ field: 'exercises', problem: 'a routine needs at least one exercise: delete it in the app instead' })
  }

  const week = { ...(S.week || {}) }
  let days = null
  if (input.days != null) {
    days = []
    for (const d of input.days) {
      const n = weekdayOf(d)
      if (n == null) problems.push({ field: 'days', input: d, problem: 'not a weekday: use 0 (Sunday) to 6 (Saturday) or an English name' })
      else if (!days.includes(n)) days.push(n)
    }
    for (const d of Object.keys(week)) {
      const rest = [].concat(week[d] || []).filter(id => id !== old.id)
      if (rest.length) week[d] = rest
      else delete week[d]
    }
    for (const d of days) week[d] = [...[].concat(week[d] || []), old.id]
    changed.push('days')
  }

  if (problems.length) return { problems }
  return { routine: next, week, days, changed }
}

/** Put a routine edited by editRoutine into the draft profile `S`, in place. */
export function applyRoutineEdit(S, edit) {
  S.routines = (S.routines || []).map(r => (r.id === edit.routine.id ? edit.routine : r))
  if (edit.days) S.week = edit.week
  return edit.routine
}
