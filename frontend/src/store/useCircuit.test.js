// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useStore } from './useStore.js'
import { useCircuit, circuitUnitAt, restoreCircuit } from './useCircuit.js'
import { useUI } from './useUI.js'
import { buildCompletedWorkout } from '../lib/finish-workout.js'
import { buildLiveActivity } from '../lib/live-activity.js'
import { watchRestTimer } from '../lib/watch-sync.js'
import { PREP_SEC } from '../lib/circuit.js'

const original = useStore.getState()
const entry = (id, sg, cfg, sets, target = {}) => ({ id, sg, target: { mode: 'reps', reps: 10, sg, sgCircuit: cfg, ...target }, sets })
const rows = (n, extra = {}) => Array.from({ length: n }, () => ({ w: 0, r: 10, done: false, ...extra }))

function seed(cfg, entries) {
  useStore.setState({ S: { ...original.S, sound: false, spokenCues: false, workouts: [], active: { id: 'w1', name: 'Burner', start: Date.now(), d: '2026-11-06', cur: 0, entries } } })
}

describe('the circuit player\'s clock', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); useCircuit.getState().reset() })
  afterEach(() => { useCircuit.getState().reset(); useUI.getState().stopRest(); vi.useRealTimers(); useStore.setState({ S: original.S }) })

  it('finds the circuit around an entry, and nothing for a plain superset', () => {
    const cfg = { mode: 'emom', every: 60, count: 4 }
    seed(cfg, [entry('a', 'g', cfg, rows(2)), entry('b', 'g', cfg, rows(2)), { id: 'c', sg: 'h', target: { sg: 'h' }, sets: rows(1) }, { id: 'd', sg: 'h', target: { sg: 'h' }, sets: rows(1) }])
    expect(circuitUnitAt(useStore.getState().S.active, 1)).toMatchObject({ unit: [0, 1], sg: 'g', cfg })
    expect(circuitUnitAt(useStore.getState().S.active, 2)).toBe(null)
  })

  it('writes each station into the session as the clock runs, and the result at the end', () => {
    const cfg = { mode: 'emom', every: 60, count: 2 }
    seed(cfg, [entry('a', 'g', cfg, rows(1)), entry('b', 'g', cfg, rows(1))])
    useUI.getState().startRest(90)
    const c = useCircuit.getState()
    c.openAt(0)
    expect(useCircuit.getState().open).toBe(true)
    c.start()
    // one clock at a time
    expect(useUI.getState().timer).toBe(null)
    vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + 20_000)
    useCircuit.getState().done()          // the split of interval 1
    vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + 61_000)
    useCircuit.getState().tick()
    let A = useStore.getState().S.active
    expect(A.entries[0].sets[0]).toMatchObject({ done: true, r: 10 })
    expect(A.cur).toBe(1)
    vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + 121_000)
    useCircuit.getState().tick()
    A = useStore.getState().S.active
    expect(A.entries[1].sets[0].done).toBe(true)
    expect(A.circuits).toHaveLength(1)
    expect(A.circuits[0]).toMatchObject({ mode: 'emom', rounds: 1, ids: ['a', 'b'], ended: 'done' })
    expect(useCircuit.getState().result.rounds).toBe(1)
    // and the saved workout keeps it
    const w = buildCompletedWorkout(A, { end: Date.now() })
    expect(w.circuits[0].mode).toBe('emom')
  })

  it('asks for the reps of the station the AMRAP cap caught, then saves them', () => {
    const cfg = { mode: 'amrap', cap: 60 }
    seed(cfg, [entry('a', 'g', cfg, rows(1, { r: 5 }), { reps: 5 }), entry('b', 'g', cfg, rows(1, { r: 5 }), { reps: 5 })])
    const c = useCircuit.getState()
    c.openAt(0); c.start()
    vi.setSystemTime(1_000_000 + PREP_SEC * 1000)
    useCircuit.getState().tick()
    for (let k = 1; k <= 3; k++) { vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + k * 15_000); useCircuit.getState().done() }
    vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + 61_000)
    useCircuit.getState().tick()
    expect(useCircuit.getState().ask).toEqual({ m: 1 })
    useCircuit.getState().finish(3)
    const A = useStore.getState().S.active
    expect(A.circuits[0]).toMatchObject({ rounds: 1, extra: 5 + 3 })
    expect(A.entries[1].sets.map(s => s.r)).toEqual([5, 3])
    // nothing owed: unticked rows are gone
    expect(A.entries.every(e => e.sets.every(s => s.done))).toBe(true)
  })

  it('comes back after a reload where the clock is', () => {
    const cfg = { mode: 'intervals', work: 20, rest: 10, rounds: 3 }
    seed(cfg, [entry('a', 'g', cfg, rows(3), { mode: 'time', sec: 20 })])
    useCircuit.getState().openAt(0); useCircuit.getState().start()
    const saved = localStorage.getItem('gym_circuit_v1')
    useCircuit.setState({ run: null })
    localStorage.setItem('gym_circuit_v1', saved)
    vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + 45_000)
    expect(restoreCircuit()).toBe(true)
    const A = useStore.getState().S.active
    // two work intervals ran while the page was gone (0-20, 30-50 s: the second still runs)
    expect(A.entries[0].sets.filter(s => s.done).length).toBe(1)
    expect(A.entries[0].sets[0].sec).toBe(20)
  })

  it('the Lock Screen and the watch count the circuit\'s rests', () => {
    const cfg = { mode: 'intervals', work: 20, rest: 10, rounds: 2 }
    seed(cfg, [entry('a', 'g', cfg, rows(2), { mode: 'time', sec: 20 })])
    useCircuit.getState().openAt(0); useCircuit.getState().start()
    const run = useCircuit.getState().run
    // get ready is a rest
    expect(watchRestTimer(null, run)).toEqual({ endsAt: 1_000_000 + PREP_SEC * 1000 })
    // #1149: a paused get-ready says it is paused, so the watch keeps its countdown instead of ending it
    useCircuit.getState().pause()
    expect(watchRestTimer(null, useCircuit.getState().run)).toMatchObject({ paused: true })
    useCircuit.getState().resume()
    let live = buildLiveActivity(useStore.getState().S, null, { circuit: run })
    expect(live.state.restEndsAt).toBe(1_000_000 + PREP_SEC * 1000)
    vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + 1000)
    useCircuit.getState().tick()
    const work = useCircuit.getState().run
    live = buildLiveActivity(useStore.getState().S, null, { circuit: work })
    expect(live.state).toMatchObject({ holdKind: 'hold', holdEndsAt: 1_000_000 + PREP_SEC * 1000 + 20_000, restEndsAt: null })
    // a work interval is not a rest on the watch
    expect(watchRestTimer({ endsAt: 5 }, work)).toBe(null)
    expect(watchRestTimer({ endsAt: 5 }, null)).toEqual({ endsAt: 5 })
  })

  it('a finish with the clock still going stops it and keeps what was done', () => {
    const cfg = { mode: 'circuit', rounds: 3 }
    seed(cfg, [entry('a', 'g', cfg, rows(3))])
    useCircuit.getState().openAt(0); useCircuit.getState().start()
    useCircuit.getState().done()                    // go now
    vi.setSystemTime(1_000_030); useCircuit.getState().done()   // round 1 done
    useCircuit.getState().wrapUp()
    const A = useStore.getState().S.active
    expect(A.circuits[0]).toMatchObject({ rounds: 1, ended: 'stopped' })
    expect(A.entries[0].sets.length).toBe(1)
  })
})
