// What the progress-photo gallery shows above and between the photos (#949): the line that says
// how long it has been since the last one, the photos per day behind the activity chart, and the
// photos gathered by month. Pure, so the screen only draws it. `photos` are progressPhotosOf()
// entries (newest first); only their `d` (a 'YYYY-MM-DD' day) is read here.
import { todayISO } from './format.js'

/** Whole days from ISO day `a` to a later ISO day `b` (read at local noon, so DST never shifts it). */
function daysFrom(a, b) {
  const ms = new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')
  return Math.max(0, Math.round(ms / 86400000))
}

/**
 * Where the person stands with their photos: { kind, days }.
 *   'none'       no photo at all
 *   'today'      one is filed for today
 *   'yesterday'  the latest is from yesterday
 *   'days'       the latest is `days` (two or more) days old
 */
export function photoStatus(photos, today = todayISO()) {
  let last = ''
  for (const p of photos || []) if (p && p.d > last) last = p.d
  if (!last) return { kind: 'none', days: 0 }
  const days = daysFrom(last, today)
  if (days === 0) return { kind: 'today', days: 0 }
  return days === 1 ? { kind: 'yesterday', days: 1 } : { kind: 'days', days }
}

/** { 'YYYY-MM-DD': number of photos that day } — what the activity chart shades by. */
export function photoCountsByDay(photos) {
  const out = {}
  for (const p of photos || []) if (p && p.d) out[p.d] = (out[p.d] || 0) + 1
  return out
}

/** The photos in runs of the same month, in the order given: [{ key: '2026-10', year, month (0-11), items }]. */
export function groupByMonth(photos) {
  const out = []
  for (const p of photos || []) {
    const key = String(p.d).slice(0, 7)
    const last = out[out.length - 1]
    if (last && last.key === key) last.items.push(p)
    else out.push({ key, year: +key.slice(0, 4), month: +key.slice(5, 7) - 1, items: [p] })
  }
  return out
}
