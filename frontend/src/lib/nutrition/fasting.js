// NutriTrace's fasting arithmetic (src/stores/fasting.js, components/diary/FastingWidget.svelte,
// FastingInsights.svelte), pure: a fast in, numbers out. A fast is { id, start_at, end_at,
// goal_hours } with ISO instants (api.js Fast); `end_at` is null while it runs.

export const DEFAULT_GOAL_HOURS = 16
export const GOAL_MIN_HOURS = 1
export const GOAL_MAX_HOURS = 168
/** How far back a fast may be started or moved (server/routes/fasts.js, FastingWidget.svelte). */
export const START_BACKDATE_MS = 24 * 3600 * 1000
export const EDIT_BACKDATE_MS = 7 * 24 * 3600 * 1000

/** NutriTrace's built-in plans: the label is the notation people know (fast hours : eating hours). */
export const PLANS = [
  { label: '14:10', hours: 14 },
  { label: '16:8', hours: 16 },
  { label: '18:6', hours: 18 },
  { label: '20:4', hours: 20 },
  { label: 'OMAD', hours: 23 },
]

export const validGoal = hours => Number.isFinite(hours) && hours >= GOAL_MIN_HOURS && hours <= GOAL_MAX_HOURS

const HOUR = 3600 * 1000
const startOf = fast => Date.parse(fast.start_at)
const goalMsOf = fast => (Number(fast.goal_hours) || DEFAULT_GOAL_HOURS) * HOUR

/** A running fast at `now` (ms): time fasted, time left to the goal, how far along it is, and
 *  when the goal falls. `reached` is true from the goal on (the time then keeps counting). */
export function progressOf(fast, now) {
  const goalMs = goalMsOf(fast)
  const elapsedMs = Math.max(0, now - startOf(fast))
  return {
    elapsedMs,
    goalMs,
    remainingMs: Math.max(0, goalMs - elapsedMs),
    reached: elapsedMs >= goalMs,
    pct: Math.min(100, (elapsedMs / goalMs) * 100),
    targetAt: startOf(fast) + goalMs,
  }
}

/** Time left, rounded up to the minute: a fast just started reads "16h 0m to go", not 15h 59m. */
export const leftMs = ms => Math.ceil(ms / 60000) * 60000

/** How long a finished fast lasted (ms). */
export const lengthOf = fast => Math.max(0, Date.parse(fast.end_at) - startOf(fast))

/** Whether a finished fast reached its goal. */
export const hitGoal = fast => lengthOf(fast) >= goalMsOf(fast)

const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const dayOfInstant = ms => dayKey(new Date(ms))

/** The one-letter weekday under a bar, in the UI language (a calendar day, 'YYYY-MM-DD'). */
export const dayInitial = (day, locale) => new Date(day + 'T12:00:00').toLocaleDateString(locale, { weekday: 'narrow' })

/** The last finished fast, by when it ended. */
export function lastFinished(history) {
  let best = null
  for (const f of history) if (f.end_at && (!best || Date.parse(f.end_at) > Date.parse(best.end_at))) best = f
  return best
}

/** NutriTrace's insight numbers, with days as the person's own calendar days (NutriTrace cut
 *  them at UTC midnight, which moved a late-evening fast to the wrong day for anyone east or
 *  west of Greenwich). A day counts toward a streak when a fast that ended on it reached its
 *  goal; a running fast that has reached its goal counts for today. Lengths are in hours. */
export function fastingStats(history, active, now) {
  const done = history.filter(f => f.end_at)
  const hours = done.map(f => lengthOf(f) / HOUR)
  const hits = new Set()
  for (const f of done) if (hitGoal(f)) hits.add(dayOfInstant(Date.parse(f.end_at)))
  if (active && progressOf(active, now).reached) hits.add(dayOfInstant(now))

  let current = 0
  for (const d = new Date(now); hits.has(dayKey(d)); d.setDate(d.getDate() - 1)) current++

  let longest = 0
  let run = 0
  let prev = null
  for (const day of [...hits].sort()) {
    const gap = prev ? Math.round((Date.parse(day + 'T12:00:00') - Date.parse(prev + 'T12:00:00')) / (24 * HOUR)) : 0
    run = gap === 1 ? run + 1 : 1
    if (run > longest) longest = run
    prev = day
  }

  return {
    count: done.length,
    avgHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : 0,
    longestHours: hours.length ? Math.round(Math.max(...hours) * 10) / 10 : 0,
    currentStreak: current,
    longestStreak: longest,
  }
}

/** The longest fast ending on each of the last `n` days, oldest first, for the bars. A running
 *  fast counts for today with what it has so far. @returns {{ day: string, hours: number }[]} */
export function recentDays(history, active, now, n = 14) {
  const byDay = new Map()
  const put = (day, h) => byDay.set(day, Math.max(byDay.get(day) || 0, h))
  for (const f of history) if (f.end_at) put(dayOfInstant(Date.parse(f.end_at)), lengthOf(f) / HOUR)
  if (active) put(dayOfInstant(now), progressOf(active, now).elapsedMs / HOUR)
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const day = dayKey(d)
    out.push({ day, hours: byDay.get(day) || 0 })
  }
  return out
}
