// Weigh-ins read back week by week (Discord 'Weight'). From one morning to the next, body weight
// moves with water, salt and the last meal by more than it moves in a month, so the number worth
// following is the week's mean — the one a single weigh-in on the card cannot give you.
import { weekKey } from './format.js'

/**
 * The ms a weigh-in belongs at on the timeline: noon of its own date. `t` is the entry's change
 * stamp — sync-merge's stampChange re-stamps it on every write, and an import writes a whole
 * history in one change, so every imported weigh-in carries the import moment (issue #632). A
 * reader that places a weigh-in by `t` piles them all on today and a 30-day window counts them
 * as one month's change. `d` is the day the entry is about, the key mergeImport dedupes on and
 * weeklyWeights groups by, so it is the time to draw and window by. An entry with no usable `d`
 * (nothing writes one today, but a hand-edited export can lose it) falls back to `t`: the record
 * time is the best day it ever had.
 */
export const weighInMs = b => {
  const ms = b?.d ? new Date(b.d + 'T12:00:00').getTime() : NaN
  return Number.isFinite(ms) ? ms : b?.t
}

/**
 * The weigh-ins grouped into weeks, newest week first. Each week carries its mean, how many
 * weigh-ins it holds, the change of its mean from the week before it that has any (null for the
 * first), and its entries newest first. `ws` is the first day of the week (weekStartOf), so the
 * weeks are the ones the calendar and the week strip show. The stored order is not relied on,
 * and an entry with no day or no weight is skipped rather than averaged in as 0.
 * Returns [{ key, avg, n, delta, entries }], `key` being the iso date the week starts on.
 */
export function weeklyWeights(bodyweight, ws) {
  const byWeek = new Map()
  for (const b of Array.isArray(bodyweight) ? bodyweight : []) {
    if (!b?.d || !(Number(b.w) > 0)) continue
    const key = weekKey(b.d, ws)
    if (!byWeek.has(key)) byWeek.set(key, [])
    byWeek.get(key).push(b)
  }
  const weeks = [...byWeek.keys()].sort().map(key => {
    const entries = byWeek.get(key).slice().sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
    return { key, n: entries.length, avg: entries.reduce((sum, b) => sum + Number(b.w), 0) / entries.length, entries }
  })
  weeks.forEach((week, i) => { week.delta = i ? week.avg - weeks[i - 1].avg : null })
  return weeks.reverse()
}
