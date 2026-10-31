// Machines: the same exercise does not load the same on every machine. A cable stack at one club
// reads 50 where another reads 20, a Technogym press is not a Basic-Fit one, so "last time" has
// to mean the last time on THIS machine.
//
// The data is small on purpose:
//   S.gyms        [{ id, name }]  the machines (or clubs) the user trains on, kept by name; the
//                                 key keeps the name it had when it was a list of gyms
//   entry.gym     id              the machine one exercise of a session was done on, chosen per
//                                 exercise and saved with the finished workout's entry
//   workout.gym   id              a workout from the first version of this feature, tagged as a
//                                 whole; read as the machine of every exercise in it
//
// An exercise with no machine reads the whole log as before, and so does a profile that never
// lists one: nothing is written, nothing is filtered.
export const MAX_GYMS = 12
export const GYM_NAME_MAX = 40

/** The listed machines, ignoring anything malformed (a hand-edited backup, an older build). */
export const gymsOf = S => (Array.isArray(S?.gyms) ? S.gyms.filter(g => g && typeof g.id === 'string' && g.id && typeof g.name === 'string' && g.name.trim()) : [])

export const gymNameOf = (S, id) => (id ? gymsOf(S).find(g => g.id === id)?.name || null : null)

/** The machine a saved entry was done on: its own, else the one its whole workout was tagged with. */
export const entryGym = (w, e) => e?.gym ?? w?.gym ?? null

// Did this saved entry log something for the exercise? A set counts once it was ticked: a row
// that was planned and never done says nothing about what the machine takes.
const didIt = e => (e?.sets || []).some(s => s && s.done)
const entriesOf = (w, exId) => (w?.entries || []).filter(e => e && e.id === exId)

/**
 * The machine an exercise opens on: the one it was last done on, while that machine is still
 * listed. Null when it never had one, so a fresh exercise starts from the whole log.
 */
export function defaultGymFor(S, exId) {
  const listed = new Set(gymsOf(S).map(g => g.id))
  if (!listed.size) return null
  const workouts = S?.workouts || []
  for (let i = workouts.length - 1; i >= 0; i--) {
    const w = workouts[i]
    for (const e of entriesOf(w, exId)) {
      const g = entryGym(w, e)
      if (g && didIt(e)) return listed.has(g) ? g : null
    }
  }
  return null
}

/**
 * The history to read an exercise's "last time" and its next prescription from, on a machine.
 *
 * If the exercise has been done on that machine before, the view holds only those sessions:
 * 20 kg on the Basic-Fit press is not a deload from 50 kg on the Technogym one. If it never was,
 * the whole log is returned unchanged, so a first time on a machine starts from what you lifted
 * elsewhere rather than from an empty bar. Entries saved before machines existed carry none and
 * never count as being on one. With no machine there is nothing to filter and S comes back.
 *
 * A view for reading only: the lists are new, everything else is S's own.
 */
export function gymHistory(S, exId, gym) {
  if (!S || !gym) return S
  const workouts = S.workouts || []
  const onIt = w => entriesOf(w, exId).some(e => entryGym(w, e) === gym && didIt(e))
  if (!workouts.some(onIt)) return S
  return {
    ...S,
    workouts: workouts.filter(onIt).map(w => ({ ...w, entries: w.entries.filter(e => !e || e.id !== exId || entryGym(w, e) === gym) })),
  }
}

/** A machine name as it is kept: trimmed, one line, capped. Empty when there is nothing left. */
export const cleanGymName = name => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, GYM_NAME_MAX)

/**
 * The list with `name` added under `id`. Returns `{ gyms, id }`, or null when the name is empty or
 * the list is full. A name already listed (any case) is not added twice: its own id comes back so
 * the picker simply selects it.
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

/** The list with one machine renamed. Null when the new name is empty or another one already has it. */
export function renamedGym(list, id, name) {
  const clean = cleanGymName(name)
  if (!clean) return null
  const gyms = Array.isArray(list) ? list : []
  if (gyms.some(g => g.id !== id && g.name.toLowerCase() === clean.toLowerCase())) return null
  return gyms.map(g => (g.id === id ? { ...g, name: clean } : g))
}
