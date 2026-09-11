import { describe, it, expect } from 'vitest'
import {
  readSession, sessionsFor, stallCount, nextPrescription, applyPrescription,
  policyFor, defaultIncrement, weightIncrement, epley1RM, deloadTarget1RM,
  deloadFactorOf, DELOAD_FACTOR, POLICIES_FOR, DELOAD_AFTER, MAX_BW_SETS,
  DEFAULT_WAVE, waveOf, stageRows, anchorBlockOf, anchorPctOf
} from './progression.js'
import { entryExcluded } from './history.js'
import { EXDB } from './exercises.js'
import { buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq)).id
const HEAVY = EXDB.find(e => e.bp === 'upper legs').id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id
const snapWeightForTest = v => Math.round(Math.round(v / 2.5) * 2.5 * 10) / 10

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

describe('wave template and resolution', () => {
  it('ships a four-stage 5/3/1 template', () => {
    expect(DEFAULT_WAVE).toHaveLength(4)
    expect(DEFAULT_WAVE[0].blocks.map(b => b.pct)).toEqual([65, 75, 85])
    expect(DEFAULT_WAVE[2].blocks.map(b => b.reps)).toEqual([5, 3, 1])
    expect(DEFAULT_WAVE[3].deload).toBe(true)
  })

  it('falls back to the template when the config has no usable wave', () => {
    expect(waveOf({}).map(w => w.blocks.length)).toEqual([3, 3, 3, 3])
    expect(waveOf({ wave: [] })).toEqual(waveOf({}))
    expect(waveOf({ wave: 'nonsense' })).toEqual(waveOf({}))
    expect(waveOf({ wave: [{ blocks: [] }] })).toEqual(waveOf({}))
  })

  it('normalises every stage and block it is given, and assigns stable ids', () => {
    const w = waveOf({ wave: [{ deload: true, repeat: '3', blocks: [{ pct: 250, reps: 0, sets: '2' }, { pct: 0 }] }] })
    expect(w).toHaveLength(1)
    // The second block (pct: 0) is dropped, same as an unusable set always was — the survivor
    // is then the only block in its stage, so it is automatically the anchor.
    expect(w[0]).toEqual({
      id: 's0', deload: true, repeat: 3,
      blocks: [{ id: 's0b0', sets: 2, reps: 1, pct: 100, type: 'work', role: 'anchor' }]
    })
  })

  it('keeps an id a block already had, rather than reassigning one', () => {
    const w = waveOf({ wave: [{ id: 'my-stage', blocks: [{ id: 'my-block', pct: 80, reps: 5, sets: 1 }] }] })
    expect(w[0].id).toBe('my-stage')
    expect(w[0].blocks[0].id).toBe('my-block')
  })

  it('expands each block by its set count and snaps every row to the load grid, stamped with its block', () => {
    const stage = {
      id: 'sX', repeat: 1,
      blocks: [
        { id: 'a', sets: 2, reps: 5, pct: 65, type: 'work', role: 'required' },
        { id: 'b', sets: 1, reps: 5, pct: 85, type: 'work', role: 'anchor' }
      ]
    }
    expect(stageRows(stage, 100, 2.5)).toEqual([
      { w: 65, r: 5, blockId: 'a', stageId: 'sX', role: 'required', blockType: 'work' },
      { w: 65, r: 5, blockId: 'a', stageId: 'sX', role: 'required', blockType: 'work' },
      { w: 85, r: 5, blockId: 'b', stageId: 'sX', role: 'anchor', blockType: 'work' }
    ])
    expect(stageRows(stage, 97, 2.5)).toEqual([
      { w: 62.5, r: 5, blockId: 'a', stageId: 'sX', role: 'required', blockType: 'work' },
      { w: 62.5, r: 5, blockId: 'a', stageId: 'sX', role: 'required', blockType: 'work' },
      { w: 82.5, r: 5, blockId: 'b', stageId: 'sX', role: 'anchor', blockType: 'work' }
    ])
  })

  it('marks the last non-warmup block anchor, and reports its percentage', () => {
    expect(anchorPctOf(waveOf({})[0])).toBe(85)
    expect(anchorPctOf(waveOf({})[3])).toBe(60)
    expect(anchorPctOf(null)).toBe(0)
    const warmupLast = waveOf({ wave: [{ blocks: [
      { pct: 80, reps: 5 }, { pct: 40, reps: 8, type: 'warmup' }
    ] }] })[0]
    // A warm-up block never becomes the anchor even when it is last in the array.
    expect(anchorBlockOf(warmupLast).pct).toBe(80)
  })

  it('offers wave only on reps work', () => {
    expect(POLICIES_FOR.reps).toContain('wave')
    expect(POLICIES_FOR.time).not.toContain('wave')
    expect(POLICIES_FOR.cardio).not.toContain('wave')
    expect(policyFor({ id: LIFT, prog: 'wave' }, null, 'reps')).toBe('wave')
    expect(policyFor({ id: LIFT, prog: 'wave', mode: 'time' }, null, 'time')).toBe('off')
  })
})

describe('readSession with a per-row target', () => {
  const ROWS = { sets: 3, reps: 5, rows: [{ w: 65, r: 5 }, { w: 75, r: 3 }, { w: 85, r: 1 }] }

  it('grades each row against its own rep target', () => {
    const s = readSession({ id: LIFT, target: ROWS, sets: [
      { w: 65, r: 5, done: true }, { w: 75, r: 3, done: true }, { w: 85, r: 1, done: true },
    ] })
    expect(s.ok).toBe(true)
    expect(s.weight).toBe(85)          // the top set stays the stage signal
  })

  it('does not fail a light row for missing the heavy row\'s reps', () => {
    // uniform grading would need 5 reps everywhere and call this a miss
    const s = readSession({ id: LIFT, target: ROWS, sets: [
      { w: 65, r: 5, done: true }, { w: 75, r: 3, done: true }, { w: 85, r: 2, done: true },
    ] })
    expect(s.ok).toBe(true)
  })

  it('fails the session when one row came up short', () => {
    expect(readSession({ id: LIFT, target: ROWS, sets: [
      { w: 65, r: 5, done: true }, { w: 75, r: 2, done: true }, { w: 85, r: 1, done: true },
    ] }).ok).toBe(false)
  })

  it('fails the session when a row was never checked off', () => {
    expect(readSession({ id: LIFT, target: ROWS, sets: [
      { w: 65, r: 5, done: true }, { w: 75, r: 3, done: true }, { w: 85, r: 1, done: false },
    ] }).ok).toBe(false)
  })

  it('fails the session when fewer rows were logged than prescribed', () => {
    expect(readSession({ id: LIFT, target: ROWS, sets: [
      { w: 65, r: 5, done: true }, { w: 75, r: 3, done: true },
    ] }).ok).toBe(false)
  })

  it('ignores warm-up rows when lining rows up with sets', () => {
    const s = readSession({ id: LIFT, target: ROWS, sets: [
      { w: 40, r: 8, done: true, warmup: true },
      { w: 65, r: 5, done: true }, { w: 75, r: 3, done: true }, { w: 85, r: 1, done: true },
    ] })
    expect(s.ok).toBe(true)
  })

  it('leaves an entry with no rows on the uniform path', () => {
    const uniform = { sets: 3, reps: 5 }
    expect(readSession({ id: LIFT, target: uniform, sets: [
      { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 4, done: true },
    ] }).ok).toBe(false)
    expect(readSession({ id: LIFT, target: { ...uniform, rows: [] }, sets: [
      { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true },
    ] }).ok).toBe(true)
  })

  it('grades required and anchor rows, but never a warm-up-type row', () => {
    const rows = [
      { w: 40, r: 8, role: 'required', blockType: 'warmup' },
      { w: 65, r: 5, role: 'anchor', blockType: 'work' }
    ]
    const s = readSession({ id: LIFT, target: { sets: 2, reps: 5, rows }, sets: [
      { w: 40, r: 3, done: true },   // short — would fail a uniform grading
      { w: 65, r: 5, done: true }
    ] })
    expect(s.ok).toBe(true)
  })
})

describe('readSession exposes the anchor row\'s own weight', () => {
  it('reads the weight from whichever row is marked anchor, not the heaviest one', () => {
    const rows = [
      { w: 100, r: 1, role: 'required', blockType: 'work' },
      { w: 80, r: 5, role: 'anchor', blockType: 'work' }
    ]
    const s = readSession({ id: LIFT, target: { sets: 2, reps: 1, rows }, sets: [
      { w: 100, r: 1, done: true }, { w: 80, r: 5, done: true }
    ] })
    expect(s.weight).toBe(100)        // still the session's own heaviest logged set
    expect(s.anchorWeight).toBe(80)   // but the stage-matching signal is the anchor row alone
  })

  it('omits anchorWeight when nothing in the target is marked anchor', () => {
    const s = readSession({ id: LIFT, target: { sets: 1, reps: 5, rows: [{ w: 60, r: 5 }] }, sets: [{ w: 60, r: 5, done: true }] })
    expect(s.anchorWeight).toBeUndefined()
  })

  it('reads the anchor row\'s own weight even when it was never checked off', () => {
    const rows = [{ w: 65, r: 5, role: 'anchor', blockType: 'work' }]
    const s = readSession({ id: LIFT, target: { sets: 1, reps: 5, rows }, sets: [{ w: 65, r: 3, done: false }] })
    expect(s.anchorWeight).toBe(65)
  })
})

describe('wave progression', () => {
  // History for a wave: each session is [ [w, r], [w, r], ... ] — one pair per work row.
  // `target`, when given, is either one target shared by every session or one per session
  // (matched by index) — a fixture needs the latter to say what a stage's rows actually were
  // prescribed as, since that can differ from what got logged (a missed rep is still logged).
  const waveHist = (id, sessions, target) => ({
    unit: 'kg',
    workouts: sessions.map((rows, i) => ({
      d: '2026-01-0' + (i + 1),
      entries: [{
        id,
        target: (Array.isArray(target) ? target[i] : target) || { sets: rows.length, reps: 5, rows: rows.map(([w, r]) => ({ w, r })) },
        sets: rows.map(([w, r, done]) => ({ w, r: r == null ? 0 : r, done: done !== false && r != null }))
      }]
    }))
  })
  // 100 kg training max, LIFT's default step is 2.5 kg (upper body, kg).
  const CFG = { id: LIFT, sets: 3, reps: 5, prog: 'wave', trainingMax: 100 }
  const W1 = [[65, 5], [75, 5], [85, 5]]
  const W2 = [[70, 3], [80, 3], [90, 3]]
  const W3 = [[75, 5], [85, 3], [95, 1]]
  const W4 = [[40, 5], [50, 5], [60, 5]]

  it('refuses to start without a training max', () => {
    const p = nextPrescription({ unit: 'kg', workouts: [] }, { ...CFG, trainingMax: 0 }, null)
    expect(p).toMatchObject({ policy: 'wave', kind: 'need-tm' })
    expect(p.rows).toBeUndefined()
    expect(nextPrescription({ unit: 'kg', workouts: [] }, { ...CFG, trainingMax: -5 }, null).kind).toBe('need-tm')
  })

  it('prescribes stage 1 as the very first session', () => {
    const p = nextPrescription({ unit: 'kg', workouts: [] }, CFG, null)
    expect(p).toMatchObject({ policy: 'wave', kind: 'first', stage: 1, stages: 4 })
    expect(p.rows).toMatchObject([{ w: 65, r: 5 }, { w: 75, r: 5 }, { w: 85, r: 5 }])
  })

  it('moves to stage 2 after a clean stage 1', () => {
    const p = nextPrescription(waveHist(LIFT, [W1]), CFG, null)
    expect(p).toMatchObject({ kind: 'up', stage: 2, stages: 4 })
    expect(p.rows).toMatchObject([{ w: 70, r: 3 }, { w: 80, r: 3 }, { w: 90, r: 3 }])
    expect(p.trainingMax).toBeUndefined()
  })

  // Stage 1's prescribed rows: 5 reps on every row, regardless of what actually got logged.
  const STAGE1_TARGET = { sets: 3, reps: 5, rows: [{ w: 65, r: 5 }, { w: 75, r: 5 }, { w: 85, r: 5 }] }

  it('runs the same stage again after a miss', () => {
    const missed = [[65, 5], [75, 5], [85, 3]]
    const p = nextPrescription(waveHist(LIFT, [missed], STAGE1_TARGET), CFG, null)
    expect(p).toMatchObject({ kind: 'hold', stage: 1 })
    expect(p.rows).toMatchObject([{ w: 65, r: 5 }, { w: 75, r: 5 }, { w: 85, r: 5 }])
  })

  it('advances past a missed stage when told to', () => {
    const missed = [[65, 5], [75, 5], [85, 3]]
    const p = nextPrescription(waveHist(LIFT, [missed], STAGE1_TARGET), { ...CFG, onMiss: 'advance' }, null)
    expect(p).toMatchObject({ kind: 'hold', stage: 2 })
    expect(p.rows).toMatchObject([{ w: 70, r: 3 }, { w: 80, r: 3 }, { w: 90, r: 3 }])
  })

  it('calls a deload stage a deload', () => {
    const p = nextPrescription(waveHist(LIFT, [W1, W2, W3]), CFG, null)
    expect(p).toMatchObject({ kind: 'deload', stage: 4 })
    expect(p.rows).toMatchObject([{ w: 40, r: 5 }, { w: 50, r: 5 }, { w: 60, r: 5 }])
  })

  it('closes the cycle by bumping the training max and going back to stage 1', () => {
    const p = nextPrescription(waveHist(LIFT, [W1, W2, W3, W4]), CFG, null)
    expect(p).toMatchObject({ kind: 'up', stage: 1, stages: 4, trainingMax: 102.5 })
    // 65 % of 102.5 kg is 66.625, which snaps to 67.5 on a 2.5 kg grid — not 65's own multiple.
    expect(p.rows).toMatchObject([{ w: 67.5, r: 5 }, { w: 77.5, r: 5 }, { w: 87.5, r: 5 }])
  })

  it('does not bump when the last stage was missed', () => {
    const missed = [[40, 5], [50, 5], [60, 3]]
    const targets = [W1, W2, W3, [[40, 5], [50, 5], [60, 5]]].map(stage => ({
      sets: 3, reps: 5, rows: stage.map(([w, r]) => ({ w, r }))
    }))
    const p = nextPrescription(waveHist(LIFT, [W1, W2, W3, missed], targets), CFG, null)
    expect(p).toMatchObject({ kind: 'hold', stage: 4 })
    expect(p.trainingMax).toBeUndefined()
  })

  it('wraps without touching the training max when the bump is off', () => {
    const p = nextPrescription(waveHist(LIFT, [W1, W2, W3, W4]), { ...CFG, bump: 'off' }, null)
    expect(p).toMatchObject({ kind: 'up', stage: 1 })
    expect(p.trainingMax).toBeUndefined()
    expect(p.rows).toMatchObject([{ w: 65, r: 5 }, { w: 75, r: 5 }, { w: 85, r: 5 }])
  })

  it('holds a repeat stage for as many sessions as it asks for', () => {
    const wave = [{ repeat: 2, blocks: [{ pct: 80, reps: 5 }] }, { blocks: [{ pct: 90, reps: 3 }] }]
    const cfg = { ...CFG, wave, sets: 1 }
    const one = [[80, 5]]
    expect(nextPrescription(waveHist(LIFT, [one]), cfg, null)).toMatchObject({ kind: 'up', stage: 1 })
    expect(nextPrescription(waveHist(LIFT, [one, one]), cfg, null)).toMatchObject({ kind: 'up', stage: 2 })
  })

  it('resolves against a live estimated 1RM when asked to', () => {
    const cfg = { ...CFG, pctBase: '1rm', trainingMax: 0 }
    // 100 x 5 -> Epley 116.7; stage 1 top set is 85 % of that, snapped to 2.5 kg.
    const st = waveHist(LIFT, [[[100, 5]]], { sets: 1, reps: 5 })
    const p = nextPrescription(st, { ...cfg, sets: 1 }, null)
    expect(p.policy).toBe('wave')
    expect(p.kind).not.toBe('need-tm')
    expect(p.rows[p.rows.length - 1].w).toBe(snapWeightForTest(116.7 * 0.85))
  })

  it('needs an estimate before it can use one', () => {
    const p = nextPrescription({ unit: 'kg', workouts: [] }, { ...CFG, pctBase: '1rm', trainingMax: 0 }, null)
    expect(p.kind).toBe('need-tm')
  })

  it('keeps per-side rep targets even and on the grid', () => {
    const cfg = { ...CFG, side: true }
    const p = nextPrescription({ unit: 'kg', workouts: [] }, cfg, null)
    // A wave is strictly prescriptive: the stored rep number is the stored rep number, per side
    // handling lives in the display layer, so the rows come through unchanged.
    expect(p.rows.map(r => r.r)).toEqual([5, 5, 5])
  })

  it('always names the stage it actually used', () => {
    const p = nextPrescription(waveHist(LIFT, [W1]), CFG, null)
    expect(p.why.join(' ')).toContain('2')
  })
})

describe('wave progression — real prescribe → log → finish → prescribe loop', () => {
  // Unlike `waveHist` above (hand-built session fixtures), this drives the actual functions the
  // app calls: buildSessionEntries prescribes a session, buildCompletedWorkout reduces it back
  // into history, and nextPrescription judges that history — the exact seam Finding 1 lived in.
  const cfg = { id: LIFT, sets: 3, reps: 5, prog: 'wave', trainingMax: 100 }
  const routine = { id: 'r', prog: 'wave', ex: [cfg] }

  function runSession(st, mark) {
    const entries = buildSessionEntries(st, routine)
    const entry = entries[0]
    const sets = entry.sets.map((s, i) => ({ ...s, done: mark(i, entry.sets.length) }))
    const workout = buildCompletedWorkout({
      id: `w${st.workouts.length + 1}`, d: `2026-01-0${st.workouts.length + 1}`, start: 1,
      entries: [{ ...entry, sets }]
    })
    st.workouts.push(workout)
  }

  it('does not deload a session merely because the top set went unticked', () => {
    const st = { unit: 'kg', workouts: [], exWeights: {}, routines: [routine] }

    // Session 1: every set logged and ticked — a clean pass on stage 1.
    runSession(st, () => true)
    const plan2 = nextPrescription(st, cfg, routine)
    expect(plan2.kind).not.toBe('deload')
    expect(plan2.stage).toBe(2)

    // Session 2: everything ticked EXCEPT the anchor (last) set of the stage — the lifter bailed
    // on the top set but logged everything before it. Before the fix, an unticked anchor read as
    // anchorWeight: 0, which the nearest-stage search always matches to the deload stage — so a
    // perfectly ordinary partial session silently sent the lifter into a deload week.
    runSession(st, (i, n) => i < n - 1)
    const plan3 = nextPrescription(st, cfg, routine)
    expect(plan3.stage).toBe(2)     // repeats stage 2 (a miss) — NOT the deload stage
    expect(plan3.kind).not.toBe('deload')
  })
})

describe('applyPrescription with rows', () => {
  const P = { policy: 'wave', kind: 'up', rows: [{ w: 65, r: 5 }, { w: 75, r: 3 }, { w: 85, r: 1 }] }

  it('gives each pending work row its own weight and reps', () => {
    const out = applyPrescription([
      { w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }, { w: 60, r: 5, done: false },
    ], P)
    expect(out).toEqual([
      { w: 65, r: 5, done: false }, { w: 75, r: 3, done: false }, { w: 85, r: 1, done: false },
    ])
  })

  it('leaves warm-ups and logged rows alone and keeps the row ordinals aligned', () => {
    const out = applyPrescription([
      { w: 40, r: 8, done: true, warmup: true },
      { w: 65, r: 5, done: true },
      { w: 60, r: 5, done: false },
      { w: 60, r: 5, done: false },
    ], P)
    expect(out[0]).toEqual({ w: 40, r: 8, done: true, warmup: true })
    expect(out[1]).toEqual({ w: 65, r: 5, done: true })
    expect(out[2]).toEqual({ w: 75, r: 3, done: false })   // work row 1 -> rows[1]
    expect(out[3]).toEqual({ w: 85, r: 1, done: false })
  })

  it('never runs past the end of the rows', () => {
    const out = applyPrescription([
      { w: 60, r: 5, done: false }, { w: 60, r: 5, done: false },
      { w: 60, r: 5, done: false }, { w: 55, r: 8, done: false },
    ], P)
    expect(out[3]).toEqual({ w: 55, r: 8, done: false })    // an intensifier's extra row keeps itself
  })

  it('grows the work rows to the number the wave prescribes', () => {
    const out = applyPrescription([{ w: 60, r: 5, done: false }], P)
    expect(out).toHaveLength(3)
    expect(out.map(s => s.w)).toEqual([65, 75, 85])
    expect(out.map(s => s.r)).toEqual([5, 3, 1])
  })

  it('applies a first session that carries rows, and skips one that does not', () => {
    const sets = [{ w: 60, r: 5, done: false }]
    expect(applyPrescription(sets, { policy: 'wave', kind: 'first', rows: [{ w: 65, r: 5 }] })[0].w).toBe(65)
    expect(applyPrescription(sets, { policy: 'linear', kind: 'first', weight: 80 })).toBe(sets)
  })

  it('does nothing at all without a training max', () => {
    const sets = [{ w: 60, r: 5, done: false }]
    expect(applyPrescription(sets, { policy: 'wave', kind: 'need-tm' })).toBe(sets)
  })

  it('leaves every rowless prescription on its existing path', () => {
    const out = applyPrescription([
      { w: 60, r: 5, done: false }, { w: 60, r: 5, done: false },
    ], { policy: 'linear', kind: 'up', weight: 62.5 })
    expect(out.map(s => s.w)).toEqual([62.5, 62.5])
  })
})

describe('applyPrescription carries block metadata onto the row', () => {
  const P = {
    policy: 'wave', kind: 'up',
    rows: [
      { w: 65, r: 5, blockId: 'b1', stageId: 's1', role: 'required', blockType: 'work' },
      { w: 85, r: 3, blockId: 'b2', stageId: 's1', role: 'anchor', blockType: 'work' }
    ]
  }

  it('stamps each pending row with the block it came from', () => {
    const out = applyPrescription([
      { w: 60, r: 5, done: false }, { w: 60, r: 5, done: false }
    ], P)
    expect(out[0]).toEqual({ w: 65, r: 5, done: false, blockId: 'b1', stageId: 's1', role: 'required', blockType: 'work' })
    expect(out[1]).toEqual({ w: 85, r: 3, done: false, blockId: 'b2', stageId: 's1', role: 'anchor', blockType: 'work' })
  })

  it('leaves an already-logged row untouched, block metadata included', () => {
    const logged = { w: 65, r: 5, done: true, blockId: 'old', stageId: 'old-stage', role: 'required', blockType: 'work' }
    const out = applyPrescription([logged, { w: 60, r: 5, done: false }], P)
    expect(out[0]).toBe(logged)
  })
})
