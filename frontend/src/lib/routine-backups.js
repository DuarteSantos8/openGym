// Planned substitutes for an exercise in a routine (Discord "Substitutions for a routine"): the
// machine is taken, the bar is busy, and the plan already says what to do instead. An optional
// list of exercise ids on the routine's entry, `subs`, picked in the routine editor; a running
// workout's swap sheet shows them first ("Your backups"), and the exercise's ⋯ menu offers each in
// one tap (#649). Nothing else reads it, and a routine entry without it is exactly what it was.

import { replaceSlotExercise } from './routines.js'

export const MAX_BACKUPS = 5

/**
 * The list as it may be stored: unique string ids, never the exercise itself, only ones `known`
 * says exist, at most MAX_BACKUPS. An empty result is no list at all (the field is left out).
 */
export function cleanBackups(list, selfId, known = () => true) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const id of list) {
    if (typeof id !== 'string' || !id || id === selfId || out.includes(id) || !known(id)) continue
    out.push(id)
    if (out.length >= MAX_BACKUPS) break
  }
  return out
}

/** `{ subs }` to spread into a saved entry, or nothing when there are none. */
export const withBackups = (list, selfId, known) => {
  const subs = cleanBackups(list, selfId, known)
  return subs.length ? { subs } : {}
}

/**
 * The plan for `backupId` taking over a running slot in one tap (#649): the slot's own sets, reps,
 * rest, warm-ups and progression, carried the way the routine editor's Replace carries them
 * (replaceSlotExercise, so a bench at 80 kg does not open the dumbbells at 80). The exercise it
 * replaces goes to the front of the backups, so the machine coming free is one tap back too.
 * Only today's session sees this: the routine keeps its exercise and its list.
 */
export function backupSlotConfig(slot, backupId, S, rid, known) {
  const old = slot || {}
  const out = replaceSlotExercise(old, backupId, S, rid)
  delete out.subs
  return { ...out, ...withBackups([old.id, ...(old.subs || [])], backupId, known) }
}
