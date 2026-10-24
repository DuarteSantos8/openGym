// Weigh-ins read back week by week (Discord 'Weight'). From one morning to the next, body weight
// moves with water, salt and the last meal by more than it moves in a month, so the number worth
// following is the week's mean — the one a single weigh-in on the card cannot give you.
import { isoOf, weekKey } from './format.js'

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

/**
 * Where a weigh-in sits on a time axis. `t` is when it was typed, which is what a sync merge goes
 * by; for a weigh-in logged for an earlier day that is not on its day, so it is put
 * at noon of the day it is for instead.
 */
export function weighInAt(b) {
  const t = Number(b?.t)
  return t > 0 && isoOf(new Date(t)) === b.d ? t : new Date(b.d + 'T12:00:00').getTime()
}

/**
 * A weigh-in logged into the profile's list, the way the check-in before a workout does it: on the
 * day it was made, replacing that day's (a second weigh-in the same day is a correction), sorted.
 * Used for the Apple Watch's weigh-in (lib/watch-sync.js). `at` is when it was made (ms).
 */
export function logWeighIn(s, w, at = Date.now()) {
  const n = Math.round(Number(w) * 10) / 10
  if (!(n > 0)) return false
  if (!Array.isArray(s.bodyweight)) s.bodyweight = []
  const d = isoOf(new Date(at))
  const ex = s.bodyweight.find(b => b.d === d)
  if (ex) { ex.w = n; ex.t = at } else s.bodyweight.push({ d, w: n, t: at })
  s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  return true
}
