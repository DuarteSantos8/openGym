// The progress-photo gallery's own arithmetic (#949): the line on top, the months the grid is
// cut into, and how many photos each day has for the activity chart. Pure: it takes the sorted
// list views/ProgressPhotos.jsx progressPhotosOf() makes ({ d, key, ... }, newest first).
import { daysApart } from './photo-compare.js'

/**
 * What the line on top says: null with no photos; { kind: 'today' }, { kind: 'yesterday' } or
 * { kind: 'ago', days } since the newest one. A photo dated after today (a clock that was off)
 * counts as today.
 */
export function photoNudge(photos, today) {
  const newest = (photos || []).reduce((a, p) => (p && p.d && (!a || p.d > a) ? p.d : a), null)
  if (!newest) return null
  if (newest >= today) return { kind: 'today' }
  const days = daysApart(newest, today)
  return days === 1 ? { kind: 'yesterday' } : { kind: 'ago', days }
}

/** The photos cut into months, newest first: [{ month: 'YYYY-MM', items }]. Keeps the order given. */
export function monthGroups(photos) {
  const out = []
  for (const p of photos || []) {
    const month = String(p.d || '').slice(0, 7)
    const last = out[out.length - 1]
    if (last && last.month === month) last.items.push(p)
    else out.push({ month, items: [p] })
  }
  return out
}

/** { 'YYYY-MM-DD': number of photos } for the activity chart. */
export function photoCounts(photos) {
  const out = {}
  for (const p of photos || []) if (p && p.d) out[p.d] = (out[p.d] || 0) + 1
  return out
}
