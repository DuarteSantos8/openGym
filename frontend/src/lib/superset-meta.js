// A superset's own name and its rest between rounds (#292). Carried on every member of the group
// (`sgName`, `sgRest` on a routine exercise, so on an entry's `target` once a session starts):
// a reorder, a member taken out or the routine copied into a session keeps them without a second
// structure to keep in step. The first member that has a value speaks for the group.
export const SG_NAME_MAX = 40
const intervalRest = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(900, Math.round(Number(value)))) : 15

const intervalFields = { work: 'sgWork', prep: 'sgPrep', roundRest: 'sgRoundRest' }
const fieldsOf = (item, onTarget) => (onTarget ? item?.target : item) || {}

/** { name, rest } of the group of `unit` (indices into `list`); `onTarget` for session entries. */
export function supersetMeta(list, unit, { onTarget = false } = {}) {
  let name = '', rest = 0, interval = null
  for (const idx of unit || []) {
    const f = fieldsOf(list?.[idx], onTarget)
    if (!name && typeof f.sgName === 'string' && f.sgName.trim()) name = f.sgName.trim().slice(0, SG_NAME_MAX)
    if (!rest && Number(f.sgRest) > 0) rest = Math.round(Number(f.sgRest))
    if (!interval && f.sgMode === 'interval') interval = { mode: 'interval', intervalRest: intervalRest(f.sgIntervalRest ?? 15), ...Object.fromEntries(Object.entries(intervalFields).filter(([, key]) => f[key] != null).map(([key, field]) => [key, Math.max(key === 'work' ? 1 : 0, intervalRest(f[field]))])) }
  }
  return { name, rest, ...interval }
}

/** Writes name and rest onto every member of group `sg` in a routine's `ex`; empty clears. */
export function setSupersetMeta(ex, sg, { name = '', rest = 0, mode, intervalRest: gap = 15, work, prep, roundRest } = {}) {
  const clean = String(name || '').trim().slice(0, SG_NAME_MAX)
  const sec = Number(rest) > 0 ? Math.round(Number(rest)) : 0
  for (const e of ex || []) {
    if (!e || !sg || e.sg !== sg) continue
    if (clean) e.sgName = clean; else delete e.sgName
    if (sec) e.sgRest = sec; else delete e.sgRest
    if (mode === 'interval') { e.sgMode = mode; e.sgIntervalRest = intervalRest(gap) }
    else { delete e.sgMode; delete e.sgIntervalRest }
    for (const [key, field] of Object.entries(intervalFields)) {
      const value = { work, prep, roundRest }[key]
      if (mode === 'interval' && value != null) e[field] = Math.max(key === 'work' ? 1 : 0, intervalRest(value))
      else delete e[field]
    }
  }
  return ex
}

/** A member that joined or left a group: it takes the group's meta, or drops what it carried. */
export function syncSupersetMeta(ex) {
  const groups = new Map()
  for (const e of ex || []) {
    if (!e?.sg) { if (e) { delete e.sgName; delete e.sgRest; delete e.sgMode; delete e.sgIntervalRest; for (const field of Object.values(intervalFields)) delete e[field] }; continue }
    const g = groups.get(e.sg) || { name: '', rest: 0 }
    if (!g.name && e.sgName) g.name = e.sgName
    if (!g.rest && Number(e.sgRest) > 0) g.rest = Number(e.sgRest)
    if (e.sgMode === 'interval' && !g.mode) { const { name, rest, ...timing } = supersetMeta([e], [0]); Object.assign(g, timing) }
    groups.set(e.sg, g)
  }
  for (const [sg, g] of groups) setSupersetMeta(ex, sg, g)
  return ex
}
