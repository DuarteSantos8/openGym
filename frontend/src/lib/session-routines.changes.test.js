import { describe, expect, it } from 'vitest'
import { routineChanges } from './session-routines.js'
import { swapActiveExercise } from './active-exercise-swap.js'

// What a routine's session changed in the routine's exercise list, offered on the finish summary.
const BENCH = '0025', RAISE = '0334', CURL = '0294', LEGCURL = '0586', INCLINE = '0047'
const routine = (ex, extra = {}) => ({ id: 'r1', name: 'Push A', ex, ...extra })
const slot = (id, extra = {}) => ({ id, sets: 3, reps: 8, weight: 60, restSec: 120, ...extra })
const ticked = [{ w: 50, r: 10, done: true }]
const undone = [{ w: 50, r: 10 }]
const entry = (id, extra = {}) => ({ id, rid: 'r1', target: { sets: 1, reps: 10, weight: 50 }, sets: ticked, ...extra })
const changes = (entries, routines) => routineChanges({ id: 'a', entries }, { routines, workouts: [] })
const ids = c => c.ex.map(x => x.id)

describe('routineChanges', () => {
  it('says nothing when the session followed the routine, done or left undone', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    expect(changes([entry(BENCH), entry(RAISE)], [r])).toEqual([])
    expect(changes([entry(BENCH), entry(RAISE, { sets: undone })], [r])).toEqual([])
    // Freestyle entries belong to no routine.
    expect(changes([{ ...entry(CURL), rid: undefined }], [r])).toEqual([])
  })

  it('adds a stamped exercise that was done, where it was done, and ignores one left unticked', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    const [c] = changes([entry(BENCH), entry(CURL, { addedInSession: true }), entry(RAISE), entry(LEGCURL, { addedInSession: true, sets: undone })], [r])
    expect(ids(c)).toEqual([BENCH, CURL, RAISE])
    expect(c).toMatchObject({ routineId: 'r1', name: 'Push A', added: [CURL], removed: 0, swapped: 0, moved: false })
    // Copied the way #592 copies it, nothing of the session's own.
    expect(c.ex[1]).toMatchObject({ id: CURL, sets: 1, reps: 10, weight: 50 })
    expect(c.ex[1].rid).toBeUndefined()
    expect(c.ex[1].addedInSession).toBeUndefined()
    // The routine's own slots keep their prescription.
    expect(c.ex[0]).toEqual(slot(BENCH))
  })

  it('does not let an added second bench take the planned one’s slot', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    // The planned bench was taken out; an added bench sits before the raise.
    const [c] = changes([entry(BENCH, { addedInSession: true }), entry(RAISE)], [r])
    // #592: an added exercise the routine already has is not added again.
    expect(ids(c)).toEqual([RAISE])
    expect(c).toMatchObject({ added: [], removed: 1 })
  })

  it('takes out an exercise removed from the workout, not one left undone', () => {
    const r = routine([slot(BENCH), slot(RAISE), slot(CURL)])
    const [c] = changes([entry(BENCH), entry(CURL, { sets: undone })], [r])
    expect(ids(c)).toEqual([BENCH, CURL])
    expect(c).toMatchObject({ added: [], removed: 1, swapped: 0, moved: false })
  })

  it('keeps the slot’s prescription on a swap, as the routine editor’s Replace does', () => {
    const r = routine([slot(BENCH), slot(RAISE, { sg: 'g1' }), slot(CURL, { sg: 'g1' })])
    const active = { id: 'a', entries: [entry(BENCH), entry(RAISE, { sets: undone, sg: 'g1' }), entry(CURL, { sg: 'g1' })] }
    // An exercise not yet ticked is replaced in place (active-exercise-swap.js).
    swapActiveExercise(active, 1, { id: LEGCURL, target: { sets: 1, reps: 10, weight: 50 }, sets: ticked })
    const [c] = routineChanges(active, { routines: [r], workouts: [] })
    expect(ids(c)).toEqual([BENCH, LEGCURL, CURL])
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 1, moved: false })
    expect(c.ex[1]).toMatchObject({ id: LEGCURL, sets: 3, reps: 8, weight: 60, restSec: 120, sg: 'g1' })
  })

  it('finds the swapped slot when the swap was also done in another place', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    // The raise swapped for a leg curl, done first.
    const [c] = changes([entry(LEGCURL), entry(BENCH)], [r])
    expect(ids(c)).toEqual([LEGCURL, BENCH])
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 1, moved: true })
    expect(c.ex[0]).toMatchObject({ sets: 3, reps: 8, restSec: 120 })
    // Never done, the raise keeps its slot, in the new place.
    const [d] = changes([entry(LEGCURL, { sets: undone }), entry(BENCH)], [r])
    expect(ids(d)).toEqual([RAISE, BENCH])
    expect(d).toMatchObject({ added: [], removed: 0, swapped: 0, moved: true })
  })

  it('swaps in an exercise that is another slot’s backup when it took this slot', () => {
    const r = routine([slot(BENCH, { subs: [INCLINE] }), slot(RAISE)])
    const [c] = changes([entry(BENCH), entry(INCLINE)], [r])
    expect(ids(c)).toEqual([BENCH, INCLINE])
    expect(c).toMatchObject({ swapped: 1, removed: 0, added: [] })
    // Inserted beside a ticked bench, it is the bench's backup: nothing to offer.
    expect(changes([entry(BENCH), entry(INCLINE), entry(RAISE)], [r])).toEqual([])
  })

  it('leaves a slot as it is when it was swapped but the new exercise was never done', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    expect(changes([entry(BENCH), entry(LEGCURL, { sets: undone })], [r])).toEqual([])
  })

  it('reads a swap to one of the slot’s own backups as no change, wherever it went', () => {
    const r = routine([slot(BENCH), slot(RAISE, { subs: [CURL] }), slot(LEGCURL, { subCfg: { [INCLINE]: { sets: 2 } }, subs: [INCLINE] })])
    expect(changes([entry(BENCH), entry(CURL), entry(INCLINE)], [r])).toEqual([])
    // Done first, the backup is still its slot: only the order changed.
    const [c] = changes([entry(CURL), entry(BENCH), entry(LEGCURL)], [r])
    expect(ids(c)).toEqual([RAISE, BENCH, LEGCURL])
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 0, moved: true })
  })

  it('keeps the original and adds the new one when the swap came after a ticked set', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    const active = { id: 'a', entries: [entry(BENCH), entry(RAISE)] }
    swapActiveExercise(active, 1, { id: CURL, target: { sets: 1, reps: 12, weight: 10 }, sets: [{ w: 10, r: 12, done: true }] }, { loggedConfirmed: true })
    expect(active.entries.map(e => e.id)).toEqual([BENCH, RAISE, CURL])
    const [c] = routineChanges(active, { routines: [r], workouts: [] })
    expect(ids(c)).toEqual([BENCH, RAISE, CURL])
    expect(c).toMatchObject({ added: [CURL], removed: 0, swapped: 0 })
    // Inserted beside a ticked original and never done: nothing to offer.
    active.entries[2].sets = undone
    expect(routineChanges(active, { routines: [r], workouts: [] })).toEqual([])
  })

  it('takes the order the exercises were done in', () => {
    const r = routine([slot(BENCH), slot(RAISE), slot(CURL)])
    const [c] = changes([entry(CURL), entry(BENCH), entry(RAISE)], [r])
    expect(ids(c)).toEqual([CURL, BENCH, RAISE])
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 0, moved: true })
  })

  it('dissolves a superset left with one member', () => {
    const r = routine([slot(BENCH, { sg: 'g1', sgName: 'Chest', sgRest: 90 }), slot(RAISE, { sg: 'g1', sgName: 'Chest', sgRest: 90 }), slot(CURL)])
    const [c] = changes([entry(BENCH, { sg: 'g1' }), entry(CURL)], [r])
    expect(ids(c)).toEqual([BENCH, CURL])
    expect(c.ex[0].sg).toBeUndefined()
    expect(c.ex[0].sgName).toBeUndefined()
    expect(c.ex[0].sgRest).toBeUndefined()
    // The routine itself is untouched until the offer is taken.
    expect(r.ex[0].sg).toBe('g1')
  })

  it('keeps two added exercises done as a superset together', () => {
    const r = routine([slot(BENCH)])
    const [c] = changes([entry(BENCH), entry(RAISE, { addedInSession: true, sg: 'x' }), entry(CURL, { addedInSession: true, sg: 'x' })], [r])
    expect(ids(c)).toEqual([BENCH, RAISE, CURL])
    expect(c.ex[1].sg).toBeTruthy()
    expect(c.ex[1].sg).toBe(c.ex[2].sg)
    expect(c.ex[0].sg).toBeUndefined()
  })

  it('never empties a routine', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    // Every planned exercise taken out, only an added one left unticked.
    expect(changes([entry(CURL, { addedInSession: true, sets: undone })], [r])).toEqual([])
    expect(changes([], [r])).toEqual([])
  })

  it('updates each routine of a combined day on its own', () => {
    const r1 = routine([slot(BENCH), slot(RAISE)])
    const r2 = { id: 'r2', name: 'Pull', ex: [slot(CURL), slot(LEGCURL)] }
    const list = changes([
      entry(RAISE), entry(BENCH),
      { ...entry(CURL), rid: 'r2' }, { ...entry(INCLINE), rid: 'r2', addedInSession: true },
    ], [r1, r2])
    expect(list.map(c => c.routineId)).toEqual(['r1', 'r2'])
    expect(ids(list[0])).toEqual([RAISE, BENCH])
    expect(list[0]).toMatchObject({ moved: true, removed: 0, added: [] })
    expect(ids(list[1])).toEqual([CURL, INCLINE])
    expect(list[1]).toMatchObject({ moved: false, removed: 1, added: [INCLINE] })
    // A routine deleted since the session started is skipped.
    expect(changes([entry(RAISE), entry(BENCH)], [])).toEqual([])
  })
})
