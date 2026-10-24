import crypto from 'node:crypto'

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('base64url')
export class BulkLimitError extends Error {
  constructor() { super('too many targets; narrow the request') }
}
export class BulkSelectionError extends Error {
  constructor(message) { super(message) }
}
const refuse = () => { throw new Error('invalid_bulk_selection') }
const stale = () => { throw new Error('invalid_confirmation') }
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const validId = id => typeof id === 'string' && id.length >= 1 && id.length <= 200
const object = x => !!x && typeof x === 'object' && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null)

export function validateBulkSelection(raw, { today = () => new Date().toISOString().slice(0, 10) } = {}) {
  if (!object(raw) || !['routines', 'workouts'].includes(raw.kind)) refuse()
  const keys = Object.keys(raw)
  if (Array.isArray(raw.ids) && keys.length === 2 && keys.includes('kind') && keys.includes('ids')) {
    if (raw.ids.length > 25) throw new BulkLimitError()
    if (raw.ids.length < 1 || raw.ids.some(id => !validId(id)) || new Set(raw.ids).size !== raw.ids.length) refuse()
    return { kind: raw.kind, ids: [...raw.ids] }
  }
  if (raw.kind === 'workouts' && keys.length === 2 && keys.includes('kind') && keys.includes('before') && date(raw.before) && raw.before <= today()) {
    return { kind: raw.kind, before: raw.before }
  }
  refuse()
}

export function resolveBulkTargets(profile, selection, options) {
  const sel = validateBulkSelection(selection, options)
  const list = profile?.[sel.kind]
  if (!Array.isArray(list)) refuse()
  const chosen = sel.ids ? sel.ids.map(id => {
    const matches = list.filter(row => row && row.id === id)
    if (matches.length !== 1) refuse()
    return matches[0]
  }) : list.filter(row => row && date(row.d) && row.d < sel.before)
  if (chosen.length > 25) throw new BulkLimitError()
  if (chosen.length < 1) refuse()
  const ids = chosen.map(row => row.id)
  if (ids.some(id => !validId(id) || list.filter(row => row && row.id === id).length !== 1)) refuse()
  const digests = Object.fromEntries(chosen.map(row => [row.id, hash(row)]))
  const rows = chosen.map(row => {
    if (typeof row.name !== 'string' || !row.name || row.name.length > 200 || (row.d !== undefined && (typeof row.d !== 'string' || row.d.length > 200)) ||
      (row.media != null && !Array.isArray(row.media) && typeof row.media !== 'string')) refuse()
    return { id: row.id, name: row.name, ...(row.d ? { date: row.d } : {}) }
  })
  const affected = sel.kind === 'routines' ? ids.length : new Set(chosen.map(row => row.d).filter(date)).size
  // ponytail: legacy records hold a single media path string; it counts as one linked item.
  const mediaCount = chosen.reduce((sum, row) => sum + (Array.isArray(row.media) ? row.media.length : typeof row.media === 'string' && row.media ? 1 : 0), 0)
  return { ids, digests, summary: { rows, total: ids.length, affected, mediaCount } }
}

// Every target must still hash to the digest frozen in the link, else nothing is deleted.
export function deleteTargets(profile, kind, ids, digests) {
  if (!['routines', 'workouts'].includes(kind) || !Array.isArray(ids) || ids.length < 1 || ids.length > 25 || new Set(ids).size !== ids.length || !object(digests)) stale()
  const list = profile?.[kind]
  if (!Array.isArray(list)) stale()
  for (const id of ids) {
    const matches = list.filter(row => row && row.id === id)
    if (!validId(id) || matches.length !== 1 || !Object.hasOwn(digests, id) || hash(matches[0]) !== digests[id]) stale()
  }
  const next = structuredClone(profile), removed = new Set(ids)
  next[kind] = next[kind].filter(row => !removed.has(row.id))
  if (kind === 'routines') {
    for (const day of Object.keys(next.week || {})) {
      const values = Array.isArray(next.week[day]) ? next.week[day] : [next.week[day]]
      if (!values.some(id => removed.has(id))) continue
      const kept = values.filter(id => !removed.has(id))
      if (kept.length) next.week[day] = kept; else delete next.week[day]
    }
    for (const day of Object.keys(next.dayPlan || {})) if (removed.has(next.dayPlan[day])) delete next.dayPlan[day]
  }
  return next
}

export const bulkDigest = (kind, selection, digests) => hash(['bulk', kind, selection, digests])
