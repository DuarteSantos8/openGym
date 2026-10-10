// Tool-layer tests for mcp/src/tools.js against a PlanRule fixture: routines carry a rule per
// occurrence, workouts are logs (exposures) pointing at an immutable prescription in
// S.prescriptions. Built with the real engine (buildSessionExposures + buildCompletedSession),
// the same way the app starts and finishes a session, rather than a hand-rolled shape.
import { describe, beforeAll, beforeEach, afterEach, test, expect, vi } from 'vitest'
import { _seedStateForTests } from '../src/state.js'
import { TOOLS } from '../src/tools.js'
import { buildSessionExposures } from '../../frontend/src/lib/session-start.js'
import { buildCompletedSession } from '../../frontend/src/lib/finish-session.js'
import { entriesForExposures } from '../../frontend/src/lib/session-ui-adapter.js'
import { ruleOccurrence } from '../../frontend/src/lib/test-fixtures.js'
import { exOr } from '../../frontend/src/lib/exercises.js'
import { PRESET_IDS, defaultPlanRule } from '../../frontend/src/lib/prescription/index.js'
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
        ruleOccurrence(LEGPRESS, { preset: 'double', options: { load: { mode: 'absolute', value: 100, unit: 'kg' }, restSeconds: 90 } })
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

  test('reports pyramid sets as their per-set targets and rests', () => {
    const profile = baseProfile()
    profile.routines[0].ex.push(ruleOccurrence(BENCH, {
      preset: 'pyramid_reps', occurrenceId: 'occ-pyr',
      options: { sets: { min: 5, max: 5 }, setReps: [12, 8, 6, 'max', 12], setRest: [60, 60, 90, 0, 60] }
    }))
    _seedStateForTests(profile)
    const pyr = call('get_routine', { routine_id: 'r1' }).exercises.at(-1)
    expect(pyr).toMatchObject({ preset_id: 'pyramid_reps', pyramid: [12, 8, 6, 'max', 12], pyramid_rest_sec: [60, 60, 90, 0, 60], summary: '12 · 8 · 6 · Max · 12' })
    expect(pyr.preset_label).toMatch(/Pyramid sets/)
  })

  test('reports a program of several phases by its phase ids, in order', () => {
    const profile = baseProfile()
    profile.routines[0].ex.push(ruleOccurrence(BENCH, { preset: 'five_three_one', occurrenceId: 'occ-531' }))
    _seedStateForTests(profile)
    const wendler = call('get_routine', { routine_id: 'r1' }).exercises.at(-1)
    expect(wendler).toMatchObject({ preset_id: 'five_three_one', phases: ['w1', 'w2', 'w3', 'w4'] })
    expect(call('get_routine', { routine_id: 'r1' }).exercises[0]).not.toHaveProperty('phases')
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

describe('get_week_plan — coach week and pins', () => {
  // Today is the pinned Monday 2026-01-12. The planner's queue reuses three routines as its three
  // sessions; the queue was applied that morning.
  const TODAY = '2026-01-12'
  const names = { r1: 'Push Day', r2: 'Pull Day', r3: 'Leg Day' }
  const rid = name => Object.keys(names).find(id => names[id] === name)
  const SINCE = Date.parse('2026-01-12T08:00:00')
  let S
  beforeEach(() => {
    S = baseProfile()
    S.routines = Object.entries(names).map(([id, name]) => ({ id, name, ex: [ruleOccurrence(BENCH, { occurrenceId: 'o-' + id, routineId: id })] }))
    S.week = { 1: ['r1'], 3: ['r2'] }
    _seedStateForTests(S)
  })
  const seed = () => _seedStateForTests(S)
  const coachWeek = (over = {}) => {
    S.queue = { ids: ['r1', 'r2', 'r3'], since: SINCE, startsOn: TODAY, label: 'W1', ...over }
    S.week = {}
    seed()
  }
  const logged = (name, d = TODAY) => ({ id: 'w-' + name, d, start: SINCE + 3600000, end: SINCE + 7200000, routineIds: [rid(name)], routineId: rid(name), name, exposures: [] })

  test('without a coach week: coach_week is null, days run seven dates from today by the weekday plan', () => {
    const r = call('get_week_plan')
    expect(r.coach_week).toBeNull()
    expect(r.days.map(d => d.date)).toEqual(['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17', '2026-01-18'])
    expect(r.days[0]).toMatchObject({ weekday: 1, weekday_name: 'Monday', routine_names: ['Push Day'], planned_by: 'weekday' })
    expect(r.days[1]).toMatchObject({ routine_ids: [], routine_names: [], planned_by: 'rest' })
    expect(r.days[2]).toMatchObject({ routine_names: ['Pull Day'], planned_by: 'weekday' })
    expect(r.today_routine_ids).toEqual(['r1'])
    expect(r.today_routine_names).toEqual(['Push Day'])
  })

  test('a weekday holding several routines (combine routines) lists them all; the singular fields keep the first', () => {
    S.week[2] = ['r2', 'r3']
    seed()
    const r = call('get_week_plan')
    const tue = r.weekdays.find(d => d.weekday === 2)
    expect(tue.routine_ids).toEqual(['r2', 'r3'])
    expect(tue.routine_names).toEqual(['Pull Day', 'Leg Day'])
    expect(tue.routine_id).toBe('r2')
    expect(tue.routine_name).toBe('Pull Day')
    expect(r.days[1]).toMatchObject({ routine_names: ['Pull Day', 'Leg Day'], planned_by: 'weekday' })
    // …and a legacy single id still reads as a one-item list.
    S.week = { 1: 'r1' }
    seed()
    expect(call('get_week_plan').weekdays.find(d => d.weekday === 1).routine_ids).toEqual(['r1'])
  })

  test('a coach week: today is the first undone session, the other days carry nothing, and the week is described', () => {
    coachWeek()
    const r = call('get_week_plan')
    expect(r.coach_week).toMatchObject({ label: 'W1', starts_on: TODAY, waiting: false, complete: false })
    expect(r.coach_week.sessions.map(x => x.state)).toEqual(['next', 'later', 'later'])
    expect(r.coach_week.sessions.map(x => x.pinned_to)).toEqual([null, null, null])
    expect(r.today_routine_name).toBe('Push Day')
    expect(r.days[0]).toMatchObject({ routine_names: ['Push Day'], planned_by: 'coach' })
    r.days.slice(1).forEach(d => expect(d).toMatchObject({ routine_ids: [], planned_by: 'rest' }))
    // The weekday table is the user's own plan only — empty here.
    r.weekdays.forEach(d => expect(d.routine_ids).toEqual([]))
  })

  test('a done session moves today to the next one; the rest of the week still floats', () => {
    coachWeek()
    S.workouts.push(logged('Push Day'))
    seed()
    const r = call('get_week_plan')
    expect(r.coach_week.sessions.map(x => x.state)).toEqual(['done', 'next', 'later'])
    expect(r.today_routine_name).toBe('Pull Day')
    expect(r.days[0].planned_by).toBe('coach')
  })

  test('a session pinned to a date sits there, is skipped today, and the pin is fulfilled once done', () => {
    coachWeek()
    S.dayPlan['2026-01-14'] = 'r3'
    seed()
    let r = call('get_week_plan')
    expect(r.coach_week.sessions[2]).toMatchObject({ state: 'pinned', pinned_to: '2026-01-14' })
    expect(r.days[2]).toMatchObject({ date: '2026-01-14', routine_names: ['Leg Day'], planned_by: 'pinned' })
    expect(r.today_routine_name).toBe('Push Day')
    // Done early: the pin reads as no override and Wednesday goes back to floating (nothing there).
    S.workouts.push(logged('Leg Day'))
    seed()
    r = call('get_week_plan')
    expect(r.coach_week.sessions[2].state).toBe('done')
    expect(r.days[2]).toMatchObject({ routine_ids: [], planned_by: 'rest' })
  })

  test('a coach week waiting for its start day: today is the weekday plan, the week says when it starts', () => {
    coachWeek({ startsOn: '2026-01-19' })
    S.week = { 1: 'r1' }
    seed()
    const r = call('get_week_plan')
    expect(r.coach_week).toMatchObject({ waiting: true, starts_on: '2026-01-19' })
    expect(r.days[0]).toMatchObject({ routine_names: ['Push Day'], planned_by: 'weekday' })
  })

  test('the user\'s own weekday routine rides along beside the coach session', () => {
    coachWeek({ ids: ['r1', 'r2'] })
    S.week = { 1: ['r3'] }
    seed()
    const r = call('get_week_plan')
    expect(r.today_routine_names).toEqual(['Push Day', 'Leg Day'])
    expect(r.today_routine_name).toBe('Push Day')
    expect(r.days[0].planned_by).toBe('coach')
    expect(r.weekdays.find(d => d.weekday === 1).routine_names).toEqual(['Leg Day'])
  })

  test('rest and routine overrides are named as such', () => {
    coachWeek()
    S.dayPlan[TODAY] = 'rest'
    S.dayPlan['2026-01-13'] = 'r3'   // a coach id → a pin, not an override
    seed()
    let r = call('get_week_plan')
    expect(r.days[0]).toMatchObject({ routine_ids: [], planned_by: 'rest_override' })
    expect(r.days[1].planned_by).toBe('pinned')
    S.queue = null
    S.week = { 1: 'r1' }
    S.dayPlan = { '2026-01-13': 'r3' }
    seed()
    r = call('get_week_plan')
    expect(r.days[1]).toMatchObject({ routine_names: ['Leg Day'], planned_by: 'override' })
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

  test('"how many did I do in March" is answerable: matching_count and truncated', () => {
    const S = baseProfile()
    const wk = (id, d) => ({
      id, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), name: 'S', routineId: S.routines[0].id,
      exposures: []
    })
    S.workouts = []
    for (let i = 1; i <= 40; i++) S.workouts.push(wk('mar' + i, '2026-03-' + String((i % 28) + 1).padStart(2, '0')))
    for (let i = 1; i <= 300; i++) S.workouts.push(wk('jan' + i, '2026-01-' + String((i % 28) + 1).padStart(2, '0')))
    _seedStateForTests(S)
    const r = call('list_workouts', { from: '2026-03-01', to: '2026-03-31' })
    expect(r.total_count).toBe(340)          // unchanged meaning: all-time, before the filter
    expect(r.matching_count).toBe(40)        // in the range asked for
    expect(r.returned_count).toBe(25)        // and how many came back
    expect(r.truncated).toBe(true)
    expect(r.workouts.every(w => w.date.startsWith('2026-03'))).toBe(true)
    const whole = call('list_workouts', { from: '2026-03-01', to: '2026-03-31', limit: 200 })
    expect(whole.returned_count).toBe(40)
    expect(whole.truncated).toBe(false)
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

describe('main features on canonical sessions', () => {
  test('logged failure flags remain visible in labels and tool fields', () => {
    const profile = seedWithWorkout()
    profile.workouts[0].exposures[0].performance.sets[1].failure = true
    _seedStateForTests(profile)
    const [plain, failed] = call('get_workout', { workout_id: 'w1' }).entries[0].sets
    expect(plain).not.toHaveProperty('failure')
    expect(failed.failure).toBe(true)
    expect(failed.label).toContain(' F')
  })

  test('preview includes a custom exercise’s equipment-specific warm-ups without leaking its index', () => {
    const profile = baseProfile()
    profile.customEx = [{ id: 'my-barbell', n: 'My barbell lift', bp: 'upper legs', tg: 'quads', eq: 'barbell', custom: true }]
    const occurrence = ruleOccurrence('my-barbell', { preset: 'autoregulated', options: { load: { mode: 'absolute', value: 200, unit: 'kg' } } })
    occurrence.warmup = { mode: 'smart', count: 5 }
    profile.routines[0].ex = [occurrence]
    _seedStateForTests(profile)
    const rows = call('preview_session', { routine_id: 'r1' }).exercises[0].opening_sets
    expect(rows.filter(row => row.role === 'warmup')).toHaveLength(5)
    expect(rows[0]).toMatchObject({ role: 'warmup', w: 50 })
    expect(rows.filter(row => row.role === 'work')).toHaveLength(3)
    expect(exOr('my-barbell').missing).toBe(true)
  })

  test('deleted customs retain their historical muscle snapshots in balance', () => {
    const profile = seedWithWorkout()
    const exposure = profile.workouts[0].exposures[0]
    exposure.exerciseId = 'deleted-bench'
    exposure.muscleSnapshot = { id: 'deleted-bench', n: 'My bench', bp: 'chest', tg: 'pectorals', eq: 'barbell', sm: [] }
    _seedStateForTests(profile)
    const balance = call('muscle_balance', { period: 'all' })
    expect(balance.worked.find(row => row.slug === 'chest')?.effective_sets).toBeGreaterThan(0)
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
    profile.routines[0].ex = [ruleOccurrence(BENCH, { preset: 'autoregulated', options: { reps: { min: 8, max: 12 }, load: { mode: 'absolute', value: 60, unit: 'kg' }, loadTo: { mode: 'absolute', value: 80, unit: 'kg' } } })]
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
    profile.routines[0].ex[0] = ruleOccurrence(BENCH, { preset: 'autoregulated', options: { load: { mode: 'percent_1rm', percent: 70 } } })
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
    const rule = (over) => defaultPlanRule('autoregulated', { id: 'r', exerciseId: 'e', sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 }, load: { mode: 'empty' }, ...over })
    expect(ruleSummary(rule({ load: { mode: 'absolute', value: 60, unit: 'kg' } }))).toBe('3 × 5 · 60 kg')
    expect(ruleSummary(rule({ sets: { min: 3, max: 5 }, reps: { min: 8, max: 12 }, load: { mode: 'percent_1rm', percent: 70 } }))).toBe('3-5 × 8-12 · 70% 1RM')
    expect(ruleSummary(rule({ durationSeconds: { min: 30, max: 60 } }))).toBe('3 × 30-60 s')
    expect(ruleSummary(rule({}))).toBe('3 × 5')
  })

  test('a load range reads low-high', () => {
    const rule = (over) => defaultPlanRule('autoregulated', { id: 'r', exerciseId: 'e', sets: { min: 3, max: 3 }, reps: { min: 8, max: 12 }, ...over })
    expect(ruleSummary(rule({ load: { mode: 'absolute', value: 60, unit: 'kg' }, loadTo: { mode: 'absolute', value: 80, unit: 'kg' } }))).toBe('3 × 8-12 · 60-80 kg')
    expect(ruleSummary(rule({ load: { mode: 'percent_1rm', percent: 60 }, loadTo: { mode: 'percent_1rm', percent: 75 } }))).toBe('3 × 8-12 · 60-75% 1RM')
  })

  test('every preset id has a label', () => {
    for (const id of PRESET_IDS) expect(presetLabel(id), id).not.toBe(id)
  })
})

/* ---------- a workout's photos and videos ---------- */

// workouts[].media — progress photos and form-check clips — are the owner's own files. The MCP
// bridge answers from the same state file, so it must not pass on a single hash, poster or even
// the key: an LLM client has nothing to do with them.
describe('workout photos and videos never leave through MCP', () => {
  const HASH = 'a1'.repeat(32), POSTER = 'b2'.repeat(32)
  test('no tool answer carries them', () => {
    const S = seedWithWorkout()
    for (const w of S.workouts) {
      w.media = [{ kind: 'video', hash: HASH, mime: 'video/mp4', size: 900000, width: 720, height: 1280, dur: 9, codec: 'avc1', poster: { hash: POSTER, mime: 'image/webp', size: 9000, width: 270, height: 480 }, at: 1 }]
    }
    _seedStateForTests(S)
    const newest = call('list_workouts', {}).workouts[0]
    const answers = [
      call('list_workouts', {}),
      call('get_workout', newest.id ? { workout_id: newest.id } : { date: newest.date }),
      call('muscle_balance', { period: 'all' }),
      call('muscle_balance', { period: 'month' }),
    ]
    for (const a of answers) {
      const json = JSON.stringify(a)
      for (const leak of [HASH, POSTER, '"media"', '"poster"', 'video/mp4']) expect(json).not.toContain(leak)
    }
  })
})

/* ---------- the documented `to` default ---------- */

describe('`to` defaults to today, as documented', () => {
  test('a workout and a weigh-in dated in the future are not "the most recent"', () => {
    const S = seedWithWorkout()
    // Another device with a wrong clock writes a 2099 row. Both tools document `to` as
    // "Defaults to today" and had no default at all, so that row was listed first and read as
    // the latest weight.
    S.workouts.push({ id: 'w-future', d: '2099-01-01', name: 'Time Machine', routineId: S.routines[0].id, start: 1, end: 2, exposures: [] })
    S.bodyweight.push({ d: '2099-01-01', w: 1 })
    _seedStateForTests(S)
    const lw = call('list_workouts')
    expect(lw.workouts.map(w => w.date)).not.toContain('2099-01-01')
    expect(lw.workouts[0].date).toBe('2026-01-05')
    const bw = call('get_bodyweight')
    expect(bw.entries.map(e => e.date)).not.toContain('2099-01-01')
    expect(bw.latest.date).toBe('2026-01-08')
    expect(bw.latest.weight).toBe(79)
    // …and asking for them explicitly still works
    expect(call('list_workouts', { to: '2099-12-31' }).workouts[0].date).toBe('2099-01-01')
    expect(call('get_bodyweight', { to: '2099-12-31' }).latest.date).toBe('2099-01-01')
  })
})

/* ---------- argument validation at the real SDK boundary ---------- */

// Driven through McpServer + an in-memory transport with the registration loop from src/index.js,
// because the thing under test is what zod does to the arguments BEFORE a handler ever runs.
describe('date arguments must be dates the calendar has', () => {
  let client

  beforeAll(async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const server = new McpServer({ name: 'opengym', version: '0.1.0' })
    for (const t of TOOLS) {
      server.tool(t.name, t.description, t.schema, async (params) => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(t.handler(params || {}), null, 2) }] }
        } catch (err) {
          return { isError: true, content: [{ type: 'text', text: `${err.code || 'ERROR'}: ${err.message}` }] }
        }
      })
    }
    client = new Client({ name: 'tools-test', version: '1' })
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(st), client.connect(ct)])
  })

  const shot = (name, args) => client.callTool({ name, arguments: args }).then(
    r => ({ ok: !r.isError, text: r.content?.[0]?.text || '' }),
    e => ({ rejected: true, code: e.code, message: String(e.message) })
  )

  test('February 30th is refused, not answered for March 2nd', async () => {
    for (const [tool, args] of [
      ['preview_session', { date: '2026-02-30' }],
      ['get_workout', { date: '2026-02-30' }],
      ['list_workouts', { from: '2026-13-45' }],
      ['list_workouts', { to: '0000-00-00' }],
      ['get_bodyweight', { to: '2026-02-30' }],
      ['get_bodyweight', { from: '2025-02-29' }]      // 2024 had one, 2025 did not
    ]) {
      const r = await shot(tool, args)
      const where = `${tool} ${JSON.stringify(args)}`
      // The SDK answers an invalid-params rejection either as a throw or as an error result
      // carrying the same code; both are the -32602 the client sees, neither runs the handler.
      expect(r.ok, `${where} must be refused`).not.toBe(true)
      expect(String(r.code ?? r.text), where).toContain('-32602')
      expect(String(r.message ?? r.text), where).toMatch(/not a date the calendar has|must be YYYY-MM-DD/)
    }
  })

  test('real dates, including a leap day, still get through', async () => {
    for (const args of [{ from: '2026-02-28', to: '2026-07-27' }, { from: '2024-02-29' }]) {
      const r = await shot('list_workouts', args)
      expect(r.rejected).toBeUndefined()
      expect(r.ok).toBe(true)
    }
  })
})
