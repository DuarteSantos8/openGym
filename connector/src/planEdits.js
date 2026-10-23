import { randomUUID } from 'node:crypto'
import { EXIDX, exOr } from '../../frontend/src/lib/exercises.js'
import { exAvailable } from '../../frontend/src/lib/equipment.js'
import { queueOf } from '../../frontend/src/lib/queue.js'

const urlOf = id => `https://gym.areum.cl/#/plan/r/${id}`
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const idOf = x => typeof x === 'string' && x.length > 0 && !/[\u0000-\u001f]/.test(x)
const finite = x => typeof x === 'number' && Number.isFinite(x)
const targets = ['sets', 'reps', 'repsMin', 'repsMax', 'weight', 'restSec', 'sec', 'min', 'speed', 'inc', 'deloadFactor']
const reserved = new Set(['__proto__', 'constructor', 'prototype'])

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

function exercise(profile, raw) {
  if (!object(raw) || !idOf(raw.id)) throw new Error('invalid exercise')
  const custom = !reserved.has(raw.id) && Array.isArray(profile.customEx) && profile.customEx.find(x => x && x.id === raw.id)
  const known = custom || (Object.hasOwn(EXIDX, raw.id) ? exOr(raw.id) : null)
  if (reserved.has(raw.id) || !known || typeof known !== 'object') throw new Error('unknown exercise')
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

function routinesOf(profile, request) {
  if (!Array.isArray(profile.routines) || !Array.isArray(request.routines)) throw new Error('invalid routines')
  const seen = new Set(profile.routines.map(r => r.id))
  return request.routines.map(raw => {
    if (!object(raw) || !Array.isArray(raw.ex) || Object.keys(raw).some(key => !['id', 'name', 'ex'].includes(key))) throw new Error('invalid routine')
    const existing = raw.id == null ? null : profile.routines.find(r => r.id === raw.id)
    if (raw.id != null && !existing) throw new Error('unknown routine')
    if (raw.name != null && (typeof raw.name !== 'string' || !raw.name.trim())) throw new Error('invalid routine name')
    if (!existing && !raw.name) throw new Error('routine name required')
    let id = existing?.id
    if (!id) { do { id = randomUUID() } while (seen.has(id)) }
    seen.add(id)
    return { id, name: raw.name ?? existing.name, ex: raw.ex.map(e => exercise(profile, e)), url: urlOf(id), isNew: !existing }
  })
}

export function proposeWeek(profile, request) {
  if (!object(profile) || !object(request) || !object(request.week) || Object.keys(request).some(key => !['week', 'routines'].includes(key))) throw new Error('invalid week request')
  const blocked = choice(profile)
  if (blocked) return blocked
  const routines = routinesOf(profile, request)
  if (new Set(routines.map(r => r.id)).size !== routines.length) throw new Error('duplicate routine')
  const known = new Set([...(profile.routines || []).map(r => r.id), ...routines.map(r => r.id)])
  const week = {}
  for (const [day, ids] of Object.entries(request.week)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(ids) || ids.some(id => !idOf(id) || !known.has(id)) || new Set(ids).size !== ids.length) throw new Error('invalid weekday assignment')
    week[day] = [...ids]
  }
  return { type: 'week', unit: profile.unit || 'kg', routines, week }
}

export function applyPlanEdit(profile, edit) {
  if (!object(profile) || !object(edit) || edit.type !== 'week' || !Array.isArray(edit.routines) || !object(edit.week)) throw new Error('invalid edit')
  const blocked = choice(profile)
  if (blocked) throw blocked
  const next = structuredClone(profile)
  if (!Array.isArray(next.routines)) throw new Error('invalid edit')
  for (const r of edit.routines) {
    if (!object(r) || !idOf(r.id) || typeof r.name !== 'string' || !r.name.trim() || !Array.isArray(r.ex)) throw new Error('invalid edit')
    const ex = r.ex.map(e => exercise(next, e))
    const index = next.routines.findIndex(old => old.id === r.id)
    if (index < 0 && !r.isNew) throw new Error('routine disappeared')
    if (index >= 0 && r.isNew && (next.routines[index].name !== r.name || JSON.stringify(next.routines[index].ex) !== JSON.stringify(ex))) throw new Error('new routine ID already exists')
    if (index < 0) next.routines.push({ id: r.id, name: r.name, ex })
    else if (!r.isNew) next.routines[index] = { ...next.routines[index], name: r.name, ex }
  }
  const known = new Set(next.routines.map(r => r.id))
  const week = { ...(object(next.week) ? next.week : {}) }
  for (const [day, ids] of Object.entries(edit.week)) {
    if (!/^[0-6]$/.test(day) || !Array.isArray(ids) || ids.some(id => !idOf(id) || !known.has(id)) || new Set(ids).size !== ids.length) throw new Error('invalid edit')
    if (ids.length) week[day] = [...ids]
    else delete week[day]
  }
  next.week = week
  return next
}

export async function updatePlanEdit(store, bearer, edit) {
  if (edit instanceof PlanChoiceRequiredError) return edit
  const profile = await store.updateProfile(bearer, current => applyPlanEdit(current, edit))
  return {
    routines: edit.routines.map(({ id }) => ({ id, name: profile.routines.find(r => r.id === id)?.name, url: urlOf(id) })),
    unit: profile.unit || 'kg',
  }
}
