import { describe, it, expect } from 'vitest'
import {
  readSession, sessionsFor, stallCount, nextPrescription, applyPrescription,
  policyFor, defaultIncrement, weightIncrement, epley1RM, deloadTarget1RM,
  deloadFactorOf, DELOAD_FACTOR, POLICIES_FOR, DELOAD_AFTER, MAX_BW_SETS
} from './progression.js'
import { entryExcluded } from './history.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq)).id
const HEAVY = EXDB.find(e => e.bp === 'upper legs').id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id

// Build a state whose history is a list of sessions given as [weight, ...repsPerSet].
// A rep count of null means "the set was never checked off".
const hist = (id, rows, target) => ({
  unit: 'kg',
  workouts: rows.map((row, i) => ({
    d: '2026-01-0' + (i + 1),
    entries: [{
      id,
      target: target || { sets: 3, reps: 5, weight: row[0] },
      sets: row.slice(1).map(r => (r === null ? { w: row[0], r: 0, done: false } : { w: row[0], r, done: true }))
    }]
  }))
})

describe('readSession', () => {
  const T = { sets: 3, reps: 5 }
  it('counts a session where every set made its reps as a hit', () => {
    const s = readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 6, done: true }] })
    expect(s.ok).toBe(true)
    expect(s.weight).toBe(60)
    expect(s.amrap).toBe(6)
    expect(s.low).toBe(5)
  })

  it('counts short reps as a miss even when the set was checked off', () => {
    expect(readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 3, done: true }] }).ok).toBe(false)
  })

  it('counts an unchecked set as a miss — it was not performed', () => {
    const s = readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 0, done: false }] })
    expect(s.ok).toBe(false)
    expect(s.weight).toBe(60)       // the working weight is still known from the sets that counted
  })

  it('counts fewer sets than prescribed as a miss', () => {
    expect(readSession({ id: LIFT, target: T, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }).ok).toBe(false)
  })

  it('refuses to call a session a hit when nothing was prescribed', () => {
    expect(readSession({ id: LIFT, target: {}, sets: [{ w: 60, r: 5, done: true }] }).ok).toBe(false)
  })

  it('reads a timed session by the hold, not by reps', () => {
    const s = readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [{ sec: 45, w: 0, done: true }, { sec: 50, w: 0, done: true }] })
    expect(s.mode).toBe('time')
    expect(s.ok).toBe(true)
    expect(s.best).toBe(50)
    expect(readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [{ sec: 45, done: true }, { sec: 30, done: true }] }).ok).toBe(false)
  })
})

describe('stallCount', () => {
  it('counts consecutive misses back from the most recent session', () => {
    expect(stallCount([{ ok: true }, { ok: true }])).toBe(0)
    expect(stallCount([{ ok: true }, { ok: false }])).toBe(1)
    expect(stallCount([{ ok: false }, { ok: false }, { ok: false }])).toBe(3)
    expect(stallCount([{ ok: false }, { ok: true }, { ok: false }])).toBe(1)
    expect(stallCount([])).toBe(0)
  })

  // 2 additional guardrails to ensure correct behavior with possible patterns
  const miss = (weight, low) => ({ ok: false, weight, low })

  it('measures progress against the best of the run, not merely the session before', () => {
    // Lows 8,9,8,9,8 at one weight: every other session beats the one immediately before it,
    // so comparing only to the previous session would let this yo-yo forever without ever
    // deloading. So we test: 9 never beats the earlier 9 and the stall streak stands.
    const oscillating = [miss(40, 8), miss(40, 9), miss(40, 8), miss(40, 9), miss(40, 8)]
    expect(stallCount(oscillating, 'double')).toBe(3)
  })

  it('ends the streak at a session that made progress rather than skipping past it', () => {
    // Lows 9,9,9,10: the most recent session is a personal best for this run. Checks whether the stall streak ends
    // there and counts nothing. Otherwise stallCount would return 3 and deload after porgress had just occurred.
    const improvedLast = [miss(40, 9), miss(40, 9), miss(40, 9), miss(40, 10)]
    expect(stallCount(improvedLast, 'double')).toBe(0)
  })
})

describe('policyFor', () => {
  it('keeps the app\'s long-standing behaviour as the default for reps work', () => {
    expect(policyFor({ id: LIFT }, null, 'reps')).toBe('linear')
  })
  it('leaves timed and cardio work alone unless asked', () => {
    expect(policyFor({ id: LIFT, mode: 'time' }, null, 'time')).toBe('off')
    expect(policyFor({ id: CARDIO }, null, 'cardio')).toBe('off')
  })
  it('lets the exercise override the routine, and the routine override the default', () => {
    expect(policyFor({ id: LIFT }, { prog: 'greyskull' }, 'reps')).toBe('greyskull')
    expect(policyFor({ id: LIFT, prog: 'double' }, { prog: 'greyskull' }, 'reps')).toBe('double')
  })
  it('refuses a policy that makes no sense for the mode', () => {
    expect(policyFor({ id: LIFT, mode: 'time', prog: 'greyskull' }, null, 'time')).toBe('off')
    expect(policyFor({ id: CARDIO, prog: 'linear' }, null, 'cardio')).toBe('off')
    expect(POLICIES_FOR.cardio).toEqual(['off'])
  })
})

describe('defaultIncrement', () => {
  it('gives lower-body lifts the bigger jump', () => {
    expect(defaultIncrement(LIFT, 'kg')).toBe(2.5)
    expect(defaultIncrement(HEAVY, 'kg')).toBe(5)
  })
  it('scales to pounds', () => {
    expect(defaultIncrement(LIFT, 'lb')).toBe(5)
    expect(defaultIncrement(HEAVY, 'lb')).toBe(10)
  })
  it('falls back for an unknown exercise', () => {
    expect(defaultIncrement('nope', 'kg')).toBe(2.5)
  })
})

describe('weightIncrement', () => {
  it('uses a positive exercise override and otherwise the exercise/unit default', () => {
    expect(weightIncrement({ id: LIFT, inc: 1 }, 'kg')).toBe(1)
    expect(weightIncrement({ id: LIFT }, 'kg')).toBe(2.5)
    expect(weightIncrement({ id: HEAVY, inc: 0 }, 'kg')).toBe(5)
  })
})

describe('Epley deload helpers', () => {
  it('maps a prescribed target pair to the requested Epley 1RM factor', () => {
    expect(epley1RM(60, 8)).toBe(76)
    expect(deloadTarget1RM(60, 8)).toBe(68.4)
    expect(deloadTarget1RM(60, 8, 0.8)).toBe(60.8)
  })

  it('uses the configured factor and keeps the ratio backward-compatible', () => {
    expect(DELOAD_FACTOR).toBe(0.9)
    expect(deloadFactorOf({})).toBe(0.9)
    expect(deloadFactorOf({ deloadFactor: 0.8 })).toBe(0.8)
    expect(deloadFactorOf({ deloadFactor: 0.1 })).toBe(0.9)
  })
})

describe('linear progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('says nothing useful before there is any history', () => {
    const p = nextPrescription({ unit: 'kg', workouts: [] }, cfg)
    expect(p.kind).toBe('first')
    expect(p.weight).toBeUndefined()
  })

  it('adds the increment after a clean session', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('repeats the weight after a miss instead of advancing', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(60)
  })

  it('does not advance when the last set was left unchecked', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, null]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(60)
  })

  it('deloads after three misses in a row, onto a loadable weight', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [60, 5, 4, 4], [60, 5, 5, 4]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(55)             // 60 × 0.9 = 54 → nearest loadable 2.5 step
    expect(DELOAD_AFTER.linear).toBe(3)
  })

  it('deloads from the prescribed target reps, not partial actual reps', () => {
    const target = { sets: 3, reps: 8, weight: 60 }
    const p = nextPrescription(hist(LIFT, [[60, 6, 6, 6], [60, 6, 6, 6], [60, 6, 6, 6]], target), { ...cfg, reps: 8 })
    expect(p.kind).toBe('deload')
    expect(p.target1RM).toBe(deloadTarget1RM(60, 8))
    expect(p.target1RM).not.toBe(deloadTarget1RM(60, 6))
    expect(p.reps).toBe(8)
  })

  it('uses a configured Epley factor when selecting the deload load', () => {
    const p = nextPrescription(hist(LIFT, [[60, 4, 4, 4], [60, 4, 4, 4], [60, 4, 4, 4]], { sets: 3, reps: 5, weight: 60 }), { ...cfg, deloadFactor: 0.8 })
    expect(p.kind).toBe('deload')
    expect(p.deloadFactor).toBe(0.8)
    expect(p.target1RM).toBe(56)
    expect(p.weight).toBe(47.5)
  })

  it('holds a below-step load instead of deloading upward', () => {
    const p = nextPrescription(hist(LIFT, [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]), { ...cfg, weight: 1, inc: 2.5 })
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(1)
    expect(p.why[0]).toMatch(/hold/i)
  })

  it('a good session in between clears the stall', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [60, 5, 5, 5], [60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('hold')
  })

  it('a deload starts a new streak, so one miss at the new weight does not deload again', () => {
    // Three misses at 60 kg earn a deload.
    const stalled = [[60, 4, 4, 4], [60, 4, 4, 4], [60, 4, 4, 4]]
    const deload = nextPrescription(hist(LIFT, stalled), cfg)
    expect(deload.kind).toBe('deload')

    // A bad day at the lighter weight is the first miss of a new run, not the fourth of the old
    // one. A deload is owed a fresh set of attempts, not an immediate second cut.
    const next = nextPrescription(hist(LIFT, [...stalled, [deload.weight, 4, 4, 4]]), cfg)
    expect(next.kind).toBe('hold')
    expect(next.weight).toBe(deload.weight)
  })

  it('never deloads below one increment, however light the lift already is', () => {
    const p = nextPrescription(hist(LIFT, [[2.5, 1, 1, 1], [2.5, 1, 1, 1], [2.5, 1, 1, 1]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(2.5)
  })

  it('always makes a deload actually lighter, even when rounding would not', () => {
    // 20 × 0.9 = 18 → nearest 2.5 step is 17.5, fine. 5 × 0.9 = 4.5 → nearest step is 5,
    // which is no deload at all, so it has to step down instead.
    const p = nextPrescription(hist(LIFT, [[5, 1, 1, 1], [5, 1, 1, 1], [5, 1, 1, 1]]), cfg)
    expect(p.weight).toBeLessThan(5)
  })

  it('uses the heavier step for a lower-body lift', () => {
    const p = nextPrescription(hist(HEAVY, [[100, 5, 5, 5]]), { id: HEAVY, sets: 3, reps: 5, prog: 'linear' })
    expect(p.weight).toBe(105)
  })

  it('honours a per-exercise increment override', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { ...cfg, inc: 1 })
    expect(p.weight).toBe(61)
  })

  it('works in pounds', () => {
    const S = { ...hist(LIFT, [[135, 5, 5, 5]]), unit: 'lb' }
    expect(nextPrescription(S, cfg).weight).toBe(140)
  })
})

describe('bodyweight exercises', () => {
  const cfg = { id: LIFT, sets: 3, reps: 10, weight: 0, prog: 'linear' }
  const bw = rows => hist(LIFT, rows, { sets: 3, reps: 10 })

  it('never invents a weight to deload to — there is nothing to take off a push-up', () => {
    const p = nextPrescription(bw([[0, 10, 10, 8], [0, 10, 10, 9], [0, 10, 10, 8]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(10)
  })

  it('progresses in reps instead of load after a clean session', () => {
    const p = nextPrescription(bw([[0, 10, 10, 10]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(11)
  })

  /* A ceiling turns "+1 rep forever" into a plan — issue #33. */
  it('climbs to the ceiling one rep at a time', () => {
    const p = nextPrescription(bw([[0, 10, 10, 10]]), { ...cfg, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.reps).toBe(11)
    expect(p.sets).toBeUndefined()
  })

  it('adds a set and restarts the range once the ceiling is reached', () => {
    const at15 = hist(LIFT, [[0, 15, 15, 15]], { sets: 3, reps: 15 })
    const p = nextPrescription(at15, { ...cfg, reps: 10, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.sets).toBe(4)
    expect(p.reps).toBe(10)
    expect(p.weight).toBe(0)
  })

  it('stops adding sets at the cap and says what to do instead', () => {
    const at15 = hist(LIFT, [[0, 15, 15, 15]], { sets: 3, reps: 15 })
    const p = nextPrescription(at15, { ...cfg, sets: MAX_BW_SETS, reps: 10, repsMax: 15 })
    expect(p.kind).toBe('hold')
    expect(p.sets).toBeUndefined()
    expect(p.why[0]).toMatch(/harder variation/)
  })

  it('leaves a belted set to the normal policies — there is a load to add now', () => {
    const belted = hist(LIFT, [[10, 10, 10, 10]], { sets: 3, reps: 10 })
    const p = nextPrescription(belted, { ...cfg, bodyweight: true, repsMax: 15 })
    expect(p.kind).toBe('up')
    expect(p.weight).toBeGreaterThan(10)
    expect(p.sets).toBeUndefined()
  })

  it('steps a unilateral total by two, so it lands on 16, 18, 20 (issue #31)', () => {
    const at16 = hist(LIFT, [[0, 16, 16, 16]], { sets: 3, reps: 16 })
    expect(nextPrescription(at16, { ...cfg, reps: 16, side: true }).reps).toBe(18)
    // and by one when it is not
    expect(nextPrescription(at16, { ...cfg, reps: 16 }).reps).toBe(17)
  })

  it('keeps climbing reps forever when no ceiling was set — the old behaviour', () => {
    const at30 = hist(LIFT, [[0, 30, 30, 30]], { sets: 3, reps: 30 })
    const p = nextPrescription(at30, cfg)
    expect(p.kind).toBe('up')
    expect(p.reps).toBe(31)
    expect(p.sets).toBeUndefined()
  })

  it('applies to every policy, not just linear', () => {
    for (const prog of ['linear', 'greyskull', 'double']) {
      const p = nextPrescription(bw([[0, 10, 10, 4], [0, 10, 10, 4], [0, 10, 10, 4]]), { ...cfg, prog })
      expect(p.weight, prog).toBe(0)
      expect(p.kind, prog).toBe('hold')
    }
  })

  it('still adds load the moment the exercise is actually weighted', () => {
    const p = nextPrescription(hist(LIFT, [[10, 10, 10, 10]], { sets: 3, reps: 10 }), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(12.5)
  })
})

describe('Greyskull LP', () => {
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'greyskull' }

  it('advances when the final set makes the target', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('takes a double jump when the last set doubles the target reps', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 10]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(65)
    expect(p.why[0]).toContain('double')
  })

  it('resets 10 % on the very first failure, unlike plain linear', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(55)
    expect(DELOAD_AFTER.greyskull).toBe(1)
  })

  it('keeps resetting from the reduced weight, not the original', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 3], [55, 5, 5, 2]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(50)            // 55 × 0.9 = 49.5 → nearest loadable 2.5 step
  })
})

describe('double progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 40, prog: 'double' }

  it('adds weight and drops back to the bottom of the range at the top of it', () => {
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 12]], { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(42.5)
    expect(p.reps).toBe(8)
  })

  it('does not deload again when the deload was performed exactly as prescribed', () => {
    const target = { sets: 3, reps: 12 }
    // Three sessions stuck mid-range where every set misses the top, so a deload falls due (see DELOAD_POLICY)
    const stalled = [[40, 9, 9, 9], [40, 9, 9, 9], [40, 9, 9, 9]]
    const deload = nextPrescription(hist(LIFT, stalled, target), cfg)
    expect(deload.kind).toBe('deload')

    // Training exactly what it asked for: its weight, its reps, every set checked off.
    const asPrescribed = [deload.weight, ...Array(target.sets).fill(deload.reps)]
    const effectiveTarget = { ...target, weight: deload.weight, reps: deload.reps }
    const completed = hist(LIFT, stalled, target)
    completed.workouts.push({
      d: '2026-01-04',
      entries: [{
        id: LIFT,
        target: effectiveTarget,
        sets: asPrescribed.slice(1).map(r => ({ w: asPrescribed[0], r, done: true }))
      }]
    })
    const next = nextPrescription(completed, cfg)

    // Complying with the app's own prescription must not be scored as another failure.
    expect(next.kind).not.toBe('deload')
    expect(next.weight).toBeGreaterThanOrEqual(deload.weight)
  })

  it('keeps the weight and asks for one more rep while inside the range', () => {
    const p = nextPrescription(hist(LIFT, [[40, 10, 9, 9]], { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('hold')
    expect(p.weight).toBe(40)
    expect(p.reps).toBe(10)             // worst set was 9 -> aim for 10
  })

  it('never asks for more than the top of the range', () => {
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 11]], { sets: 3, reps: 12 }), cfg)
    expect(p.reps).toBeLessThanOrEqual(12)
  })

  it('deloads after a run of stalls and restarts at the bottom of the range', () => {
    const rows = [[40, 9, 9, 9], [40, 9, 9, 9], [40, 9, 9, 9]]
    const p = nextPrescription(hist(LIFT, rows, { sets: 3, reps: 12 }), cfg)
    expect(p.kind).toBe('deload')
    expect(p.reps).toBe(8)
    expect(p.weight).toBe(40)           // 40 × 8 is the closest valid Epley candidate
  })

  it('climbs a range wider than the deload budget instead of cutting on the way up', () => {
    // We consider a 8-12 rep range, so 4 rep steps one per session.
    // This is graded against DELOAD_AFTER.double which allows for 2 stalls towards progress. 
    // And only a hit at the top clears a stall. 
    // With our rep range reaching the top thus cannot be achieved within the current budget of 3. 
    // Therefore we wish to count the climb as progress as well. 
    expect(cfg.reps - cfg.repsMin).toBeGreaterThan(DELOAD_AFTER.double - 1)

    const target = { sets: 3, reps: cfg.reps }
    const rows = []
    let p = { weight: cfg.weight, reps: cfg.repsMin }
    for (let session = 1; session <= 5; session++) {
      // Train exactly what was prescribed, every set, every session.
      rows.push([p.weight, ...Array(target.sets).fill(p.reps)])
      p = nextPrescription(hist(LIFT, rows, target), cfg)
      expect(p.kind).not.toBe('deload')
    }

    // Five compliant sessions later the top of the range is reached and the weight goes up.
    expect(p.kind).toBe('up')
    expect(p.weight).toBeGreaterThan(cfg.weight)
    expect(p.reps).toBe(cfg.repsMin)
  })

  it('normalizes persisted per-side bounds before prescribing', () => {
    const perSide = { ...cfg, reps: 13, repsMin: 7, side: true }
    const p = nextPrescription(hist(LIFT, [[40, 12, 12, 12]], { sets: 3, reps: 13 }), perSide)
    expect(p.kind).toBe('hold')
    expect(p.reps).toBe(14)
  })

  it('selects a lower in-range rep target and never increases the attempted load', () => {
    const target = { sets: 3, reps: 12, weight: 40 }
    const p = nextPrescription(hist(LIFT, [[40, 9, 9, 9], [40, 9, 9, 9], [40, 9, 9, 9]], target), cfg)
    expect(p.kind).toBe('deload')
    expect(p.reps).toBeGreaterThanOrEqual(8)
    expect(p.reps).toBeLessThanOrEqual(12)
    expect(p.weight).toBeLessThanOrEqual(40)
    expect(p.target1RM).toBe(deloadTarget1RM(40, 12))
  })

  it('keeps a 5 kg load and lowers reps when that is closer than a 50% weight cut', () => {
    const small = { id: LIFT, sets: 3, reps: 8, repsMin: 4, weight: 5, inc: 2.5, prog: 'double' }
    const target = { sets: 3, reps: 8, weight: 5 }
    const p = nextPrescription(hist(LIFT, [[5, 6, 6, 6], [5, 6, 6, 6], [5, 6, 6, 6]], target), small)
    expect(p.kind).toBe('deload')
    expect(p.weight).toBe(5)
    expect(p.reps).toBe(4)
    expect(p.target1RM).toBe(deloadTarget1RM(5, 8))
  })

  it('uses half the reps for per-side Epley and returns an even total', () => {
    const perSide = { ...cfg, reps: 8, side: true }
    const target = { sets: 3, reps: 8, weight: 60, side: true }
    const p = nextPrescription(hist(LIFT, [[60, 6, 6, 6], [60, 6, 6, 6], [60, 6, 6, 6]], target), perSide)
    expect(p.kind).toBe('deload')
    expect(p.reps % 2).toBe(0)
    expect(p.target1RM).toBe(deloadTarget1RM(60, 8, 0.9, true))
  })

})

describe('timed progression', () => {
  const cfg = { id: LIFT, mode: 'time', sets: 2, sec: 45, prog: 'time' }
  const T = { sets: 2, sec: 45, mode: 'time' }
  const timeHist = rows => ({
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: '2026-02-0' + (i + 1),
      entries: [{ id: LIFT, target: T, sets: row.map(sec => ({ sec, w: 0, done: true })) }]
    }))
  })

  it('adds time when every set went the full duration', () => {
    const p = nextPrescription(timeHist([[45, 45]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.sec).toBe(50)
    expect(p.weight).toBeUndefined()
  })

  it('repeats the target when a hold came up short', () => {
    const p = nextPrescription(timeHist([[45, 38]]), cfg)
    expect(p.kind).toBe('hold')
    expect(p.sec).toBe(45)
  })

  it('backs the target off after a run of short sessions', () => {
    const p = nextPrescription(timeHist([[45, 30], [45, 32], [45, 31]]), cfg)
    expect(p.kind).toBe('deload')
    expect(p.sec).toBe(40)              // 45 × 0.9 = 40.5 → nearest 5 s step
  })

  it('ignores reps history when the exercise switched to time', () => {
    const S = hist(LIFT, [[60, 5, 5, 5]])
    const p = nextPrescription({ ...S, unit: 'kg' }, cfg)
    expect(p.kind).toBe('first')        // no timed session yet, so no opinion
  })
})

describe('policy "off"', () => {
  it('has no opinion at all', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { id: LIFT, sets: 3, reps: 5, prog: 'off' })
    expect(p.kind).toBe('off')
    expect(p.weight).toBeUndefined()
  })
  it('is what cardio always gets', () => {
    expect(nextPrescription({ unit: 'kg', workouts: [] }, { id: CARDIO, sets: 1, min: 20 }).kind).toBe('off')
  })
})

describe('sessionsFor', () => {
  it('skips workouts where the exercise was never actually logged', () => {
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-01-01', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: true }] }] },
        { d: '2026-01-02', entries: [{ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 0, done: false }] }] },
        { d: '2026-01-03', entries: [{ id: 'other', target: {}, sets: [{ w: 20, r: 5, done: true }] }] }
      ]
    }
    expect(sessionsFor(S, LIFT).map(s => s.d)).toEqual(['2026-01-01'])
  })

  it('ignores marked deload workouts when it calculates the next regular target', () => {
    const target = { sets: 3, reps: 5, weight: 60 }
    const entry = (weight, reps) => ({
      id: LIFT,
      target: { ...target, weight },
      sets: reps.map(r => ({ w: weight, r, done: true }))
    })
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-01-01', entries: [entry(60, [5, 5, 5])] },
        { d: '2026-01-08', excludeFromProgression: true, entries: [entry(30, [8, 8])] }
      ]
    }

    expect(sessionsFor(S, LIFT).map(s => s.d)).toEqual(['2026-01-01'])
    expect(nextPrescription(S, { id: LIFT, ...target, prog: 'linear' }).weight).toBe(62.5)
  })

  it('reads a legacy entry that has no target without crashing', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, sets: [{ w: 60, r: 5, done: true }] }] }] }
    expect(sessionsFor(S, LIFT)).toHaveLength(1)
  })
})

// "Excluded from progression" is per-entry now (ENG-11): a rehab routine combined with real
// work must exclude only its own exercises, not the whole session.
describe('per-entry noProg (combine routines)', () => {
  const PRESS = EXDB.find(e => e.bp !== 'cardio' && e.id !== LIFT && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp)).id
  const tgt = w => ({ sets: 3, reps: 5, weight: w })
  const entry = (id, w, reps, extra) => ({ id, target: tgt(w), sets: reps.map(r => ({ w, r, done: true })), ...extra })

  it('skips a noProg entry for that exercise only, in a mixed combined session', () => {
    const S = {
      unit: 'kg',
      workouts: [{
        d: '2026-02-01',
        routineIds: ['strength', 'rehab'],
        entries: [entry(LIFT, 60, [5, 5, 5]), entry(PRESS, 40, [5, 5, 5], { noProg: true })],
      }],
    }
    expect(sessionsFor(S, LIFT)).toHaveLength(1)
    expect(sessionsFor(S, PRESS)).toHaveLength(0)
  })

  it('still advances the non-excluded exercise of a mixed combined session', () => {
    const S = {
      unit: 'kg',
      workouts: [{
        d: '2026-02-01',
        entries: [entry(LIFT, 60, [5, 5, 5]), entry(PRESS, 40, [5, 5, 5], { noProg: true })],
      }],
    }
    expect(nextPrescription(S, { id: LIFT, ...tgt(60), prog: 'linear' }).weight).toBe(62.5)
  })

  it('a noProg gap never becomes the deload / stall baseline', () => {
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-02-01', entries: [entry(LIFT, 60, [5, 5, 5])] },
        { d: '2026-02-03', entries: [entry(LIFT, 60, [5, 5, 5])] },
        { d: '2026-02-05', entries: [entry(LIFT, 30, [8, 8, 8], { noProg: true })] },
      ],
    }
    expect(sessionsFor(S, LIFT).map(s => s.d)).toEqual(['2026-02-01', '2026-02-03'])
    expect(nextPrescription(S, { id: LIFT, ...tgt(60), prog: 'linear' }).weight).toBe(62.5)
  })

  it('honours a legacy whole-workout excludeFromProgression flag (all entries skipped)', () => {
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-02-01', entries: [entry(LIFT, 60, [5, 5, 5])] },
        { d: '2026-02-08', excludeFromProgression: true, entries: [entry(LIFT, 30, [8, 8])] },
      ],
    }
    expect(sessionsFor(S, LIFT).map(s => s.d)).toEqual(['2026-02-01'])
  })

  it('an exercise only ever logged noProg → sessionsFor [] → nextPrescription kind "first"', () => {
    const S = {
      unit: 'kg',
      workouts: [{ d: '2026-02-01', entries: [entry(LIFT, 30, [8, 8, 8], { noProg: true })] }],
    }
    expect(sessionsFor(S, LIFT)).toHaveLength(0)
    expect(nextPrescription(S, { id: LIFT, ...tgt(50), prog: 'linear' }).kind).toBe('first')
  })

  it('entryExcluded truth table', () => {
    expect(entryExcluded({}, {})).toBe(false)
    expect(entryExcluded({ excludeFromProgression: true }, {})).toBe(true)
    expect(entryExcluded({}, { noProg: true })).toBe(true)
    expect(entryExcluded({ excludeFromProgression: true }, { noProg: true })).toBe(true)
  })

  it('stallCount is not reset by a noProg gap at the same weight', () => {
    // three real misses at 60, with a noProg 60 session interleaved — still streaks to a deload
    const miss = d => ({ d, entries: [entry(LIFT, 60, [4, 4, 4])] })
    const S = {
      unit: 'kg',
      workouts: [
        { d: '2026-02-01', entries: [entry(LIFT, 60, [5, 5, 5])] },
        miss('2026-02-03'),
        { d: '2026-02-04', entries: [entry(LIFT, 60, [3, 3, 3], { noProg: true })] },
        miss('2026-02-05'),
        miss('2026-02-07'),
      ],
    }
    const sessions = sessionsFor(S, LIFT)
    expect(sessions.map(s => s.d)).toEqual(['2026-02-01', '2026-02-03', '2026-02-05', '2026-02-07'])
    expect(stallCount(sessions)).toBe(3)
    expect(nextPrescription(S, { id: LIFT, ...tgt(60), prog: 'linear' }).kind).toBe('deload')
  })
})

// Workouts only began storing their prescription in v1.2.2. Everything logged before that is
// targetless, and reading it as "missed" would tell every long-standing user to deload on
// their first session after updating — which is exactly what the demo history did.
describe('history logged before targets were recorded', () => {
  const legacy = rows => ({
    unit: 'kg',
    workouts: rows.map((row, i) => ({
      d: '2026-03-' + String(i + 1).padStart(2, '0'),
      entries: [{ id: LIFT, sets: row.slice(1).map(r => ({ w: row[0], r, done: true })) }]   // no target
    }))
  })
  const cfg = { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear' }

  it('judges a targetless session against the current plan instead of calling it a miss', () => {
    const p = nextPrescription(legacy([[60, 5, 5, 5]]), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(62.5)
  })

  it('does not manufacture a stall out of a long clean history', () => {
    const p = nextPrescription(legacy(Array.from({ length: 11 }, () => [60, 5, 5, 5])), cfg)
    expect(p.kind).toBe('up')
  })

  it('still spots a genuine miss in old data', () => {
    expect(nextPrescription(legacy([[60, 5, 5, 2]]), cfg).kind).toBe('hold')
  })

  it('matches the weight hint the app showed before this engine existed', () => {
    // Old rule: every set at or above the plan's reps, with a real weight → suggest a step up.
    expect(nextPrescription(legacy([[60, 5, 6, 5]]), cfg).weight).toBe(62.5)
    expect(nextPrescription(legacy([[60, 5, 4, 5]]), cfg).kind).toBe('hold')
  })
})

describe('applyPrescription', () => {
  const sets = [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: false }]

  it('rewrites only what the policy decided, and only unlogged sets', () => {
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5 })
    expect(out[0]).toEqual({ w: 60, r: 5, done: true })
    expect(out[1]).toEqual({ w: 62.5, r: 5, done: false })
  })

  it('sets reps too when the policy has an opinion about them', () => {
    expect(applyPrescription(sets, { kind: 'up', weight: 42.5, reps: 8 })[1]).toEqual({ w: 42.5, r: 8, done: false })
  })

  it('touches nothing for "off" or a first session', () => {
    expect(applyPrescription(sets, { kind: 'off' })).toBe(sets)
    expect(applyPrescription(sets, { kind: 'first' })).toBe(sets)
    expect(applyPrescription(sets, null)).toBe(sets)
  })

  it('adjusts a timed set without inventing a weight', () => {
    const timed = [{ sec: 45, w: 0, done: false }]
    expect(applyPrescription(timed, { kind: 'up', sec: 50 })).toEqual([{ sec: 50, w: 0, done: false }])
  })

  it('grows the list when the policy added a set (issue #33)', () => {
    const three = [{ w: 0, r: 10, done: false }, { w: 0, r: 10, done: false }, { w: 0, r: 10, done: false }]
    const out = applyPrescription(three, { kind: 'up', weight: 0, reps: 10, sets: 4 })
    expect(out).toHaveLength(4)
    expect(out[3]).toEqual({ w: 0, r: 10, done: false })
  })

  it('never shrinks a session that has already logged sets', () => {
    expect(applyPrescription(sets, { kind: 'up', weight: 60, sets: 1 })).toHaveLength(sets.length)
  })
})


describe('warm-up rows in session reads (round 3)', () => {
  it('readSession ignores warm-up rows for reps, count, low and ok', () => {
    // An undone warm-up (r 0) must not poison `ok` forever; its lighter reps must not
    // drag `low`/`count` - the warm-up is prep, the session is the work rows.
    const s = readSession({ id: LIFT, target: { sets: 2, reps: 5, mode: 'reps' }, sets: [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 6, done: true },
    ] })
    expect(s.count).toBe(2)
    expect(s.low).toBe(5)
    expect(s.reps).toEqual([5, 6])
    expect(s.ok).toBe(true)
  })

  it('readSession keeps an undone warm-up out of held/ok in time mode', () => {
    const s = readSession({ id: LIFT, target: { sets: 2, sec: 45, mode: 'time' }, sets: [
      { sec: 45, done: true, warmup: true },
      { sec: 45, done: true },
      { sec: 30, done: true },
    ] })
    expect(s.held).toEqual([45, 30])
    expect(s.ok).toBe(false) // the 30s work row is the miss, not the warm-up
  })

  it('uses phase as authoritative and falls back to the legacy warm-up flag', () => {
    const s = readSession({ id: LIFT, target: { sets: 1, reps: 5 }, sets: [
      { phase: 'warmup', w: 120, r: 20, done: true },
      { phase: 'work', warmup: true, w: 60, r: 5, done: true },
    ] })
    expect(s.count).toBe(1)
    expect(s.weight).toBe(60)
    expect(s.low).toBe(5)
    expect(s.ok).toBe(true)
  })
})

describe('applyPrescription never touches warm-up rows (round 3)', () => {
  it('leaves a done warm-up exactly as logged', () => {
    const sets = [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 5, done: false },
    ]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5 })
    expect(out[0]).toEqual({ w: 20, r: 8, done: true, warmup: true })
    expect(out[1]).toEqual({ w: 60, r: 5, done: true })
    expect(out[2]).toEqual({ w: 62.5, r: 5, done: false })
  })

  it('grows the work rows, not the warm-up rows, when the policy adds sets', () => {
    const sets = [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 60, r: 5, done: true },
      { w: 60, r: 5, done: false },
    ]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5, sets: 4 })
    expect(out.filter(s => !s.warmup)).toHaveLength(4) // 2 existing + 2 grown
    expect(out.filter(s => s.warmup)).toHaveLength(1)  // warm-up untouched
    expect(out[0]).toEqual({ w: 20, r: 8, done: true, warmup: true })
  })

  it('an all-warm-up entry terminates and stays untouched', () => {
    const sets = [
      { w: 20, r: 8, done: true, warmup: true },
      { w: 25, r: 6, done: true, warmup: true },
    ]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5, reps: 5, sets: 4 })
    expect(out).toEqual(sets) // no work row to seed growth from - nothing grows, no loop
  })
})

describe('drop-sets and rest-pause sets in progression', () => {
  it('readSession judges a drop-set row on its own main weight/reps, ignoring the drops', () => {
    const withDrops = readSession({ id: LIFT, target: { sets: 1, reps: 5 }, sets: [
      { type: 'dropset', w: 60, r: 5, done: true, drops: [{ w: 40, r: 8 }, { w: 20, r: 10 }] },
    ] })
    const plain = readSession({ id: LIFT, target: { sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: true }] })
    expect(withDrops).toEqual(plain)
  })

  it('readSession judges a rest-pause row on its activation weight/reps, ignoring the bursts', () => {
    const withBursts = readSession({ id: LIFT, target: { sets: 1, reps: 8 }, sets: [
      { type: 'restpause', w: 60, r: 8, done: true, clusters: [{ r: 4, restSec: 15 }, { r: 3, restSec: 15 }] },
    ] })
    const plain = readSession({ id: LIFT, target: { sets: 1, reps: 8 }, sets: [{ w: 60, r: 8, done: true }] })
    expect(withBursts).toEqual(plain)
  })

  it('applyPrescription still rewrites a drop-set/rest-pause row\'s own weight, leaving its drops/clusters untouched', () => {
    const sets = [{ type: 'dropset', w: 60, r: 5, done: false, drops: [{ w: 40, r: 8 }] }]
    const out = applyPrescription(sets, { kind: 'up', weight: 62.5 })
    expect(out[0]).toEqual({ type: 'dropset', w: 62.5, r: 5, done: false, drops: [{ w: 40, r: 8 }] })
  })

  it('a newly grown row keeps the seed\'s planned type but not its already-logged drops/clusters', () => {
    const sets = [{ type: 'dropset', w: 0, r: 10, done: false, drops: [{ w: 0, r: 12 }] }]
    const out = applyPrescription(sets, { kind: 'up', weight: 0, reps: 10, sets: 2 })
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({ type: 'dropset', w: 0, r: 10, done: false })
  })
})

describe('a weight off the increment grid keeps its offset when it goes up (issue #175)', () => {
  it('adds the step instead of snapping the sum to the grid', () => {
    // A sled logged as its own 167 lb plus plates: 397 with a 10 lb step goes to 407, not 410.
    const lin = { id: LIFT, sets: 3, reps: 5, weight: 397, prog: 'linear', inc: 10 }
    const p = nextPrescription(hist(LIFT, [[397, 5, 5, 5]], { sets: 3, reps: 5, weight: 397 }), lin)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(407)
    const dbl = { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 397, prog: 'double', inc: 10 }
    const d = nextPrescription(hist(LIFT, [[397, 12, 12, 12]], { sets: 3, reps: 12, weight: 397 }), dbl)
    expect(d.kind).toBe('up')
    expect(d.weight).toBe(407)
  })
  it('still snaps from a weight that sits on the grid', () => {
    const p = nextPrescription(hist(LIFT, [[60, 5, 5, 5]]), { id: LIFT, sets: 3, reps: 5, weight: 60, prog: 'linear', inc: 2.5 })
    expect(p.weight).toBe(62.5)
  })
})
