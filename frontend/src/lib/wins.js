// First wins (EP25): the handful of things a new lifter can be proud of in the first month,
// before there is a chart worth looking at. Each one is about turning up, none about the number
// on the bar: showing up is the only thing a beginner fully controls, and the weights follow it.
//
// Read back from the log every time, like the levels (lib/levels.js): nothing is stored, so two
// devices, a restored backup and an import all agree, and a deleted workout can take one away.
// Two sessions in a week is the line the WHO draws for muscle-strengthening activity (WHO
// guidelines on physical activity and sedentary behaviour, 2020), which is why it is a win here.
import { weekKey, weekStartOf } from './format.js'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const WEEK_MS = 7 * 86400e3

const daysOf = S => (Array.isArray(S?.workouts) ? S.workouts : [])
  .map(w => w?.d).filter(d => typeof d === 'string' && DAY.test(d))

// The Monday (or Sunday) each trained week starts on, as a UTC timestamp, oldest first.
function trainedWeeks(days, ws) {
  const starts = new Set()
  for (const d of days) {
    const t = Date.parse(d + 'T00:00:00Z')
    const back = (new Date(t).getUTCDay() - ws + 7) % 7
    starts.add(t - back * 86400e3)
  }
  return [...starts].sort((a, b) => a - b)
}

/**
 * The first wins, in the order a beginner meets them:
 *   [{ id, done, n? }]  — `n` is the count a win names (5, 10 workouts).
 */
export function firstWins(S) {
  const days = daysOf(S)
  const ws = weekStartOf(S)
  const perWeek = new Map()
  for (const d of days) { const k = weekKey(d, ws); perWeek.set(k, (perWeek.get(k) || 0) + 1) }
  const weeks = trainedWeeks(days, ws)
  const backToBack = weeks.some((w, i) => i > 0 && w - weeks[i - 1] === WEEK_MS)
  return [
    { id: 'first', done: days.length >= 1 },
    { id: 'two-in-week', done: [...perWeek.values()].some(n => n >= 2) },
    { id: 'five', n: 5, done: days.length >= 5 },
    { id: 'two-weeks', done: backToBack },
    { id: 'ten', n: 10, done: days.length >= 10 },
  ]
}

/** { done, total, next } — `next` is the first win still open, or null once all are in. */
export function winsSummary(S) {
  const wins = firstWins(S)
  return { done: wins.filter(w => w.done).length, total: wins.length, next: wins.find(w => !w.done) || null, wins }
}
