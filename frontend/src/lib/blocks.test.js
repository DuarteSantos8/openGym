import { describe, it, expect } from 'vitest'
import { supersetUnits } from './history.js'
import { FLOW_MAX_REST, isFlowUnit, blockOf, flowProgress, flowSetsOf, flowUnitAt, unitKey, unitViewOf } from './blocks.js'

// A session of five blocks, as the active workout holds them: superset id on the entry, target
// under `target`. The shapes are what the derivation is judged on — warm-up 15 s, skill 30 s,
// primary 90 s, accessories 60 s, cool-down 10 s.
const timed = (id, sg, sec, restSec, sets = 2) =>
  ({ id, sg, target: { mode: 'time', sets, sec, restSec }, sets: Array.from({ length: sets }, () => ({ sec, done: false })) })
const reps = (id, sg, r, restSec, sets = 3) =>
  ({ id, sg, target: { mode: 'reps', sets, reps: r, restSec }, sets: Array.from({ length: sets }, () => ({ r, w: 0, done: false })) })

const session = () => [
  timed('wu-jog', 'sg-warmup', 45, 15),
  timed('wu-cat-cow', 'sg-warmup', 35, 15),
  timed('1368', 'sg-warmup', 35, 15),
  timed('sk-side-plank', 'sg-skill', 30, 30),
  reps('sk-getup-half', 'sg-skill', 4, 30, 2),
  reps('0042', null, 6, 90),
  reps('0289', 'sg-m1', 10, 60),
  reps('0652', 'sg-m1', 8, 60),
  timed('1512', 'sg-cooldown', 35, 10),
  timed('1424', 'sg-cooldown', 35, 10),
  timed('1494', 'sg-cooldown', 35, 10, 1),
]

describe('flow blocks', () => {
  it('reads a warm-up and a cool-down off the session and leaves every other block alone', () => {
    const e = session()
    const units = supersetUnits(e)
    expect(units.map((_, i) => blockOf(e, units, i))).toEqual([
      'warmup',    // 3 timed movements, rest 15
      null,        // skill: a hold and a lift together, rest 30
      null,        // the primary, alone, rest 90
      null,        // accessories: reps, rest 60
      'cooldown',  // 3 timed holds, rest 10
    ])
  })

  it('takes the rest the block asks for, not the movements alone', () => {
    // The skill block's rest is 30 s and that is the whole difference: its side plank is held
    // exactly like a warm-up movement is. A cool-down slowed to 45 s between holds is a
    // sequence of exercises you rest between, and gets the ordinary screen.
    const held = [timed('a', 'sg-x', 30, 30), timed('b', 'sg-x', 30, 30)]
    expect(isFlowUnit(held, [0, 1])).toBe(false)
    const slow = [timed('a', 'sg-x', 30, 45), timed('b', 'sg-x', 30, 45)]
    expect(isFlowUnit(slow, [0, 1])).toBe(false)
    const flow = [timed('a', 'sg-x', 30, FLOW_MAX_REST), timed('b', 'sg-x', 30, FLOW_MAX_REST)]
    expect(isFlowUnit(flow, [0, 1])).toBe(true)
  })

  it('never calls a lone exercise, a mixed block or a block on the global rest a flow', () => {
    const e = session()
    expect(isFlowUnit(e, [5])).toBe(false)                          // one exercise is not a flow
    expect(isFlowUnit(e, [3, 4])).toBe(false)                       // one held, one counted
    // No rest of its own means the global rest timer — 90 s out of the box. Timed movements do
    // not make that a flow; the block has to ask for the short rest itself.
    const inherit = [{ id: 'a', sg: 'sg-x', target: { mode: 'time', sec: 30 }, sets: [] },
                     { id: 'b', sg: 'sg-x', target: { mode: 'time', sec: 30 }, sets: [] }]
    expect(isFlowUnit(inherit, [0, 1])).toBe(false)
    expect(isFlowUnit(null, [0, 1])).toBe(false)
    expect(blockOf(e, supersetUnits(e), 99)).toBe(null)
  })

  it("reads a routine's exercises as well as a session's entries", () => {
    // get_routine hands the MCP a flat config per exercise — no `target`, no `sets` rows. The
    // same block has to come back from that as from the session's entries.
    const routine = [
      { id: 'wu-jog', sg: 'sg-warmup', mode: 'time', sets: 2, sec: 45, restSec: 15 },
      { id: '1368', sg: 'sg-warmup', mode: 'time', sets: 2, sec: 35, restSec: 15 },
    ]
    expect(isFlowUnit(routine, [0, 1])).toBe(true)
    expect(blockOf(routine, supersetUnits(routine), 0)).toBe('warmup')
  })

  it('counts rounds from the first member with work, so uneven members still read right', () => {
    const e = session()
    const cool = [8, 9, 10]                       // two holds twice, one held once
    expect(flowProgress(e, cool)).toEqual({ round: 1, rounds: 2, done: false, at: 8 })
    // Round one done: the single-set stretch is spent, the other two are on their second.
    e[8].sets[0].done = true; e[9].sets[0].done = true; e[10].sets[0].done = true
    expect(flowProgress(e, cool)).toEqual({ round: 2, rounds: 2, done: false, at: 8 })
    // Part way through round two the round does not advance — it is counted from the member
    // that is furthest behind, not from whoever moved last.
    e[9].sets[1].done = true
    expect(flowProgress(e, cool)).toEqual({ round: 2, rounds: 2, done: false, at: 8 })
    e[8].sets[1].done = true
    expect(flowProgress(e, cool)).toEqual({ round: 2, rounds: 2, done: true, at: null })
    expect(flowProgress(e, [])).toEqual({ round: 0, rounds: 0, done: true, at: null })
  })

  it('points at the movement that comes next, not back at the one just held', () => {
    // The warm-up: three movements, twice over. Holding the first does not make it the thing
    // to do next just because its second round is still outstanding — that read sent the block
    // back to the same movement every time, which is the one thing a hands-free screen cannot do.
    const e = session()
    const wu = [0, 1, 2]
    expect(flowProgress(e, wu)).toEqual({ round: 1, rounds: 2, done: false, at: 0 })
    e[0].sets[0].done = true
    expect(flowProgress(e, wu)).toEqual({ round: 1, rounds: 2, done: false, at: 1 })
    e[1].sets[0].done = true
    expect(flowProgress(e, wu)).toEqual({ round: 1, rounds: 2, done: false, at: 2 })
    // Only once the round is closed does it start again at the top.
    e[2].sets[0].done = true
    expect(flowProgress(e, wu)).toEqual({ round: 2, rounds: 2, done: false, at: 0 })
  })

  // A per-side stretch in a cool-down: each set is a left row and a right row (v1.3.10 times the
  // two sides apart), and the set rows number the pair as one set. So does the flow: "Round 1 of
  // 2", not of 4, and a round is not done for the stretch until both sides are.
  it('counts a timed per-side pair as one set, done once both sides are', () => {
    const sided = (id, sets) => ({ id, sg: 'sg-cd', target: { mode: 'time', sets, sec: 30, restSec: 10, side: true },
      sets: Array.from({ length: sets }, () => [{ sec: 30, side: 'L', done: false }, { sec: 30, side: 'R', done: false }]).flat() })
    const e = [sided('cd-pigeon', 2), timed('1424', 'sg-cd', 35, 10)]
    expect(isFlowUnit(e, [0, 1])).toBe(true)
    expect(flowSetsOf(e[0])).toEqual([{ done: false }, { done: false }])
    expect(flowProgress(e, [0, 1])).toEqual({ round: 1, rounds: 2, done: false, at: 0 })

    e[0].sets[0].done = true                                  // the left side only
    expect(flowSetsOf(e[0])).toEqual([{ done: false }, { done: false }])
    expect(flowProgress(e, [0, 1])).toMatchObject({ round: 1, at: 0 })   // its right side is next

    e[0].sets[1].done = true                                  // both sides: the set is done
    expect(flowProgress(e, [0, 1])).toMatchObject({ round: 1, at: 1 })
    e[1].sets[0].done = true
    expect(flowProgress(e, [0, 1])).toMatchObject({ round: 2, at: 0 })
  })

  it('answers whether one exercise is inside a block that is running as a flow', () => {
    const entries = session()
    const active = { entries }
    expect(flowUnitAt(active, 0)).toEqual([0, 1, 2])      // a warm-up movement
    expect(flowUnitAt(active, 2)).toEqual([0, 1, 2])
    expect(flowUnitAt(active, 5)).toBe(null)              // the primary, alone
    expect(flowUnitAt(active, 6)).toBe(null)              // an accessory superset
    // The user putting the block back into rows is the handbrake: the shape has not changed, but
    // the block is no longer running itself, so nothing may act as though it is.
    expect(flowUnitAt({ entries, unitView: { 'sg-warmup': 'rows' } }, 0)).toBe(null)
    expect(flowUnitAt({ entries, unitView: { 'sg-warmup': 'flow' } }, 0)).toEqual([0, 1, 2])
    expect(flowUnitAt(null, 0)).toBe(null)
    expect(flowUnitAt(active, null)).toBe(null)
    expect(flowUnitAt(active, 99)).toBe(null)
  })

  // A saved workout open in the editor and a past workout being logged run nothing by
  // themselves. The bar's Pause, the hold chain and the get-ready count all ask here.
  it('runs no block in a workout that is not happening now', () => {
    const entries = session()
    expect(flowUnitAt({ entries, editingWorkoutId: 'w-saved' }, 0)).toBe(null)
    expect(flowUnitAt({ entries, backfill: { durationMin: 60, replaceId: null } }, 0)).toBe(null)
    expect(flowUnitAt({ entries, unitView: { 'sg-warmup': 'flow' }, backfill: { durationMin: 60 } }, 0)).toBe(null)
  })

  it('keys an override by the superset id, which outlives the indices', () => {
    const e = session()
    expect(unitKey(e, [0, 1, 2])).toBe('sg-warmup')
    expect(unitKey(e, [5])).toBe(null)            // nothing to remember about a lone exercise
    expect(unitKey(e, [])).toBe(null)
  })

  it('lets the block decide, the user overrule and the session layout have the rest', () => {
    const e = session()
    const units = supersetUnits(e)
    const at = (i, opts) => unitViewOf(e, units, i, opts)
    expect(at(0, { workoutView: 'cards' })).toBe('flow')
    expect(at(2, { workoutView: 'cards' })).toBe('cards')
    expect(at(2, { workoutView: 'list' })).toBe('list')
    // The header ⋮ turns this warm-up back into rows without touching the cool-down, and
    // "rows" means the session's own layout rather than a layout of its own — so a block taken
    // off the flow screen still follows the session when that is switched afterwards.
    const overrides = { 'sg-warmup': 'rows' }
    expect(at(0, { workoutView: 'list', overrides })).toBe('list')
    expect(at(0, { workoutView: 'compact', overrides })).toBe('compact')
    expect(at(4, { workoutView: 'list', overrides })).toBe('flow')
    // ... and cannot turn a block that is not a flow into one. A flow screen is a hold and a
    // countdown; a block of counted sets has nothing for it to run, so the card would show 0:00
    // over a Start that hands a 10-rep set to a 45 second hold while the timer bar offered
    // Cancel — flowUnitAt tests the shape, so it would have said the block was not in a flow.
    expect(at(3, { workoutView: 'cards', overrides: { 'sg-m1': 'flow' } })).toBe('cards')
    expect(at(3, { workoutView: 'list', overrides: { 'sg-m1': 'flow' } })).toBe('list')
    expect(unitViewOf(e, units, 0)).toBe('flow')
    expect(unitViewOf(e, units, 2)).toBe('cards')
  })

  // v1.4.0's Focus view shows one exercise at a time and steps on as its sets are ticked: a block
  // there is its rows, an override included, and nothing in it runs by itself.
  it('runs no block in the Focus view, and shows every block there as the Focus view does', () => {
    const e = session()
    const units = supersetUnits(e)
    expect(unitViewOf(e, units, 0, { workoutView: 'focus' })).toBe('focus')
    expect(unitViewOf(e, units, 0, { workoutView: 'focus', overrides: { 'sg-warmup': 'flow' } })).toBe('focus')
    expect(flowUnitAt({ entries: e }, 0, 'focus')).toBe(null)
    expect(flowUnitAt({ entries: e }, 0, 'cards')).toEqual([0, 1, 2])
    expect(flowUnitAt({ entries: e }, 0, 'list')).toEqual([0, 1, 2])
  })
})
