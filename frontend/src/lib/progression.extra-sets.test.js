// Issue #233: a set logged on top of the plan is extra work, not part of the prescription.
// Before this, one heavier bonus set pulled the next session's weight up with it, and a bonus
// set taken short of the target reps reported the whole session as missed.
import { describe, it, expect } from 'vitest'
import { nextPrescription, readSession } from './progression.js'

const set = (w, r, done = true) => ({ w, r, done })
const entry = (target, sets) => ({ id: '0025', target, sets })
const plan = { mode: 'reps', sets: 3, reps: 8, weight: 60 }

describe('extra sets stay out of the progression read', () => {
  it('ignores a heavier bonus set when reading the weight', () => {
    const done = readSession(entry(plan, [set(60, 8), set(60, 8), set(60, 8), set(80, 8)]))
    expect(done.weight).toBe(60)
    expect(done.ok).toBe(true)
  })

  it('does not call the session missed because a bonus set fell short', () => {
    const done = readSession(entry(plan, [set(60, 8), set(60, 8), set(60, 8), set(80, 3)]))
    expect(done.ok).toBe(true)
    expect(done.low).toBe(8)
    expect(done.count).toBe(3)
    // Greyskull reads the last set of the plan, not whatever was tacked on after it
    expect(done.amrap).toBe(8)
  })

  it('still reports a short session as short, and still reads every planned set', () => {
    const short = readSession(entry(plan, [set(60, 8), set(60, 5), set(60, 8)]))
    expect(short.ok).toBe(false)
    expect(short.low).toBe(5)
    const missing = readSession(entry(plan, [set(60, 8), set(60, 8)]))
    expect(missing.ok).toBe(false)
  })

  it('reads everything when the plan names no set count (freestyle)', () => {
    const free = readSession(entry({ mode: 'reps', reps: 8 }, [set(60, 8), set(80, 8)]))
    expect(free.weight).toBe(80)
    expect(free.count).toBe(2)
  })

  it('leaves warm-ups out before counting, so a warm-up does not eat a planned slot', () => {
    const warm = readSession(entry(plan, [{ w: 20, r: 10, done: true, phase: 'warmup' }, set(60, 8), set(60, 8), set(60, 8), set(90, 8)]))
    expect(warm.weight).toBe(60)
    expect(warm.ok).toBe(true)
  })

  it('applies the same rule to a timed hold', () => {
    const timed = { mode: 'time', sets: 2, sec: 30, weight: 0 }
    const held = readSession(entry(timed, [{ sec: 30, done: true }, { sec: 30, done: true }, { sec: 12, done: true }]))
    expect(held.ok).toBe(true)
    expect(held.best).toBe(30)
  })
})

// The slice has to see a plan the session itself carried. A Hevy or CSV import, and anything
// logged before v1.2.2, carries no target, and readSession then falls back to the exercise's
// config as it stands TODAY: a session worked up to 80 was graded on its first three rows,
// 40/50/60, and the next prescription started again from the ramp.
describe('a session with no plan of its own is read whole', () => {
  const ramp = () => ({ id: '0025', sets: [set(40, 5), set(50, 5), set(60, 5), set(70, 5), set(80, 5)] })

  it("grades an imported session on all of its sets, not on today's set count", () => {
    const s = readSession(ramp(), plan)               // the 3-set config the routine asks for now
    expect(s.weight).toBe(80)
    expect(s.count).toBe(5)
    // and a session that DID carry its own plan is still sliced by it
    expect(readSession({ ...ramp(), target: { ...plan, reps: 5 } }, plan).weight).toBe(60)
  })

  it('so the first prescription after an import starts from the top set, not the third', () => {
    const cfg = { id: '0025', mode: 'reps', sets: 3, reps: 5, weight: 60, prog: 'linear' }
    const S = { unit: 'kg', workouts: [{ id: 'hevy-1', d: '2026-09-01', entries: [ramp()] }] }
    const p = nextPrescription(S, cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(82.5)
  })
})
