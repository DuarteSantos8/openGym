import { describe, expect, it } from 'vitest'
import { buildCompletedWorkout } from './finish-workout.js'
import { cascadeWeight } from './history.js'
import { buildSessionEntries } from './session-start.js'
import { makeSideSet, setSideField, toggleSide, WEIGHT_ORIGIN_MANUAL } from './workout-model.js'

describe('completed workout boundary', () => {
  it('builds the same legacy-shaped record doFinishWorkout stores and keeps it visible', () => {
    const active = {
      id: 'active-1', d: '2026-08-08', start: 1000, routineIds: ['routine-1'], name: 'Push', bw: 80,
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }], topW: 60, target: { sets: 1, reps: 8 } }],
    }
    const completed = buildCompletedWorkout(active, { end: 2000, prs: [] })
    expect(completed).toEqual({
      id: 'active-1', d: '2026-08-08', start: 1000, end: 2000,
      routineIds: ['routine-1'], routineId: 'routine-1', name: 'Push', bw: 80,
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }], topW: 60, target: { sets: 1, reps: 8 } }],
      prs: []
    })
  })

  it('keeps interval workout metadata and entries without completed sets', () => {
    const active = {
      id: 'interval-1',
      d: '2026-10-08',
      start: 1000,
      routineIds: ['hiit'],
      name: 'HIIT',
      bw: null,
      interval: {
        round: 2,
        exercise: 1,
        phase: 'work',
        rounds: 4,
        exerciseCount: 3,
        workSec: 30,
        restSec: 15,
      },
      entries: [
        { id: 'burpees', sets: [], target: {} },
        { id: 'squats', sets: [], target: {} },
        { id: 'pushups', sets: [], target: {} },
      ],
    }

    const completed = buildCompletedWorkout(active, { end: 10000, prs: [] })

    expect(completed.type).toBe('interval')
    expect(completed.interval).toEqual({
      rounds: 4,
      workSec: 30,
      restSec: 15,
    })
    expect(completed.entries.map(e => e.id)).toEqual([
      'burpees',
      'squats',
      'pushups',
    ])
  })

  // planSec is live-session bookkeeping — the plan a hold displaced before it finished put aside
  // (Workout.startTimed). A finished session keeps only what was logged, so an unfinished row goes
  // back to recording its plan and the key never reaches S.workouts.
  it('never stores planSec: an unfinished row goes back to recording its plan', () => {
    const active = {
      id: 'a', d: '2026-09-18', start: 1000,
      entries: [{
        id: 'plank',
        sets: [
          { done: true, sec: 30, w: 0 },
          { done: false, sec: 3, planSec: 30, w: 0 },
          { done: true, sec: 28, planSec: 45, w: 0 },
        ],
      }],
    }
    const sets = buildCompletedWorkout(active, { end: 2000 }).entries[0].sets
    expect(sets).toEqual([
      { done: true, sec: 30, w: 0 },
      { done: false, sec: 30, w: 0 },      // the plan it was asking for, and what it held is gone
      { done: true, sec: 28, w: 0 },       // a logged row keeps its log
    ])
    expect(JSON.stringify(sets)).not.toContain('planSec')
  })

  // weightOrigin marks a load typed by hand during the session so a later edit of an earlier set
  // does not cascade over it (#209). History has nothing left to cascade: the saved rows carry
  // only the loads, and the plan the session was built from (`planned`) is kept as it was.
  it('never stores weightOrigin, on a row or on either side, and keeps the plan stamps', () => {
    const planned = { sets: 3, reps: 5, weight: 100 }
    let rows = [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: false }, { w: 100, r: 5, done: false }]
    rows[2] = { ...rows[2], w: 95, weightOrigin: WEIGHT_ORIGIN_MANUAL }
    rows[1] = { ...rows[1], w: 105, weightOrigin: WEIGHT_ORIGIN_MANUAL }
    rows = cascadeWeight(rows, 1, 105)
    expect(rows[2]).toMatchObject({ w: 95, weightOrigin: WEIGHT_ORIGIN_MANUAL })   // a manual row stays put
    rows = rows.map(row => ({ ...row, done: true }))
    let side = setSideField(makeSideSet({ w: 20, r: 16 }), 'L', 'w', 22.5)
    side.sides.L.weightOrigin = WEIGHT_ORIGIN_MANUAL
    side = toggleSide(toggleSide(side, 'L'), 'R')

    const active = {
      id: 'a', d: '2026-09-18', start: 1000, routineIds: ['r'],
      entries: [
        { id: '0025', rid: 'r', target: { ...planned }, planned, sets: rows },
        { id: 'lunge', rid: 'r', target: { sets: 1, reps: 16, side: true }, sets: [side] },
      ],
    }
    const saved = buildCompletedWorkout(active, { end: 2000 })
    expect(JSON.stringify(saved)).not.toContain('weightOrigin')
    expect(saved.entries[0].sets.map(s => s.w)).toEqual([100, 105, 95])
    expect(saved.entries[0].planned).toEqual(planned)
    expect(saved.entries[1].sets[0].sides).toMatchObject({ L: { w: 22.5, done: true }, R: { w: 20, done: true } })
    // The live rows keep their marks until the session is over.
    expect(active.entries[0].sets[2].weightOrigin).toBe(WEIGHT_ORIGIN_MANUAL)

    // The next session of the plan reads the loads back and carries no mark of its own.
    const st = { unit: 'kg', exWeights: {}, routines: [{ id: 'r', ex: [{ id: '0025', ...planned }] }], workouts: [saved] }
    const next = buildSessionEntries(st, st.routines[0])[0]
    expect(JSON.stringify(next.sets)).not.toContain('weightOrigin')
  })

  it('leaves the rows it has nothing to strip exactly as they are', () => {
    const rows = [{ done: true, w: 60, r: 8 }]
    const active = { id: 'a', d: '2026-09-18', start: 1000, entries: [{ id: '0025', sets: rows }] }
    expect(buildCompletedWorkout(active, { end: 2000 }).entries[0].sets[0]).toBe(rows[0])
  })

  it('mirrors routineIds → routineId, and tolerates a legacy scalar active.routineId', () => {
    const base = {
      id: 'w', d: '2026-08-08', start: 1,
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }], target: { sets: 1, reps: 8 } }],
    }
    const combined = buildCompletedWorkout({ ...base, routineIds: ['a', 'b'] })
    expect(combined.routineIds).toEqual(['a', 'b'])
    expect(combined.routineId).toBe('a')

    const legacy = buildCompletedWorkout({ ...base, routineId: 'only' })
    expect(legacy.routineIds).toEqual(['only'])
    expect(legacy.routineId).toBe('only')

    const freestyle = buildCompletedWorkout(base)
    expect(freestyle.routineIds).toEqual([])
    expect(freestyle.routineId).toBe(null)
  })

  it('carries per-entry rid and noProg onto the saved entry, written only when set', () => {
    const active = {
      id: 'w', d: '2026-08-08', start: 1, routineIds: ['strength', 'rehab'],
      entries: [
        { id: '0025', rid: 'strength', sets: [{ done: true, w: 60, r: 8 }], target: { sets: 1, reps: 8 } },
        { id: '0031', rid: 'rehab', noProg: true, sets: [{ done: true, w: 10, r: 12 }], target: { sets: 1, reps: 12 } },
      ],
    }
    const [a, b] = buildCompletedWorkout(active).entries
    expect(a.rid).toBe('strength')
    expect('noProg' in a).toBe(false)
    expect(b.rid).toBe('rehab')
    expect(b.noProg).toBe(true)
  })

  it('keeps the plan each entry was built from, next to the target the prescription moved', () => {
    const active = {
      id: 'w', d: '2026-08-08', start: 1, routineIds: ['strength'],
      entries: [
        { id: '0025', rid: 'strength', planned: { sets: 2, reps: 10, weight: 60 }, sets: [{ done: true, w: 62.5, r: 10 }], target: { sets: 2, reps: 10, weight: 62.5 } },
        { id: '0031', sets: [{ done: true, w: 10, r: 12 }], target: { sets: 1, reps: 12 } },
      ],
    }
    const [a, b] = buildCompletedWorkout(active).entries
    expect(a.planned).toEqual({ sets: 2, reps: 10, weight: 60 })
    expect('planned' in b).toBe(false)
  })

  it('derives topW from the highest completed non-warm-up work set, not stale entry data', () => {
    const active = {
      id: 'active-1', d: '2026-08-08', start: 1000,
      entries: [{
        id: '0025', topW: 80, target: { mode: 'reps', sets: 2, reps: 8 },
        sets: [
          { phase: 'warmup', done: true, w: 120, r: 8 },
          { done: true, w: 75, r: 8 },
          { done: true, w: 85, r: 7 },
          { done: false, w: 100, r: 8 },
        ],
      }],
    }

    expect(buildCompletedWorkout(active).entries[0].topW).toBe(85)
    expect(buildCompletedWorkout({
      ...active,
      entries: [{ ...active.entries[0], topW: 120 }],
    }).entries[0].topW).toBe(85)
  })

  it('keeps a legacy topW when old completed rows have no usable weight', () => {
    const active = {
      id: 'active-1', d: '2026-08-08', start: 1000,
      entries: [{ id: '0025', topW: 60, sets: [{ done: true, r: 8 }] }],
    }

    expect(buildCompletedWorkout(active).entries[0].topW).toBe(60)
  })

  it('writes the legacy excludeFromProgression mirror iff every completed entry is noProg', () => {
    const mk = entries => ({ id: 'w', d: '2026-08-08', start: 1, routineIds: ['x'], entries })
    const done = extra => ({ id: '0025', sets: [{ done: true, w: 30, r: 8 }], target: { sets: 1, reps: 8 }, ...extra })

    // rehab-only combined session → present
    expect(buildCompletedWorkout(mk([done({ noProg: true }), done({ id: '0031', noProg: true })])))
      .toHaveProperty('excludeFromProgression', true)
    // rehab + strength → absent
    expect(buildCompletedWorkout(mk([done({ noProg: true }), done({ id: '0031' })])))
      .not.toHaveProperty('excludeFromProgression')
    // all-normal → absent
    expect(buildCompletedWorkout(mk([done(), done({ id: '0031' })])))
      .not.toHaveProperty('excludeFromProgression')
  })

  it('persists a muscle snapshot only when the caller supplies one', () => {
    const active = {
      id: 'active-1', d: '2026-08-08', start: 1000,
      entries: [
        { id: 'catalogue', sets: [{ done: true }] },
        { id: 'custom', sets: [{ done: true }] },
      ],
    }
    const completed = buildCompletedWorkout(active, {
      end: 2000,
      snapshotFor: entry => entry.id === 'custom'
        ? { n: 'Custom lift', muscleWeights: { chest: 1 } }
        : null,
    })

    expect(completed.entries[0]).not.toHaveProperty('muscleSnapshot')
    expect(completed.entries[1].muscleSnapshot).toEqual({
      n: 'Custom lift', muscleWeights: { chest: 1 },
    })
  })
})

// Notes written during a session have to survive it, or "write a note during your workout"
// means "write a note and lose it when you tap Finish".
describe('session notes', () => {
  const active = (entry) => ({
    id: 'w1', d: '2026-08-25', start: 1, routineId: 'r1', name: 'Push', bw: null,
    entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }], ...entry }],
  })

  it('keeps a per-exercise note and its pin', () => {
    const w = buildCompletedWorkout(active({ note: '  narrower grip next time  ', notePin: true }))
    expect(w.entries[0].note).toBe('narrower grip next time')
    expect(w.entries[0].notePin).toBe(true)
  })

  it('keeps an unpinned note without inventing a pin', () => {
    const w = buildCompletedWorkout(active({ note: 'shoulder twinged' }))
    expect(w.entries[0].note).toBe('shoulder twinged')
    expect('notePin' in w.entries[0]).toBe(false)
  })

  it('writes no note fields at all when nothing was typed', () => {
    const w = buildCompletedWorkout(active({ note: '   ', notePin: true }))
    expect('note' in w.entries[0]).toBe(false)
    expect('notePin' in w.entries[0]).toBe(false)
  })

  it('keeps a whole-session note on the workout', () => {
    const a = active({})
    expect(buildCompletedWorkout({ ...a, note: 'slept badly' }).note).toBe('slept badly')
    expect('note' in buildCompletedWorkout(a)).toBe(false)
  })
})

// Discord (rubik_97): supersets appeared nowhere once the workout was saved, because the finish
// whitelist dropped the group tag every other screen reads them from.
describe('superset groups', () => {
  const done = { w: 40, r: 10, done: true }
  const open = { w: 40, r: 10, done: false }
  const active = entries => ({ id: 'w', d: '2026-09-17', start: 1, routineIds: ['r1'], name: 'Arms', entries })

  it('keeps the group on every member that was trained', () => {
    const w = buildCompletedWorkout(active([
      { id: 'a', sg: 'sg1', sets: [done], target: {} },
      { id: 'b', sg: 'sg1', sets: [done], target: {} },
      { id: 'c', sets: [done], target: {} },
    ]))
    expect(w.entries.map(e => e.sg)).toEqual(['sg1', 'sg1', undefined])
    expect('sg' in w.entries[2]).toBe(false)
  })

  it('drops the tag of a member whose partner was never trained', () => {
    const entries = [
      { id: 'a', sg: 'sg1', sets: [done], target: {} },
      { id: 'b', sg: 'sg1', sets: [open], target: {} },
      { id: 'c', sets: [done], target: {} },
    ]
    const w = buildCompletedWorkout(active(entries))
    expect(w.entries.map(e => e.id)).toEqual(['a', 'c'])
    expect('sg' in w.entries[0]).toBe(false)
    // the running session is not the one tidied up
    expect(entries[0].sg).toBe('sg1')
  })
})
