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

// A backup's own plan (#978): its sets, reps, weight, rest and progression, set in the routine
// editor by tapping the backup. Kept beside the list as `subCfg`, keyed by the backup's id, so
// `subs` stays a plain list of ids for everything else that reads it. A backup without one
// takes the slot's plan, as it always did (backupSlotConfig).
// What a backup's plan may not hold: who it is, its own backups, and the superset it sits in
// (that belongs to the slot).
const NOT_IN_BACKUP_CFG = ['id', 'subs', 'subCfg', 'sg', 'sgName', 'sgRest', 'sgCircuit']

/** One backup's plan as it may be stored, or null when there is nothing usable. */
export function cleanBackupConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null
  const out = { ...cfg }
  for (const k of NOT_IN_BACKUP_CFG) delete out[k]
  return Object.keys(out).length && Number(out.sets) > 0 ? out : null
}

/** The plans of the backups still in `subs`, cleaned; an empty map is no map. */
export function cleanBackupConfigs(map, subs) {
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Array.isArray(subs)) return {}
  const out = {}
  for (const id of subs) {
    if (!Object.prototype.hasOwnProperty.call(map, id)) continue
    const c = cleanBackupConfig(map[id])
    if (c) out[id] = c
  }
  return out
}

/** `{ subs }` (and `{ subCfg }` when a backup has its own plan) to spread into a saved entry, or nothing when there are none. */
export const withBackups = (list, selfId, known, configs) => {
  const subs = cleanBackups(list, selfId, known)
  if (!subs.length) return {}
  const subCfg = cleanBackupConfigs(configs, subs)
  return Object.keys(subCfg).length ? { subs, subCfg } : { subs }
}

/** The plan a backup has of its own in this slot, or null when it follows the slot's. */
export const ownBackupConfig = (slot, id) => cleanBackupConfigs(slot?.subCfg, [id])[id] || null

/** The slot's own plan, as it is kept for the exercise it hands over to a backup. */
function slotPlanOf(slot) {
  return cleanBackupConfig(slot)
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
  const own = ownBackupConfig(old, backupId)
  // A backup with its own plan (#978) opens at that plan, in the slot's superset; one without
  // takes the slot's, carried as Replace carries it.
  const out = own
    ? { ...own, id: backupId, ...(old.sg ? { sg: old.sg, ...(old.sgName ? { sgName: old.sgName } : {}), ...(old.sgRest ? { sgRest: old.sgRest } : {}), ...(old.sgCircuit ? { sgCircuit: old.sgCircuit } : {}) } : {}) }
    : replaceSlotExercise(old, backupId, S, rid)
  delete out.subs
  delete out.subCfg
  // The exercise handing over keeps its plan as a backup's own, so swapping back restores it,
  // and the other backups keep theirs.
  const configs = { ...(old.subCfg || {}) }
  delete configs[backupId]
  if (old.id) { const mine = slotPlanOf(old); if (mine) configs[old.id] = mine }
  return { ...out, ...withBackups([old.id, ...(old.subs || [])], backupId, known, configs) }
}
