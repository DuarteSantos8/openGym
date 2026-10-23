import { randomUUID } from 'node:crypto'
import { CATALOGUE } from '../../frontend/src/lib/exercises.js'
import { exAvailable } from '../../frontend/src/lib/equipment.js'
import { queueOf } from '../../frontend/src/lib/queue.js'
import { ProfileConflictError } from './profileStore.js'

const urlOf = id => `https://gym.areum.cl/#/plan/r/${id}`
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const idOf = x => typeof x === 'string' && x.length > 0 && !/[\u0000-\u001f]/.test(x)
const finite = x => typeof x === 'number' && Number.isFinite(x)
const targets = ['sets', 'reps', 'repsMin', 'repsMax', 'weight', 'restSec', 'sec', 'min', 'speed', 'inc', 'deloadFactor']
const reserved = new Set(['__proto__', 'constructor', 'prototype'])
const CATALOGUE_BY_ID = new Map(CATALOGUE.map(e => [e.id, e]))

function weekOf(profile) {
  const ids = [...new Set(Object.values(object(profile.week) ? profile.week : {})
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter(id => typeof id === 'string' && profile.routines?.some(r => r.id === id)))]
  return { name: 'Fixed week', ids, names: ids.map(id => profile.routines.find(r => r.id === id).name) }
}

export class PlanChoiceRequiredError extends Error {
  constructor(profile) {
    super('choose between the live queue and the fixed week before editing')
    this.name = 'PlanChoiceRequiredError'
    const queue = queueOf(profile)
    this.queue = { name: queue?.label || 'Live queue', ids: queue?.ids || [], names: (queue?.ids || []).map(id => profile.routines.find(r => r.id === id)?.name || id) }
    this.week = weekOf(profile)
  }
}

function choice(profile) {
  // A live queue owns Home, even when scheduleMode says week. Never silently switch to week.
  return queueOf(profile) ? new PlanChoiceRequiredError(profile) : null
}

function knownExercise(profile, id) {
  if (!idOf(id) || reserved.has(id)) return null
  const custom = Array.isArray(profile.customEx) ? profile.customEx.find(x => x && x.id === id) : null
  if (custom && typeof custom === 'object') return custom
  return CATALOGUE_BY_ID.get(id) || null
}

function exercise(profile, raw) {
  if (!object(raw) || !idOf(raw.id)) throw new Error('invalid exercise')
  const known = knownExercise(profile, raw.id)
  if (!known) throw new Error('unknown exercise')
  if (!exAvailable(profile, known)) throw new Error('exercise unavailable with active equipment')
  if (Object.keys(raw).some(key => key !== 'id' && !targets.includes(key))) throw new Error('invalid exercise field')
  const result = { id: raw.id }
  for (const key of targets) {
    if (!Object.hasOwn(raw, key)) continue
    if (!finite(raw[key]) || raw[key] < 0 || (key === 'sets' && (!Number.isInteger(raw[key]) || raw[key] < 1))) throw new Error('invalid exercise target')
    result[key] = raw[key]
  }
  return result
}

function patchesOf(profile, rawEx) {
  if (!Array.isArray(rawEx) || rawEx.length === 0) throw new Error('invalid routine')
  const patches = rawEx.map(e => exercise(profile, e))
  if (new Set(patches.map(e => e.id)).size !== patches.length) throw new Error('duplicate exercise')
  return patches
}

function mergeEx(current, patches) {
  const list = Array.isArray(current) ? current.map(e => ({ ...e })) : []
  for (const patch of patches) {
    const i = list.findIndex(e => e.id === patch.id)
    if (i < 0) list.push({ ...patch })
    else list[i] = { ...list[i], ...patch }
  }
  return list
}

function routinesOf(profile, request) {
  if (!Array.isArray(profile.routines) || !Array.isArray(request.routines)) throw new Error('invalid routines')
  const seen = new Set(profile.routines.map(r => r.id))
  return request.routines.map(raw => {
    if (!object(raw) || Object.keys(raw).some(key => !['id', 'name', 'ex'].includes(key))) throw new Error('invalid routine')
    const existing = raw.id == null ? null : profile.routines.find(r => r.id === raw.id)
    if (raw.id != null && !existing) throw new Error('unknown routine')
    if (raw.name != null && (typeof raw.name !== 'string' || !raw.name.trim())) throw new Error('invalid routine name')
    if (!existing && !raw.name) throw new Error('routine name required')
    const ex = patchesOf(profile, raw.ex)
    let id = existing?.id
    if (!id) { do { id = randomUUID() } while (seen.has(id)) }
    seen.add(id)
    return { id, name: raw.name ?? existing.name, ex, url: urlOf(id), isNew: !existing }
  })
}

function weekPatch(requestWeek, known) {
  if (!object(requestWeek)) throw new Error('invalid week request')
  const week = {}
  for (const [day, ids] of Object.entries(requestWeek)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(ids) || ids.length === 0 || ids.some(id => !idOf(id) || !known.has(id)) || new Set(ids).size !== ids.length) {
      throw new Error('invalid weekday assignment')
    }
    week[day] = [...ids]
  }
  return week
}

function requireEdit(edit) {
  if (!object(edit) || edit.type !== 'week' || !Array.isArray(edit.routines) || !object(edit.week)) throw new Error('invalid edit')
  for (const r of edit.routines) {
    if (!object(r) || !idOf(r.id) || !Array.isArray(r.ex) || r.ex.length === 0) throw new Error('invalid edit')
  }
  for (const ids of Object.values(edit.week)) {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('invalid edit')
  }
}

export function proposeWeek(profile, request) {
  if (!object(profile) || !object(request) || !object(request.week) || Object.keys(request).some(key => !['week', 'routines'].includes(key))) throw new Error('invalid week request')
  const blocked = choice(profile)
  if (blocked) return blocked
  const routines = routinesOf(profile, request)
  if (new Set(routines.map(r => r.id)).size !== routines.length) throw new Error('duplicate routine')
  const known = new Set([...(profile.routines || []).map(r => r.id), ...routines.map(r => r.id)])
  return { type: 'week', unit: profile.unit || 'kg', routines, week: weekPatch(request.week, known) }
}

export function applyPlanEdit(profile, edit) {
  requireEdit(edit)
  const blocked = choice(profile)
  if (blocked) throw blocked
  if ((edit.unit || 'kg') !== (profile.unit || 'kg')) throw new Error('unit mismatch')
  if (!Array.isArray(profile.routines)) throw new Error('invalid edit')
  const next = structuredClone(profile)
  for (const r of edit.routines) {
    if (typeof r.name !== 'string' || !r.name.trim()) throw new Error('invalid edit')
    const patches = patchesOf(next, r.ex)
    const index = next.routines.findIndex(old => old.id === r.id)
    if (index < 0 && !r.isNew) throw new Error('routine disappeared')
    if (index >= 0 && r.isNew) {
      const same = next.routines[index].name === r.name && JSON.stringify(next.routines[index].ex) === JSON.stringify(patches)
      if (!same) throw new Error('new routine ID already exists')
      continue
    }
    if (index < 0) next.routines.push({ id: r.id, name: r.name, ex: patches })
    else next.routines[index] = { ...next.routines[index], name: r.name, ex: mergeEx(next.routines[index].ex, patches) }
  }
  const known = new Set(next.routines.map(r => r.id))
  const week = { ...(object(next.week) ? next.week : {}) }
  for (const [day, ids] of Object.entries(edit.week)) {
    weekPatch({ [day]: ids }, known)
    week[day] = [...ids]
  }
  next.week = week
  return next
}

export async function updatePlanEdit(store, bearer, edit) {
  if (edit instanceof PlanChoiceRequiredError) return edit
  requireEdit(edit)
  try {
    const profile = await store.updateProfile(bearer, current => applyPlanEdit(current, edit))
    return {
      routines: edit.routines.map(({ id }) => ({ id, name: profile.routines.find(r => r.id === id)?.name, url: urlOf(id) })),
      unit: profile.unit || 'kg',
    }
  } catch (error) {
    if (error instanceof ProfileConflictError) throw new Error('profile conflict')
    throw error
  }
}
