import { describe, expect, it } from 'vitest'
import { routineChanges, noteRoutineStart } from './session-routines.js'
import { swapActiveExercise } from './active-exercise-swap.js'

// What a routine's session changed in the routine's exercise list, offered on the finish summary.
// Each test starts a session the way Start does (one entry per slot, noteRoutineStart), then
// changes it the way the workout screen does.
const BENCH = '0025', RAISE = '0334', CURL = '0294', LEGCURL = '0586', INCLINE = '0047'
const routine = (ex, extra = {}) => ({ id: 'r1', name: 'Push A', ex, ...extra })
const slot = (id, extra = {}) => ({ id, sets: 3, reps: 8, weight: 60, restSec: 120, ...extra })
const ticked = () => [{ w: 50, r: 10, done: true }]
const undone = () => [{ w: 50, r: 10 }]
const entry = (id, rid = 'r1', extra = {}) => ({ id, rid, target: { sets: 1, reps: 10, weight: 50 }, sets: ticked(), ...extra })

// Every slot of each routine, done; `only` keeps a part of a routine (leftovers.js).
function start(routines, only = {}) {
  const entries = routines.flatMap(r => r.ex.filter(x => !only[r.id] || only[r.id].includes(x.id)).map(x => entry(x.id, r.id, x.sg ? { sg: x.sg } : {})))
  return noteRoutineStart({ id: 'a', entries })
}
const at = (a, id, n = 0) => a.entries.map((e, i) => [e, i]).filter(([e]) => e.id === id)[n][1]
const take = (a, id) => { a.entries.splice(at(a, id), 1); return a }
const leave = (a, id) => { a.entries[at(a, id)].sets = undone(); return a }
const order = (a, list) => { a.entries = list.map(id => a.entries[at(a, id)]); return a }
const add = (a, id, extra = {}) => { a.entries.push(entry(id, 'r1', { addedInSession: true, ...extra })); return a }
// Replaced in place before a set of it was ticked (active-exercise-swap.js), then done or not.
const swap = (a, id, to, done = true) => {
  leave(a, id)
  swapActiveExercise(a, at(a, id), { id: to, target: { sets: 1, reps: 10, weight: 50 }, sets: done ? ticked() : undone() })
  return a
}
const changes = (a, routines) => routineChanges(a, { routines, workouts: [] })
const ids = c => c.ex.map(x => x.id)

describe('routineChanges', () => {
  it('says nothing when the session followed the routine, done or left undone', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    expect(changes(start([r]), [r])).toEqual([])
    expect(changes(leave(start([r]), RAISE), [r])).toEqual([])
    // Freestyle entries belong to no routine.
    const a = start([r])
    a.entries.push({ ...entry(CURL), rid: undefined })
    expect(changes(a, [r])).toEqual([])
  })

  it('adds a stamped exercise that was done, where it was done, and ignores one left unticked', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    const a = add(start([r]), CURL)
    a.entries = [a.entries[0], a.entries[2], a.entries[1]]
    add(a, LEGCURL, { sets: undone() })
    const [c] = changes(a, [r])
    expect(ids(c)).toEqual([BENCH, CURL, RAISE])
    expect(c).toMatchObject({ routineId: 'r1', name: 'Push A', added: [CURL], removed: 0, swapped: 0, moved: false })
    // Copied the way #592 copies it, nothing of the session's own.
    expect(c.ex[1]).toMatchObject({ id: CURL, sets: 1, reps: 10, weight: 50 })
    for (const key of ['rid', 'addedInSession', 'fromSlot']) expect(c.ex[1][key]).toBeUndefined()
    // The routine's own slots keep their prescription.
    expect(c.ex[0]).toEqual(slot(BENCH))
  })

  it('reads a bench taken out and added again as the bench’s own slot, and never adds a second', () => {
    const r = routine([slot(BENCH, { reps: 5 }), slot(RAISE)])
    // Done again, after the raise: the slot as the routine has it, in the new place.
    const [c] = changes(add(take(start([r]), BENCH), BENCH), [r])
    expect(ids(c)).toEqual([RAISE, BENCH])
    expect(c.ex[1]).toEqual(slot(BENCH, { reps: 5 }))
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 0, moved: true })
    // Added again but never done: taken out, as before.
    const [d] = changes(add(take(start([r]), BENCH), BENCH, { sets: undone() }), [r])
    expect(ids(d)).toEqual([RAISE])
    expect(d).toMatchObject({ added: [], removed: 1 })
    // With the planned bench still in the session, a second one is not added.
    expect(changes(add(start([r]), BENCH), [r])).toEqual([])
  })

  it('takes out an exercise removed from the workout, not one left undone', () => {
    const r = routine([slot(BENCH), slot(RAISE), slot(CURL)])
    const [c] = changes(leave(take(start([r]), RAISE), CURL), [r])
    expect(ids(c)).toEqual([BENCH, CURL])
    expect(c).toMatchObject({ added: [], removed: 1, swapped: 0, moved: false })
  })

  it('never takes out what the session did not start with', () => {
    // Leftovers from last time (leftovers.js): only the raise of this routine came along.
    const r = routine([slot(BENCH), slot(RAISE), slot(CURL)])
    expect(changes(start([r], { r1: [RAISE] }), [r])).toEqual([])
    // A slot added on another device while the workout ran.
    const a = start([r])
    const now = routine([slot(BENCH), slot(INCLINE), slot(RAISE), slot(CURL)])
    expect(changes(a, [now])).toEqual([])
    const [c] = changes(take(a, CURL), [now])
    expect(ids(c)).toEqual([BENCH, INCLINE, RAISE])
    expect(c).toMatchObject({ removed: 1 })
    // A session from before this was recorded offers its additions and nothing else.
    const old = { id: 'o', entries: [entry(BENCH), { ...entry(CURL), addedInSession: true }] }
    const [d] = changes(old, [routine([slot(BENCH), slot(RAISE)])])
    expect(ids(d)).toEqual([BENCH, RAISE, CURL])
    expect(d).toMatchObject({ added: [CURL], removed: 0, swapped: 0, moved: false })
  })

  it('leaves every slot of an exercise alone when another device changed how many it has', () => {
    const r = routine([slot(BENCH, { reps: 5 }), slot(RAISE), slot(CURL)])
    // A second bench added on another device, before the old one: which one went is unclear.
    const now = routine([slot(BENCH, { reps: 10 }), slot(BENCH, { reps: 5 }), slot(RAISE), slot(CURL)])
    expect(changes(take(start([r]), BENCH), [now])).toEqual([])
    // What else changed still goes through.
    const [c] = changes(take(take(start([r]), BENCH), RAISE), [now])
    expect(ids(c)).toEqual([BENCH, BENCH, CURL])
    expect(c.ex.map(x => x.reps)).toEqual([10, 5, 8])
    expect(c).toMatchObject({ removed: 1, swapped: 0, moved: false })
  })

  it('leaves twins alone: which of two benches went is a guess', () => {
    const r = routine([slot(BENCH, { reps: 5 }), slot(BENCH, { reps: 10 }), slot(RAISE), slot(CURL)])
    // Another device swapped the two bench slots; the workout took out the first bench.
    const now = routine([slot(BENCH, { reps: 10 }), slot(BENCH, { reps: 5 }), slot(RAISE), slot(CURL)])
    expect(changes(take(start([r]), BENCH), [now])).toEqual([])
    expect(changes(take(start([r]), BENCH), [r])).toEqual([])
    // Other changes still go through.
    const [c] = changes(take(take(start([r]), BENCH), RAISE), [now])
    expect(c.ex.map(x => [x.id, x.reps])).toEqual([[BENCH, 10], [BENCH, 5], [CURL, 8]])
    expect(c).toMatchObject({ removed: 1 })
  })

  it('puts an addition done after a twin after the last slot of that exercise', () => {
    const r = routine([slot(BENCH), slot(RAISE), slot(RAISE), slot(CURL)])
    const a = start([r])
    a.entries.splice(3, 0, entry(LEGCURL, 'r1', { addedInSession: true }))
    const [c] = changes(a, [r])
    expect(ids(c)).toEqual([BENCH, RAISE, RAISE, LEGCURL, CURL])
    expect(c).toMatchObject({ added: [LEGCURL], removed: 0, moved: false })
    // Done after the first raise too: still after the last one, where no guess is needed.
    const b = start([r])
    b.entries.splice(2, 0, entry(LEGCURL, 'r1', { addedInSession: true }))
    expect(ids(changes(b, [r])[0])).toEqual([BENCH, RAISE, RAISE, LEGCURL, CURL])
  })

  it('keeps an order set on another device when the workout kept its own', () => {
    const r = routine([slot(BENCH), slot(RAISE), slot(CURL)])
    const now = routine([slot(RAISE), slot(BENCH), slot(CURL)])
    expect(changes(start([r]), [now])).toEqual([])
    // An addition goes after the exercise it was done after, in the order the routine has now.
    const [c] = changes(add(order(start([r]), [BENCH, RAISE, CURL]), LEGCURL), [now])
    expect(ids(c)).toEqual([RAISE, BENCH, CURL, LEGCURL])
    expect(c).toMatchObject({ added: [LEGCURL], moved: false })
    const a = start([r])
    a.entries.splice(1, 0, entry(LEGCURL, 'r1', { addedInSession: true }))
    expect(ids(changes(a, [now])[0])).toEqual([RAISE, BENCH, LEGCURL, CURL])
    // The workout's own new order still wins for the slots it did.
    const [d] = changes(order(start([r]), [CURL, BENCH, RAISE]), [now])
    expect(ids(d)).toEqual([CURL, BENCH, RAISE])
    expect(d).toMatchObject({ moved: true })
  })

  it('keeps the slot’s prescription on a swap, as the routine editor’s Replace does', () => {
    const r = routine([slot(BENCH), slot(RAISE, { sg: 'g1' }), slot(CURL, { sg: 'g1' })])
    const [c] = changes(swap(start([r]), RAISE, LEGCURL), [r])
    expect(ids(c)).toEqual([BENCH, LEGCURL, CURL])
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 1, moved: false })
    expect(c.ex[1]).toMatchObject({ id: LEGCURL, sets: 3, reps: 8, weight: 60, restSec: 120, sg: 'g1' })
  })

  it('takes the prescription of the slot that was swapped, whatever else was taken out', () => {
    const r = routine([slot(BENCH, { reps: 5 }), slot(RAISE, { reps: 12 }), slot(CURL)])
    const [c] = changes(swap(take(start([r]), BENCH), RAISE, LEGCURL), [r])
    expect(ids(c)).toEqual([LEGCURL, CURL])
    expect(c.ex[0]).toMatchObject({ id: LEGCURL, reps: 12 })
    expect(c).toMatchObject({ removed: 1, swapped: 1, moved: false })
  })

  it('finds the swapped slot when the swap was also done in another place', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    const [c] = changes(order(swap(start([r]), RAISE, LEGCURL), [LEGCURL, BENCH]), [r])
    expect(ids(c)).toEqual([LEGCURL, BENCH])
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 1, moved: true })
    expect(c.ex[0]).toMatchObject({ sets: 3, reps: 8, restSec: 120 })
    // Never done, the raise keeps its slot, in the new place.
    const [d] = changes(order(swap(start([r]), RAISE, LEGCURL, false), [LEGCURL, BENCH]), [r])
    expect(ids(d)).toEqual([RAISE, BENCH])
    expect(d).toMatchObject({ added: [], removed: 0, swapped: 0, moved: true })
  })

  it('leaves a slot as it is when it was swapped but the new exercise was never done', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    expect(changes(swap(start([r]), RAISE, LEGCURL, false), [r])).toEqual([])
  })

  it('reads a swap to one of the slot’s own backups as no change', () => {
    const r = routine([slot(BENCH), slot(RAISE, { subs: [CURL] }), slot(LEGCURL, { subCfg: { [INCLINE]: { sets: 2 } }, subs: [INCLINE] })])
    expect(changes(swap(swap(start([r]), RAISE, CURL), LEGCURL, INCLINE), [r])).toEqual([])
    // Done first, the backup is still its slot: only the order changed.
    const [c] = changes(order(swap(start([r]), RAISE, CURL), [CURL, BENCH, LEGCURL]), [r])
    expect(ids(c)).toEqual([RAISE, BENCH, LEGCURL])
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 0, moved: true })
  })

  it('swaps in an exercise that is another slot’s backup when it took this slot', () => {
    const r = routine([slot(BENCH, { subs: [INCLINE] }), slot(RAISE)])
    const [c] = changes(swap(start([r]), RAISE, INCLINE), [r])
    expect(ids(c)).toEqual([BENCH, INCLINE])
    expect(c).toMatchObject({ swapped: 1, removed: 0, added: [] })
  })

  it('keeps the original and adds the new one when the swap came after a ticked set', () => {
    const r = routine([slot(BENCH, { subs: [INCLINE] }), slot(RAISE)])
    const a = start([r])
    swapActiveExercise(a, 1, { id: CURL, target: { sets: 1, reps: 12, weight: 10 }, sets: [{ w: 10, r: 12, done: true }] }, { loggedConfirmed: true })
    expect(a.entries.map(e => e.id)).toEqual([BENCH, RAISE, CURL])
    const [c] = changes(a, [r])
    expect(ids(c)).toEqual([BENCH, RAISE, CURL])
    expect(c).toMatchObject({ added: [CURL], removed: 0, swapped: 0 })
    // Inserted beside a ticked original and never done: nothing to offer.
    a.entries[2].sets = undone()
    expect(changes(a, [r])).toEqual([])
    // A backup of the bench inserted beside it: the plan working as meant.
    const b = start([r])
    swapActiveExercise(b, 0, { id: INCLINE, target: { sets: 1, reps: 10, weight: 50 }, sets: ticked() }, { loggedConfirmed: true })
    expect(changes(b, [r])).toEqual([])
  })

  it('takes the order the exercises were done in', () => {
    const r = routine([slot(BENCH), slot(RAISE), slot(CURL)])
    const [c] = changes(order(start([r]), [CURL, BENCH, RAISE]), [r])
    expect(ids(c)).toEqual([CURL, BENCH, RAISE])
    expect(c).toMatchObject({ added: [], removed: 0, swapped: 0, moved: true })
  })

  it('dissolves a superset left with one member', () => {
    const r = routine([slot(BENCH, { sg: 'g1', sgName: 'Chest', sgRest: 90 }), slot(RAISE, { sg: 'g1', sgName: 'Chest', sgRest: 90 }), slot(CURL)])
    const [c] = changes(take(start([r]), RAISE), [r])
    expect(ids(c)).toEqual([BENCH, CURL])
    expect(c.ex[0].sg).toBeUndefined()
    expect(c.ex[0].sgName).toBeUndefined()
    expect(c.ex[0].sgRest).toBeUndefined()
    // The routine itself is untouched until the offer is taken.
    expect(r.ex[0].sg).toBe('g1')
  })

  it('keeps two added exercises done as a superset together', () => {
    const r = routine([slot(BENCH)])
    const [c] = changes(add(add(start([r]), RAISE, { sg: 'x' }), CURL, { sg: 'x' }), [r])
    expect(ids(c)).toEqual([BENCH, RAISE, CURL])
    expect(c.ex[1].sg).toBeTruthy()
    expect(c.ex[1].sg).toBe(c.ex[2].sg)
    expect(c.ex[0].sg).toBeUndefined()
  })

  it('never empties a routine', () => {
    const r = routine([slot(BENCH), slot(RAISE)])
    // Every planned exercise taken out, only an added one left unticked.
    expect(changes(add(take(take(start([r]), BENCH), RAISE), CURL, { sets: undone() }), [r])).toEqual([])
    expect(changes(take(take(start([r]), BENCH), RAISE), [r])).toEqual([])
  })

  it('updates each routine of a combined day on its own', () => {
    const r1 = routine([slot(BENCH), slot(RAISE)])
    const r2 = { id: 'r2', name: 'Pull', ex: [slot(CURL), slot(LEGCURL)] }
    const a = order(take(start([r1, r2]), LEGCURL), [RAISE, BENCH, CURL])
    a.entries.push(entry(INCLINE, 'r2', { addedInSession: true }))
    const list = changes(a, [r1, r2])
    expect(list.map(c => c.routineId)).toEqual(['r1', 'r2'])
    expect(ids(list[0])).toEqual([RAISE, BENCH])
    expect(list[0]).toMatchObject({ moved: true, removed: 0, added: [] })
    expect(ids(list[1])).toEqual([CURL, INCLINE])
    expect(list[1]).toMatchObject({ moved: false, removed: 1, added: [INCLINE] })
    // A routine deleted since the session started is skipped.
    expect(changes(a, [])).toEqual([])
  })
})

describe('noteRoutineStart', () => {
  it('records each routine’s slots once, and only for the entries it is given', () => {
    const a = noteRoutineStart({ entries: [entry(BENCH), entry(RAISE), entry(BENCH), { ...entry(CURL), rid: undefined }] })
    expect(a.startEx).toEqual({ r1: [BENCH, RAISE, BENCH] })
    expect(a.entries.map(e => e.fromSlot)).toEqual([0, 1, 2, undefined])
    // A routine added to the running session (AddRoutineToSession) joins the record.
    const more = [entry(CURL, 'r2')]
    a.entries.push(...more, entry(LEGCURL, 'r1', { addedInSession: true }))
    noteRoutineStart(a, more)
    expect(a.startEx).toEqual({ r1: [BENCH, RAISE, BENCH], r2: [CURL] })
    expect(a.entries.at(-1).fromSlot).toBeUndefined()
  })
})
