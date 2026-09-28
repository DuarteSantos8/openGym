// "Don't count for progression" for a whole session, from the workout header ⋮ (Discord,
// asierlama: "exclude the current workout" on an injury day). An exercise's ⋯ menu does it for
// one exercise by stamping that entry's `noProg`; this stamps every entry. The entries are what
// everything downstream reads: the saved workout keeps each entry's flag and gets the whole-workout
// `excludeFromProgression` when every entry carries it (finish-workout.js), and the history and the
// next prescription read past them (history.js entryExcluded). So a session kept out as a whole
// saves exactly like one whose exercises were each kept out by hand.
//
// `active.noProg` records that the choice was made for the session as a whole, which the entries
// cannot tell on their own: a one-exercise session with that exercise kept out by hand looks the
// same. It is what the header shows as on, and what an exercise or a routine added afterwards
// joins, so the session stays out as a whole. It lives on the running session only; the saved
// workout is built from the entries (buildCompletedWorkout lists its fields) and never carries it.

const list = v => (Array.isArray(v) ? v : [])

export const sessionNoProg = active => active?.noProg === true

/**
 * Keeps the whole session out of progression, or puts it back. Off counts every entry again
 * except the ones a deload or rehab routine keeps out (`routineOwns(entry)`): that is the
 * routine's setting, which its entries show with no switch of their own, the same rule as the
 * exercise menu. Mutates `active`, for use inside a store update.
 */
export function setSessionNoProg(active, on, routineOwns = () => false) {
  if (!active) return
  if (on) {
    active.noProg = true
    for (const entry of list(active.entries)) if (entry) entry.noProg = true
    return
  }
  delete active.noProg
  for (const entry of list(active.entries)) if (entry && !routineOwns(entry)) delete entry.noProg
}

/**
 * One exercise kept out or counted again from its own menu or its marker's Undo. Counting one
 * again means the session is no longer out as a whole, so the header stops saying it is and an
 * exercise added later counts too.
 */
export function setEntryNoProg(active, index, on) {
  const entry = list(active?.entries)[index]
  if (!entry) return
  if (on) {
    entry.noProg = true
    return
  }
  delete entry.noProg
  delete active.noProg
}

/** An entry joining the session (added, or brought in with a routine): out too while the whole session is. */
export const joinSessionNoProg = (active, entry) => (sessionNoProg(active) ? { ...entry, noProg: true } : entry)
