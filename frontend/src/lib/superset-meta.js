// A superset's own name and its rest between rounds (#292). Carried on every member of the group
// (`sgName`, `sgRest` on a routine exercise, so on an entry's `target` once a session starts):
// a reorder, a member taken out or the routine copied into a session keeps them without a second
// structure to keep in step. The first member that has a value speaks for the group.
export const SG_NAME_MAX = 40

const fieldsOf = (item, onTarget) => (onTarget ? item?.target : item) || {}

/** { name, rest } of the group of `unit` (indices into `list`); `onTarget` for session entries. */
export function supersetMeta(list, unit, { onTarget = false } = {}) {
  let name = '', rest = 0
  for (const idx of unit || []) {
    const f = fieldsOf(list?.[idx], onTarget)
    if (!name && typeof f.sgName === 'string' && f.sgName.trim()) name = f.sgName.trim().slice(0, SG_NAME_MAX)
    if (!rest && Number(f.sgRest) > 0) rest = Math.round(Number(f.sgRest))
  }
  return { name, rest }
}

/** Writes name and rest onto every member of group `sg` in a routine's `ex`; empty clears. */
export function setSupersetMeta(ex, sg, { name = '', rest = 0 } = {}) {
  const clean = String(name || '').trim().slice(0, SG_NAME_MAX)
  const sec = Number(rest) > 0 ? Math.round(Number(rest)) : 0
  for (const e of ex || []) {
    if (!e || !sg || e.sg !== sg) continue
    if (clean) e.sgName = clean; else delete e.sgName
    if (sec) e.sgRest = sec; else delete e.sgRest
  }
  return ex
}

/** A member that joined or left a group: it takes the group's meta, or drops what it carried. */
export function syncSupersetMeta(ex) {
  const groups = new Map()
  for (const e of ex || []) {
    if (!e?.sg) { if (e) { delete e.sgName; delete e.sgRest }; continue }
    const g = groups.get(e.sg) || { name: '', rest: 0 }
    if (!g.name && e.sgName) g.name = e.sgName
    if (!g.rest && Number(e.sgRest) > 0) g.rest = Number(e.sgRest)
    groups.set(e.sg, g)
  }
  for (const [sg, g] of groups) setSupersetMeta(ex, sg, g)
  return ex
}
