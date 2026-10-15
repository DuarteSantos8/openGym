// The demo build is the only openGym most people ever see, so its seeded history has to
// exercise the stats it is there to show off — including the effort card, which renders as
// dashes on a history that is rated too thinly or not at all.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { buildDemoState } from './demoSeed.js'
import {
  effortSummary, effortWeeks, effortHistogram, hasEffort, displayScale, avgRir,
  rirOf, isHardSet, MIN_RATED, HARD_RIR
} from './effort.js'
import { effortOf, modeOf } from './history.js'

const S = buildDemoState()
const eachSet = fn => S.workouts.forEach(w => w.entries.forEach(e => e.sets.forEach(s => fn(s, w, e))))
const sum = effortSummary(S, 0)   // 0 = the whole history

describe('demo seed — effort', () => {
  it('rates enough of the history to clear every guard in the effort stats', () => {
    expect(hasEffort(S)).toBe(true)
    expect(sum.done).toBeGreaterThan(400)
    expect(sum.rated).toBeGreaterThan(MIN_RATED * 20)
    expect(sum.avg).not.toBeNull()
    expect(sum.hardPct).not.toBeNull()
    // Somewhere between "everything is a grinder" and "nothing ever gets close".
    expect(sum.hardPct).toBeGreaterThan(0.3)
    expect(sum.hardPct).toBeLessThan(0.9)
  })

  it('leaves coverage partial, because that is the normal case the UI states a denominator for', () => {
    const cov = sum.rated / sum.done
    expect(cov).toBeGreaterThan(0.7)
    expect(cov).toBeLessThan(0.95)
  })

  it('never rates a set that has no reps to leave in the tank', () => {
    eachSet((s, w, e) => {
      if (rirOf(s) != null) expect(modeOf({ ...(e.target || {}), id: e.id })).toBe('reps')
    })
  })

  it('leaves one exercise unrated throughout, so the per-exercise Effort toggle is absent for it', () => {
    const rated = {}
    eachSet((s, w, e) => { rated[e.id] = (rated[e.id] || 0) + (rirOf(s) != null ? 1 : 0) })
    const ids = Object.keys(rated)
    expect(ids.filter(id => rated[id] === 0)).toEqual(['0605'])
    // …while the rest carry enough rated sessions for a curve of their own (needs 3).
    ids.filter(id => id !== '0605').forEach(id => {
      const sessions = S.workouts.filter(w => {
        const en = w.entries.find(e => e.id === id)
        return en && avgRir(en.sets.filter(s => s.done)) != null
      })
      expect(sessions.length).toBeGreaterThanOrEqual(3)
    })
  })

  it('labels the aggregates in the scale the profile logs', () => {
    expect(effortOf(S)).toBe('rir')
    expect(displayScale(S)).toBe('rir')
    // The oldest block is written in RPE, as if imported — the stats have to average the mix.
    let rir = 0, rpe = 0
    eachSet(s => { if (s.rir != null) rir++; else if (s.rpe != null) rpe++ })
    expect(rir).toBeGreaterThan(0)
    expect(rpe).toBeGreaterThan(0)
  })

  it('draws a weekly trend with a point for every week of the history', () => {
    const wks = effortWeeks(S, 0)
    expect(wks.length).toBeGreaterThanOrEqual(10)
    wks.forEach(w => { expect(w.n).toBeGreaterThanOrEqual(2); expect(w.sets).toBeGreaterThanOrEqual(w.n) })
    // Sorted oldest first, one point per calendar week.
    expect(wks.map(w => w.t)).toEqual([...wks.map(w => w.t)].sort((a, b) => a - b))
    expect(new Set(wks.map(w => w.t)).size).toBe(wks.length)
  })

  it('makes the deload visible as a genuinely easier week', () => {
    const wks = effortWeeks(S, 0)
    const easiest = wks.reduce((a, b) => (b.rir > a.rir ? b : a))
    const rest = wks.filter(w => w !== easiest)
    const restAvg = rest.reduce((a, w) => a + w.rir, 0) / rest.length
    expect(easiest.rir - restAvg).toBeGreaterThan(1)      // a step, not noise
    // and the blocks around it grind toward failure rather than sitting flat
    const hardest = wks.reduce((a, b) => (b.rir < a.rir ? b : a))
    expect(easiest.rir - hardest.rir).toBeGreaterThan(1.5)
    expect(hardest.t).toBeGreaterThan(easiest.t)          // the deepest week comes after it
  })

  it('spreads across the scale instead of piling onto one bucket', () => {
    const hist = effortHistogram(S, 0)
    expect(hist.reduce((n, b) => n + b.n, 0)).toBe(sum.rated)
    expect(hist.filter(b => b.pct > 0.05).length).toBeGreaterThan(2)
    expect(Math.max(...hist.map(b => b.pct))).toBeLessThan(0.6)
    // both ends occupied: sets taken to (or near) failure and sets left well short of it
    expect(hist[0].n + hist[1].n).toBeGreaterThan(0)
    expect(hist[hist.length - 1].n).toBeGreaterThan(0)
  })

  it('has hard sets to filter the muscle map by', () => {
    let hard = 0
    eachSet(s => { if (isHardSet(s)) hard++ })
    expect(hard).toBe(sum.hard)
    expect(hard).toBeGreaterThan(50)
    eachSet(s => { if (isHardSet(s)) expect(rirOf(s)).toBeLessThanOrEqual(HARD_RIR) })
  })

  it('is deterministic — two builds produce the same ratings', () => {
    const b = buildDemoState()
    const flat = st => st.workouts.map(w => w.entries.map(e => e.sets.map(s => `${s.w}x${s.r}/${s.rir ?? ''}/${s.rpe ?? ''}`).join(',')).join('|')).join(';')
    expect(flat(b)).toBe(flat(S))
  })
})

// The demo history is a published fixture: mcp/test/tools.test.js pins exact values against it,
// and every existing viewer's demo profile is these numbers. Anything drawn from a generator the
// training loop shares slides the whole sequence along and rewrites that history — which is how
// the measurement block first broke the mcp suite. So the training stream gets pinned here too,
// on the frontend side of the boundary, where the seed actually lives.
describe('demo seed — the training stream is a fixture', () => {
  const TODAY = '2026-07-27'                 // Monday, matching the mcp suite's pinned clock
  // Not copied off a run: 18412.5 is the sum of w×r over the twenty completed sets of the newest
  // session, and 78.3 is BW_TO, the end of the body-weight trend. Same two values mcp asserts.
  const NEWEST = { d: '2026-07-24', name: 'Leg Day', vol: 18412.5 }
  const LATEST_BW = { d: TODAY, w: 78.3 }
  let D = null

  beforeAll(() => {
    vi.useFakeTimers({ now: new Date(TODAY + 'T12:00:00Z'), toFake: ['Date'] })
    D = buildDemoState()
  })
  afterAll(() => vi.useRealTimers())

  it('ends the body-weight trend where the goal delta is derived from', () => {
    expect(D.bodyweight.at(-1)).toMatchObject(LATEST_BW)
  })

  it('closes on the session the mcp suite reads as newest', () => {
    const w = D.workouts.at(-1)
    expect({ d: w.d, name: w.name, vol: w.vol }).toEqual(NEWEST)
    const sets = w.entries.flatMap(e => e.sets)
    expect(sets.length).toBe(20)
    expect(sets.every(s => s.done)).toBe(true)
    // …and the volume really is the sum of w×r over them, not a number that drifted into place.
    expect(sets.reduce((n, s) => n + s.w * s.r, 0)).toBe(NEWEST.vol)
  })

  it('logs measurements without touching that stream', () => {
    // Measurements land on their own cadence, so a shared generator would show up as a shifted
    // history rather than as anything wrong with the measurements themselves.
    expect(D.measurements.length).toBeGreaterThanOrEqual(5)
    const dates = D.measurements.map(m => m.d)
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates).toEqual([...dates].sort())
    // The waist trend is the one the demo exists to show moving; it should actually move.
    const waist = D.measurements.map(m => m.waist)
    expect(waist.every(v => v > 60 && v < 130)).toBe(true)
    expect(waist.at(0) - waist.at(-1)).toBeGreaterThan(3)
  })
})
