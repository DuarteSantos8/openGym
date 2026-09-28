import { describe, it, expect } from 'vitest'
import {
  readSession, sessionsFor, stallCount, nextPrescription, applyPrescription, plannedOf, planChanged,
  policyFor, defaultIncrement, weightIncrement, epley1RM, deloadTarget1RM,
  deloadFactorOf, DELOAD_FACTOR, POLICIES_FOR, DELOAD_AFTER, MAX_BW_SETS
} from './progression.js'
import { entryExcluded } from './history.js'
import { EXDB, isAssisted } from './exercises.js'

// A plainly loaded lift: more weight is harder. The first match used to be `assisted chest dip`,
// whose stack takes weight off you and which therefore progresses downwards (issue #232) — these
// tests are about the ordinary direction, so the assistance machines are excluded by name here.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
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

// The same history with the plan each session was built from stamped on its entries, the way
// a session started since #275 saves them.
const stamped = (st, planned) => ({ ...st, workouts: st.workouts.map(w => ({ ...w, entries: w.entries.map(e => ({ ...e, planned })) })) })

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

  it('reads all of a per-side timed hold\'s doubled rows, not just the first pair', () => {
    const T = { sets: 2, sec: 30, mode: 'time', side: true }
    // 2 planned sets, per side, is 4 real rows (buildSets) — every one of them has to be read,
    // or a miss on the second pair goes unnoticed and progression bumps the hold anyway.
    const allHeld = readSession({ id: LIFT, target: T, sets: [
      { sec: 30, done: true, side: 'L' }, { sec: 30, done: true, side: 'R' },
      { sec: 30, done: true, side: 'L' }, { sec: 30, done: true, side: 'R' },
    ] })
    expect(allHeld.ok).toBe(true)
    const secondPairShort = readSession({ id: LIFT, target: T, sets: [
      { sec: 30, done: true, side: 'L' }, { sec: 30, done: true, side: 'R' },
      { sec: 15, done: true, side: 'L' }, { sec: 30, done: true, side: 'R' },
    ] })
    expect(secondPairShort.ok).toBe(false)
    // Fewer logged rows than the doubled count is short, same as any other mode.
    expect(readSession({ id: LIFT, target: T, sets: [
      { sec: 30, done: true, side: 'L' }, { sec: 30, done: true, side: 'R' },
    ] }).ok).toBe(false)
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
  const cfg = { id: LIFT, sets: 3, reps: 10, weight: 0, prog: 'linear', bodyweight: true }
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

  it('keeps a set the ceiling added: the next clean session climbs reps at the new count (issue #33)', () => {
    const grown = stamped(hist(LIFT, [[0, 10, 10, 10, 10]], { sets: 4, reps: 10 }), plannedOf(cfg))
    const p = nextPrescription(grown, { ...cfg, repsMax: 15 })
    expect(p).toMatchObject({ kind: 'up', reps: 11, sets: 4 })
    // and a miss holds that count too
    const missed = stamped(hist(LIFT, [[0, 10, 10, 10, 8]], { sets: 4, reps: 10 }), plannedOf(cfg))
    expect(nextPrescription(missed, { ...cfg, repsMax: 15 })).toMatchObject({ kind: 'hold', reps: 10, sets: 4 })
  })

  // A session saved before plans were stamped cannot say which plan its set count grew from: a
  // routine cut from 4 sets to 3 before the upgrade would otherwise open at 4 for good, since
  // every session after re-stamps that 4 against an unchanged plan of 3.
  it('opens at the plan\'s set count after an older session with more sets', () => {
    const legacy = hist(LIFT, [[0, 10, 10, 10, 10]], { sets: 4, reps: 10 })
    const clean = nextPrescription(legacy, { ...cfg, repsMax: 15 })
    expect(clean).toMatchObject({ kind: 'up', reps: 11 })
    expect(clean.sets).toBeUndefined()
    const missed = nextPrescription(hist(LIFT, [[0, 10, 10, 10, 8]], { sets: 4, reps: 10 }), { ...cfg, repsMax: 15 })
    expect(missed).toMatchObject({ kind: 'hold', reps: 10 })
    expect(missed.sets).toBeUndefined()
  })

  it('still adds load the moment the exercise is actually weighted', () => {
    const p = nextPrescription(hist(LIFT, [[10, 10, 10, 10]], { sets: 3, reps: 10 }), cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(12.5)
  })
})

// A quick-added exercise starts at 0 kg, and a bench press ticked off without typing a weight
// is logged at 0. That is a missing number, not a push-up: it must not climb reps.
describe('a loaded lift logged at 0 kg', () => {
  const BENCH = '0025'   // barbell bench press
  const zero = hist(BENCH, [[0, 10, 10, 10]], { sets: 3, reps: 10 })

  it('holds and asks for the weight instead of climbing reps', () => {
    const p = nextPrescription(zero, { id: BENCH, sets: 3, reps: 10, weight: 0, prog: 'linear' })
    expect(p.kind).toBe('hold')
    expect(p.reps).toBeUndefined()
    expect(p.weight).toBeUndefined()
    expect(p.why[0]).toMatch(/No weight logged/)
  })

  it('falls back to the plan\'s weight when the routine has one', () => {
    expect(nextPrescription(zero, { id: BENCH, sets: 3, reps: 10, weight: 60, prog: 'double' })).toMatchObject({ kind: 'hold', weight: 60 })
  })

  // Only a bar, a bell, a stack or a sled has a load nobody typed in. An ab wheel, a stability
  // ball, a bosu or the straps of an assisted knee raise are logged at 0 because there is no
  // load to enter, and they climb reps the way a push-up does — they always have.
  const noLoad = { '0857': 'wheel rollerout', '0271': 'crunch on a stability ball', '0653': 'push-up on a bosu ball', '0011': 'assisted hanging knee raise' }
  for (const [id, name] of Object.entries(noLoad)) {
    it(`climbs reps on a ${name}, which has nothing to load`, () => {
      const cfg = { id, sets: 3, reps: 10, weight: 0 }
      const twice = stamped(hist(id, [[0, 10, 10, 10], [0, 10, 10, 10]], { sets: 3, reps: 10 }), plannedOf(cfg))
      expect(nextPrescription(twice, cfg)).toMatchObject({ kind: 'up', weight: 0, reps: 11 })
    })
  }
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

  it('does not raise the weight for a session that only matched its own recorded target, short of the top of the range (issue #278)', () => {
    // The very first logged session for a fresh double-progression exercise gets its target
    // seeded at the bottom of the range (8 here), not the top (12). Hitting exactly that many
    // reps in every set is compliance with the plan, not "reached the top of the range" - so
    // it must not be graded as a hit that earns more weight.
    const target = { sets: 3, reps: 8, weight: 40 }
    const p = nextPrescription(hist(LIFT, [[40, 8, 8, 8]], target), cfg)
    expect(p.kind).not.toBe('up')
    expect(p.weight).toBe(40)
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

// Issue #216: a heavy day and a light day of the same lift progress on their own lines. The
// routine's own sessions decide; a routine without any reads the exercise's whole history.
describe('routine slots (#216)', () => {
  const entry = (rid, w, r, extra = {}) => ({ id: LIFT, rid, target: { sets: 2, reps: r, weight: w }, sets: [{ w, r, done: true }, { w, r, done: true }], ...extra })
  const S = {
    unit: 'kg',
    workouts: [
      { d: '2026-03-01', routineIds: ['heavy'], entries: [entry('heavy', 60, 10)] },
      { d: '2026-03-03', routineIds: ['light'], entries: [entry('light', 40, 15)] },
    ],
  }
  const heavy = { id: 'heavy', prog: 'linear', ex: [] }
  const light = { id: 'light', prog: 'linear', ex: [] }

  it('reads only the routine\'s own sessions, each marked with its routine', () => {
    expect(sessionsFor(S, LIFT, null, 'heavy').map(s => [s.d, s.rid, s.weight])).toEqual([['2026-03-01', 'heavy', 60]])
    expect(sessionsFor(S, LIFT, null, 'light').map(s => [s.d, s.rid, s.weight])).toEqual([['2026-03-03', 'light', 40]])
    expect(sessionsFor(S, LIFT)).toHaveLength(2)
  })

  it('progresses each routine from its own last session', () => {
    expect(nextPrescription(S, { id: LIFT, sets: 2, reps: 10, weight: 60 }, heavy).weight).toBe(62.5)
    expect(nextPrescription(S, { id: LIFT, sets: 2, reps: 15, weight: 40 }, light).weight).toBe(42.5)
  })

  it('falls back to the exercise\'s history for a routine that never trained it', () => {
    expect(sessionsFor(S, LIFT, null, 'new').map(s => s.rid)).toEqual(['heavy', 'light'])
  })

  it('reads a combined day by the routine\'s own entry, not the first one', () => {
    const combined = { unit: 'kg', workouts: [{ d: '2026-03-05', routineIds: ['heavy', 'light'], entries: [entry('heavy', 60, 10), entry('light', 40, 15)] }] }
    expect(sessionsFor(combined, LIFT, null, 'light').map(s => s.weight)).toEqual([40])
    expect(nextPrescription(combined, { id: LIFT, sets: 2, reps: 15, weight: 40 }, light).weight).toBe(42.5)
  })

  it('does not let a stall on one routine deload the other', () => {
    const miss = (d, rid, w) => ({ d, routineIds: [rid], entries: [{ id: LIFT, rid, target: { sets: 2, reps: 10, weight: w }, sets: [{ w, r: 6, done: true }, { w, r: 6, done: true }] }] })
    const st = { unit: 'kg', workouts: [miss('2026-03-01', 'heavy', 60), S.workouts[1], miss('2026-03-05', 'heavy', 60), miss('2026-03-07', 'heavy', 60)] }
    expect(nextPrescription(st, { id: LIFT, sets: 2, reps: 10, weight: 60 }, heavy).kind).toBe('deload')
    expect(nextPrescription(st, { id: LIFT, sets: 2, reps: 15, weight: 40 }, light).kind).toBe('up')
  })

  it('reads a session saved before per-entry routine ids by the workout\'s routine', () => {
    const legacy = { unit: 'kg', workouts: [{ d: '2026-03-01', routineId: 'heavy', entries: [{ id: LIFT, target: { sets: 2, reps: 10, weight: 60 }, sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: true }] }] }] }
    expect(sessionsFor(legacy, LIFT, null, 'heavy').map(s => s.rid)).toEqual(['heavy'])
  })
})

// Issue #275: every session entry carries the plan it was built from (`planned`). When the
// routine's sets or reps have changed since, or the last session is borrowed from another
// routine with another plan, the next session starts again from the plan — the old target
// cannot say where the new one stands.
describe('an edited plan restarts progression (#275)', () => {
  const PUSH = EXDB.find(e => e.eq === 'body weight' && e.bp !== 'cardio').id
  const logged = (id, planned, target, w, reps, extra = {}) => ({
    d: '2026-04-01', routineIds: ['r'],
    entries: [{ id, planned, target, sets: reps.map(r => ({ w, r, done: true })), ...extra }],
  })
  const R = { id: 'r', ex: [] }

  it('stamps only what the routine asks for, and tells an edit from a progression', () => {
    expect(plannedOf({ id: LIFT, sets: 2, reps: 10, weight: 60, prog: 'linear', note: 'x' })).toEqual({ sets: 2, reps: 10, weight: 60 })
    expect(plannedOf({ id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 40 })).toEqual({ sets: 3, reps: 12, repsMin: 8, weight: 40 })
    expect(plannedOf({ id: LIFT, mode: 'time', sets: 2, sec: 45, weight: 0 })).toEqual({ sets: 2, sec: 45, weight: 0 })
    const planned = plannedOf({ id: LIFT, sets: 2, reps: 10, weight: 60 })
    expect(planChanged(planned, { id: LIFT, sets: 2, reps: 10, weight: 80 })).toBe(false)   // weight: history's call
    expect(planChanged(planned, { id: LIFT, sets: 2, reps: 12, weight: 60 })).toBe(true)
    expect(planChanged(planned, { id: LIFT, sets: 3, reps: 10, weight: 60 })).toBe(true)
    expect(planChanged(planned, { id: LIFT, sets: 2, reps: 12, repsMin: 10, weight: 60 })).toBe(true)
    expect(planChanged(undefined, { id: LIFT, sets: 2, reps: 12 })).toBe(false)
  })

  it('holds the weight at the new sets × reps when a loaded lift\'s plan was edited', () => {
    const S = { unit: 'kg', workouts: [logged(LIFT, { sets: 2, reps: 15, weight: 40 }, { sets: 2, reps: 15, weight: 40 }, 40, [15, 15])] }
    const p = nextPrescription(S, { id: LIFT, sets: 2, reps: 10, weight: 40, prog: 'linear' }, R)
    expect(p).toMatchObject({ kind: 'hold', weight: 40, reps: 10 })
    expect(p.why[0]).toBe('Plan changed — starting from your new target.')
    // The same session under an unchanged plan progresses as usual.
    expect(nextPrescription(S, { id: LIFT, sets: 2, reps: 15, weight: 40, prog: 'linear' }, R)).toMatchObject({ kind: 'up', weight: 42.5 })
  })

  // The weight is history's call — unless the same edit that changed the sets or reps changed the
  // plan's weight too. 102.5 × 10 after 3 × 5 @ 100 was rewritten as 3 × 10 @ 70 is a load never
  // lifted for those reps, and "starting from your new target" would not be true of it.
  it('opens at the plan\'s new weight when the edit changed it along with the reps', () => {
    const five = logged(LIFT, { sets: 3, reps: 5, weight: 100 }, { sets: 3, reps: 5, weight: 102.5 }, 102.5, [5, 5, 5])
    const S = { unit: 'kg', workouts: [five] }
    const p = nextPrescription(S, { id: LIFT, sets: 3, reps: 10, weight: 70, prog: 'linear' }, R)
    expect(p).toMatchObject({ kind: 'hold', weight: 70, reps: 10 })
    expect(p.why[0]).toBe('Plan changed — starting from your new target.')
    // Only the reps edited, the weight the routine was created with left alone: what was lifted.
    expect(nextPrescription(S, { id: LIFT, sets: 3, reps: 10, weight: 100, prog: 'linear' }, R)).toMatchObject({ kind: 'hold', weight: 102.5, reps: 10 })
    // A weight edit alone restarts nothing: the sets and reps are the plan's, the history moves on.
    expect(nextPrescription(S, { id: LIFT, sets: 3, reps: 5, weight: 70, prog: 'linear' }, R)).toMatchObject({ kind: 'up', weight: 105 })
  })

  it('starts a new weight at the bottom of a double-progression range', () => {
    const twelve = logged(LIFT, { sets: 3, reps: 12, weight: 40 }, { sets: 3, reps: 12, weight: 40 }, 40, [12, 12, 12])
    const p = nextPrescription({ unit: 'kg', workouts: [twelve] }, { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 60, prog: 'double' }, R)
    expect(p).toMatchObject({ kind: 'hold', weight: 60, reps: 8 })
  })

  it('restarts a bodyweight goal from the new reps instead of climbing from the old ones', () => {
    const S = { unit: 'kg', workouts: [logged(PUSH, { sets: 2, reps: 15, weight: 0 }, { sets: 2, reps: 15, weight: 0 }, 0, [15, 15])] }
    const p = nextPrescription(S, { id: PUSH, sets: 2, reps: 10, weight: 0, bodyweight: true }, R)
    expect(p).toMatchObject({ kind: 'hold', weight: 0, reps: 10 })
  })

  it('does not deload toward the old target after three misses and an edit', () => {
    const miss = { d: '2026-04-01', routineIds: ['r'], entries: [{ id: LIFT, planned: { sets: 3, reps: 15, weight: 50 }, target: { sets: 3, reps: 15, weight: 50 }, sets: [12, 12, 12].map(r => ({ w: 50, r, done: true })) }] }
    const S = { unit: 'kg', workouts: [miss, miss, miss] }
    expect(nextPrescription(S, { id: LIFT, sets: 3, reps: 15, weight: 50, prog: 'linear' }, R).kind).toBe('deload')
    const p = nextPrescription(S, { id: LIFT, sets: 2, reps: 10, weight: 50, prog: 'linear' }, R)
    expect(p).toMatchObject({ kind: 'hold', weight: 50, reps: 10 })
    expect(p.sets).toBeUndefined()
  })

  it('ends a stall streak at the edit — misses against the old plan do not count', () => {
    const at = (planned, reps) => ({ d: '2026-04-01', routineIds: ['r'], entries: [{ id: LIFT, planned, target: { ...planned }, sets: reps.map(r => ({ w: 50, r, done: true })) }] })
    const old = { sets: 3, reps: 15, weight: 50 }
    const now = { sets: 3, reps: 10, weight: 50 }
    const S = { unit: 'kg', workouts: [at(old, [12, 12, 12]), at(old, [12, 12, 12]), at(now, [9, 9, 9])] }
    expect(stallCount(sessionsFor(S, LIFT, null, 'r'))).toBe(1)
    expect(nextPrescription(S, { id: LIFT, ...now, prog: 'linear' }, R).kind).toBe('hold')
  })

  it('aims inside the new range under double progression, from what you managed', () => {
    // History at 3 × 8 under linear, then the exercise switched to double 8–12 (the #278 path):
    // a restart at the same weight, aiming one rep up — not a raise off a bottom stamped as hit.
    const S = { unit: 'kg', workouts: [logged(LIFT, { sets: 3, reps: 8, weight: 36 }, { sets: 3, reps: 8, weight: 36 }, 36, [8, 8, 8])] }
    const p = nextPrescription(S, { id: LIFT, sets: 3, reps: 12, repsMin: 8, weight: 36, prog: 'double' }, R)
    expect(p).toMatchObject({ kind: 'hold', weight: 36, reps: 9 })
  })

  it('restarts a timed hold at its new duration', () => {
    const S = { unit: 'kg', workouts: [logged(LIFT, { sets: 2, sec: 60, weight: 0 }, { mode: 'time', sets: 2, sec: 60 }, 0, [], { sets: [{ sec: 60, done: true }, { sec: 60, done: true }] })] }
    const p = nextPrescription(S, { id: LIFT, mode: 'time', sets: 2, sec: 30, weight: 0, prog: 'time' }, R)
    expect(p).toMatchObject({ kind: 'hold', sec: 30 })
  })

  it('starts a routine from its own target when the only history is another routine\'s', () => {
    const B = { d: '2026-04-01', routineIds: ['b'], entries: [{ id: PUSH, rid: 'b', planned: { sets: 2, reps: 15, weight: 0 }, target: { sets: 2, reps: 15, weight: 0 }, sets: [{ w: 0, r: 15, done: true }, { w: 0, r: 15, done: true }] }] }
    const p = nextPrescription({ unit: 'kg', workouts: [B] }, { id: PUSH, sets: 2, reps: 10, weight: 0, bodyweight: true }, { id: 'a', ex: [] })
    expect(p).toMatchObject({ kind: 'hold', reps: 10 })
    expect(p.why[0]).toBe('First time in this routine — starting from its own target.')
  })

  // A heavy day and a light day of the same lift (#216): the heavy day's first session opens at
  // its own weight, not at the light day's.
  it('starts a routine at its own weight when the routine it borrows from planned another', () => {
    const B = { d: '2026-04-01', routineIds: ['b'], entries: [{ id: LIFT, rid: 'b', planned: { sets: 2, reps: 15, weight: 40 }, target: { sets: 2, reps: 15, weight: 40 }, sets: [{ w: 40, r: 15, done: true }, { w: 40, r: 15, done: true }] }] }
    const p = nextPrescription({ unit: 'kg', workouts: [B] }, { id: LIFT, sets: 2, reps: 10, weight: 60, prog: 'linear' }, { id: 'a', ex: [] })
    expect(p).toMatchObject({ kind: 'hold', weight: 60, reps: 10 })
    expect(p.why[0]).toBe('First time in this routine — starting from its own target.')
  })

  it('opens a loaded lift logged at 0 kg at the plan\'s weight when the plan changed', () => {
    const BENCH = '0025'   // barbell bench press: a load nobody typed in, not a bodyweight set
    const S = { unit: 'kg', workouts: [logged(BENCH, { sets: 2, reps: 15, weight: 0 }, { sets: 2, reps: 15, weight: 0 }, 0, [15, 15])] }
    expect(nextPrescription(S, { id: BENCH, sets: 2, reps: 10, weight: 50, prog: 'linear' }, R)).toMatchObject({ kind: 'hold', weight: 50, reps: 10 })
  })

  it('continues another routine\'s progression when its plan is the same one (a copied routine)', () => {
    const B = { d: '2026-04-01', routineIds: ['b'], entries: [{ id: LIFT, rid: 'b', planned: { sets: 2, reps: 10, weight: 60 }, target: { sets: 2, reps: 10, weight: 60 }, sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: true }] }] }
    expect(nextPrescription({ unit: 'kg', workouts: [B] }, { id: LIFT, sets: 2, reps: 10, weight: 60, prog: 'linear' }, { id: 'copy', ex: [] }))
      .toMatchObject({ kind: 'up', weight: 62.5 })
  })

  it('leaves history saved before plans were stamped to progress as it always did', () => {
    const S = { unit: 'kg', workouts: [{ d: '2026-04-01', routineIds: ['r'], entries: [{ id: LIFT, target: { sets: 2, reps: 15, weight: 40 }, sets: [{ w: 40, r: 15, done: true }, { w: 40, r: 15, done: true }] }] }] }
    expect(nextPrescription(S, { id: LIFT, sets: 2, reps: 10, weight: 40, prog: 'linear' }, R)).toMatchObject({ kind: 'up', weight: 42.5 })
  })

  it('aims an Epley deload at the plan\'s set count even for history saved before plans were stamped', () => {
    const miss = { d: '2026-04-01', routineIds: ['r'], entries: [{ id: LIFT, target: { sets: 3, reps: 8, weight: 60 }, sets: [6, 6, 6].map(r => ({ w: 60, r, done: true })) }] }
    const p = nextPrescription({ unit: 'kg', workouts: [miss, miss, miss] }, { id: LIFT, sets: 2, reps: 8, weight: 60, prog: 'linear' }, R)
    expect(p.kind).toBe('deload')
    expect(p.sets).toBe(2)
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

  it('an open warm-up follows the reps or the hold the policy settled on, never a done one', () => {
    // insertWarmupRow copies the work row's reps before the prescription is applied, so without
    // this a bodyweight climb or a double-progression aim left the warm-up at the old number.
    const reps = applyPrescription([
      { w: 20, r: 8, done: true, warmup: true },
      { w: 0, r: 10, done: false, phase: 'warmup' },
      { w: 0, r: 10, done: false },
    ], { kind: 'up', weight: 0, reps: 12 })
    expect(reps.map(s => s.r)).toEqual([8, 12, 12])
    const held = applyPrescription([{ sec: 30, w: 0, done: false, phase: 'warmup' }, { sec: 30, w: 0, done: false }], { kind: 'up', sec: 35 })
    expect(held.map(s => s.sec)).toEqual([35, 35])
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
