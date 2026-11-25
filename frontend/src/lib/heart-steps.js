// The heart rate exercise by exercise: the band on the workout screen shows the one in progress
// (components/HeartBand.jsx), a finished workout's card and its copied text each one's numbers
// (components/SessionHeart.jsx, lib/workout-text.js). Nothing is saved: the spans come from the
// sets' ticks (`at`), the readings from the watch or the phone's health hub.
//
// An exercise's span runs from the tick before its first set (the end of whatever came before it,
// its rest included) to its own last tick. A superset is one exercise here, its members done in
// turn. Coming back to an exercise later makes a second span of it.
import { sessionSections } from './history.js'
import { t } from './i18n-core.js'
import { fmtDur } from './format.js'

// The units the detail sheet and the copied text group a workout into (history.js sessionSections):
// a superset inside one routine is one unit, never two routines' exercises paired across their edge.
const units = entries => sessionSections(entries).flatMap(section => section.units)

const BPM_MIN = 25
const BPM_MAX = 250
// A reading counts for the time up to the next one, never more than this: a gap is no zone.
const SAMPLE_MAX_MS = 15000
// The zones a set works in, as against the rests between: 4 and 5, from 80% of the maximum
// (lib/live-tiles.js hrZone).
const HIGH_SHARE = 0.8

// A set's tick: its own, or the later side's for a per-side set.
export const tickOf = s => {
  if (!s) return 0
  if (s.done === true && Number(s.at) > 0) return Number(s.at)
  const sides = [s.sides?.L, s.sides?.R].filter(x => x?.done === true && Number(x.at) > 0).map(x => Number(x.at))
  return sides.length ? Math.max(...sides) : 0
}

/** Every done set's tick in time order: [{ at, unit }], `unit` the first entry index of its superset unit. */
function ticks(entries, start, end) {
  const out = []
  for (const unit of units(entries || [])) {
    for (const i of unit) {
      for (const s of entries[i]?.sets || []) {
        const at = tickOf(s)
        if (at > start && at <= end) out.push({ at, unit: unit[0] })
      }
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * A workout's exercises as spans of time: [{ unit, members, from, to }] in the order they were
 * done, `unit` the first entry index of the exercise (or superset), `members` all of them.
 */
export function exerciseSpans(w, start = w?.start, end = w?.end || Date.now()) {
  const entries = w?.entries || []
  const members = new Map(units(entries).map(u => [u[0], u]))
  const spans = []
  let from = start
  for (const { at, unit } of ticks(entries, start, end)) {
    const last = spans[spans.length - 1]
    if (last && last.unit === unit) last.to = at
    else spans.push({ unit, members: members.get(unit) || [unit], from, to: at })
    from = at
  }
  return spans
}

/**
 * Where the exercise in progress started, for the band: the last tick of anything else, so its
 * curve takes in the rest before it and every set of it so far. `cur` is an entry index.
 */
export function currentSpanStart(A, origin = A?.start) {
  const entries = A?.entries || []
  const unit = units(entries).find(u => u.includes(A?.cur))
  const mine = unit ? unit[0] : A?.cur
  let from = origin
  for (const tk of ticks(entries, origin, Infinity)) if (tk.unit !== mine) from = tk.at
  return from
}

/**
 * The readings ([ms, bpm]) between `from` and `to` as { avg, max, high, n, sum }: `high` the time
 * spent in zones 4 and 5 (ms) for a maximum of `hrMax`, `sum` the readings added up, so spans put
 * together average once (avgOf) rather than over rounded averages. null without a reading.
 */
export function heartStats(samples, from, to, hrMax) {
  const kept = (Array.isArray(samples) ? samples : [])
    .filter(s => Array.isArray(s) && s[0] >= from && s[0] <= to && s[1] >= BPM_MIN && s[1] <= BPM_MAX)
  if (!kept.length) return null
  let sum = 0, max = 0, high = 0
  kept.forEach(([ms, bpm], i) => {
    sum += bpm
    if (bpm > max) max = bpm
    const next = i + 1 < kept.length ? kept[i + 1][0] : to
    if (hrMax > 0 && bpm >= hrMax * HIGH_SHARE) high += Math.max(0, Math.min(SAMPLE_MAX_MS, next - ms))
  })
  return { avg: Math.round(sum / kept.length), max: Math.round(max), high, n: kept.length, sum }
}

/** The average bpm of several spans' heartStats, rounded once over all their readings. */
export const avgOf = parts => {
  const n = parts.reduce((x, p) => x + p.n, 0)
  return n ? Math.round(parts.reduce((x, p) => x + p.sum, 0) / n) : null
}

/**
 * Each exercise's numbers for a finished workout: [{ unit, members, avg, max, high }] in the order
 * first done, an exercise done in two goes counted once over both. Exercises without a reading
 * are left out.
 */
export function heartByExercise(w, samples, hrMax) {
  const by = new Map()
  for (const sp of exerciseSpans(w)) {
    const was = by.get(sp.unit) || { unit: sp.unit, members: sp.members, parts: [] }
    was.parts.push(...(Array.isArray(samples) ? samples : []).filter(s => Array.isArray(s) && s[0] >= sp.from && s[0] <= sp.to))
    was.spans = [...(was.spans || []), [sp.from, sp.to]]
    by.set(sp.unit, was)
  }
  const out = []
  for (const x of by.values()) {
    // Each span on its own for the time in the zones (no reading carries over a gap between them).
    const parts = x.spans.map(([a, b]) => heartStats(x.parts, a, b, hrMax)).filter(Boolean)
    if (!parts.length) continue
    out.push({
      unit: x.unit, members: x.members,
      avg: avgOf(parts),
      max: Math.max(...parts.map(p => p.max)),
      high: parts.reduce((s, p) => s + p.high, 0),
    })
  }
  return out
}

/** "Average 128 · Max 152 bpm · 3 min in zones 4 and 5": an exercise's line, on the card and in the copied text. */
export function heartStepText(x) {
  const high = Math.round(x.high / 60000)
  return t('Average {0} · Max {1} bpm', x.avg, x.max) + (high >= 1 ? ' · ' + t('{0} in zones 4 and 5', fmtDur(high * 60000)) : '')
}
