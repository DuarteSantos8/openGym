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
  if (ex) { ex.w = n; ex.t = at; delete ex.src } else s.bodyweight.push({ d, w: n, t: at })
  s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  return true
}

// ---- Weekly rate (#759) ----------------------------------------------------------------------
// How fast the weight moves, for steering a cut or a bulk. Not this week's mean against last
// week's: water and salt swing a morning by more than a lean bulk moves in a week. A straight
// line through every weigh-in of the last three weeks (least squares) lets no one morning flip
// it, and it needs enough of them, spread far enough apart, to say anything at all.
export const RATE_WINDOW_DAYS = 21
export const RATE_MIN_WEIGHINS = 6
export const RATE_MIN_SPAN_DAYS = 10
const DAY = 86400000

/**
 * The trend of the weigh-ins in the `days` up to `now`, in the weigh-ins' own unit per week and
 * in percent of the window's mean weight per week. `{ enough: false, n }` when there are fewer
 * than RATE_MIN_WEIGHINS, or they span less than RATE_MIN_SPAN_DAYS. Each weigh-in sits at noon
 * of its day, so a correction typed later does not move it along the line.
 */
export function weightRate(bodyweight, { now = Date.now(), days = RATE_WINDOW_DAYS } = {}) {
  const from = isoOf(new Date(now - (days - 1) * DAY)), to = isoOf(new Date(now))
  const pts = (Array.isArray(bodyweight) ? bodyweight : [])
    .filter(b => b?.d && b.d >= from && b.d <= to && Number(b.w) > 0)
    .map(b => ({ x: new Date(b.d + 'T12:00:00').getTime() / DAY, y: Number(b.w) }))
  const n = pts.length
  const span = n ? Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)) : 0
  if (n < RATE_MIN_WEIGHINS || span < RATE_MIN_SPAN_DAYS - 0.5) return { enough: false, n }
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const perWeek = slope * 7
  return { enough: true, n, perWeek, pct: perWeek / my * 100, mean: my }
}

/**
 * The corridor a profile aims its rate at (S.rateGoal): `dir` lose, gain or hold, `by` '%' (of
 * body weight) or 'w' (the profile's unit), and `lo`/`hi` as sizes, never signed: "lose 0.5 to 1
 * a week" is { dir: 'lose', lo: 0.5, hi: 1 }. Hold keeps within ±hi. Null when it makes no sense.
 */
export function rateCorridor(goal) {
  if (!goal || !['lose', 'gain', 'hold'].includes(goal.dir)) return null
  const lo = Math.abs(Number(goal.lo) || 0), hi = Math.abs(Number(goal.hi) || 0)
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
  if (!(b > 0)) return null
  const by = goal.by === 'w' ? 'w' : '%'
  if (goal.dir === 'hold') return { dir: 'hold', by, min: -b, max: b }
  return goal.dir === 'lose' ? { dir: 'lose', by, min: -b, max: -a } : { dir: 'gain', by, min: a, max: b }
}

/**
 * Where a rate sits against the corridor: 'in', 'fast' (losing or gaining harder than planned),
 * 'slow', or for hold 'off' (drifting out either way). Null without a rate or a corridor.
 */
export function rateStatus(rate, goal) {
  const c = rateCorridor(goal)
  if (!c || !rate?.enough) return null
  const v = c.by === 'w' ? rate.perWeek : rate.pct
  // What the card shows is rounded to two decimals; the verdict goes by the same number.
  const r = Math.round(v * 100) / 100
  if (r >= c.min && r <= c.max) return 'in'
  if (c.dir === 'hold') return 'off'
  if (c.dir === 'lose') return r < c.min ? 'fast' : 'slow'
  return r > c.max ? 'fast' : 'slow'
}
