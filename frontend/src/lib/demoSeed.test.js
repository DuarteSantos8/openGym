// The demo build is the only openGym most people ever see, so its seeded history has to
// exercise the stats it is there to show off — including the effort card, which renders as
// dashes on a history that is rated too thinly or not at all.
import { describe, it, expect } from 'vitest'
import { buildDemoProfile } from './demoSeed.js'
import {
  effortSummary, effortWeeks, effortHistogram, hasEffort, displayScale, avgRir,
  rirOf, isHardSet, MIN_RATED, HARD_RIR
} from './effort.js'
import { effortOf, modeOf } from './history.js'
import { validateCanonicalProfile } from '../../../api/migration/profile-migration.js'
import { legacyEntriesOf } from './prescription/index.js'

const S = buildDemoProfile()
const eachSet = fn => S.workouts.forEach(w => legacyEntriesOf(w, S.prescriptions).forEach(e => e.sets.forEach(s => fn(s, w, e))))
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
        const en = legacyEntriesOf(w, S.prescriptions).find(e => e.id === id)
        return en && avgRir(en.sets.filter(s => s.done)) != null
      })
      expect(sessions.length).toBeGreaterThanOrEqual(3)
    })
  })

  it('labels the aggregates in the scale the profile logs', () => {
    expect(effortOf(S)).toBe('rir')
    expect(displayScale(S)).toBe('rir')
    // The oldest block is written in RPE, as if imported — the stats have to average the mix.
    // legacyEntriesOf always surfaces the derived `rir` alongside a set's own `rpe` (the engine's
    // internal scale is RIR, per audit.js normalizeEffort), so a set entered in RPE carries both
    // fields — check `rpe` first to bucket it as RPE-original, and only count a bare `rir` as a
    // set that was genuinely logged on that scale.
    let rir = 0, rpe = 0
    eachSet(s => { if (s.rpe != null) rpe++; else if (s.rir != null) rir++ })
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
    const b = buildDemoProfile()
    const flat = st => st.workouts.map(w => legacyEntriesOf(w, st.prescriptions).map(e => e.sets.map(s => `${s.w}x${s.r}/${s.rir ?? ''}/${s.rpe ?? ''}`).join(',')).join('|')).join(';')
    expect(flat(b)).toBe(flat(S))
  })
})

describe('demo seed — engine shape', () => {
  it('is a valid v2 profile', () => {
    expect(S.engineSchemaVersion).toBe(2)
    expect(validateCanonicalProfile(S)).toEqual({ ok: true, errors: [] })
  })
})
