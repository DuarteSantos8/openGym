import { describe, it, expect } from 'vitest'
import { targetsFor, checkTarget, withSessionTarget, refusalsFor, markUsed, REST_MAX } from './session-targets.js'
import { REST_MAX as APP_REST_MAX } from './duration.js'
import { buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { modeOf, isPerSide } from './history.js'
import { mergeStates, STAMPED_MAPS } from './sync-merge.js'
import { STAMPED_MAPS as API_STAMPED_MAPS } from '../../../api/sync-stamps.js'

const helpers = { modeOf, isPerSide }
const DAY = '2026-11-09'
// The issue's synthetic example: three working sets, double progression over 6-10, one day's
// target of 3 × 60 kg × 8 with three warm-ups of its own.
const routine = { id: 'r1', name: 'Upper', prog: 'double', ex: [
  { id: '0025', sets: 3, reps: 10, repsMin: 6, weight: 55, prog: 'double', inc: 2.5 },
  { id: '0098', sets: 3, reps: 12, weight: 20 },
] }
const target = over => ({
  rid: 'r1', d: DAY, unit: 'kg', by: 'Coach Ana', _ts: 5,
  ex: [{ id: '0025', rows: [
    { w: 20, r: 5, warmup: true }, { w: 30, r: 3, warmup: true }, { w: 40, r: 3, warmup: true },
    { w: 60, r: 8, rest: 180 }, { w: 60, r: 8, rest: 180 }, { w: 60, r: 8, rest: 180 },
  ] }],
  ...over,
})
const state = (targets, over) => ({ unit: 'kg', routines: [routine], workouts: [], week: {}, sessionTargets: targets, active: { d: DAY }, ...over })

describe('session targets (#972)', () => {
  it('rest cap matches the app', () => expect(REST_MAX).toBe(APP_REST_MAX))

  it('opens the named exercise at the target rows: warm-ups typed, rests per row', () => {
    const S = state({ t1: target() })
    const entries = buildSessionEntries(S, routine)
    const bench = entries[0]
    expect(bench.sets).toHaveLength(6)
    expect(bench.sets.slice(0, 3).every(s => s.warmup === true && s.phase === 'warmup')).toBe(true)
    expect(bench.sets.slice(0, 3).map(s => [s.w, s.r])).toEqual([[20, 5], [30, 3], [40, 3]])
    expect(bench.sets.slice(3).map(s => [s.w, s.r, s.restSec, !!s.warmup])).toEqual([[60, 8, 180, false], [60, 8, 180, false], [60, 8, 180, false]])
    expect(bench.sessionTarget).toEqual({ id: 't1', by: 'Coach Ana' })
    // The routine's band is untouched: its target still holds the 6-10 range.
    expect(bench.target.repsMin).toBe(6)
    expect(bench.planned.reps).toBe(10)
    expect(routine.ex[0].reps).toBe(10)
    // The other exercise builds as the routine says.
    expect(entries[1].sessionTarget).toBeUndefined()
    expect(entries[1].sets.filter(s => !s.warmup).length).toBe(3)
  })

  it('does nothing on another day, for another routine or once used', () => {
    expect(buildSessionEntries(state({ t1: target({ d: '2026-11-10' }) }), routine)[0].sessionTarget).toBeUndefined()
    expect(buildSessionEntries(state({ t1: target({ rid: 'r2' }) }), routine)[0].sessionTarget).toBeUndefined()
    expect(buildSessionEntries(state({ t1: target({ used: 'w9' }) }), routine)[0].sessionTarget).toBeUndefined()
  })

  it('converts a target in lb into the profile unit', () => {
    const S = state({ t1: target({ unit: 'lb', ex: [{ id: '0025', rows: [{ w: 135, r: 5 }] }] }) })
    const row = buildSessionEntries(S, routine)[0].sets[0]
    expect(row.w).toBeCloseTo(61.235, 2)
  })

  it('refuses a target that does not fit, whole, and says why', () => {
    const cases = [
      [target({ unit: 'stone' }), 'kg or lb'],
      [target({ ex: [{ id: '9999', rows: [{ w: 1, r: 1 }] }] }), 'not in this routine'],
      [target({ ex: [{ id: '0025', rows: [{ w: 60 }] }] }), 'needs reps'],
      [target({ ex: [{ id: '0025', rows: [{ w: 20, r: 5, warmup: true }] }] }), 'no working rows'],
      [target({ ex: [{ id: '0025', rows: [{ w: 60, r: 8, rest: 99999 }] }] }), 'rest'],
      [target({ ex: [{ id: '0025', slot: 1, rows: [{ w: 60, r: 8 }] }] }), 'at that place'],
      [target({ d: '9/11/2026' }), 'date'],
    ]
    for (const [tg, why] of cases) {
      const checked = checkTarget({ ...tg, id: 'x' }, routine, helpers)
      expect(checked.ok).toBe(false)
      expect(checked.errors.join(' | ')).toContain(why)
    }
    // Refused whole: not even the rows that were fine are applied.
    const S = state({ t1: target({ ex: [...target().ex, { id: '9999', rows: [{ w: 1, r: 1 }] }] }) })
    expect(buildSessionEntries(S, routine)[0].sessionTarget).toBeUndefined()
    expect(refusalsFor(S, [routine], DAY, helpers)).toEqual([{ id: 't1', routine: 'Upper', errors: ['9999 is not in this routine'] }])
    expect(refusalsFor(S, [routine], '2026-11-10', helpers)).toEqual([])
  })

  it('refuses per-side and cardio exercises explicitly instead of guessing', () => {
    const r = { ...routine, ex: [{ id: '0025', sets: 3, reps: 10, side: true }] }
    expect(checkTarget(target(), r, helpers).errors[0]).toContain('per side')
  })

  it('the newest unused target for the day wins', () => {
    const S = { sessionTargets: { a: target({ _ts: 1 }), b: target({ _ts: 9 }), c: target({ _ts: 20, used: 'w' }) } }
    expect(targetsFor(S, 'r1', DAY).map(x => x.id)).toEqual(['b', 'a'])
  })

  it('leaves entries alone without a routine or targets', () => {
    const entries = [{ id: '0025', sets: [] }]
    expect(withSessionTarget({}, routine, entries, DAY, helpers)).toBe(entries)
  })

  it('is used once: the saved workout marks it, and history keeps no trace of the marker', () => {
    const map = { t1: target(), t2: target() }
    const entries = [{ id: '0025', sessionTarget: { id: 't1' }, sets: [{ w: 60, r: 8, done: true }] }]
    const out = markUsed(map, entries, 'w1', 50)
    expect(out.t1).toMatchObject({ used: 'w1', _ts: 50 })
    expect(out.t2.used).toBeUndefined()
    expect(map.t1.used).toBeUndefined()
    expect(markUsed(map, [{ id: 'x' }], 'w1')).toBe(map)
    const w = buildCompletedWorkout({ id: 'w1', d: DAY, start: 1, entries }, { end: 2 })
    expect('sessionTarget' in w.entries[0]).toBe(false)
  })

  it('syncs per target on both sides', () => {
    expect(STAMPED_MAPS).toContain('sessionTargets')
    expect(API_STAMPED_MAPS).toEqual(STAMPED_MAPS)
    const m = mergeStates({ _ts: 1, sessionTargets: { t1: target({ _ts: 9, used: 'w1' }) } }, { _ts: 2, sessionTargets: { t1: target({ _ts: 3 }), t2: target({ _ts: 4 }) } })
    expect(m.sessionTargets.t1.used).toBe('w1')
    expect(m.sessionTargets.t2).toBeTruthy()
  })
})
