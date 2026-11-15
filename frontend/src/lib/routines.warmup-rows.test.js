import { describe, it, expect } from 'vitest'
import { routineChangesFromEntry, updateRoutineFromEntry, ownWarmupsChange, replaceSlotExercise } from './routines.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'
import { withWarmupBlock, rungRows } from './warmup-ramp.js'
import { patchSetIn } from './watch-sync.js'
import { liveReramp } from './history.js'
import { isWarmupRow, markWarmupEdited } from './workout-model.js'
import { convertStateUnit } from './units.js'

const BENCH = '0025'
const warm = (w, r, extra = {}) => ({ w, r, done: true, phase: 'warmup', warmup: true, ...extra })
const work = (w = 60, r = 5) => ({ w, r, done: true })
const routineWith = slot => ({ id: 'R', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60, ...slot }] })
const entryWith = sets => [{ id: BENCH, rid: 'R', target: { sets: 3, reps: 5, weight: 60 }, sets }]

describe('keeping a session’s warm-ups in the routine (#525)', () => {
  it('an older ramp-set slot still counts its warm-ups', () => {
    const r = routineWith({ warmupSets: 1 })
    const found = routineChangesFromEntry(r, entryWith([warm(30, 5), warm(45, 5), work()]), 0, 20)
    expect(found.changes).toEqual([{ key: 'warmupSets', from: 1, to: 2 }])
  })
  it('a generated block you left alone offers nothing', () => {
    const r = routineWith({ warmup: 'auto' })
    expect(routineChangesFromEntry(r, entryWith([warm(20, 10, { wb: true }), warm(35, 3, { wp: 60 }), work()]), 0, 20)).toBeNull()
  })
  it('a generated block you changed is offered as your own, and saved as one', () => {
    const r = routineWith({ warmup: 'auto' })
    const entries = entryWith([warm(20, 12, { wb: true, edited: true }), warm(30, 8, { wp: 50 }), warm(40, 5, { edited: true }), work()])
    const found = routineChangesFromEntry(r, entries, 0, 20)
    expect(found.changes[0]).toEqual({ key: 'warmupRows', from: null, to: [{ wb: true, r: 12 }, { wp: 50, r: 8 }, { wp: 67, r: 5 }] })
    updateRoutineFromEntry(r, entries, 0, 20)
    expect(r.ex[0].warmup).toBe('own')
    expect(r.ex[0].warmupRows).toHaveLength(3)
    expect(r.ex[0].warmupSets).toBeUndefined()
    expect(routineChangesFromEntry(r, entries, 0, 20)).toBeNull()
  })
  it('“Keep these warm-ups” keeps them even untouched', () => {
    const slot = { id: BENCH }
    expect(ownWarmupsChange(slot, entryWith([warm(20, 10), warm(40, 5), work()])[0], 20, { force: true })).toEqual([{ wb: true, r: 10 }, { wp: 67, r: 5 }])
  })
})

describe('a shared routine carries its warm-ups', () => {
  it('the choice and the rows travel, junk does not', () => {
    const S = { unit: 'kg', routines: [routineWith({ warmup: 'own', warmupRows: [{ wb: true, r: 10 }, { wp: 140, r: 3 }, { nope: 1 }] })], week: {} }
    const file = buildPlanBundle(S, 'Push')
    const ex = file.routines[0].ex[0]
    expect(ex.warmup).toBe('own')
    expect(ex.warmupRows).toEqual([{ wb: true, r: 10 }, { wp: 95, r: 3 }])
    const back = parsePlan(JSON.stringify(file), 'kg')
    expect(back.routines[0].ex[0].warmupRows).toEqual([{ wb: true, r: 10 }, { wp: 95, r: 3 }])
  })
})

describe('a block of your own in fixed weights', () => {
  it('a session that did the fixed rows as planned offers nothing', () => {
    const r = routineWith({ warmup: 'own', warmupRows: [{ wf: 40, r: 8 }] })
    expect(routineChangesFromEntry(r, entryWith([warm(40, 8, { wf: 40 }), work()]), 0, 20)).toBeNull()
  })
  it('a fixed row you changed in the session is kept at its new weight', () => {
    const r = routineWith({ warmup: 'own', warmupRows: [{ wf: 40, r: 8 }] })
    const found = routineChangesFromEntry(r, entryWith([warm(42.5, 8, { wf: 40, edited: true, weightOrigin: 'manual' }), work()]), 0, 20)
    expect(found.changes).toEqual([{ key: 'warmupRows', from: [{ wf: 40, r: 8 }], to: [{ wf: 42.5, wp: 71, r: 8 }] }])
  })
  it('a light day that left a fixed row out offers nothing', () => {
    const r = routineWith({ weight: 75, warmup: 'own', warmupRows: [{ wp: 50, r: 10 }, { wf: 80, r: 12 }] })
    expect(routineChangesFromEntry(r, entryWith([warm(35, 10, { wp: 50 }), work(75, 12)]), 0, 20)).toBeNull()
  })
  const LEGEXT = '0585'
  const legSlot = (weight, warmupRows) => ({ id: LEGEXT, sets: 2, reps: 12, weight, prog: 'off', mode: 'reps', warmup: 'own', warmupRows })
  const legEntry = (slot, sets) => [{ id: LEGEXT, rid: 'R', target: { sets: 2, reps: 12, weight: slot.weight }, planned: { sets: 2, reps: 12, weight: slot.weight }, sets }]
  const S0 = { unit: 'kg', exWeights: {}, routines: [], workouts: [], week: {}, dayPlan: {} }
  it('raising the work weight past a fixed row the session left out offers nothing', () => {
    const slot = legSlot(75, [{ wp: 50, r: 10 }, { wf: 80, wp: 95, r: 12 }])
    let sets = withWarmupBlock(S0, slot, [{ w: 75, r: 12, done: false }, { w: 75, r: 12, done: false }], { grid: 2.5 })
    sets = liveReramp(sets.map(x => (isWarmupRow(x) ? x : { ...x, w: 85 })), 2.5).map(x => ({ ...x, done: true }))
    expect(routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [slot] }, legEntry(slot, sets), 0, 0, 2.5)).toBeNull()
  })
  it('lowering the work weight under a fixed row mid-session offers nothing', () => {
    const slot = legSlot(140, [{ wf: 80, wp: 57, r: 10 }, { wp: 75, r: 5 }, { wf: 100, wp: 71, r: 2 }])
    let sets = withWarmupBlock(S0, slot, [{ w: 140, r: 12, done: false }, { w: 140, r: 12, done: false }], { grid: 2.5 })
    expect(sets.filter(isWarmupRow).map(x => x.w)).toEqual([80, 100, 105])
    sets = liveReramp(sets.map(x => (isWarmupRow(x) ? x : { ...x, w: 90 })), 2.5)
    expect(routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [slot] }, legEntry(slot, sets), 0, 0, 2.5)).toBeNull()
  })
  it('a session that opened at last time’s weight offers nothing when its first set moves', () => {
    const slot = legSlot(140, [{ wp: 70, r: 5 }, { wf: 100, wp: 69, r: 2 }])
    let sets = withWarmupBlock(S0, slot, [{ w: 145, r: 12, done: false }, { w: 145, r: 12, done: false }], { grid: 2.5 })
    expect(sets.filter(isWarmupRow).map(x => [x.w, x.r])).toEqual([[100, 2]])
    sets = liveReramp(sets.map((x, i) => (i === 1 ? { ...x, w: 142.5 } : x)), 2.5)
    expect(routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [slot] }, legEntry(slot, sets), 0, 0, 2.5)).toBeNull()
  })
  it('a session that says how many warm-ups its block built reads back by that, however the sets moved', () => {
    const slot = legSlot(140, [{ wp: 70, r: 5 }, { wf: 100, wp: 69, r: 2 }])
    let sets = withWarmupBlock(S0, slot, [{ w: 145, r: 12, done: false }, { w: 145, r: 12, done: false }], { grid: 2.5 })
    sets = liveReramp(sets.map(x => (isWarmupRow(x) ? x : { ...x, w: 142.5 })), 2.5)
    const [e] = legEntry(slot, sets)
    expect(routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [slot] }, [{ ...e, target: { ...e.target, warmupCount: 1 } }], 0, 0, 2.5)).toBeNull()
  })
  it('a unit switch mid-session cannot make an untouched block look changed', () => {
    // Three rows built in lb; read back in kg two of them would land on one weight.
    const slot = { id: BENCH, sets: 3, reps: 5, weight: 54.5, warmup: 'own', warmupRows: [{ wp: 30, r: 5 }, { wf: 25, wp: 46, r: 5 }, { wp: 50, r: 5 }] }
    const sets = [warm(20.5, 5, { wp: 30 }), warm(25, 5, { wf: 25 }), warm(27.25, 5, { wp: 50 }), work(54.5), work(54.5)]
    const e = { id: BENCH, rid: 'R', target: { sets: 3, reps: 5, weight: 54.5, warmupCount: 3 }, sets }
    expect(routineChangesFromEntry({ id: 'R', name: 'Push', ex: [slot] }, [e], 0, 20, 2.5)).toBeNull()
  })
  it('a warm-up you removed is offered even when a work set went lighter', () => {
    const slot = { id: BENCH, sets: 3, reps: 5, weight: 60, warmup: 'own', warmupRows: [{ wp: 40, r: 10 }, { wp: 60, r: 5 }, { wp: 80, r: 3 }] }
    const sets = [warm(35, 5, { wp: 60 }), warm(47.5, 3, { wp: 80 }), work(60), work(60), work(30)]
    const found = routineChangesFromEntry({ id: 'R', name: 'Push', ex: [slot] }, [{ id: BENCH, rid: 'R', target: { sets: 3, reps: 5, weight: 60, warmupCount: 3 }, sets }], 0, 20, 2.5)
    expect(found.changes[0].key).toBe('warmupRows')
  })
  it('in an exercise’s own unit the count uses its grid', () => {
    const slot = legSlot(65.7709, [{ wf: 45.3592, wp: 69, r: 10 }, { wp: 70, r: 5 }])
    const lbGrid = x => Math.round(Math.floor(x / 0.45359237 / 10 + 1e-9) * 10 * 0.45359237 * 10000) / 10000
    const sets = withWarmupBlock(S0, slot, [{ w: 65.7709, r: 12, done: true }, { w: 65.7709, r: 12, done: true }], { grid: lbGrid })
    expect(sets.filter(isWarmupRow).map(x => x.w)).toEqual([45.3592])
    expect(routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [slot] }, legEntry(slot, sets), 0, 0, lbGrid)).toBeNull()
  })
  describe('a row the block left out today stays in the routine', () => {
    const slot = legSlot(75, [{ wp: 50, r: 10 }, { wf: 80, wp: 95, r: 12 }])
    const counted = (s, sets) => legEntry(s, sets).map(e => ({ ...e, target: { ...e.target, warmupCount: sets.filter(isWarmupRow).length } }))
    const build = s => withWarmupBlock(S0, s, [{ w: s.weight, r: 12, done: false }, { w: s.weight, r: 12, done: false }], { grid: 2.5 })
    it('"Keep these warm-ups" on an untouched light day has nothing to keep', () => {
      const sets = build(slot)
      expect(sets.filter(isWarmupRow).map(x => x.w)).toEqual([37.5])
      expect(ownWarmupsChange(slot, counted(slot, sets)[0], 0, { force: true, grid: 2.5 })).toBeNull()
    })
    it('a reps edit on the other row keeps the fixed row it left out', () => {
      const sets = build(slot).map(x => (isWarmupRow(x) ? { ...x, r: 8, edited: true, done: true } : x))
      const r = { id: 'R', name: 'Legs', ex: [structuredClone(slot)] }
      updateRoutineFromEntry(r, counted(slot, sets), 0, 0, 2.5)
      expect(r.ex[0].warmupRows).toEqual([{ wp: 50, r: 8 }, { wf: 80, wp: 95, r: 12 }])
    })
    it('a share that landed on a fixed row stays too', () => {
      const s2 = legSlot(117.5, [{ wf: 80, wp: 69, r: 12 }, { wp: 70, r: 8 }])
      const sets = build(s2).map(x => (isWarmupRow(x) ? { ...x, r: 10, edited: true } : x))
      const r = { id: 'R', name: 'Legs', ex: [structuredClone(s2)] }
      updateRoutineFromEntry(r, counted(s2, sets), 0, 0, 2.5)
      expect(r.ex[0].warmupRows).toEqual([{ wf: 80, wp: 69, r: 10 }, { wp: 70, r: 8 }])
    })
    it('a fixed weight changed on the watch is read back at the new weight, one side of a per-side row too', () => {
      const s4 = legSlot(100, [{ wf: 40, r: 8 }])
      const r = { id: 'R', name: 'Legs', ex: [s4] }
      const S = { ...S0, active: { id: 'a1', entries: counted(s4, build(s4)) } }
      patchSetIn(S, { wid: 'a1', exId: LEGEXT, entryIdx: 0, setIdx: 0 }, { w: 45, r: 8, done: true }, null)
      expect(routineChangesFromEntry(r, S.active.entries, 0, 0, 2.5).changes[0].to[0].wf).toBe(45)
      const sides = [...rungRows(s4.warmupRows, { work: 100, grid: 2.5, perSide: true }), { w: 100, r: 12, done: false }]
      const T = { ...S0, active: { id: 'a1', entries: counted(s4, sides) } }
      patchSetIn(T, { wid: 'a1', exId: LEGEXT, entryIdx: 0, setIdx: 0, side: 'L' }, { w: 45, r: 8 }, null)
      expect(routineChangesFromEntry(r, T.active.entries, 0, 0, 2.5).changes[0].to[0].wf).toBe(45)
    })
    it('a fixed row done while a lighter work set held it down keeps its own weight', () => {
      const setWork = (sets, w) => liveReramp(sets.map(x => (isWarmupRow(x) ? x : { ...x, w })), 2.5)
      const s6 = legSlot(100, [{ wf: 80, r: 10 }])
      let sets = setWork(build(s6), 75)
      expect(sets.filter(isWarmupRow).map(x => x.w)).toEqual([75])
      sets = setWork(sets.map(x => (isWarmupRow(x) ? { ...x, done: true } : x)), 100)
      expect(ownWarmupsChange(s6, counted(s6, sets)[0], 0, { force: true, grid: 2.5 })).toBeNull()
      const s7 = legSlot(100, [{ wp: 50, r: 10 }, { wf: 80, r: 10 }])
      let more = setWork(build(s7), 75)
      more = setWork(more.map(x => (isWarmupRow(x) ? { ...x, done: true } : x)), 100)
      const S = { ...S0, active: { id: 'a1', entries: counted(s7, more) } }
      patchSetIn(S, { wid: 'a1', exId: LEGEXT, entryIdx: 0, setIdx: 0 }, { r: 8 }, null)
      const to = routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [s7] }, S.active.entries, 0, 0, 2.5).changes[0].to
      expect(to.find(x => x.wf).wf).toBe(80)
    })
    it('at five rows, a row put back gives way to a warm-up you added', () => {
      const s5 = legSlot(75, [{ wp: 20, r: 10 }, { wp: 40, r: 8 }, { wp: 60, r: 6 }, { wp: 80, r: 4 }, { wf: 80, r: 2 }])
      const built = build(s5)
      const count = built.filter(isWarmupRow).length
      const sets = [...built.filter(isWarmupRow), markWarmupEdited({ w: 65, r: 3, done: false, phase: 'warmup', warmup: true }), ...built.filter(x => !isWarmupRow(x))]
      const e = legEntry(s5, sets).map(x => ({ ...x, target: { ...x.target, warmupCount: count } }))
      const to = routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [s5] }, e, 0, 0, 2.5).changes[0].to
      expect(to).toHaveLength(5)
      expect(to.some(x => x.wf === 80)).toBe(false)
    })
    it('once you removed a row it built, the routine takes the session as it is', () => {
      const s3 = legSlot(140, [{ wp: 50, r: 10 }, { wf: 80, wp: 57, r: 8 }, { wf: 150, r: 3 }])
      const built = build(s3)
      expect(built.filter(isWarmupRow).map(x => x.w)).toEqual([70, 80])
      const sets = built.filter(x => !(isWarmupRow(x) && x.wp === 50))
      const e = legEntry(s3, sets).map(x => ({ ...x, target: { ...x.target, warmupCount: 2 } }))
      expect(routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [s3] }, e, 0, 0, 2.5).changes[0].to.map(x => x.wf)).toEqual([80])
    })
  })
  it('a share that lands on a fixed row today offers nothing', () => {
    const slot = legSlot(117.5, [{ wf: 80, wp: 69, r: 12 }, { wp: 70, r: 8 }])
    const sets = withWarmupBlock(S0, slot, [work(117.5, 12), work(117.5, 12)], { grid: 2.5 }).map(x => ({ ...x, done: true }))
    expect(sets.filter(isWarmupRow).map(x => [x.w, x.r])).toEqual([[80, 12]])
    expect(routineChangesFromEntry({ id: 'R', name: 'Legs', ex: [slot] }, legEntry(slot, sets), 0, 0, 2.5)).toBeNull()
  })
  it('a stray non-number wf is no fixed weight, through a unit switch too', () => {
    const S = { unit: 'kg', routines: [{ id: 'r', ex: [legSlot(100, [{ wp: 50, wf: true, r: 10 }])] }], workouts: [] }
    expect(convertStateUnit(S, 'lb').routines[0].ex[0].warmupRows).toEqual([{ wp: 50, wf: true, r: 10 }])
  })
  it('a running session’s backup plan converts with the profile', () => {
    const S = { unit: 'kg', routines: [], workouts: [], active: { id: 'a', entries: [{ id: LEGEXT, target: { sets: 2, reps: 12, weight: 110, subs: [BENCH], subCfg: { [BENCH]: { sets: 3, reps: 5, weight: 60, warmup: 'own', warmupRows: [{ wf: 40, r: 8 }] } } }, sets: [work(110, 12)] }] } }
    expect(convertStateUnit(S, 'lb').active.entries[0].target.subCfg[BENCH]).toMatchObject({ weight: 132.5, warmupRows: [{ wf: 88, r: 8 }] })
  })
  it('a fixed row goes back to its share when the slot takes another exercise', () => {
    const slot = { id: '0585', sets: 2, mode: 'reps', reps: 12, weight: 110, warmup: 'own', warmupRows: [{ wf: 80, wp: 73, r: 12 }, { wb: true, r: 5 }] }
    expect(replaceSlotExercise(slot, BENCH, null).warmupRows).toEqual([{ wp: 73, r: 12 }, { wb: true, r: 5 }])
    const bare = replaceSlotExercise({ ...slot, warmupRows: [{ wf: 80, r: 12 }] }, BENCH, null)
    expect(bare.warmup).toBeUndefined()
    expect(bare.warmupRows).toBeUndefined()
  })
  it('a plan file in lb brings the fixed weight over in kg', () => {
    const S = { unit: 'lb', routines: [routineWith({ weight: 135, warmup: 'own', warmupRows: [{ wf: 95, r: 8 }, { wp: 80, r: 3 }] })], week: {} }
    const back = parsePlan(JSON.stringify(buildPlanBundle(S, 'Push')), 'kg')
    expect(back.routines[0].ex[0].warmupRows).toEqual([{ wf: 43, r: 8 }, { wp: 80, r: 3 }])
  })
})
