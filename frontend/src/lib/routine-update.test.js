import { describe, expect, it } from 'vitest'
import { sessionRoutinePlans, rewriteRoutine, rewritesRoutine, applyRoutineUpdate, swapOwnPlan } from './routine-update.js'
import { buildCombinedEntries, startSlotsOf } from './session-merge.js'
import { swapActiveExercise } from './active-exercise-swap.js'

// "Update routine from this workout": what a finished session did to its routine, and the
// routine rewritten to match. Exercises: 0198 cable pulldown, 0652 pull-up (bodyweight),
// 0027 barbell row, 0861 cable seated row, 0313 dumbbell hammer curl, 0025 barbell bench,
// 0314 dumbbell incline bench, 0201 cable pushdown, 0334 dumbbell lateral raise.
const clone = v => JSON.parse(JSON.stringify(v))
const DEF = { unit: 'kg', workouts: [], routines: [], exWeights: {} }
const ticked = (n = 2, w = 40) => Array.from({ length: n }, () => ({ w, r: 10, done: true }))
const open = (n = 2, w = 40) => Array.from({ length: n }, () => ({ w, r: 10 }))

const pull = () => ({
  id: 'r1', name: 'Pull A', ex: [
    { id: '0198', sets: 4, reps: 12, repsMin: 8, weight: 50, restSec: 90, note: 'Pause at the chest', prog: 'double' },
    { id: '0027', sets: 3, reps: 8, weight: 60 },
    { id: '0313', sets: 3, reps: 12, weight: 14 },
  ],
})

// A session as the app starts one: the stamps buildCombinedEntries puts on each entry.
function sessionOf(routines, rids = ['r1']) {
  const st = { ...clone(DEF), routines }
  const { entries, startSlots } = buildCombinedEntries(st, rids)
  return { st, active: { id: 'a', routineIds: rids, entries: entries.map(e => ({ ...e, sets: ticked() })), startSlots } }
}
const entry = (id, slotAt, extra = {}) => ({ id, rid: 'r1', slotAt, target: { sets: 2, reps: 10, weight: 40 }, sets: ticked(), ...extra })
const plain = routine => ({ id: 'a', routineIds: [routine.id], startSlots: startSlotsOf([routine]) })
const ids = ex => ex.map(x => x.id)
const planFor = (active, routines) => sessionRoutinePlans(active, routines)[0]

describe('the session start stamps what an update reads', () => {
  it('stamps every entry with its slot and keeps the routine as it was', () => {
    const { active } = sessionOf([pull()])
    expect(active.entries.map(e => e.slotAt)).toEqual([0, 1, 2])
    expect(active.startSlots).toEqual({ r1: ['0198', '0027', '0313'] })
  })

  it('a swap keeps the slot on the replacement, in place or inserted beside logged sets', () => {
    const a = { entries: [entry('0198', 0, { sets: open() }), entry('0027', 1)] }
    swapActiveExercise(a, 0, { id: '0652', target: {}, sets: open() })
    expect(a.entries[0]).toMatchObject({ id: '0652', slotAt: 0, rid: 'r1' })
    swapActiveExercise(a, 1, { id: '0861', target: {}, sets: open() }, { loggedConfirmed: true })
    expect(a.entries.map(e => [e.id, e.slotAt])).toEqual([['0652', 0], ['0027', 1], ['0861', 1]])
  })

  it('a plan of its own does not outlive the exercise it was set for', () => {
    const a = { entries: [entry('0198', 0, { sets: open(), swapPlan: { sets: 5, reps: 5 } })] }
    swapActiveExercise(a, 0, { id: '0652', target: {}, sets: open() })
    expect(a.entries[0].swapPlan).toBeUndefined()
  })
})

describe('sessionRoutinePlans', () => {
  it('reads nothing from a session without the stamps (the watch, an older session)', () => {
    expect(sessionRoutinePlans({ entries: [entry('0198', 0)] }, [pull()])).toEqual([])
    expect(sessionRoutinePlans(null, [pull()])).toEqual([])
  })

  it('leaves out a routine of a combined day that was not trained at all, and one deleted since', () => {
    const push = { id: 'r2', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 80 }] }
    const { active } = sessionOf([pull(), push], ['r1', 'r2'])
    active.entries.forEach(e => { if (e.rid === 'r2') e.sets = open() })
    expect(sessionRoutinePlans(active, [pull(), push]).map(p => p.routineId)).toEqual(['r1'])
    expect(sessionRoutinePlans(active, [push])).toEqual([])
  })

  it('a slot swapped after some sets were logged became what was done last', () => {
    const routine = pull()
    const active = { ...plain(routine), entries: [entry('0198', 0), entry('0652', 0), entry('0027', 1), entry('0313', 2)] }
    expect(planFor(active, [routine]).slots[0]).toMatchObject({ from: '0198', to: '0652', pos: 1 })
    // The replacement never ticked: the slot stayed what it was.
    active.entries[1].sets = open()
    expect(planFor(active, [routine]).slots[0]).toMatchObject({ from: '0198', to: '0198', pos: 0 })
  })
})

describe('rewriteRoutine', () => {
  it('changes nothing when the session went as planned', () => {
    const routine = pull()
    const { st, active } = sessionOf([routine])
    expect(rewriteRoutine(routine, planFor(active, [routine]), st)).toBeNull()
  })

  it('a swap takes over the slot: rest, note, progression, sets and range', () => {
    const routine = pull()
    const active = { ...plain(routine), entries: [entry('0861', 0), entry('0027', 1), entry('0313', 2)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.changes).toEqual([{ kind: 'swap', from: '0198', to: '0861' }])
    expect(out.ex[0]).toMatchObject({ id: '0861', sets: 4, reps: 12, repsMin: 8, restSec: 90, note: 'Pause at the chest', prog: 'double' })
    expect(ids(out.ex)).toEqual(['0861', '0027', '0313'])
    expect(rewritesRoutine(out)).toBe(true)
  })

  it('a swap to bodyweight work does not carry the load', () => {
    const routine = pull()
    const active = { ...plain(routine), entries: [entry('0652', 0), entry('0027', 1), entry('0313', 2)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.ex[0]).toMatchObject({ id: '0652', sets: 4, weight: 0 })
  })

  it('a swap that set its own sets and reps keeps them', () => {
    const routine = pull()
    const active = { ...plain(routine), entries: [entry('0861', 0, { swapPlan: { sets: 5, reps: 6 } }), entry('0027', 1), entry('0313', 2)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.ex[0]).toMatchObject({ id: '0861', sets: 5, reps: 6, restSec: 90, prog: 'double' })
    // A plan with no range has no bottom to keep.
    expect(out.ex[0].repsMin).toBeUndefined()
  })

  it('a planned backup takes the slot and the old exercise becomes its first backup', () => {
    const routine = pull()
    routine.ex[0].subs = ['0652', '0861']
    const active = { ...plain(routine), entries: [entry('0861', 0), entry('0027', 1), entry('0313', 2)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.ex[0]).toMatchObject({ id: '0861', sets: 4, reps: 12, restSec: 90 })
    expect(out.ex[0].subs).toEqual(['0198', '0652'])
  })

  it('removes an exercise taken out of the session, and one skipped with no set done', () => {
    const routine = pull()
    // Hammer curl removed from the session: no entry is left for its slot.
    let active = { ...plain(routine), entries: [entry('0198', 0), entry('0027', 1)] }
    let out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.changes).toEqual([{ kind: 'remove', id: '0313' }])
    expect(ids(out.ex)).toEqual(['0198', '0027'])
    // Rows left unticked: skipped, the same as removed.
    active = { ...plain(routine), entries: [entry('0198', 0), entry('0027', 1, { sets: open() }), entry('0313', 2)] }
    out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.changes).toEqual([{ kind: 'remove', id: '0027' }])
    expect(ids(out.ex)).toEqual(['0198', '0313'])
    // The untouched slots are the routine's own, settings and all.
    expect(out.ex[0]).toEqual(routine.ex[0])
  })

  it('follows the order of the session', () => {
    const routine = pull()
    const active = { ...plain(routine), entries: [entry('0027', 1), entry('0198', 0), entry('0313', 2)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.changes).toEqual([{ kind: 'order' }])
    expect(ids(out.ex)).toEqual(['0027', '0198', '0313'])
    expect(rewritesRoutine(out)).toBe(true)
  })

  it('puts an exercise added in the session where it was done, set up as it was done', () => {
    const routine = pull()
    const raise = { id: '0334', rid: 'r1', addedInSession: true, target: { sets: 2, reps: 15, weight: 8 }, sets: ticked(2, 8) }
    const active = { ...plain(routine), entries: [entry('0198', 0), clone(raise), entry('0027', 1), entry('0313', 2)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.changes).toEqual([{ kind: 'add', id: '0334' }])
    expect(ids(out.ex)).toEqual(['0198', '0334', '0027', '0313'])
    expect(out.ex[1]).toMatchObject({ id: '0334', sets: 2, weight: 8 })
    expect(out.ex[1].addedInSession).toBeUndefined()
    expect(out.ex[1].rid).toBeUndefined()
    // Additions alone are what the summary's "New in this workout" already offers.
    expect(rewritesRoutine(out)).toBe(false)
    // One added and never ticked was not part of the workout.
    const skipped = { ...plain(routine), entries: [entry('0198', 0), { ...clone(raise), sets: open() }, entry('0027', 1), entry('0313', 2)] }
    expect(rewriteRoutine(routine, planFor(skipped, [routine]), clone(DEF))).toBeNull()
  })

  it('lists swaps, removals, additions and the order together', () => {
    const routine = pull()
    const raise = { id: '0334', rid: 'r1', addedInSession: true, target: { sets: 2, reps: 15, weight: 8 }, sets: ticked(2, 8) }
    const active = { ...plain(routine), entries: [entry('0027', 1), entry('0652', 0), clone(raise)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.changes).toEqual([
      { kind: 'swap', from: '0198', to: '0652' },
      { kind: 'remove', id: '0313' },
      { kind: 'add', id: '0334' },
      { kind: 'order' },
    ])
    expect(ids(out.ex)).toEqual(['0027', '0652', '0334'])
  })

  it('a swap inside a superset keeps the group, and a partner left alone loses its tag', () => {
    const routine = pull()
    routine.ex[1].sg = 'g1'
    routine.ex[2].sg = 'g1'
    routine.ex[1].sgName = 'Arms and back'
    let active = { ...plain(routine), entries: [entry('0198', 0), entry('0861', 1, { sg: 'g1' }), entry('0313', 2, { sg: 'g1' })] }
    let out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.ex.map(x => [x.id, x.sg])).toEqual([['0198', undefined], ['0861', 'g1'], ['0313', 'g1']])
    expect(out.ex[1].sgName).toBe('Arms and back')
    // The curl dropped: the row is no superset of one.
    active = { ...plain(routine), entries: [entry('0198', 0), entry('0027', 1, { sg: 'g1' })] }
    out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.ex.map(x => [x.id, x.sg])).toEqual([['0198', undefined], ['0027', undefined]])
  })

  it('a superset moved as a whole stays one, and one split by the new order comes apart', () => {
    const routine = pull()
    routine.ex[0].sg = 'g1'
    routine.ex[1].sg = 'g1'
    let active = { ...plain(routine), entries: [entry('0313', 2), entry('0198', 0, { sg: 'g1' }), entry('0027', 1, { sg: 'g1' })] }
    let out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.ex.map(x => [x.id, x.sg])).toEqual([['0313', undefined], ['0198', 'g1'], ['0027', 'g1']])
    active = { ...plain(routine), entries: [entry('0198', 0), entry('0313', 2), entry('0027', 1)] }
    out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.ex.every(x => x.sg === undefined)).toBe(true)
  })

  it('an exercise added into a superset in the session joins it; two of the same tag apart become two groups', () => {
    const routine = pull()
    routine.ex[0].sg = 'g1'
    routine.ex[1].sg = 'g1'
    const raise = { id: '0334', rid: 'r1', addedInSession: true, sg: 'g1', target: { sets: 2, reps: 15, weight: 8 }, sets: ticked(2, 8) }
    const active = { ...plain(routine), entries: [entry('0198', 0, { sg: 'g1' }), entry('0027', 1, { sg: 'g1' }), clone(raise), entry('0313', 2)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.ex.slice(0, 3).map(x => x.sg)).toEqual(['g1', 'g1', 'g1'])
    // The tags of a routine that already had a second group are kept apart.
    const two = pull()
    two.ex = [{ ...two.ex[0], sg: 'g1' }, { ...two.ex[1], sg: 'g1' }, { id: '0025', sets: 3, reps: 5, weight: 80 }, { ...two.ex[2], sg: 'g2' }, { id: '0201', sets: 3, reps: 12, weight: 20, sg: 'g2' }]
    const s2 = { id: 'a', routineIds: ['r1'], startSlots: startSlotsOf([two]), entries: [entry('0198', 0), entry('0027', 1), entry('0313', 3), entry('0201', 4), entry('0025', 2)] }
    const o2 = rewriteRoutine(two, planFor(s2, [two]), clone(DEF))
    expect(o2.ex.map(x => [x.id, x.sg])).toEqual([['0198', 'g1'], ['0027', 'g1'], ['0313', 'g2'], ['0201', 'g2'], ['0025', undefined]])
  })

  it('keeps the edits made to the routine while the session ran', () => {
    const routine = pull()
    const active = { ...plain(routine), entries: [entry('0861', 0), entry('0027', 1)] }
    const plan = planFor(active, [routine])
    // Meanwhile, in the routine editor: a new note on the row, a pushdown added after it, and
    // the hammer curl (removed in the session too) already gone.
    const edited = clone(routine)
    edited.ex[1].note = 'Strict, no swing'
    edited.ex.splice(2, 1, { id: '0201', sets: 3, reps: 12, weight: 20 })
    const out = rewriteRoutine(edited, plan, clone(DEF))
    expect(out.changes).toEqual([{ kind: 'swap', from: '0198', to: '0861' }])
    expect(ids(out.ex)).toEqual(['0861', '0027', '0201'])
    expect(out.ex[1].note).toBe('Strict, no swing')
  })

  it('does not bring back a slot the routine replaced while the session ran', () => {
    const routine = pull()
    const active = { ...plain(routine), entries: [entry('0861', 0), entry('0027', 1), entry('0313', 2)] }
    const plan = planFor(active, [routine])
    const edited = clone(routine)
    edited.ex[0] = { ...edited.ex[0], id: '0818' }
    expect(rewriteRoutine(edited, plan, clone(DEF))).toBeNull()
  })

  it('reads the same exercise twice as two slots, by its place among its twins', () => {
    const routine = { id: 'r1', name: 'Arms', ex: [{ id: '0313', sets: 3, reps: 12, weight: 14 }, { id: '0201', sets: 3, reps: 12, weight: 20 }, { id: '0313', sets: 2, reps: 20, weight: 8 }] }
    const active = { ...plain(routine), entries: [entry('0313', 0), entry('0201', 1), entry('0334', 2)] }
    const out = rewriteRoutine(routine, planFor(active, [routine]), clone(DEF))
    expect(out.changes).toEqual([{ kind: 'swap', from: '0313', to: '0334' }])
    expect(out.ex.map(x => [x.id, x.sets])).toEqual([['0313', 3], ['0201', 3], ['0334', 2]])
  })

  it('never empties a routine', () => {
    const routine = { id: 'r1', name: 'Solo', ex: [{ id: '0198', sets: 3, reps: 10, weight: 40 }, { id: '0027', sets: 3, reps: 8, weight: 60 }] }
    const active = { ...plain(routine), entries: [entry('0198', 0)] }
    const plan = planFor(active, [routine])
    const edited = clone(routine)
    edited.ex.splice(0, 1)
    expect(rewriteRoutine(edited, plan, clone(DEF))).toBeNull()
  })
})

describe('applyRoutineUpdate', () => {
  it('writes only the exercises of the routine and leaves the session alone', () => {
    const routine = pull()
    const active = { ...plain(routine), entries: [entry('0027', 1), entry('0652', 0)] }
    const before = clone(active)
    const plan = planFor(active, [routine])
    const draft = clone(routine)
    const changes = applyRoutineUpdate(draft, plan, clone(DEF))
    expect(changes.map(c => c.kind)).toEqual(['swap', 'remove', 'order'])
    expect(ids(draft.ex)).toEqual(['0027', '0652'])
    expect(draft.name).toBe('Pull A')
    expect(active).toEqual(before)
    // Applied once, the routine matches: the same plan has nothing left to do.
    expect(applyRoutineUpdate(draft, plan, clone(DEF))).toBeNull()
  })
})

describe('swapOwnPlan', () => {
  const slot = { id: '0861', sets: 4, reps: 12, repsMin: 8, weight: 50 }
  it('is null for a plan the swap was offered: the slot carried over, or the defaults', () => {
    expect(swapOwnPlan({ ...slot, weight: 30 }, [slot])).toBeNull()
    expect(swapOwnPlan({ id: '0861', sets: 3, reps: 10, weight: 0 }, [slot, { id: '0861', sets: 3, reps: 10 }])).toBeNull()
  })
  it('is the plan without its weight when the swap set its own', () => {
    expect(swapOwnPlan({ id: '0861', sets: 5, reps: 5, weight: 70 }, [slot, { id: '0861', sets: 3, reps: 10 }])).toEqual({ sets: 5, reps: 5 })
  })
})
