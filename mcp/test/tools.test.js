// Tool-layer tests for mcp/src/tools.js against a PlanRule fixture: routines carry a rule per
// occurrence, workouts are logs (exposures) pointing at an immutable prescription in
// S.prescriptions. Built with the real engine (buildSessionExposures + buildCompletedSession),
// the same way the app starts and finishes a session, rather than a hand-rolled shape.
import { describe, beforeEach, afterEach, test, expect, vi } from 'vitest'
import { _seedStateForTests } from '../src/state.js'
import { TOOLS } from '../src/tools.js'
import { buildSessionExposures } from '../../frontend/src/lib/session-start.js'
import { buildCompletedSession } from '../../frontend/src/lib/finish-session.js'
import { entriesForExposures } from '../../frontend/src/lib/session-ui-adapter.js'
import { ruleOccurrence } from '../../frontend/src/lib/test-fixtures.js'
import { PRESET_IDS } from '../../frontend/src/lib/prescription/index.js'
import { ruleSummary, presetLabel } from '../src/labels.js'

const byName = Object.fromEntries(TOOLS.map(t => [t.name, t.handler]))
function call(name, params = {}) {
  const h = byName[name]
  if (!h) throw new Error(`unknown tool ${name}`)
  return h(params)
}

const BENCH = '0025'     // barbell bench press — chest
const LEGPRESS = '0739'  // sled 45° leg press — quadriceps

const MONDAY_1 = new Date('2026-01-05T12:00:00Z').getTime()   // workout day
const MONDAY_2 = new Date('2026-01-12T12:00:00Z').getTime()   // "today" in most tests

const ctxAt = now => ({ now, newId: seed => seed, unit: 'kg' })

function baseProfile() {
  return {
    engineSchemaVersion: 2, unit: 'kg',
    prescriptions: {}, progression: {}, oneRepMaxes: {},
    customEx: [], week: { 1: ['r1'] }, dayPlan: {}, exWeights: {},
    bodyweight: [{ d: '2026-01-01', w: 80 }, { d: '2026-01-08', w: 79 }],
    targetW: 77,
    routines: [{
      id: 'r1', name: 'Push Day', emoji: 'figureStrength',
      ex: [
        // Bench: linear progression at the preset defaults (3 x 5 @ 20 kg).
        ruleOccurrence(BENCH),
        // Leg press: double progression, 3 x 8-12 @ 100 kg, its own rest.
        ruleOccurrence(LEGPRESS, { preset: 'double', patch: r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'absolute', value: 100, unit: 'kg' }, restSeconds: 90 } }) })
      ]
    }],
    workouts: []
  }
}

// Starts the fixture routine and finishes it through buildCompletedSession, so the log carries
// the same audit the app writes. Bench's last set is logged 5 kg above its prescribed load —
// the deliberate out-of-plan set get_workout has to surface; leg press is logged as prescribed.
function seedWithWorkout() {
  const profile = baseProfile()
  const routine = profile.routines[0]
  const exposures = buildSessionExposures(profile, routine, ctxAt(MONDAY_1))
  const entries = entriesForExposures(exposures, profile.prescriptions)
  entries.forEach(e => e.sets.forEach(s => { s.done = true }))
  entries[0].sets[2].w = 25
  const active = { id: 'w1', d: '2026-01-05', start: MONDAY_1, routineIds: ['r1'], name: 'Push Day', bw: 79.5, exposures, entries }
  const { session, progression } = buildCompletedSession(active, profile, { end: MONDAY_1 + 40 * 60000, newId: seed => seed, unit: 'kg' })
  profile.workouts.push({ ...session, prs: [BENCH] })
  profile.progression = { ...profile.progression, ...progression }
  return profile
}

beforeEach(() => {
  vi.useFakeTimers({ now: MONDAY_2, toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
})

/* ---------- no state / unsupported schema ---------- */

describe('profile gates', () => {
  test('no state file at all', () => {
    _seedStateForTests(null)
    expect(call('list_routines')).toMatchObject({ error: expect.stringContaining('no synced state') })
  })

  test('a v1 (pre-engine) profile is reported, not rendered empty', () => {
    _seedStateForTests({ unit: 'kg', routines: [{ id: 'r1', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 5 }] }], workouts: [] })
    const extraParams = { muscle_balance: { period: 'all' }, get_workout: { workout_id: 'anything' } }
    for (const name of ['list_routines', 'get_week_plan', 'list_workouts', 'get_bodyweight', 'estimate_1rm', 'muscle_balance', 'get_workout']) {
      const r = call(name, extraParams[name] || {})
      expect(r.error, `${name} should refuse a v1 profile`).toBe('engine_schema_unsupported')
      expect(r.engine_schema_version).toBe(1)
      expect(r.min_engine_schema).toBe(2)
    }
    const preview = call('preview_session', { routine_id: 'r1' })
    expect(preview.error).toBe('engine_schema_unsupported')
    expect(() => call('get_routine', { routine_id: 'r1' })).not.toThrow()
    expect(call('get_routine', { routine_id: 'r1' }).error).toBe('engine_schema_unsupported')
  })
})

/* ---------- list_routines / get_routine ---------- */

describe('list_routines', () => {
  test('reports the routine and every distinct preset in play', () => {
    _seedStateForTests(baseProfile())
    const r = call('list_routines')
    expect(r.unit).toBe('kg')
    expect(r.routines).toHaveLength(1)
    const push = r.routines[0]
    expect(push).toMatchObject({ id: 'r1', name: 'Push Day', exercise_count: 2, superset_groups: 0, exclude_from_progression: false })
    expect(push.presets.map(p => p.preset_id).sort()).toEqual(['double', 'linear'])
    expect(push.presets.find(p => p.preset_id === 'linear').preset_label).toBe('Linear progression')
  })
})

describe('get_routine', () => {
  test('reads each occurrence\'s own plan rule', () => {
    _seedStateForTests(baseProfile())
    const r = call('get_routine', { routine_id: 'r1' })
    expect(r.exercises).toHaveLength(2)

    const bench = r.exercises[0]
    expect(bench).toMatchObject({ id: BENCH, name: 'barbell bench press', mode: 'reps', preset_id: 'linear' })
    expect(bench).not.toHaveProperty('binding_mode')
    expect(bench).not.toHaveProperty('resolution_source')
    expect(bench.params).toMatchObject({ sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { value: 20, unit: 'kg' } })
    expect(bench.summary).toBe('3 × 5 · 20 kg')
    expect(bench.rest_sec).toBe(180)

    const legs = r.exercises[1]
    expect(legs).toMatchObject({ id: LEGPRESS, mode: 'reps', preset_id: 'double', rest_sec: 90 })
    expect(legs.params.reps).toEqual({ min: 8, max: 12 })
  })

  test('unknown routine throws ENOENT', () => {
    _seedStateForTests(baseProfile())
    expect(() => call('get_routine', { routine_id: 'nope' })).toThrow()
  })
})

/* ---------- get_week_plan ---------- */

describe('get_week_plan', () => {
  test('Monday resolves to the scheduled routine; every other weekday is rest', () => {
    _seedStateForTests(baseProfile())
    const r = call('get_week_plan')
    expect(r.today).toBe('2026-01-12')
    expect(r.today_routine_id).toBe('r1')
    const monday = r.weekdays.find(w => w.weekday === 1)
    expect(monday).toMatchObject({ routine_id: 'r1', routine_name: 'Push Day' })
    expect(monday.routine_ids).toEqual(['r1'])
    expect(r.weekdays.filter(w => w.weekday !== 1).every(w => w.routine_id === null)).toBe(true)
  })

  test('a rest override cancels an otherwise-scheduled day', () => {
    const profile = baseProfile()
    profile.dayPlan['2026-01-12'] = 'rest'
    _seedStateForTests(profile)
    expect(call('get_week_plan').today_routine_id).toBeNull()
  })
})

/* ---------- list_workouts / get_workout ---------- */

describe('list_workouts', () => {
  test('summarises the logged session', () => {
    _seedStateForTests(seedWithWorkout())
    const r = call('list_workouts')
    expect(r.total_count).toBe(1)
    const w = r.workouts[0]
    expect(w).toMatchObject({ id: 'w1', date: '2026-01-05', routine_id: 'r1', routine_name: 'Push Day', exercise_count: 2, sets_planned: 6, prs: 1 })
    expect(w.sets_done).toBe(6)   // every logged set is status 'completed', including the rep miss
    expect(w.volume).toBeGreaterThan(0)
  })

  test('two workouts on one date come back as an ambiguous choice', () => {
    const profile = seedWithWorkout()
    profile.workouts.push({ ...profile.workouts[0], id: 'w2', exposures: [] })
    _seedStateForTests(profile)
    const r = call('get_workout', { date: '2026-01-05' })
    expect(r.ambiguous).toBe(true)
    expect(r.workouts.map(w => w.id).sort()).toEqual(['w1', 'w2'])
  })
})

describe('get_workout', () => {
  test('distinguishes what was prescribed from what was observed, set by set', () => {
    _seedStateForTests(seedWithWorkout())
    const r = call('get_workout', { workout_id: 'w1' })
    expect(r.entries).toHaveLength(2)

    const bench = r.entries.find(e => e.id === BENCH)
    expect(bench.mode).toBe('reps')
    expect(bench.preset_id).toBe('linear')
    // What the plan asked for, at the exercise level.
    expect(bench.prescribed_target).toMatchObject({ sets: 3, reps: 5, weight: 20 })
    // Sets 0 and 1: logged exactly as prescribed. Set 2: prescribed 20 kg, logged 25 — the
    // deliberate mismatch — and both numbers have to survive independently, not collapse into one.
    expect(bench.sets[0].prescribed).toEqual({ reps_min: 5, reps_max: 5, weight: 20 })
    expect(bench.sets[0].observed).toMatchObject({ r: 5, w: 20 })
    expect(bench.sets[2].prescribed).toEqual({ reps_min: 5, reps_max: 5, weight: 20 })
    expect(bench.sets[2].observed).toMatchObject({ r: 5, w: 25 })
    expect(bench.sets[2].done).toBe(true)
    expect(bench.sets[2].role_label).toBe('Work set')

    const legs = r.entries.find(e => e.id === LEGPRESS)
    expect(legs.prescribed_target).toMatchObject({ sets: 3, reps_min: 8, reps_max: 12, weight: 100 })
    expect(legs.out_of_plan).toEqual([])
    expect(legs.sets.every(s => s.prescribed.weight === s.observed.w)).toBe(true)
  })

  test('get_workout lists out-of-plan fields from the saved audit', () => {
    _seedStateForTests(seedWithWorkout())
    const out = call('get_workout', { workout_id: 'w1' })
    expect(out.entries[0].out_of_plan).toEqual(['load'])
  })

  test('unknown workout_id throws ENOENT', () => {
    _seedStateForTests(seedWithWorkout())
    expect(() => call('get_workout', { workout_id: 'nope' })).toThrow()
  })

  test('neither date nor workout_id throws EINVAL', () => {
    _seedStateForTests(seedWithWorkout())
    expect(() => call('get_workout', {})).toThrow()
  })
})

/* ---------- get_bodyweight ---------- */

describe('get_bodyweight', () => {
  test('reports the goal delta on the latest weigh-in', () => {
    _seedStateForTests(baseProfile())
    const r = call('get_bodyweight')
    expect(r.goal).toBe(77)
    expect(r.count).toBe(2)
    expect(r.latest).toMatchObject({ date: '2026-01-08', weight: 79 })
    expect(r.latest.delta_vs_goal).toBeCloseTo(2)
  })
})

/* ---------- estimate_1rm ---------- */

describe('estimate_1rm', () => {
  test('best-ever estimate for one exercise, from the heavier-scoring set', () => {
    _seedStateForTests(seedWithWorkout())
    const r = call('estimate_1rm', { exercise_id: BENCH })
    expect(r.best.w).toBe(25)
    expect(r.best.r).toBe(5)   // the out-of-plan 25 kg set is the heaviest, logged as-is
    expect(r.trend).toHaveLength(1)
  })

  test('a PR table across all trained exercises when no exercise_id is given', () => {
    _seedStateForTests(seedWithWorkout())
    const r = call('estimate_1rm', {})
    expect(r.pr_table.map(p => p.exId).sort()).toEqual([BENCH, LEGPRESS].sort())
  })
})

/* ---------- muscle_balance ---------- */

describe('muscle_balance', () => {
  test('ranks the muscles the logged session actually worked', () => {
    _seedStateForTests(seedWithWorkout())
    const r = call('muscle_balance', { period: 'all' })
    expect(r.workouts_in_period).toBe(1)
    const chest = r.worked.find(m => m.slug === 'chest')
    const quads = r.worked.find(m => m.slug === 'quadriceps')
    expect(chest).toBeTruthy()
    expect(quads).toBeTruthy()
    expect(chest.effective_sets).toBeGreaterThan(0)
  })

  test('a period with no sessions reports every muscle neglected', () => {
    _seedStateForTests(seedWithWorkout())
    vi.setSystemTime(MONDAY_1 + 30 * 86400000)   // a month past the workout — well outside "this week"
    const r = call('muscle_balance', { period: 'week' })
    expect(r.workouts_in_period).toBe(0)
    expect(r.worked).toEqual([])
  })
})

/* ---------- preview_session ---------- */

describe('preview_session', () => {
  test('a fresh routine (no history) previews exactly its configured targets', () => {
    _seedStateForTests(baseProfile())
    const r = call('preview_session', { routine_id: 'r1', date: '2026-01-05' })
    expect(r.exercises).toHaveLength(2)

    const bench = r.exercises.find(e => e.id === BENCH)
    expect(bench).toMatchObject({ preset_id: 'linear', preset_label: 'Linear progression', prescription: { sets: 3, reps: 5, weight: 20 } })
    expect(bench).not.toHaveProperty('resolution_source')
    expect(bench.configured).toMatchObject({ reps: { min: 5, max: 5 }, load: { value: 20, unit: 'kg' } })
    expect(bench.changed).toEqual([])
    expect(bench.opening_sets.map(s => s.w)).toEqual([20, 20, 20])
    expect(bench.opening_sets[0].label).toMatch(/20.*5|5.*20/)

    const legs = r.exercises.find(e => e.id === LEGPRESS)
    expect(legs.prescription).toMatchObject({ reps_min: 8, reps_max: 12, weight: 100 })
    expect(r.overridden_count).toBe(0)
  })

  test('a load range previews its high end as weight_max', () => {
    const profile = baseProfile()
    profile.routines[0].ex = [ruleOccurrence(BENCH, { preset: 'autoregulated', patch: r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'absolute', value: 60, unit: 'kg' }, loadTo: { mode: 'absolute', value: 80, unit: 'kg' } } }) })]
    _seedStateForTests(profile)
    const [bench] = call('preview_session', { routine_id: 'r1' }).exercises
    expect(bench.prescription).toMatchObject({ weight: 60, weight_max: 80 })
    expect(bench.configured.summary).toBe('3 × 8-12 · 60-80 kg')
  })

  test('preview_session reports the generated prescription and why', () => {
    _seedStateForTests(baseProfile())
    const out = call('preview_session', { routine_id: 'r1' })
    expect(out.exercises[0]).toMatchObject({ preset_id: 'linear', preset_label: 'Linear progression', prescription: { sets: 3, reps: 5, weight: 20 } })
    expect(out.exercises[0].opening_sets.map(s => s.w)).toEqual([20, 20, 20])
  })

  test('a percent rule with no 1RM on file says why its loads are blank', () => {
    const profile = baseProfile()
    profile.routines[0].ex[0] = ruleOccurrence(BENCH, { preset: 'manual', patch: r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'percent_1rm', percent: 70 } } }) })
    _seedStateForTests(profile)
    const bench = call('preview_session', { routine_id: 'r1' }).exercises[0]
    expect(bench.prescription.why).toMatch(/no 1RM on file/)
  })

  test('rest day reports no routine rather than throwing', () => {
    const profile = baseProfile()
    profile.week = {}
    _seedStateForTests(profile)
    const r = call('preview_session', {})
    expect(r.rest_day).toBe(true)
    expect(r.exercises).toEqual([])
  })

  test('previewing after a logged session is history-aware and never crashes', () => {
    _seedStateForTests(seedWithWorkout())
    const r = call('preview_session', { routine_id: 'r1', date: '2026-01-19' })
    expect(r.exercises).toHaveLength(2)
    expect(r.exercises.every(e => e.prescription.sets === 3)).toBe(true)
  })

  test('unknown routine throws ENOENT', () => {
    _seedStateForTests(baseProfile())
    expect(() => call('preview_session', { routine_id: 'nope' })).toThrow()
  })
})

/* ---------- ruleSummary / preset labels ---------- */

describe('ruleSummary', () => {
  test('one line per load kind and rep shape', () => {
    const rule = (over) => ({ parameters: { sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'empty' }, ...over } })
    expect(ruleSummary(rule({ load: { mode: 'absolute', value: 60, unit: 'kg' } }))).toBe('3 × 5 · 60 kg')
    expect(ruleSummary(rule({ sets: { min: 3, max: 5 }, reps: { min: 8, max: 12 }, load: { mode: 'percent_1rm', percent: 70 } }))).toBe('3-5 × 8-12 · 70% 1RM')
    expect(ruleSummary(rule({ durationSeconds: { min: 30, max: 60 } }))).toBe('3 × 30-60 s')
    expect(ruleSummary(rule({}))).toBe('3 × 5')
  })

  test('a load range reads low-high', () => {
    const rule = (over) => ({ parameters: { sets: { min: 3, max: 3 }, reps: { min: 8, max: 12 }, ...over } })
    expect(ruleSummary(rule({ load: { mode: 'absolute', value: 60, unit: 'kg' }, loadTo: { mode: 'absolute', value: 80, unit: 'kg' } }))).toBe('3 × 8-12 · 60-80 kg')
    expect(ruleSummary(rule({ load: { mode: 'percent_1rm', percent: 60 }, loadTo: { mode: 'percent_1rm', percent: 75 } }))).toBe('3 × 8-12 · 60-75% 1RM')
  })

  test('every preset id has a label', () => {
    for (const id of PRESET_IDS) expect(presetLabel(id), id).not.toBe(id)
  })
})
