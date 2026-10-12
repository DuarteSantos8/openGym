// Back-off sets (lib/backoff.js): the top set is planned and progressed, every set after it is
// one step lighter, and the sequence only moves up when every planned set reached its target.
import { describe, it, expect } from 'vitest'
import { isBackoff, backoffAt, backoffWeights, applyBackoff } from './backoff.js'
import { buildSessionEntries } from './session-start.js'
import { readSession, nextPrescription } from './progression.js'
import { cascadeWeight } from './history.js'
import { isWarmupRow, makeSideSet } from './workout-model.js'

const LIFT = '0025'

describe('backoffAt / backoffWeights', () => {
  it('steps each set down by the step', () => {
    expect(backoffWeights(26, 3, 2)).toEqual([26, 24, 22])
    expect(backoffWeights(80, 4, 5)).toEqual([80, 75, 70, 65])
    expect(backoffWeights(60, 3, 2.5)).toEqual([60, 57.5, 55])
  })

  it('stays on the grid the top set is on, and steps from an off-grid top set as typed', () => {
    // one decimal, the way snapWeight and every stepper in the app show a 1.25 step
    expect(backoffWeights(62.5, 3, 1.25)).toEqual([62.5, 61.3, 60])
    expect(backoffWeights(27, 3, 2)).toEqual([27, 25, 23])        // a top set off the 2 kg grid
  })

  it('never goes below one step, and never above the top set', () => {
    expect(backoffWeights(6, 5, 2)).toEqual([6, 4, 2, 2, 2])
    expect(backoffAt(1, 3, 2)).toBe(1)
  })

  it('leaves a missing load alone', () => {
    expect(backoffAt(0, 2, 2)).toBe(0)
    expect(backoffAt(30, 2, 0)).toBe(30)
  })
})

describe('isBackoff', () => {
  it('is off unless switched on, so older plans build as before', () => {
    expect(isBackoff({ id: LIFT, sets: 3, reps: 6, weight: 26 })).toBe(false)
    expect(isBackoff({ id: LIFT, sets: 3, reps: 6, weight: 26, backoff: true })).toBe(true)
  })
  it('does not apply to a timed hold, a pyramid or a rest-pause', () => {
    expect(isBackoff({ mode: 'time', backoff: true })).toBe(false)
    expect(isBackoff({ backoff: true, pyramid: [12, 10, 8] })).toBe(false)
    expect(isBackoff({ backoff: true, intensifier: { type: 'restpause' } })).toBe(false)
    expect(isBackoff({ backoff: true, intensifier: { type: 'dropset', count: 1, pct: 20 } })).toBe(true)
  })
})

describe('applyBackoff', () => {
  it('steps the work rows from the first one and leaves warm-ups and logged rows alone', () => {
    const rows = [
      { w: 10, r: 6, phase: 'warmup', done: false },
      { w: 26, r: 6, done: false },
      { w: 26, r: 6, done: true },
      { w: 26, r: 6, done: false },
    ]
    expect(applyBackoff(rows, 2).map(r => r.w)).toEqual([10, 26, 26, 22])
  })
  it('steps both sides of a per-side row', () => {
    const rows = [makeSideSet({ w: 20, r: 12 }), makeSideSet({ w: 20, r: 12 })]
    const out = applyBackoff(rows, 2)
    expect(out[1].sides.L.w).toBe(18)
    expect(out[1].sides.R.w).toBe(18)
    expect(out[1].w).toBe(18)
  })
})

// The spec's main acceptance criterion, walked through the same builder the app uses: build a
// session, do it, save it, build the next one.
describe('a routine with back-off sets, session by session', () => {
  const cfg = { id: LIFT, sets: 3, reps: 6, weight: 26, inc: 2, backoff: true }
  const routine = { id: 'r', prog: 'linear', ex: [cfg] }
  const start = workouts => buildSessionEntries({ unit: 'kg', exWeights: {}, routines: [routine], workouts }, routine)[0]
  const work = entry => entry.sets.filter(s => !isWarmupRow(s))
  const weights = entry => work(entry).map(s => s.w)
  // Log the session: `reps` per planned set, at the weights on the screen unless `ws` overrides.
  const perform = (entry, reps, ws, extra = []) => ({
    ...entry,
    sets: [...work(entry).map((s, i) => ({ ...s, r: reps[i], w: ws ? ws[i] : s.w, done: true })), ...extra],
  })
  let day = 0
  const save = (workouts, entry) => [...workouts, { d: `2026-01-${String(++day).padStart(2, '0')}`, routineIds: ['r'], entries: [entry] }]

  it('opens at the plan with every set one step lighter', () => {
    const first = start([])
    expect(weights(first)).toEqual([26, 24, 22])
    expect(first.target.backoffStep).toBe(2)
    expect(work(first).every(s => s.r === 6)).toBe(true)
  })

  it('TEST 1: every planned set hit → the whole sequence goes up one step', () => {
    const hist = save([], perform(start([]), [6, 6, 6]))
    expect(weights(start(hist))).toEqual([28, 26, 24])
  })

  for (const [name, reps] of [['TEST 2: last back-off short', [6, 6, 5]], ['TEST 3: middle back-off short', [6, 5, 6]], ['TEST 4: top set short', [5, 6, 6]]]) {
    it(`${name} → the same sequence again`, () => {
      const hist = save([], perform(start([]), reps))
      const next = start(hist)
      expect(next.plan.kind).toBe('hold')
      expect(weights(next)).toEqual([26, 24, 22])
    })
  }

  it('TEST 5: an extra set on top does not count either way', () => {
    const hist = save([], perform(start([]), [6, 6, 6], null, [{ w: 18, r: 3, done: true }]))
    expect(weights(start(hist))).toEqual([28, 26, 24])
  })

  it('a back-off set taken lighter than planned is not the sequence done', () => {
    const lighter = perform(start([]), [6, 6, 6], [26, 24, 20])
    expect(readSession(lighter).ok).toBe(false)
    expect(weights(start(save([], lighter)))).toEqual([26, 24, 22])
    // heavier than planned is fine
    expect(readSession(perform(start([]), [6, 6, 6], [26, 25, 24])).ok).toBe(true)
  })

  it('TEST 7: a failed session retries, and the next clean one moves on', () => {
    let hist = save([], perform(start([]), [6, 6, 6]))             // 26/24/22 clean
    expect(weights(start(hist))).toEqual([28, 26, 24])
    hist = save(hist, perform(start(hist), [6, 6, 5]))             // 28/26/24, last one short
    expect(weights(start(hist))).toEqual([28, 26, 24])
    hist = save(hist, perform(start(hist), [6, 6, 6]))             // clean
    expect(weights(start(hist))).toEqual([30, 28, 26])
    hist = save(hist, perform(start(hist), [6, 6, 5]))             // 30 × 6, 28 × 6, 26 × 5
    expect(weights(start(hist))).toEqual([30, 28, 26])
  })

  it('repeated misses fall into the existing deload, and the back-off sets follow it down', () => {
    let hist = []
    for (let i = 0; i < 3; i++) hist = save(hist, perform(start(hist), [6, 6, 4]))
    const next = start(hist)
    expect(next.plan.kind).toBe('deload')
    const w = weights(next)
    expect(w[0]).toBeLessThan(26)
    expect(w).toEqual(backoffWeights(w[0], 3, 2))
  })

  it('uses the exercise step, whatever it is: a 5 kg lever machine', () => {
    const lever = { ...cfg, weight: 80, inc: 5 }
    const r = { ...routine, ex: [lever] }
    const first = buildSessionEntries({ unit: 'kg', exWeights: {}, routines: [r], workouts: [] }, r)[0]
    expect(weights(first)).toEqual([80, 75, 70])
  })

  it('warm-ups still ramp toward the top set', () => {
    const r = { ...routine, ex: [{ ...cfg, weight: 40, warmupSets: 2 }] }
    const entry = buildSessionEntries({ unit: 'kg', exWeights: {}, routines: [r], workouts: [] }, r)[0]
    const warm = entry.sets.filter(isWarmupRow).map(s => s.w)
    expect(warm.every(w => w < 40)).toBe(true)
    expect(weights(entry)).toEqual([40, 38, 36])
  })

  it('works under double progression too: the top set moves when every set reaches the top of the range', () => {
    const dbl = { ...cfg, prog: 'double', reps: 8, repsMin: 6 }
    const r = { ...routine, ex: [dbl] }
    const st = workouts => ({ unit: 'kg', exWeights: {}, routines: [r], workouts })
    const go = workouts => buildSessionEntries(st(workouts), r)[0]
    let hist = save([], perform(go([]), [7, 7, 6]))
    expect(weights(go(hist))).toEqual([26, 24, 22])
    hist = save(hist, perform(go(hist), [8, 8, 8]))
    const up = go(hist)
    expect(weights(up)).toEqual([28, 26, 24])
    expect(work(up).every(s => s.r === 6)).toBe(true)
  })
})

describe('TEST 8: nothing changes without the switch', () => {
  it('a plan without back-off opens every set at the same weight and stamps no step', () => {
    const cfg = { id: LIFT, sets: 3, reps: 6, weight: 26, inc: 2 }
    const r = { id: 'r', prog: 'linear', ex: [cfg] }
    const entry = buildSessionEntries({ unit: 'kg', exWeights: {}, routines: [r], workouts: [] }, r)[0]
    expect(entry.sets.map(s => s.w)).toEqual([26, 26, 26])
    expect(entry.target.backoffStep).toBeUndefined()
  })
  it('a session without a stamped step reads exactly as before, lighter sets and all', () => {
    const entry = { id: LIFT, target: { sets: 3, reps: 6, weight: 26 }, sets: [26, 24, 20].map(w => ({ w, r: 6, done: true })) }
    expect(readSession(entry).ok).toBe(true)
  })
  it('an assistance machine is left out, where lighter is harder', () => {
    const r = { id: 'r', prog: 'linear', ex: [{ id: LIFT, assisted: true, sets: 3, reps: 6, weight: 30, inc: 5, backoff: true }] }
    const entry = buildSessionEntries({ unit: 'kg', exWeights: {}, routines: [r], workouts: [] }, r)[0]
    expect(entry.sets.map(s => s.w)).toEqual([30, 30, 30])
  })
})

describe('editing a weight mid-session', () => {
  const rows = () => [{ w: 26, r: 6, done: false }, { w: 24, r: 6, done: false }, { w: 22, r: 6, done: false }]
  it('carries a top-set change down the sequence', () => {
    expect(cascadeWeight(rows(), 0, 28, undefined, 2).map(r => r.w)).toEqual([26, 26, 24])
  })
  it('from a back-off set, steps down from there', () => {
    expect(cascadeWeight(rows(), 1, 20, undefined, 2).map(r => r.w)).toEqual([26, 24, 18])
  })
  it('keeps the old flat cascade when the session has no back-off', () => {
    expect(cascadeWeight(rows(), 0, 28).map(r => r.w)).toEqual([26, 28, 28])
  })
  it('a logged set in between keeps its place in the sequence', () => {
    const r = rows(); r[1] = { ...r[1], done: true }
    expect(cascadeWeight(r, 0, 30, undefined, 2).map(x => x.w)).toEqual([26, 24, 26])
  })
})

describe('nextPrescription with back-off', () => {
  it('decides only the top set; the rows derive the rest', () => {
    const cfg = { id: LIFT, sets: 3, reps: 6, weight: 26, inc: 2, backoff: true, prog: 'linear' }
    const S = { unit: 'kg', workouts: [{ d: '2026-01-01', entries: [{ id: LIFT, target: { ...cfg, backoffStep: 2 }, sets: [26, 24, 22].map(w => ({ w, r: 6, done: true })) }] }] }
    const p = nextPrescription(S, cfg)
    expect(p.kind).toBe('up')
    expect(p.weight).toBe(28)
  })
})
