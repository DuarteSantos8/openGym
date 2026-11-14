import { visibleOptionalEntries, highestStamp } from '../sync-merge.js'
import { NUTRIENTS, normalizeEntry, editEntry, roundAmount } from './entry.js'
const key = 'nutritionEntries'
export function addEntry(S, entry) {
  if (!normalizeEntry(entry).supported) throw new Error('unsupported')
  if ((S[key] || []).some(e => e.id === entry.id)) throw new Error('duplicate')
  S[key] = [...(S[key] || []), entry]
}
export function changeEntry(S, id, patch) {
  if (!visibleOptionalEntries(S, key).some(e => e.id === id)) return
  S[key] = S[key].map(e => e.id === id ? editEntry(e, patch) : e)
}
export function deleteEntry(S, id) {
  if (!visibleOptionalEntries(S, key).some(e => e.id === id)) return
  S.deleted = { ...S.deleted, [key]: { ...S.deleted?.[key], [id]: Math.max(Date.now(), highestStamp(S)) + 1 } }
}
// Caller joins available copies before undo. Change visibility only, never field ownership.
export function undoEntry(S, id, knownCopies = []) {
  if (!(S[key] || []).some(e => e.id === id) || !(S.deleted?.[key]?.[id] > 0)) return
  const at = [S, ...knownCopies].reduce((n, copy) => Math.max(n, highestStamp(copy)), Date.now()) + 1
  S.deleted = { ...S.deleted, [key]: { ...S.deleted?.[key], [id]: -at } }
}
export function diaryDays(S) {
  const days = Object.create(null)
  for (const entry of visibleOptionalEntries(S, key)) {
    const day = typeof entry.day === 'string' ? entry.day : ''
    ;(days[day] ||= []).push(entry)
  }
  return days
}
export function dailyTotals(S, day) {
  const rows = (diaryDays(S)[day] || []).map(e => normalizeEntry(e))
  return Object.fromEntries(NUTRIENTS.map(k => {
    let value = 0, unknown = 0
    for (const { entry, supported } of rows) {
      if (!supported || entry[k] == null) unknown++
      else value += entry[k]
    }
    return [k, { value: roundAmount(value), unknown }]
  }))
}
export function foodSuggestions(S, { query = '', order = 'recent', limit = 8 } = {}) {
  const groups = new Map()
  for (const e of visibleOptionalEntries(S, key)) {
    if (!normalizeEntry(e).supported || !e.label.toLowerCase().includes(query.toLowerCase())) continue
    const name = e.label.toLowerCase()
    const old = groups.get(name)
    const recency = `${e.day}:${e.createdAt || ''}:${e.id}`
    groups.set(name, { count: (old?.count || 0) + 1, recency: !old || recency > old.recency ? recency : old.recency, entry: !old || recency > old.recency ? e : old.entry })
  }
  return [...groups.values()].sort((a, b) => (order === 'frequent' ? b.count - a.count : 0) || (a.recency < b.recency ? 1 : a.recency > b.recency ? -1 : 0)).slice(0, Math.max(0, Math.min(30, limit))).map(x => x.entry)
}
