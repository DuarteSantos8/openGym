// A weight unit per exercise (#657): shown and typed in its own unit, stored in the profile's.
import { describe, expect, it } from 'vitest'
import {
  exUnitOf, exConverted, withExUnit, shownWeight, storedWeight, exView, viewTarget, storedTarget,
  viewRow, storedRow, viewEntry, storedEntry, storedBar,
} from './ex-unit.js'
import { convertStateUnit, convertExact, convertStep } from './units.js'
import { buildPlannedEntry, buildSessionEntry } from './session-start.js'
import { inventoryFor, baseWeightFor, rowLoad } from './plates.js'
import { ownedWeightsFor, stepOwned, withStack, stackOf } from './dumbbells.js'
import { weightIncrement, stepWeight } from './progression.js'
import { pctWeight } from './programmes.js'
import { mergeStates, STAMPED_MAPS } from './sync-merge.js'
import { STAMPED_MAPS as API_STAMPED_MAPS } from '../../../api/sync-stamps.js'
import { EXIDX } from './exercises.js'
import { workoutText } from './workout-text.js'
import { cleanNum } from './format.js'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'
import { exUnitTag } from './ex-unit.js'

const BENCH = '0025'   // barbell bench press
const CURL = '0294'    // dumbbell curl
const FLY = '0596'     // lever seated fly
const SQUAT = '0043'   // barbell squat, never pinned here

const pin = (unit, id, to, extra = {}) => ({
  unit, workouts: [], routines: [], exWeights: {}, exUnit: withExUnit({}, id, to, 1), ...extra,
})
const session = (d, id, sets, target = {}) => ({
  id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(),
  entries: [{ id, target: { sets: sets.length, reps: 5, mode: 'reps', ...target }, sets: sets.map(([w, r]) => ({ w, r, done: true })) }],
})

describe('the pin', () => {
  it('the exercises used here are what the test assumes', () => {
    expect(EXIDX[BENCH].eq).toBe('barbell')
    expect(EXIDX[CURL].eq).toBe('dumbbell')
    expect(EXIDX[FLY].eq).toBe('leverage machine')
  })

  it('defaults to the profile unit, and a stamped null goes back to it', () => {
    expect(exUnitOf({ unit: 'lb' }, BENCH)).toBe('lb')
    expect(exUnitOf({ unit: 'kg', exUnit: withExUnit({}, BENCH, 'lb', 5) }, BENCH)).toBe('lb')
    const back = withExUnit(withExUnit({}, BENCH, 'lb', 5), BENCH, null, 6)
    expect(back[BENCH]).toEqual({ unit: null, _ts: 6 })
    expect(exUnitOf({ unit: 'kg', exUnit: back }, BENCH)).toBe('kg')
    // Garbage is no pin.
    expect(exUnitOf({ unit: 'kg', exUnit: { [BENCH]: { unit: 'stone', _ts: 1 } } }, BENCH)).toBe('kg')
  })

  it('an exercise in the profile unit, pinned or not, gets the state itself back: nothing changes', () => {
    const plain = { unit: 'kg', workouts: [session('2026-10-01', BENCH, [[60, 5]])] }
    expect(exView(plain, BENCH)).toBe(plain)
    const same = pin('kg', BENCH, 'kg', { workouts: plain.workouts })
    expect(exConverted(same, BENCH)).toBe(false)
    expect(exView(same, BENCH)).toBe(same)
    expect(shownWeight(same, BENCH, 61.25)).toBe(61.25)
    expect(storedWeight(same, BENCH, 61.25)).toBe(61.25)
  })
})

describe('converting at the edge', () => {
  it('stores 45 lb as 20.4117 kg and shows 45 lb again', () => {
    const S = pin('kg', BENCH, 'lb')
    expect(storedWeight(S, BENCH, 45)).toBe(20.4117)
    expect(shownWeight(S, BENCH, 20.4117)).toBe(45)
    // And a kg dumbbell on a lb profile: 35 kg is 77.1618 lb, not the 77 that reads 34.9.
    const L = pin('lb', CURL, 'kg')
    expect(storedWeight(L, CURL, 35)).toBe(77.1618)
    expect(shownWeight(L, CURL, 77.1618)).toBe(35)
  })

  it('every plate-grid weight comes back exactly as typed, both ways', () => {
    const lb = pin('kg', BENCH, 'lb')
    for (let w = 0.5; w <= 1500; w += 0.5) expect(shownWeight(lb, BENCH, storedWeight(lb, BENCH, w))).toBe(w)
    const kg = pin('lb', CURL, 'kg')
    for (let w = 0.25; w <= 700; w += 0.25) expect(shownWeight(kg, CURL, storedWeight(kg, CURL, w))).toBe(w)
  })

  it('does not drift over many edits, and a number shown and left alone keeps its stored value', () => {
    const S = pin('kg', BENCH, 'lb')
    let stored = storedWeight(S, BENCH, 135)
    let shown = 135
    // A walk of a thousand steps up, down and nowhere, as a stepper and typing would make it.
    let seed = 7
    for (let i = 0; i < 1000; i++) {
      seed = (seed * 48271) % 2147483647
      const move = [-5, 0, 2.5, 5, 0.5, -2.5][seed % 6]
      shown = Math.max(0, shown + move)
      stored = storedWeight(S, BENCH, shown, stored)
      expect(shownWeight(S, BENCH, stored)).toBe(shown)
    }
    // An odd value that did not come from the lb side (a kg-grid 61.3) is kept as it is when its
    // shown number is saved back unchanged.
    const odd = shownWeight(S, BENCH, 61.3)
    expect(storedWeight(S, BENCH, odd, 61.3)).toBe(61.3)
  })

  it('a row and a target go there and back, untouched numbers kept to the last place', () => {
    const S = pin('kg', BENCH, 'lb')
    const row = { w: 61.3, r: 5, drops: [{ w: 40, r: 6 }] }
    const v = viewRow(S, BENCH, row)
    expect(v.w).toBe(135.143)
    expect(storedRow(S, BENCH, v, row)).toEqual(row)
    expect(storedRow(S, BENCH, { ...v, w: 140 }, row).w).toBe(63.5029)
    const side = { sides: { L: { w: 20, r: 5 }, R: { w: 20, r: 5 } }, w: 20, r: 10 }
    expect(viewRow(S, BENCH, side).sides.L.w).toBe(44.092)
    expect(storedRow(S, BENCH, viewRow(S, BENCH, side), side).sides.R.w).toBe(20)
    const cfg = { id: BENCH, sets: 3, reps: 5, weight: 61.25, inc: 2.5, warmup: [{ pct: 50, weight: 30 }], pyramidWeight: [0, 40] }
    const vt = viewTarget(S, BENCH, cfg)
    // The step is the usual lb one, not 5.51 lb.
    expect(vt.inc).toBe(5)
    expect(vt.pyramidWeight[0]).toBe(0)
    expect(storedTarget(S, BENCH, vt, cfg)).toEqual(cfg)
    expect(storedTarget(S, BENCH, { ...vt, inc: 10 }, cfg).inc).toBe(5)
    expect(storedTarget(S, BENCH, { ...vt, inc: 7.5 }, cfg).inc).toBe(3.4019)
  })

  it('an entry goes there and back whole', () => {
    const S = pin('lb', CURL, 'kg')
    const e = { id: CURL, topW: 50, target: { weight: 50, inc: 5 }, planned: { sets: 3, weight: 50 }, sets: [{ w: 50, r: 8 }] }
    const v = viewEntry(S, e)
    expect(v.target.inc).toBe(2.5)
    expect(v.sets[0].w).toBe(22.68)
    expect(storedEntry(S, v, e)).toEqual(e)
  })

  it('steps pair with their usual counterpart, and others convert exactly', () => {
    expect(convertStep(2.5, 'kg', 'lb')).toBe(5)
    expect(convertStep(10, 'lb', 'kg')).toBe(5)
    expect(convertStep(1.25, 'kg', 'lb')).toBe(2.5)
    expect(convertStep(3, 'kg', 'lb')).toBe(6.6139)
    expect(convertExact(45, 'lb', 'kg')).toBe(20.4117)
  })
})

describe('the exercise as it sees the state', () => {
  it('reads its history, routine slot, kept weight and bar in its own unit, and leaves the rest alone', () => {
    const S = pin('kg', BENCH, 'lb', {
      workouts: [{ ...session('2026-10-01', BENCH, [[61.25, 5]]), bw: 80, entries: [
        session('2026-10-01', BENCH, [[61.25, 5]]).entries[0],
        session('2026-10-01', SQUAT, [[100, 5]]).entries[0],
      ] }],
      routines: [{ id: 'r', ex: [{ id: BENCH, weight: 61.25 }, { id: SQUAT, weight: 100 }] }],
      exWeights: { [BENCH]: { w: 61.25, d: '2026-10-01' }, [SQUAT]: { w: 100, d: '2026-10-01' } },
      barWeights: { [BENCH]: 15 },
    })
    const V = exView(S, BENCH)
    expect(V.unit).toBe('lb')
    expect(V.workouts[0].entries[0].sets[0].w).toBe(135.033)
    expect(V.workouts[0].entries[1].sets[0].w).toBe(100)
    expect(V.workouts[0].bw).toBe(176.37)
    expect(V.routines[0].ex[0].weight).toBe(135.033)
    expect(V.routines[0].ex[1].weight).toBe(100)
    expect(V.exWeights[BENCH].w).toBe(135.033)
    expect(V.exWeights[SQUAT].w).toBe(100)
    expect(V.barWeights[BENCH]).toBe(33.069)
    // The same view each time for the same state, and the state itself is never written.
    expect(exView(S, BENCH)).toBe(V)
    expect(S.workouts[0].entries[0].sets[0].w).toBe(61.25)
    expect(exView(V, BENCH)).toBe(V)
  })

  it('a new state over the same history reuses its converted history, a changed one does not', () => {
    // During a workout only S.active changes: each tap is a new state, the history the same array.
    const S = pin('kg', BENCH, 'lb', { workouts: [session('2026-10-01', BENCH, [[61.25, 5]])] })
    const V = exView(S, BENCH)
    const next = { ...S, active: { id: 'a', entries: [] } }
    const W = exView(next, BENCH)
    expect(W).not.toBe(V)
    expect(W.active).toBe(next.active)
    expect(W.workouts).toBe(V.workouts)
    // Another pin on the same history, and a history with a session added, get their own.
    expect(exView({ ...S, exUnit: withExUnit({}, BENCH, 'lb', 2) }, BENCH).workouts).toBe(V.workouts)
    const more = { ...S, workouts: [...S.workouts, session('2026-10-02', BENCH, [[70, 5]])] }
    expect(exView(more, BENCH).workouts.map(w => w.entries[0].sets[0].w)).toEqual([135.033, 154.324])
    const lbProfile = pin('lb', BENCH, 'kg', { workouts: S.workouts })
    expect(exView(lbProfile, BENCH).workouts[0].entries[0].sets[0].w).toBe(27.783)
  })

  it('a pinned barbell loads lb plates on the 45 lb bar on a kg profile', () => {
    const V = exView(pin('kg', BENCH, 'lb'), BENCH)
    expect(baseWeightFor(V, BENCH)).toBe(45)
    const load = rowLoad('pairs', 135, baseWeightFor(V, BENCH), inventoryFor(V))
    expect(load.plates).toEqual([45])
    expect(load.missing).toBe(0)
    // A bar of its own is typed in lb and kept in kg.
    const S = pin('kg', BENCH, 'lb')
    expect(storedBar(S, BENCH, 35)).toBe(15.8757)
    expect(storedBar(S, BENCH, 0)).toBe(0)
    // The profile-unit exercise next to it keeps the 20 kg bar.
    expect(baseWeightFor(S, SQUAT)).toBe(20)
  })

  it('a kg-pinned dumbbell on a lb profile walks the kg rack, and the step is 2.5 kg', () => {
    const S = pin('lb', CURL, 'kg', { dumbbells: { kg: { weights: [10, 12.5, 15, 17.5], _ts: 1 }, lb: { weights: [20, 25, 30], _ts: 1 } } })
    const V = exView(S, CURL)
    expect(ownedWeightsFor(V, { id: CURL })).toEqual([10, 12.5, 15, 17.5])
    expect(stepOwned(ownedWeightsFor(V, { id: CURL }), 12.5, 1)).toBe(15)
    expect(ownedWeightsFor(S, { id: CURL })).toEqual([20, 25, 30])
    expect(weightIncrement({ id: CURL }, V.unit)).toBe(2.5)
    expect(stepWeight(12.5, 2.5, 1)).toBe(15)
  })

  it('a machine stack entered in the pinned unit is read in it', () => {
    const S = pin('kg', FLY, 'lb')
    const V = exView(S, FLY)
    const stacked = { ...S, stackWeights: withStack(V, FLY, [10, 20, 30], 2) }
    expect(stacked.stackWeights[FLY].unit).toBe('lb')
    expect(stackOf(exView(stacked, FLY), FLY)).toEqual([10, 20, 30])
    // The profile's own reading of it is the kg equivalent, to the tenth.
    expect(stackOf(stacked, FLY)).toEqual([4.5, 9.1, 13.6])
  })

  it('a programme’s %1RM rounds to the pinned unit’s step', () => {
    const S = pin('kg', BENCH, 'lb', { workouts: [session('2026-10-01', BENCH, [[storedWeight(pin('kg', BENCH, 'lb'), BENCH, 225), 5]])] })
    const w = pctWeight(exView(S, BENCH), BENCH, 75, { step: 5 })
    expect(w % 5).toBe(0)
    expect(w).toBe(195)
  })
})

describe('building sessions in the pinned unit', () => {
  // Five sessions of linear progression, every set made: each one opens 5 lb heavier, exactly on
  // the step, though every number on the way is stored in kg.
  it('linear progression lands on 5 lb steps on a kg profile, with no drift', () => {
    let S = pin('kg', BENCH, 'lb')
    const cfg = { id: BENCH, sets: 3, reps: 5, mode: 'reps', weight: storedWeight(S, BENCH, 135) }
    const routine = { id: 'r', ex: [cfg] }
    S = { ...S, routines: [routine] }
    const shownTops = []
    for (let i = 0; i < 6; i++) {
      const d = `2026-10-${String(1 + i * 2).padStart(2, '0')}`
      const built = buildPlannedEntry({ ...S, active: { d } }, cfg, routine)
      const top = shownWeight(S, BENCH, built.target.weight ?? cfg.weight)
      shownTops.push(top)
      for (const s of built.sets) expect(Number.isInteger(shownWeight(S, BENCH, s.w) * 2)).toBe(true)
      const sets = built.sets.map(s => ({ ...s, r: Math.max(s.r || 0, 5), done: true }))
      S = { ...S, workouts: [...S.workouts, { id: 'w' + i, d, start: new Date(d + 'T10:00:00').getTime(), entries: [{ id: BENCH, rid: 'r', target: built.target, planned: built.planned, sets }] }] }
    }
    expect(shownTops).toEqual([135, 140, 145, 150, 155, 160])
  })

  it('a kg-pinned dumbbell on a lb profile goes up by 2.5 kg', () => {
    let S = pin('lb', CURL, 'kg')
    const cfg = { id: CURL, sets: 2, reps: 10, mode: 'reps', weight: storedWeight(S, CURL, 12.5) }
    const routine = { id: 'r', ex: [cfg] }
    S = { ...S, routines: [routine] }
    const tops = []
    for (let i = 0; i < 4; i++) {
      const d = `2026-10-${String(1 + i * 2).padStart(2, '0')}`
      const built = buildPlannedEntry({ ...S, active: { d } }, cfg, routine)
      tops.push(shownWeight(S, CURL, built.target.weight ?? cfg.weight))
      const sets = built.sets.map(s => ({ ...s, r: 10, done: true }))
      S = { ...S, workouts: [...S.workouts, { id: 'w' + i, d, start: new Date(d + 'T10:00:00').getTime(), entries: [{ id: CURL, rid: 'r', target: built.target, planned: built.planned, sets }] }] }
    }
    expect(tops).toEqual([12.5, 15, 17.5, 20])
  })

  it('the config a session is built from comes back as it was stored', () => {
    const S = pin('kg', BENCH, 'lb')
    const cfg = { id: BENCH, sets: 3, reps: 5, mode: 'reps', weight: 61.3, inc: 2.5 }
    const built = buildPlannedEntry(S, cfg, { id: 'r', ex: [cfg] }, { noProg: true })
    expect(built.target.inc).toBe(2.5)
    expect(built.target.weight).toBe(61.3)
    expect(built.planned.weight).toBe(61.3)
  })

  it('freestyle repeats last time in the pinned unit', () => {
    const S = pin('kg', BENCH, 'lb', { workouts: [session('2026-10-01', BENCH, [[20.4117, 8], [22.6796, 6]])] })
    const built = buildSessionEntry({ ...S, active: { d: '2026-10-03', entries: [] } }, BENCH, { sets: 2, reps: 8 }, null, null)
    expect(built.sets.map(s => shownWeight(S, BENCH, s.w))).toEqual([45, 50])
    expect(built.target.id).toBeUndefined()
  })
})

describe('the profile switch', () => {
  it('converts pinned exercises exactly, so they read the same numbers after', () => {
    const S = {
      unit: 'kg',
      exUnit: { ...withExUnit({}, BENCH, 'lb', 1), ...withExUnit({}, CURL, 'kg', 1) },
      workouts: [{ id: 'w', d: '2026-10-01', entries: [
        { id: BENCH, sets: [{ w: 20.4117, r: 5 }] },
        { id: CURL, sets: [{ w: 35, r: 8 }] },
        { id: SQUAT, sets: [{ w: 100, r: 5 }] },
      ] }],
      routines: [{ id: 'r', ex: [{ id: BENCH, weight: 61.235, inc: 2.268 }, { id: CURL, weight: 35, inc: 2.5 }] }],
      exWeights: { [CURL]: { w: 35, d: '2026-10-01' } },
    }
    const L = convertStateUnit(S, 'lb')
    const [bench, curl, squat] = L.workouts[0].entries
    // The lb exercise lands on its own numbers, the kg one is kept exact, the plain one on the grid.
    expect(bench.sets[0].w).toBe(45)
    expect(curl.sets[0].w).toBe(77.1618)
    expect(shownWeight(L, CURL, curl.sets[0].w)).toBe(35)
    expect(squat.sets[0].w).toBe(220.5)
    expect(L.routines[0].ex[0].weight).toBe(135)
    expect(L.routines[0].ex[1].inc).toBe(5)
    expect(shownWeight(L, CURL, L.exWeights[CURL].w)).toBe(35)
    // And back again, still the same numbers on screen.
    const K = convertStateUnit(L, 'kg')
    expect(shownWeight(K, BENCH, K.workouts[0].entries[0].sets[0].w)).toBe(45)
    expect(K.workouts[0].entries[1].sets[0].w).toBe(35)
    expect(K.routines[0].ex[1].inc).toBe(2.5)
  })
})

describe('sync', () => {
  it('is a stamped map on both sides: key union, the later pick wins, a clear included', () => {
    expect(STAMPED_MAPS).toContain('exUnit')
    expect(API_STAMPED_MAPS).toEqual(STAMPED_MAPS)
    const a = { unit: 'kg', _ts: 10, exUnit: { ...withExUnit({}, BENCH, 'lb', 5), ...withExUnit({}, CURL, 'lb', 9) } }
    const b = { unit: 'kg', _ts: 20, exUnit: { ...withExUnit({}, BENCH, null, 8), ...withExUnit({}, FLY, 'lb', 3) } }
    const m = mergeStates(b, a)
    expect(m.exUnit[BENCH]).toEqual({ unit: null, _ts: 8 })
    expect(m.exUnit[CURL]).toEqual({ unit: 'lb', _ts: 9 })
    expect(m.exUnit[FLY]).toEqual({ unit: 'lb', _ts: 3 })
  })

  it('a copy that never heard of it merges as before', () => {
    const a = { unit: 'kg', _ts: 10, exUnit: withExUnit({}, BENCH, 'lb', 5) }
    const old = { unit: 'kg', _ts: 20 }
    expect(mergeStates(old, a).exUnit[BENCH].unit).toBe('lb')
  })
})

describe('display', () => {
  it('a copied workout writes a pinned exercise in its unit, the volume in the profile’s', () => {
    const S = pin('kg', BENCH, 'lb')
    const w = { id: 'w', d: '2026-10-01', start: 0, end: 0, name: 'Push', entries: [
      { id: BENCH, sets: [{ w: 61.235, r: 5, done: true }, { w: 63.5029, r: 5, done: true }] },
      { id: SQUAT, sets: [{ w: 100, r: 5, done: true }] },
    ] }
    const text = workoutText(w, { unit: 'kg', nameOf: e => e.id, state: S })
    expect(text).toContain('135×5, 140×5 (lb)')
    expect(text.trim().endsWith('100×5')).toBe(true)
    // Volume stays a profile total: 61.235×5 + 63.5029×5 + 500 kg.
    expect(text).toContain('1,123.7 kg')
    // Without the state (an older caller), the stored numbers as before.
    expect(workoutText(w, { unit: 'kg', nameOf: e => e.id })).toContain('61.2×5')
  })

  it('tags only exercises shown in another unit', () => {
    const S = pin('kg', BENCH, 'lb')
    expect(exUnitTag(S, BENCH)).toBe(' (lb)')
    expect(exUnitTag(S, SQUAT)).toBe('')
  })
})

describe('shared plan files', () => {
  const writer = () => pin('kg', BENCH, 'lb', {
    routines: [{ id: 'r', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 20.4117 }, { id: SQUAT, sets: 3, reps: 5, weight: 100 }] }],
    week: {}, customEx: [],
  })
  it('carry the pins of the plan’s exercises, the numbers in the file’s unit', () => {
    const b = buildPlanBundle(writer(), 'Push')
    expect(b.exUnit).toEqual({ [BENCH]: 'lb' })
    expect(b.unit).toBe('kg')
    expect(b.routines[0].ex[0].weight).toBe(20.4117)
    // Nothing pinned, nothing written: the file keeps the shape it had.
    expect('exUnit' in buildPlanBundle({ ...writer(), exUnit: {} }, 'Push')).toBe(false)
  })

  it('pin the exercise on import, converted to the reader’s profile, unless the reader chose already', () => {
    const file = JSON.stringify(buildPlanBundle(writer(), 'Push'))
    const lbReader = { unit: 'lb', routines: [], week: {}, customEx: [] }
    mergePlan(lbReader, parsePlan(file, 'lb'))
    expect(lbReader.exUnit[BENCH].unit).toBe('lb')
    expect(lbReader.routines[0].ex[0].weight).toBe(45)
    const kgReader = { unit: 'kg', routines: [], week: {}, customEx: [] }
    mergePlan(kgReader, parsePlan(file, 'kg'))
    expect(shownWeight(kgReader, BENCH, kgReader.routines[0].ex[0].weight)).toBe(45)
    const decided = { unit: 'kg', routines: [], week: {}, customEx: [], exUnit: withExUnit({}, BENCH, null, 3) }
    mergePlan(decided, parsePlan(file, 'kg'))
    expect(decided.exUnit[BENCH]).toEqual({ unit: null, _ts: 3 })
  })

  it('an older file without the map, or a broken one, pins nothing', () => {
    const b = buildPlanBundle(writer(), 'Push')
    delete b.exUnit
    const s = { unit: 'kg', routines: [], week: {}, customEx: [] }
    mergePlan(s, parsePlan(JSON.stringify(b), 'kg'))
    expect(s.exUnit).toBeUndefined()
    const bad = parsePlan(JSON.stringify({ ...b, exUnit: { [BENCH]: 'stone', nope: 'lb' } }), 'kg')
    expect(bad.exUnit).toEqual({})
  })
})

describe('input fields show clean numbers', () => {
  it('two places at most, a hair off the step or a whole or half number snapped', () => {
    expect(cleanNum(20.4117)).toBe(20.41)
    expect(cleanNum(44.996)).toBe(45)
    expect(cleanNum(22.496)).toBe(22.5)
    expect(cleanNum(61.25)).toBe(61.25)
    expect(cleanNum(61.246, 1.25)).toBe(61.25)
    expect(cleanNum(135.143)).toBe(135.14)
    expect(cleanNum(8)).toBe(8)
    expect(cleanNum('')).toBe('')
    expect(cleanNum(null)).toBe(null)
  })
})
