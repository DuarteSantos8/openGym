// The heart rate Apple Health holds for a workout's window (from the watch, any source), as the
// summary the workout keeps: w.hr = { avg, max, min, n, s: [[offsetSec, bpm], ...] }. Only the
// iOS build ever sets it (lib/health-sync.js fetchHeartRate).
import { t } from './i18n-core.js'

// The watch often starts a moment before Start is tapped, and stops a moment after Finish.
const SLACK = 60000
// Points kept for the sparkline: enough for its width, small enough to sync and back up.
const POINTS = 240

/**
 * `samples` are [{ t: ms, bpm }]. Null when none falls in [start - 60 s, end + 60 s]; never an
 * empty summary. avg/max/min/n are over the raw samples, `s` is bucketed to at most 240 points.
 */
export function hrSummary(samples, start, end) {
  const kept = (samples || [])
    .filter(x => Number.isFinite(x?.t) && Number.isFinite(x?.bpm) && x.bpm > 0 && x.t >= start - SLACK && x.t <= end + SLACK)
    .sort((a, b) => a.t - b.t)
  if (!kept.length) return null
  let sum = 0
  let max = -Infinity
  let min = Infinity
  for (const x of kept) { sum += x.bpm; max = Math.max(max, x.bpm); min = Math.min(min, x.bpm) }
  const off = ms => Math.round((ms - start) / 1000)
  return {
    avg: Math.round(sum / kept.length),
    max: Math.round(max),
    min: Math.round(min),
    n: kept.length,
    s: kept.length <= POINTS ? kept.map(x => [off(x.t), Math.round(x.bpm)]) : buckets(kept, start, end),
  }
}

// One [mid offset, mean bpm] per non-empty bucket of the window; the slack falls in the end ones.
function buckets(kept, start, end) {
  const width = Math.max(end - start, 1) / POINTS
  const sums = new Array(POINTS).fill(0)
  const counts = new Array(POINTS).fill(0)
  for (const x of kept) {
    const i = Math.min(POINTS - 1, Math.max(0, Math.floor((x.t - start) / width)))
    sums[i] += x.bpm
    counts[i]++
  }
  const out = []
  for (let i = 0; i < POINTS; i++) {
    if (counts[i]) out.push([Math.round(((i + 0.5) * width) / 1000), Math.round(sums[i] / counts[i])])
  }
  return out
}

/** A later fetch replaces what the workout has only when it holds more samples. */
export function betterHr(current, next) {
  return next && next.n > (current?.n || 0) ? next : current
}

/** '132 avg · 171 max', or '' without a summary. */
export function fmtHr(hr) {
  return hr ? t('{0} avg · {1} max', hr.avg, hr.max) : ''
}
