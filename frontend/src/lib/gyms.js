// Gyms: the same machine does not load the same in every club. A cable stack at one gym reads
// 50 where another reads 20, so "last time" has to mean the last time in THIS gym.
//
// The data is small on purpose:
//   S.gyms     [{ id, name }]   the places the user trains at, kept by name (Settings and the
//                               picker shown when a workout starts)
//   S.gymLast  id | null        the gym of the last workout started, offered first next time
//   active.gym / workout.gym    the gym a session was done in; written only when one was chosen,
//                               so a profile that never lists a gym is byte-for-byte what it was
//
// A profile with no gyms listed reads everything as before: no gym, no filtering.
export const MAX_GYMS = 12
export const GYM_NAME_MAX = 40

/** The listed gyms, ignoring anything malformed (a hand-edited backup, an older build). */
export const gymsOf = S => (Array.isArray(S?.gyms) ? S.gyms.filter(g => g && typeof g.id === 'string' && g.id && typeof g.name === 'string' && g.name.trim()) : [])

/**
 * The gym the session being built or run belongs to: the running session's, or the one a start is
 * about to open (`pendingGym`, set only on the read-only copy beginWorkout builds entries from).
 */
export const gymOf = S => S?.active?.gym ?? S?.pendingGym ?? null

export const gymNameOf = (S, id) => (id ? gymsOf(S).find(g => g.id === id)?.name || null : null)

// Did this saved workout log something for the exercise? A set counts once it was ticked: a row
// that was planned and never done says nothing about what the machine takes.
const didExercise = (w, exId) => (w?.entries || []).some(e => e && e.id === exId && (e.sets || []).some(s => s && s.done))

/**
 * The history to read an exercise's "last time" and its next prescription from, for a gym.
 *
 * If the exercise has been done in that gym before, the view holds only the workouts done there:
 * 20 kg on the Basic-Fit machine is not a deload from 50 kg on the other one. If it never was,
 * the whole log is returned unchanged, so a first visit starts from what you lifted elsewhere
 * rather than from an empty bar. Workouts saved before gyms existed carry no gym and never
 * count as "in" one. With no gym there is nothing to filter and S itself comes back.
 *
 * A view for reading only: the list is new, everything else is S's own.
 */
export function gymHistory(S, exId, gym = gymOf(S)) {
  if (!S || !gym) return S
  const workouts = S.workouts || []
  const here = workouts.filter(w => w && w.gym === gym)
  if (!here.some(w => didExercise(w, exId))) return S
  return { ...S, workouts: here }
}

/**
 * Whether the numbers an exercise opens with come from another gym: it has history, none of it
 * in `gym`, so the weights shown are the ones lifted elsewhere. The workout screen says so, so
 * a lighter machine is not a surprise.
 */
export function carriedFromOtherGym(S, exId, gym = gymOf(S)) {
  if (!S || !gym) return false
  const workouts = S.workouts || []
  return workouts.some(w => didExercise(w, exId)) && !workouts.some(w => w && w.gym === gym && didExercise(w, exId))
}

/** A gym name as it is kept: trimmed, one line, capped. Empty when there is nothing left. */
export const cleanGymName = name => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, GYM_NAME_MAX)

/**
 * The gym list with `name` added under `id`. Returns `{ gyms, id }`, or null when the name is
 * empty or the list is full. A name already listed (any case) is not added twice: its own id
 * comes back so the picker simply selects it.
 */
export function withGym(list, name, id) {
  const clean = cleanGymName(name)
  const gyms = Array.isArray(list) ? list.filter(g => g && g.id && g.name) : []
  if (!clean) return null
  const same = gyms.find(g => g.name.toLowerCase() === clean.toLowerCase())
  if (same) return { gyms, id: same.id }
  if (gyms.length >= MAX_GYMS) return null
  return { gyms: [...gyms, { id, name: clean }], id }
}

/** The list with one gym renamed. Null when the new name is empty or another gym already has it. */
export function renamedGym(list, id, name) {
  const clean = cleanGymName(name)
  if (!clean) return null
  const gyms = Array.isArray(list) ? list : []
  if (gyms.some(g => g.id !== id && g.name.toLowerCase() === clean.toLowerCase())) return null
  return gyms.map(g => (g.id === id ? { ...g, name: clean } : g))
}
