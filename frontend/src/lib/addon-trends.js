// A small pure adapter over openGym's existing workout/day/volume calculations.
// The chart is read-only; this never changes workout data.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
export function trainingVolumeSeries(workouts, { end, days = 14, dayOf, volumeOf } = {}) {
  const finalDay = ISO_DAY.test(String(end)) ? end : new Date().toISOString().slice(0, 10)
  const timestamp = Date.parse(finalDay + 'T00:00:00.000Z')
  const count = Math.min(60, Math.max(1, Math.trunc(Number(days) || 14)))
  const rows = Array.from({ length: count }, (_, i) => ({
    day: new Date(timestamp - (count - i - 1) * 86400000).toISOString().slice(0, 10), volume: 0
  }))
  const map = new Map(rows.map(row => [row.day, row]))
  for (const workout of Array.isArray(workouts) ? workouts : []) {
    const row = map.get(dayOf?.(workout))
    if (!row) continue
    const volume = Number(volumeOf?.(workout))
    if (Number.isFinite(volume) && volume > 0) row.volume += volume
  }
  return rows.map(row => ({ day: row.day, volume: Math.round(row.volume) }))
}
