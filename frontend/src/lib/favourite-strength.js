import { favIds } from './favourites.js'
import { e1rmSeries, DEFAULT_FORMULA } from './onerm.js'
// The favourite-lifts card on Home: the best estimated 1RM of every favourite exercise, the way
// the body-weight card shows the latest weigh-in.
//
// Favourites are the list the user already keeps (lib/favourites.js), so there is nothing new to
// set up or sync. Only exercises that produce an estimate appear: timed holds, cardio, reps-only
// bodyweight work and assistance machines have no 1RM (lib/onerm.js), and a favourite that has
// never been logged has nothing to show yet.

// How far back the "gained lately" figure looks.
export const GAIN_DAYS = 30
// How many sessions the row's trend line spans.
export const TREND_POINTS = 12

const timeOf = p => p.t || new Date(p.d).getTime()

/**
 * One row per favourite with an estimate, in the order the favourites were added:
 *   { id, best: { est, w, r, d }, gain, trend }
 * `gain` is how much the all-time best rose over the last GAIN_DAYS, against the best that
 * stood before them. It is null when there was no estimate before the window (the first
 * sessions are not a gain) or the best did not move. `trend` is the per-session estimate over
 * the last TREND_POINTS sessions ([{ t, d, y }], oldest first) for the row's trend line.
 */
export function favouriteStrength(S, { now = Date.now(), formula = DEFAULT_FORMULA } = {}) {
  const cutoff = now - GAIN_DAYS * 86400000
  const rows = []
  for (const id of favIds(S)) {
    const pts = e1rmSeries(S, id, formula)
    if (!pts.length) continue
    let best = null, before = null
    for (const p of pts) {
      if (!best || p.y > best.est) best = { est: p.y, w: p.w, r: p.r, d: p.d }
      if (timeOf(p) < cutoff && (before === null || p.y > before)) before = p.y
    }
    const gain = before !== null && best.est > before ? Math.round((best.est - before) * 10) / 10 : null
    const trend = pts.slice(-TREND_POINTS).map(p => ({ t: p.t, d: p.d, y: p.y }))
    rows.push({ id, best, gain, trend })
  }
  return rows
}
