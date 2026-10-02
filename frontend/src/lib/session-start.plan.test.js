// A routine saved as "2 × 10" has to open as 2 × 10 (Discord report, #275). Every scenario starts
// the session the way beginWorkout does (buildCombinedEntries → buildSessionEntries) and logs it
// the way the finish path does (buildCompletedWorkout), so the history each one reads has the
// exact shape the app saves — `target`, `rid` and all.
import { describe, it, expect } from 'vitest'
import { buildCombinedEntries } from './session-merge.js'
import { buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { POLICIES } from './progression.js'
import { isWarmupRow } from './workout-model.js'

const BENCH = '0025'   // barbell bench press — loaded, 2.5 kg step
const work = e => e.sets.filter(s => !isWarmupRow(s))
const reps = e => work(e).map(s => s.r)
const clone = v => JSON.parse(JSON.stringify(v))
const state = (routines, extra = {}) => ({ unit: 'kg', exWeights: {}, routines: clone(routines), workouts: [], week: {}, dayPlan: {}, ...extra })
const cfgOf = (st, rid, exId = BENCH) => st.routines.find(r => r.id === rid).ex.find(c => c.id === exId)
const start = (st, rids) => buildCombinedEntries(st, rids).entries

// Train the given routines: start them for real, optionally type something else into the work
// rows (`typed`: an object, or a function of the row index), tick everything and finish.
let day = 1
function train(st, rids, typed) {
  const entries = start(st, rids).map(e => {
    let i = -1
    return { ...e, sets: e.sets.map(s => {
      if (isWarmupRow(s)) return { ...s, done: true }
      i++
      return { ...s, ...(typeof typed === 'function' ? typed(i) : typed || {}), done: true }
    }) }
  })
  const d = `2026-08-${String(day).padStart(2, '0')}`
  const active = { id: 'w' + day, d, start: day * 1000, routineIds: rids, name: 'x', entries }
  day++
  st.workouts.push(buildCompletedWorkout(active, { end: active.start + 1 }))
}

describe('a planned session opens at the plan\'s reps', () => {
  it('when the same exercise was trained at 15 in another routine', () => {
    const st = state([
      { id: 'A', name: 'Plan A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 60 }] },
      { id: 'B', name: 'Plan B', ex: [{ id: BENCH, sets: 2, reps: 15, weight: 40 }] },
    ])
    train(st, ['B'])
    const [a] = start(st, ['A'])
    expect(work(a)).toHaveLength(2)
    expect(reps(a)).toEqual([10, 10])
    expect(a.target.reps).toBe(10)
    // A has no session of its own, so it starts from its own sets × reps (#216), and says so. Its
    // plan asks 60 where B's asked 40 — a heavy day and a light day — so it opens at its own 60,
    // not at the light day's load.
    expect(work(a).map(s => s.w)).toEqual([60, 60])
    expect(a.plan.why[0]).toBe('First time in this routine — starting from its own target.')
    // From then on A progresses on its own line, whatever B does.
    train(st, ['A'])
    train(st, ['B'], { r: 9 })
    const [again] = start(st, ['A'])
    expect(work(again).map(s => [s.w, s.r])).toEqual([[62.5, 10], [62.5, 10]])
  })

  it('from the exercise\'s last weight when the other routine planned the same one', () => {
    const st = state([
      { id: 'A', name: 'Plan A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 40 }] },
      { id: 'B', name: 'Plan B', ex: [{ id: BENCH, sets: 2, reps: 15, weight: 40 }] },
    ])
    train(st, ['B'])
    train(st, ['B'])
    const [a] = start(st, ['A'])
    expect(work(a).map(s => [s.w, s.r])).toEqual([[42.5, 10], [42.5, 10]])
  })

  for (const prog of [undefined, 'linear', 'greyskull', 'off']) {
    it(`after the routine was edited from 15 to 10 · policy ${prog || '(default)'}`, () => {
      const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 15, weight: 50, ...(prog ? { prog } : {}) }] }])
      train(st, ['A'])
      train(st, ['A'])
      cfgOf(st, 'A').reps = 10
      const [e] = start(st, ['A'])
      expect(reps(e)).toEqual([10, 10])
      expect(e.target.reps).toBe(10)
    })
  }

  it('after one session logged at 15 on a 10 target — it does not stick', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50 }] }])
    expect(reps(start(st, ['A'])[0])).toEqual([10, 10])
    train(st, ['A'], { r: 15 })
    const [next] = start(st, ['A'])
    expect(reps(next)).toEqual([10, 10])
    expect(next.plan.kind).toBe('up')          // the weight still moves: 15 ≥ 10 was a hit
    expect(work(next).map(s => s.w)).toEqual([52.5, 52.5])
    train(st, ['A'])
    expect(reps(start(st, ['A'])[0])).toEqual([10, 10])
  })

  it('under Greyskull, whose AMRAP set carried its own count before', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50, prog: 'greyskull' }] }])
    train(st, ['A'], i => (i === 1 ? { r: 15 } : {}))
    const [e] = start(st, ['A'])
    expect(e.plan.reps).toBeUndefined()
    expect(reps(e)).toEqual([10, 10])
  })

  it('with planned warm-ups, which follow the plan\'s reps too', () => {
    const st = state([
      { id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 60, warmupSets: 1 }] },
      { id: 'B', name: 'B', ex: [{ id: BENCH, sets: 2, reps: 15, weight: 40 }] },
    ])
    train(st, ['B'])
    const [e] = start(st, ['A'])
    expect(e.sets.filter(isWarmupRow).map(s => s.r)).toEqual([10])
  })

  it('on a combined day that holds the exercise twice, each block at its own plan', () => {
    const st = state([
      { id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 60 }] },
      { id: 'B', name: 'B', ex: [{ id: BENCH, sets: 2, reps: 15, weight: 40 }] },
    ])
    train(st, ['B'])
    const [a, b] = start(st, ['A', 'B'])
    expect(reps(a)).toEqual([10, 10])
    expect(reps(b)).toEqual([15, 15])
  })

  it('for a new routine\'s default policy, with a legacy session logged at 15', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50, mode: 'reps' }] }])
    st.workouts.push({ id: 'p', d: '2026-09-01', entries: [{ id: BENCH, target: { sets: 2, reps: 10, weight: 50 }, sets: [{ w: 50, r: 15, done: true }, { w: 50, r: 15, done: true }] }] })
    const [e] = buildSessionEntries(st, st.routines[0])
    expect(e.plan.policy).toBe('linear')
    expect(reps(e)).toEqual([10, 10])
  })

  // Whatever the earlier session's target — the routine said 15 then, the user typed 15 over a
  // 10, or it predates stamped targets — only a policy that moves reps may move them.
  const priors = {
    'target 15': { sets: 2, reps: 15, weight: 50, mode: 'reps' },
    'target 10, did 15': { sets: 2, reps: 10, weight: 50, mode: 'reps' },
    'no target': null,
  }
  for (const [label, priorTarget] of Object.entries(priors)) {
    for (const prog of POLICIES) {
      it(`every policy at 2 × 10 after a logged 2 × 15 · prior ${label} · ${prog}`, () => {
        const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50, mode: 'reps', prog }] }])
        st.workouts.push({ id: 'p', d: '2026-09-01', entries: [{ id: BENCH, target: priorTarget, sets: [{ w: 50, r: 15, done: true }, { w: 50, r: 15, done: true }] }] })
        const [e] = start(st, ['A'])
        if (prog === 'double') expect(reps(e).every(r => r >= 8 && r <= 10)).toBe(true)
        else expect(reps(e)).toEqual([10, 10])
      })
    }
  }
})

describe('a routine whose only history is freestyle or imported', () => {
  it('starts from its own sets × reps at the last weight, not from the other session\'s shape', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50, mode: 'reps' }] }])
    st.workouts.push({ id: 'imp', d: '2026-09-01', routineId: null, entries: [{ id: BENCH, sets: [{ w: 30, r: 15, done: true }, { w: 30, r: 15, done: true }, { w: 30, r: 15, done: true }] }] })
    const [e] = start(st, ['A'])
    expect(work(e).map(s => [s.w, s.r])).toEqual([[30, 10], [30, 10]])
    expect(e.plan.why[0]).toBe('First time in this routine — starting from its own target.')
  })
})

describe('an edited routine starts again from its new plan', () => {
  it('holds the weight at the new reps under the default policy', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 15, weight: 50 }] }])
    train(st, ['A'])
    cfgOf(st, 'A').reps = 10
    const [e] = start(st, ['A'])
    expect(work(e).map(s => [s.w, s.r])).toEqual([[50, 10], [50, 10]])
    expect(e.plan.why[0]).toBe('Plan changed — starting from your new target.')
    train(st, ['A'])
    expect(start(st, ['A'])[0].plan.kind).toBe('up')   // and progresses from there
  })

  // The same edit that changed the reps changed the weight: 3 × 5 @ 100 rewritten as 3 × 10 @ 70
  // opens at 70 × 10, not at the 102.5 progression reached for fives.
  it('opens at the plan\'s new weight when the edit changed it too', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 100 }] }])
    train(st, ['A'])
    train(st, ['A'])
    expect(work(start(st, ['A'])[0]).map(s => s.w)).toEqual([105, 105, 105])
    Object.assign(cfgOf(st, 'A'), { reps: 10, weight: 70 })
    const [e] = start(st, ['A'])
    expect(work(e).map(s => [s.w, s.r])).toEqual([[70, 10], [70, 10], [70, 10]])
    expect(e.plan.why[0]).toBe('Plan changed — starting from your new target.')
    train(st, ['A'])
    expect(work(start(st, ['A'])[0]).map(s => [s.w, s.r])).toEqual([[72.5, 10], [72.5, 10], [72.5, 10]])
  })

  it('aims inside the new range under double progression', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 15, repsMin: 13, weight: 50, prog: 'double' }] }])
    train(st, ['A'])
    Object.assign(cfgOf(st, 'A'), { reps: 10, repsMin: 8 })
    const [e] = start(st, ['A'])
    expect(e.plan.kind).toBe('hold')
    expect(reps(e)).toEqual([10, 10])
  })

  it('restarts a bodyweight rep goal from the new count, not from the old one plus a rep', () => {
    const ARCHER = '3294'   // archer push-up — body-weight equipment
    const st = state([{ id: 'A', name: 'A', ex: [{ id: ARCHER, sets: 2, reps: 15, weight: 0, mode: 'reps' }] }])
    train(st, ['A'])
    cfgOf(st, 'A', ARCHER).reps = 10
    const [e] = start(st, ['A'])
    expect(reps(e)).toEqual([10, 10])
    train(st, ['A'])
    expect(reps(start(st, ['A'])[0])).toEqual([11, 11])
  })

  it('does not deload toward the old reps, or grow back a removed set, after three misses', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 3, reps: 15, weight: 50 }] }])
    for (let i = 0; i < 3; i++) train(st, ['A'], { r: 12 })
    Object.assign(cfgOf(st, 'A'), { sets: 2, reps: 10 })
    const [e] = start(st, ['A'])
    expect(e.plan.kind).toBe('hold')
    expect(work(e).map(s => [s.w, s.r])).toEqual([[50, 10], [50, 10]])
  })

  it('does not raise the weight off a bottom stamped after switching to double (#278)', () => {
    const A = { id: 'A', name: 'A', ex: [{ id: BENCH, sets: 3, reps: 8, weight: 36, inc: 6 }] }
    const st = state([A])
    train(st, ['A'])                                        // 3 × 8 @ 36 under linear
    st.routines[0].ex[0] = { ...st.routines[0].ex[0], reps: 12, repsMin: 8, prog: 'double' }
    const [e] = start(st, ['A'])
    expect(e.plan).toMatchObject({ kind: 'hold', weight: 36, reps: 9 })
    train(st, ['A'], { r: 8, w: 42 })                      // the user overrides to 42, does 3 × 8
    const [next] = start(st, ['A'])
    expect(next.plan.kind).not.toBe('up')
    expect(work(next).map(s => s.w)).toEqual([42, 42, 42])
  })
})

describe('bodyweight progression and a lift logged without a weight', () => {
  const PUSHUP = '0662'   // push-up — body-weight equipment

  it('adds a set at the rep ceiling and keeps it: 2 × 10, 2 × 11, 3 × 10, 3 × 11, 4 × 10 (#33)', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: PUSHUP, sets: 2, reps: 10, repsMax: 11, weight: 0, bodyweight: true }] }])
    const shape = []
    for (let i = 0; i < 5; i++) {
      const [e] = start(st, ['A'])
      shape.push(`${work(e).length}x${reps(e)[0]}`)
      train(st, ['A'])
    }
    expect(shape).toEqual(['2x10', '2x11', '3x10', '3x11', '4x10'])
  })

  it('climbs reps on an ab wheel logged at 0 kg — it has no load to enter', () => {
    const WHEEL = '0857'   // wheel rollerout — wheel roller equipment
    const st = state([{ id: 'A', name: 'A', ex: [{ id: WHEEL, sets: 3, reps: 10, weight: 0 }] }])
    train(st, ['A'])
    train(st, ['A'])
    const [e] = start(st, ['A'])
    expect(e.plan.kind).toBe('up')
    expect(reps(e)).toEqual([12, 12, 12])
  })

  it('does not climb reps on a loaded lift whose rows were logged at 0 kg', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 0 }] }])
    train(st, ['A'])
    const [e] = start(st, ['A'])
    expect(e.plan.kind).toBe('hold')
    expect(reps(e)).toEqual([10, 10])
  })
})

describe('"Your last session" keeps the old carry-over', () => {
  it('opens at the reps logged last time, judged against the plan', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 10, weight: 50 }] }], { startFrom: 'last' })
    train(st, ['A'], { r: 15 })
    const [e] = start(st, ['A'])
    expect(reps(e)).toEqual([15, 15])
    expect(e.target.reps).toBe(10)
  })

  it('still lets a policy that decides reps decide them', () => {
    const st = state([{ id: 'A', name: 'A', ex: [{ id: BENCH, sets: 2, reps: 12, repsMin: 8, weight: 40, prog: 'double' }] }], { startFrom: 'last' })
    train(st, ['A'], { r: 9 })
    const [e] = start(st, ['A'])
    expect(e.plan.kind).toBe('hold')
    expect(reps(e)).toEqual([10, 10])
  })
})
