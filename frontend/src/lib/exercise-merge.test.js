import { describe, expect, test } from 'vitest'
import { mergeExercise, undoMerge, mergePreview, mergeBlocked, mergedInto, mergedAway, applyExerciseMerges } from './exercise-merge.js'
import { mergeStates, stampChange } from './sync-merge.js'
import { allExercises, EXIDX, registerCustom } from './exercises.js'

const BENCH = '0025'   // barbell bench press (catalogue)
const SQUAT = '0043'   // barbell squat (catalogue)
const CUSTOM = 'c_benchfn'
const clone = v => JSON.parse(JSON.stringify(v))
const custom = { id: CUSTOM, n: 'Bench Press (Barbell)', bp: 'chest', eq: 'barbell', custom: true, tg: 'pectorals', media: { hash: 'abc', kind: 'image' }, _ts: 1 }
const wk = (id, d, exId, sets, extra = {}) => ({ id, d, start: new Date(d + 'T10:00:00').getTime(), name: 'Push', prs: [], entries: [{ id: exId, target: { mode: 'reps' }, sets, n: 'Bench Press (Barbell)', muscleSnapshot: { n: 'Bench Press (Barbell)', bp: 'chest' } }], ...extra })
const set = (w, r) => ({ w, r, done: true })

function state() {
  return {
    unit: 'kg',
    customEx: [clone(custom)],
    workouts: [
      wk('w1', '2026-09-01', CUSTOM, [set(70, 8), set(70, 8)], { prs: [CUSTOM] }),
      wk('w2', '2026-09-05', CUSTOM, [set(72.5, 8)]),
      wk('w3', '2026-09-09', BENCH, [set(75, 5)]),
      wk('w4', '2026-09-10', SQUAT, [set(100, 5)]),
    ],
    routines: [
      { id: 'r1', name: 'Push', ex: [{ id: CUSTOM, sets: 3, reps: 8, warmupRows: [{ pct: 50, r: 8 }], subs: [BENCH, SQUAT] }] },
      { id: 'r2', name: 'Legs', ex: [{ id: SQUAT, sets: 3, reps: 5 }] },
    ],
    programmes: { p1: { id: 'p1', name: 'Block', weeks: [{ t: { [CUSTOM]: { pct: 80 }, ['r1:' + CUSTOM]: { rpe: 8 } } }] } },
    exWeights: { [CUSTOM]: { w: 72.5 }, [BENCH]: { w: 75 } },
    exNotes: { [CUSTOM]: 'Seat 4', [BENCH]: 'Grip 81' },
    exAliases: { [CUSTOM]: ['FN bench'] },
    favEx: [CUSTOM, SQUAT],
    barWeights: { [CUSTOM]: 20 },
    exUnit: { [CUSTOM]: { unit: 'lb', _ts: 5 } },
    balanceOverrides: { 'tpl:bench': { id: CUSTOM, _ts: 5 } },
    active: null,
  }
}

describe('merging an exercise into another (#656)', () => {
  test('the preview counts what moves', () => {
    expect(mergePreview(state(), CUSTOM, BENCH)).toMatchObject({ workouts: 2, sets: 3, routines: 1, programmes: 1, note: true, custom: true })
  })

  test('all history, plans and settings move to the target, and the custom source is gone', () => {
    const S = state()
    registerCustom(S.customEx)
    mergeExercise(S, CUSTOM, BENCH, { now: 1000 })
    const ids = S.workouts.flatMap(w => w.entries.map(e => e.id))
    expect(ids).toEqual([BENCH, BENCH, BENCH, SQUAT])
    // the custom snapshot goes, the catalogue answers for a catalogue target
    expect(S.workouts[0].entries[0].muscleSnapshot).toBeUndefined()
    expect(S.workouts[0].entries[0].n).toBeUndefined()
    expect(S.workouts[0].prs).toEqual([BENCH])
    // workouts it changed are stamped, the others are not
    expect(S.workouts[0]._ts).toBe(1000)
    expect(S.workouts[2]._ts).toBeUndefined()
    // the routine slot keeps its warm-ups; the backups lose the exercise itself
    expect(S.routines[0].ex[0]).toMatchObject({ id: BENCH, sets: 3, warmupRows: [{ pct: 50, r: 8 }], subs: [SQUAT] })
    expect(S.programmes.p1.weeks[0].t).toEqual({ [BENCH]: { pct: 80 }, ['r1:' + BENCH]: { rpe: 8 } })
    expect(S.exWeights).toEqual({ [BENCH]: { w: 75 } })
    expect(S.exNotes).toEqual({ [BENCH]: 'Grip 81\nSeat 4' })
    expect(S.exAliases[BENCH]).toEqual(expect.arrayContaining(['FN bench', 'Bench Press (Barbell)']))
    expect(S.favEx).toEqual([BENCH, SQUAT])
    expect(S.barWeights).toEqual({ [BENCH]: 20 })
    expect(S.exUnit[BENCH]).toMatchObject({ unit: 'lb' })
    expect(S.balanceOverrides['tpl:bench'].id).toBe(BENCH)
    expect(S.customEx).toEqual([])
    expect(S.exMerged[CUSTOM]).toEqual({ into: BENCH, _ts: 1000 })
    expect(mergedInto(S, CUSTOM)).toBe(BENCH)
  })

  test('the better kept weight wins, and a target keeps its own settings', () => {
    const S = state()
    S.exWeights[CUSTOM] = { w: 90 }
    S.barWeights[BENCH] = 15
    mergeExercise(S, CUSTOM, BENCH, { now: 1000 })
    expect(S.exWeights[BENCH].w).toBe(90)
    expect(S.barWeights[BENCH]).toBe(15)
  })

  test('a catalogue source is hidden from the lists instead of removed, and its name finds the target', () => {
    const S = state()
    mergeExercise(S, SQUAT, BENCH, { now: 1000 })
    expect(allExercises(S).some(e => e.id === SQUAT)).toBe(false)
    expect(allExercises(S).some(e => e.id === BENCH)).toBe(true)
    expect(S.exAliases[BENCH]).toEqual(expect.arrayContaining([EXIDX[SQUAT].n]))
    expect([...mergedAway(S)]).toEqual([SQUAT])
  })

  test('a custom target takes the source picture when it has none, and the history its name', () => {
    const S = state()
    S.customEx.push({ id: 'c_other', n: 'My bench', bp: 'chest', custom: true })
    registerCustom(S.customEx)
    mergeExercise(S, CUSTOM, 'c_other', { now: 1000 })
    expect(S.customEx).toEqual([expect.objectContaining({ id: 'c_other', media: custom.media })])
    expect(S.workouts[0].entries[0]).toMatchObject({ id: 'c_other', n: 'My bench' })
    expect(S.workouts[0].entries[0].muscleSnapshot.n).toBe('My bench')
  })

  test('what cannot be merged', () => {
    const S = state()
    expect(mergeBlocked(S, CUSTOM, CUSTOM)).toBeTruthy()
    expect(mergeBlocked(S, CUSTOM, 'nope')).toBeTruthy()
    expect(mergeBlocked({ ...S, active: { entries: [{ id: CUSTOM, sets: [] }] } }, CUSTOM, BENCH)).toBe('Finish your current workout first')
    expect(mergeBlocked(S, CUSTOM, BENCH)).toBe(null)
    expect(() => mergeExercise(S, CUSTOM, CUSTOM)).toThrow()
    // a merge back into what was merged away is refused
    mergeExercise(S, CUSTOM, BENCH, { now: 1 })
    expect(mergeBlocked(S, BENCH, CUSTOM)).toBeTruthy()
  })

  test('Undo puts everything back and clears the record with a stamp', () => {
    const S = state()
    const was = clone(S)
    const { undo } = mergeExercise(S, CUSTOM, BENCH, { now: 1000 })
    undoMerge(S, undo, { now: 2000 })
    const { exMerged, workouts, ...rest } = S
    const { workouts: w0, ...rest0 } = was
    expect(rest).toEqual(rest0)
    expect(workouts.map(w => w.entries[0].id)).toEqual(w0.map(w => w.entries[0].id))
    expect(workouts[0]._ts).toBe(2000)
    expect(exMerged[CUSTOM]).toEqual({ into: null, _ts: 2000 })
    expect(mergedAway(S)).toBe(null)
  })
})

describe('a merge on one device, a workout on another', () => {
  test('the other copy’s workout against the source moves over when the copies meet', () => {
    const base = state()
    const phone = clone(base)
    const prev = clone(phone)
    mergeExercise(phone, CUSTOM, BENCH, { now: 5000 })
    stampChange(prev, phone, 5000)
    phone._ts = 5000
    // the tablet logged against the custom exercise before it heard of the merge
    const tablet = clone(base)
    tablet.workouts.push(wk('w9', '2026-09-12', CUSTOM, [set(80, 6)]))
    tablet._ts = 4000
    const merged = mergeStates(phone, tablet)
    expect(merged.workouts.find(w => w.id === 'w9').entries[0].id).toBe(BENCH)
    expect(merged.workouts.flatMap(w => w.entries.map(e => e.id)).includes(CUSTOM)).toBe(false)
    expect(merged.customEx.some(c => c.id === CUSTOM)).toBe(false)
    expect(merged.exMerged[CUSTOM].into).toBe(BENCH)
  })

  test('applyExerciseMerges leaves a copy without merges alone', () => {
    const S = state()
    expect(applyExerciseMerges(S)).toBe(0)
    expect(S).toEqual(state())
  })
})
