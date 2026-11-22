// The entry a workout gets when an exercise is added to it mid-session (a scanned machine, a tapped
// sticker): the routine block the current exercise sits in decides the prescription, freestyle
// repeats last time. Pure: the caller places it.
import { freestyleConfig, pickedExerciseConfig } from './history.js'
import { buildSessionEntry, builtOutOfProgression } from './session-start.js'
import { joinSessionNoProg } from './session-noprog.js'
import { sessionHistory } from './backfill.js'

export function entryToAdd(S, id, curEntry) {
  const curRid = curEntry?.rid
  const routine = curRid ? (S.routines || []).find(r => r.id === curRid) : null
  const noProg = !!routine && builtOutOfProgression(curEntry, routine)
  const cfg = routine ? pickedExerciseConfig(id, undefined, S) : freestyleConfig(sessionHistory(S), { id, ...pickedExerciseConfig(id, undefined, S) })
  const built = buildSessionEntry(S, id, cfg, routine, curEntry)
  return joinSessionNoProg(S.active, { id, ...built, ...(curRid ? { rid: curRid, addedInSession: true } : {}), ...(noProg ? { noProg: true } : {}) })
}
