// Tool-layer tests for mcp/src/tools.js, seeded from frontend/src/lib/demoSeed.js — the same
// deterministic fixture the public demo runs on. The pure lib functions have their own 92
// tests in frontend/src/lib/*.test.js; here we pin JSON shape + the user-facing edge cases
// (rest-day override, missing routine, zero-workout history, no synced state, superset links).
import { describe, beforeAll, afterAll, beforeEach, test, expect, vi } from 'vitest'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'
import { EXDB } from '../../frontend/src/lib/exercises.js'
import { _seedStateForTests } from '../src/state.js'
import { TOOLS } from '../src/tools.js'
import { bestSetOf } from '../../frontend/src/lib/onerm.js'

// Re-stated here so the assertions stand alone without reaching into lib internals to learn
// the demo state's exact values.
const FAKE_TODAY_ISO = '2026-07-27'                         // Monday — Push Day is scheduled
const GOAL_WEIGHT = 77
// Re-pinned against the v1.2.4 seed, which moved when the demo learned about bodyweight work
// and effort. Hand-checked rather than copied off a failing run: 18412.5 is the sum of w×r
// over the twenty completed sets, and 1.3 is 78.3 − 77.
const NEWEST_WORKOUT = { date: '2026-07-24', name: 'Leg Day', volume: 18412.5, bw: 78.4, sets_done: 20, sets_total: 20, duration: '1h 11m' }
const LATEST_BW = { date: '2026-07-27', weight: 78.3, delta: 1.3 }
const LEG_PRESS_ID = '0739'                                 // sled 45° leg press in the demo data
const LEG_PRESS_BEST = { w: 152.5, r: 12, epley: 213.5, brzycki: 219.6 }

const byName = Object.fromEntries(TOOLS.map(t => [t.name, t.handler]))

let S = null

function call(name, params = {}) {
  const h = byName[name]
  if (!h) throw new Error(`unknown tool ${name}`)
  return h(params)
}

function freshState() {
  const s = buildDemoState()
  s.unit = 'kg'
  return s
}

// Pin "today" before building state so dayPlan/week alignment matches the assertions below.
// `toFake: ['Date']` only — keeps fs.watch and the rest of the event loop real.
beforeAll(() => {
  vi.useFakeTimers({ now: new Date(FAKE_TODAY_ISO + 'T12:00:00Z'), toFake: ['Date'] })
  S = freshState()
  _seedStateForTests(S)
})

afterAll(() => {
  vi.useRealTimers()
})

// Fresh state per test — tests that mutate dayPlan can't leak into siblings.
beforeEach(() => {
  S = freshState()
  _seedStateForTests(S)
})

/* ---------- list_routines ---------- */

describe('list_routines', () => {
  test('returns the three starter routines with names + counts', () => {
    const r = call('list_routines')
    expect(r.unit).toBe('kg')
    expect(r.routines.length).toBe(3)
    expect(r.routines.map(x => x.name).sort()).toEqual(['Leg Day', 'Pull Day', 'Push Day'])
    r.routines.forEach(rn => {
      expect(typeof rn.id).toBe('string')
      expect(rn.exercise_count).toBeGreaterThan(0)
      expect(typeof rn.superset_groups).toBe('number')
      expect(['off', 'linear', 'greyskull', 'double', 'time']).toContain(rn.policy)
    })
  })

  test('reports progression exclusion in routine summaries and details', () => {
    S.routines[0].excludeFromProgression = true
    const summary = call('list_routines').routines.find(r => r.id === S.routines[0].id)
    const detail = call('get_routine', { routine_id: S.routines[0].id })

    expect(summary.exclude_from_progression).toBe(true)
    expect(detail.exclude_from_progression).toBe(true)
  })

  test('list_routines entries line up with get_routine (no id drift)', () => {
    const list = call('list_routines').routines
    list.forEach(summary => {
      const detail = call('get_routine', { routine_id: summary.id })
      expect(detail.id).toBe(summary.id)
      expect(detail.name).toBe(summary.name)
      expect(detail.exercises.length).toBe(summary.exercise_count)
    })
  })
})

/* ---------- get_routine ---------- */

describe('get_routine', () => {
  test('returns the full exercise list for Push Day with per-exercise summaries', () => {
    const push = call('list_routines').routines.find(x => x.name === 'Push Day')
    const r = call('get_routine', { routine_id: push.id })
    expect(r.name).toBe('Push Day')
    expect(r.exercises.length).toBe(push.exercise_count)
    expect(r.policy_name).toBeTruthy()
    r.exercises.forEach(e => {
      expect(['reps', 'time', 'cardio']).toContain(e.mode)
      // Every summary has "N × M" with a non-ASCII × (the lib uses U+00D7, not ASCII 'x')
      expect(e.summary).toMatch(/\d+\s*×\s*\d+/)
      expect(e.superset_group === null || typeof e.superset_group === 'string').toBe(true)
    })
  })

  test('resolves custom exercises from the current profile state', () => {
    const custom = { id: 'cx-sled-drag', n: 'Sled drag', bp: 'upper legs' }
    S.customEx = [custom]
    S.routines[0].ex.push({ id: custom.id, sets: 3, reps: 20 })

    const r = call('get_routine', { routine_id: S.routines[0].id })
    expect(r.exercises.at(-1)).toMatchObject({
      id: custom.id,
      name: 'Sled drag',
      body_part: 'upper legs'
    })
  })

  test('returns both bounds of a reps range', () => {
    const cfg = S.routines[0].ex[0]
    Object.assign(cfg, { mode: 'reps', reps: 8, repsMin: 8, repsMax: 12 })

    const r = call('get_routine', { routine_id: S.routines[0].id })
    expect(r.exercises[0]).toMatchObject({ reps: 8, reps_min: 8, reps_max: 12 })
  })

  test('summarises a double-progression range as the range, not as its top', () => {
    Object.assign(S.routines[0].ex[0], { mode: 'reps', sets: 3, reps: 12, repsMin: 8, weight: 40 })
    const r = call('get_routine', { routine_id: S.routines[0].id })
    expect(r.exercises[0].summary).toBe('3 × 8–12 · 40 kg')
  })

  test('reports an exercise\'s own rest, and leaves it out when it inherits the timer', () => {
    S.routines[0].ex[0].restSec = 180
    delete S.routines[0].ex[1]?.restSec

    const r = call('get_routine', { routine_id: S.routines[0].id })
    expect(r.exercises[0].rest_sec).toBe(180)
    // An exercise with no rest of its own inherits the global timer. Absent says that;
    // a zero would read as "no rest at all", which is a different prescription.
    expect(JSON.parse(JSON.stringify(r)).exercises[1]).not.toHaveProperty('rest_sec')
  })

  test('projects routine and exercise progression rules from prog', () => {
    S.routines[0].prog = 'greyskull'
    S.routines[0].ex[0].prog = 'double'

    const r = call('get_routine', { routine_id: S.routines[0].id })
    expect(r).toMatchObject({ policy: 'greyskull', policy_name: 'Greyskull LP' })
    expect(r.exercises[0].policy_override).toBe('double')
  })

  test('a routine with no prog reports the policy the app actually runs, not off', () => {
    delete S.routines[0].prog
    delete S.routines[0].ex[0].prog

    // policyFor defaults reps to linear (progression.js:73) and RoutineEdit.jsx:59 shows
    // that same default, so reporting 'off' here would misdescribe every untouched routine.
    const r = call('get_routine', { routine_id: S.routines[0].id })
    expect(r.policy).toBe('linear')
    expect(r.exercises[0].policy).toBe('linear')
    expect(r.exercises[0].policy_override).toBeNull()
  })

  test('a policy the mode cannot run is clamped, not echoed back raw', () => {
    S.routines[0].prog = 'greyskull'                       // reps-only policy
    S.customEx = [{ id: 'cx-plank', n: 'Plank', bp: 'waist' }]
    S.routines[0].ex.push({ id: 'cx-plank', mode: 'time', sets: 3, sec: 60 })

    const view = call('get_routine', { routine_id: S.routines[0].id }).exercises.at(-1)
    expect(view.mode).toBe('time')
    expect(view.policy).toBe('off')      // POLICIES_FOR.time excludes greyskull
  })

  test('throws ENOENT on a bogus routine id', () => {
    expect(() => call('get_routine', { routine_id: 'bogus' })).toThrow()
  })

  test('reports superset links when an adjacent pair shares an sg id', () => {
    // Inject a superset pair into a clone, since the starter plan has none.
    S.routines[0].ex[0].sg = 'A'
    S.routines[0].ex[1].sg = 'A'
    const r = call('get_routine', { routine_id: S.routines[0].id })
    expect(r.exercises[0].superset_group).toBe('A')
    expect(r.exercises[1].superset_group).toBe('A')
    expect(r.exercises[2].superset_group).toBeNull()
  })

  test('preserves mode + per-mode fields for a timed entry and a cardio entry', () => {
    // Append synthetic entries the starter plan doesn't ship: a timed plank (sec, no w) and a
    // cardio treadmill block (min + speed). These exercise ids don't exist in EXDB, so exOr
    // returns a placeholder named "Unknown exercise" — that's fine, we test the cfg fields.
    const push = S.routines.find(r => r.name === 'Push Day')
    push.ex.push({ id: 'synth-plank', sets: 3, sec: 60, weight: 0, mode: 'time' })
    push.ex.push({ id: 'synth-treadmill', sets: 1, min: 20, speed: 8, mode: 'cardio' })
    const r = call('get_routine', { routine_id: push.id })
    const t = r.exercises[r.exercises.length - 2]
    const c = r.exercises[r.exercises.length - 1]
    expect(t.mode).toBe('time')
    expect(t.sec).toBe(60)
    expect(t.reps).toBeUndefined()
    expect(c.mode).toBe('cardio')
    expect(c.min).toBe(20)
    expect(c.speed).toBe(8)
  })
})

/* ---------- get_week_plan ---------- */

describe('get_week_plan', () => {
  test('reports each weekday in getDay() order (Sunday=0 … Saturday=6) with names', () => {
    const r = call('get_week_plan')
    expect(r.weekdays.length).toBe(7)
    expect(r.weekdays.map(d => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(r.weekdays.map(d => d.weekday_name))
      .toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
  })

  test('today is the pinned Monday, and Push Day is scheduled', () => {
    const r = call('get_week_plan')
    expect(r.today).toBe(FAKE_TODAY_ISO)
    const push = S.routines.find(x => x.name === 'Push Day')
    expect(r.today_routine_id).toBe(push.id)
    expect(r.today_routine_name).toBe('Push Day')
  })

  test('week[1]/[3]/[5] map to Push/Pull/Leg, other weekdays are rest', () => {
    const r = call('get_week_plan')
    const byWd = Object.fromEntries(r.weekdays.map(d => [d.weekday, d]))
    expect(byWd[1].routine_name).toBe('Push Day')
    expect(byWd[3].routine_name).toBe('Pull Day')
    expect(byWd[5].routine_name).toBe('Leg Day')
    ;[0, 2, 4, 6].forEach(wd => {
      expect(byWd[wd].routine_id).toBeNull()
      expect(byWd[wd].routine_name).toBeNull()
    })
  })

  test('a "rest" override on today cancels the scheduled routine', () => {
    // Sanity check first — without the override, today has a routine.
    const before = call('get_week_plan')
    expect(before.today_routine_id).not.toBeNull()
    S.dayPlan[FAKE_TODAY_ISO] = 'rest'
    const after = call('get_week_plan')
    expect(after.today_routine_id).toBeNull()
    expect(after.today_routine_name).toBeNull()
    // The override is surfaced on the matching weekday entry.
    const todayWd = new Date(FAKE_TODAY_ISO + 'T12:00:00Z').getDay()
    expect(after.weekdays.find(d => d.weekday === todayWd).override_for_today_or_null).toBe('rest')
  })

  test('a routine-id override on today replaces the weekday default', () => {
    const legs = S.routines.find(r => r.name === 'Leg Day')
    S.dayPlan[FAKE_TODAY_ISO] = legs.id
    const r = call('get_week_plan')
    expect(r.today_routine_id).toBe(legs.id)
    expect(r.today_routine_name).toBe('Leg Day')
  })

  test('empty week + no override → today has no routine (a quiet Sunday)', () => {
    S.week = {}
    S.dayPlan = {}
    const r = call('get_week_plan')
    expect(r.today_routine_id).toBeNull()
    expect(r.today_routine_name).toBeNull()
    r.weekdays.forEach(d => expect(d.routine_id).toBeNull())
  })
})

/* ---------- list_workouts ---------- */

describe('list_workouts', () => {
  test('newest first, with computed volume/duration matching hand-calculated values', () => {
    const r = call('list_workouts', {})
    expect(r.returned_count).toBeGreaterThan(0)
    expect(r.total_count).toBeGreaterThanOrEqual(r.returned_count)
    // newest-first check
    const dates = r.workouts.map(w => w.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    // The newest workout is the Friday before the pinned Monday today.
    expect(r.workouts[0].date).toBe(NEWEST_WORKOUT.date)
    expect(r.workouts[0].routine_name).toBe(NEWEST_WORKOUT.name)
    expect(r.workouts[0].volume).toBe(NEWEST_WORKOUT.volume)
    expect(r.workouts[0].sets_done).toBe(NEWEST_WORKOUT.sets_done)
    expect(r.workouts[0].sets_planned).toBe(NEWEST_WORKOUT.sets_total)
    expect(r.workouts[0].sets_ratio).toBe(`${NEWEST_WORKOUT.sets_done}/${NEWEST_WORKOUT.sets_total}`)
    // Past the hour the lib switches format, so the expectation carries the rendered string
    // rather than assuming a "N min" shape that only held while the session was shorter.
    expect(r.workouts[0].duration).toBe(NEWEST_WORKOUT.duration)
    expect(r.workouts[0].bodyweight_at_workout).toBe(NEWEST_WORKOUT.bw)
    r.workouts.forEach(w => {
      expect(w.sets_done).toBeLessThanOrEqual(w.sets_planned)
      expect(typeof w.volume).toBe('number')
      expect(w.sets_ratio).toMatch(/^\d+\/\d+$/)
    })
  })

  test('date range filter narrows results (closed interval, both endpoints inclusive)', () => {
    const all = call('list_workouts')
    expect(all.workouts.length).toBeGreaterThan(2)
    const earliest = all.workouts[all.workouts.length - 1].date
    // closed on both ends — earliest's own date should still appear
    const restricted = call('list_workouts', { from: earliest, to: earliest })
    expect(restricted.returned_count).toBe(1)
    expect(restricted.workouts[0].date).toBe(earliest)
  })

  test('a from > to range yields zero workouts (not an error, not silently everything)', () => {
    const r = call('list_workouts', { from: '2026-07-27', to: '2026-01-01' })
    expect(r.returned_count).toBe(0)
    expect(r.workouts).toEqual([])
    expect(r.total_count).toBeGreaterThan(0)  // total still reflects the real history
  })

  test('respects limit (caps returned_count, never total_count)', () => {
    const r = call('list_workouts', { limit: 3 })
    expect(r.returned_count).toBeLessThanOrEqual(3)
    expect(r.total_count).toBeGreaterThanOrEqual(r.returned_count)
  })

  test('"how many did I do in March" is answerable: matching_count and truncated', () => {
    const wk = (id, d) => ({
      id, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), name: 'S', routineId: S.routines[0].id,
      entries: [{ id: '0025', target: { sets: 1, reps: 5, weight: 100 }, sets: [{ done: true, w: 100, r: 5 }] }]
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

/* ---------- get_workout ---------- */

describe('get_workout', () => {
  test('matches the newest workout from list_workouts, every set has a readable label', () => {
    const list = call('list_workouts', {}).workouts
    const w = call('get_workout', { date: list[0].date })
    expect(w.date).toBe(list[0].date)
    expect(w.entries.length).toBe(list[0].exercise_count)
    expect(w.volume).toBe(list[0].volume)
    w.entries.forEach(e => {
      expect(['reps', 'time', 'cardio']).toContain(e.mode)
      e.sets.forEach(s => {
        expect(typeof s.label).toBe('string')
        expect(s.label.length).toBeGreaterThan(0)
      })
    })
  })

  test('throws ENOENT on a date with no workout', () => {
    expect(() => call('get_workout', { date: '1900-01-01' })).toThrow()
  })

  test('two sessions on one day are both reachable, and the date alone never picks one silently', () => {
    // Lifting in the morning, a run in the evening: ordinary, and it used to make the second
    // session unreachable while questions about it were answered with the first one's numbers.
    const day = '2026-07-26'
    S.workouts.push(
      { id: 'w-morning', d: day, name: 'Pull', start: 1000, end: 1000 + 40 * 60000, vol: 0, prs: [], entries: [] },
      { id: 'w-evening', d: day, name: 'Cardio', start: 2000, end: 2000 + 55 * 60000, vol: 0, prs: [], entries: [] }
    )
    _seedStateForTests(S)

    const amb = call('get_workout', { date: day })
    expect(amb.ambiguous).toBe(true)
    expect(amb.workouts.map(w => w.id).sort()).toEqual(['w-evening', 'w-morning'])

    // Each is retrievable by the id the ambiguous answer handed back.
    expect(call('get_workout', { workout_id: 'w-evening' }).routine_name).toBe('Cardio')
    expect(call('get_workout', { workout_id: 'w-morning' }).routine_name).toBe('Pull')
    // And list_workouts carries the id, or nothing above could ask for one.
    expect(call('list_workouts', {}).workouts.every(w => 'id' in w)).toBe(true)
  })

  test('an unknown workout_id is an error, not the wrong workout', () => {
    expect(() => call('get_workout', { workout_id: 'nope' })).toThrow()
    expect(() => call('get_workout', {})).toThrow()
  })

  test('renders reps/time/cardio set labels in the lib format on a synthetic workout', () => {
    // The starter routine has only reps-mode exercises — synthesise a workout that includes a
    // timed plank and a cardio row so the label rendering is actually exercised.
    S.workouts = [{
      id: 'synth-1', d: '2026-07-25', start: 0, end: 1800000, routineId: 'x', name: 'Synth',
      bw: 78, vol: 0, prs: [],
      entries: [
        { id: 'squat', target: { mode: 'reps' }, sets: [{ w: 60, r: 5, done: true }] },
        { id: 'plank', target: { mode: 'time' }, sets: [{ sec: 90, w: 0, done: true }] },
        { id: 'plank-w', target: { mode: 'time' }, sets: [{ sec: 90, w: 20, done: true }] },
        { id: 'row', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 8, done: true }] }
      ]
    }]
    const w = call('get_workout', { date: '2026-07-25' })
    expect(w.entries[0].sets[0].label).toBe('60×5')             // reps
    // 90 sec → 1 min 30 sec → mm:ss label is "1:30" (fmtSec in history.js)
    expect(w.entries[1].sets[0].label).toBe('1:30')             // 90 s in mm:ss, no weight
    expect(w.entries[2].sets[0].label).toBe('1:30 · 20')        // weighted plank
    expect(w.entries[3].sets[0].label).toBe('20 min @ 8 km/h')   // cardio
  })

  test('infers cardio mode from the exercise id when the target has no mode key', () => {
    // Reproduces the review bug: the sheet saves a cardio target as {sets, min, speed} with
    // no mode and no id. modeOf must fall through to isCardio(id), which needs the id on the
    // cfg — entryView has to spread id into the cfg the way every app call site does.
    const CARDIO_ID = EXDB.find(e => e.bp === 'cardio').id
    S.workouts = [{
      id: 'synth-cardio', d: '2026-07-25', start: 0, end: 1800000, routineId: 'x', name: 'Synth',
      bw: 78, vol: 0, prs: [],
      entries: [
        { id: CARDIO_ID, target: { sets: 1, min: 20, speed: 8 }, sets: [{ min: 20, speed: 8, done: true }] }
      ]
    }]
    const w = call('get_workout', { date: '2026-07-25' })
    expect(w.entries[0].mode).toBe('cardio')
    expect(w.entries[0].sets[0].label).toBe('20 min @ 8 km/h')
  })
})

/* ---------- get_bodyweight ---------- */

describe('get_bodyweight', () => {
  test('returns weigh-ins with the goal, the latest entry, and exact delta vs goal', () => {
    const r = call('get_bodyweight')
    expect(r.goal).toBe(GOAL_WEIGHT)
    expect(r.entries.length).toBeGreaterThan(0)
    // Newest is the LATEST_BW entry (deterministic from the demo seed at the pinned time).
    expect(r.latest).toBeTruthy()
    expect(r.latest.date).toBe(LATEST_BW.date)
    expect(r.latest.weight).toBe(LATEST_BW.weight)
    expect(r.latest.delta_vs_goal).toBe(LATEST_BW.delta)
    // entries are chronological
    const dates = r.entries.map(e => e.date)
    expect([...dates].sort()).toEqual(dates)
  })

  test('closed date range returns a single matching entry on the boundary', () => {
    const all = call('get_bodyweight')
    expect(all.entries.length).toBeGreaterThan(1)
    const earliest = all.entries[0].date
    const restricted = call('get_bodyweight', { from: earliest, to: earliest })
    expect(restricted.entries.length).toBe(1)
    expect(restricted.entries[0].date).toBe(earliest)
  })

  test('no goal set → delta_vs_goal is null, not NaN, not zero', () => {
    S.targetW = null
    const r = call('get_bodyweight')
    expect(r.goal).toBeNull()
    r.entries.forEach(e => expect(e.delta_vs_goal).toBeNull())
    expect(r.latest.delta_vs_goal).toBeNull()
  })
})

/* ---------- estimate_1rm ---------- */

describe('estimate_1rm', () => {
  test('PR table across all reps-mode exercises; epley formula is the default', () => {
    const r = call('estimate_1rm', {})
    expect(r.formula).toBe('epley')
    expect(Array.isArray(r.pr_table)).toBe(true)
    expect(r.pr_table.length).toBeGreaterThan(0)
    r.pr_table.forEach(p => {
      expect(typeof p.est).toBe('number')
      expect(p.est).toBeGreaterThan(0)
      expect(typeof p.exName).toBe('string')
      expect(typeof p.exId).toBe('string')   // exId surfaced (regression test for the bug where callers passed exName as id)
    })
    // sort order: descending by est
    for (let i = 1; i < r.pr_table.length; i++) {
      expect(r.pr_table[i].est).toBeLessThanOrEqual(r.pr_table[i - 1].est)
    }
  })

  test('top-of-table values exactly match the hand-computed Epley for the demo seed', () => {
    const r = call('estimate_1rm', {})
    const top = r.pr_table[0]
    // Demo seed's hardest set: sled 45° leg press at 152.5×12 (r=12 hits estimate1RM's REP_CAP).
    expect(top.exId).toBe(LEG_PRESS_ID)
    expect(top.w).toBe(LEG_PRESS_BEST.w)
    expect(top.r).toBe(LEG_PRESS_BEST.r)
    expect(top.est).toBeCloseTo(LEG_PRESS_BEST.epley, 1)
  })

  test('per-exercise trend + best, with formula honours (Epley vs Brzycki numbers diverge)', () => {
    const epley = call('estimate_1rm', { exercise_id: LEG_PRESS_ID, formula: 'epley' })
    expect(epley.exercise.id).toBe(LEG_PRESS_ID)
    expect(epley.formula).toBe('epley')
    expect(Array.isArray(epley.trend)).toBe(true)
    expect(epley.best).toBeTruthy()
    expect(epley.best.w).toBe(LEG_PRESS_BEST.w)
    expect(epley.best.r).toBe(LEG_PRESS_BEST.r)
    expect(epley.best.est).toBeCloseTo(LEG_PRESS_BEST.epley, 1)
    const brz = call('estimate_1rm', { exercise_id: LEG_PRESS_ID, formula: 'brzycki' })
    expect(brz.formula).toBe('brzycki')
    expect(brz.best.est).toBeCloseTo(LEG_PRESS_BEST.brzycki, 1)
    // Distinct formulas must produce distinct estimates for this set.
    expect(epley.best.est).not.toBeCloseTo(brz.best.est, 1)
  })

  // Both halves of this tool are one reading of one history. A unilateral set is a single row
  // carrying both sides, so the row's own `r` is L+R and goes over the rep cap while each side's
  // reps do not; before the PR table asked bestSetOf() the same way the per-exercise answer does,
  // the exercise had a 1RM and no line in the table at the same time.
  test('the PR table and the per-exercise best agree on a per-side exercise', () => {
    const CURL = '0294'
    const side = (w, r, rDone, lDone = true) => ({
      w, r: r * 2, done: lDone && rDone,
      sides: { L: { w, r, done: lDone }, R: { w, r, done: rDone } }
    })
    S.workouts = [{
      id: 'w1', d: '2026-07-06', start: Date.parse('2026-07-06T10:00:00'), end: Date.parse('2026-07-06T11:00:00'), name: 'S',
      entries: [{ id: CURL, target: { sets: 3, reps: 8, weight: 20, perSide: true }, sets: [side(20, 8, true), side(20, 8, true), side(22, 8, false)] }]
    }]
    _seedStateForTests(S)
    const one = call('estimate_1rm', { exercise_id: CURL })
    const row = call('estimate_1rm', {}).pr_table.find(p => p.exId === CURL)
    expect(one.best).toBeTruthy()
    expect(row).toBeTruthy()
    expect(row.est).toBeCloseTo(one.best.est, 3)
    expect(row.w).toBe(one.best.w)
    expect(row.r).toBe(one.best.r)
  })

  // The app keeps an assistance machine out of the estimate, the curve and the strength list
  // (bestSetOf, issue #232): the load is the help you were given, so Epley on it would rise as
  // you got weaker and call that a record. The PR table scanned the rows itself and listed it.
  test('an assistance machine is not in the PR table, the same as in the app', () => {
    const ASSISTED_PULL_UP = '0017'
    S.workouts = [{
      id: 'w1', d: '2026-07-06', start: Date.parse('2026-07-06T10:00:00'), end: Date.parse('2026-07-06T11:00:00'), name: 'S',
      entries: [{ id: ASSISTED_PULL_UP, target: { sets: 2, reps: 8, weight: 30 }, sets: [{ done: true, w: 30, r: 8 }, { done: true, w: 25, r: 8 }] }]
    }]
    _seedStateForTests(S)
    expect(bestSetOf(S.workouts[0].entries[0])).toBeNull()
    expect(call('estimate_1rm', {}).pr_table.find(p => p.exId === ASSISTED_PULL_UP)).toBeUndefined()
    expect(call('estimate_1rm', { exercise_id: ASSISTED_PULL_UP }).best).toBeNull()
  })

  test('exercises with no reps-mode history get null best + empty trend (not a 0 estimate)', () => {
    S.workouts = []
    _seedStateForTests(S)
    const r = call('estimate_1rm', { exercise_id: LEG_PRESS_ID })
    expect(r.best).toBeNull()
    expect(r.trend).toEqual([])
    const table = call('estimate_1rm', {}).pr_table
    expect(table).toEqual([])
  })

  test('an id that does not exist says so, and is not confused with "never trained"', () => {
    const r = call('estimate_1rm', { exercise_id: 'not-an-exercise-at-all' })
    expect(r.best).toBeNull()
    expect(r.exercise.unknown).toBe(true)
    expect(r.no_estimate_reason).toMatch(/No exercise with id "not-an-exercise-at-all" exists/)
    expect(r.no_estimate_reason).not.toMatch(/No completed sets logged/)
    // a real exercise with no history keeps the answer about the training, not about the id
    S.workouts = []
    _seedStateForTests(S)
    const real = call('estimate_1rm', { exercise_id: LEG_PRESS_ID })
    expect(real.exercise.unknown).toBeUndefined()
    expect(real.no_estimate_reason).toBe('No completed sets logged for this exercise.')
  })

  test('an empty exercise_id is a validation error, not the whole PR table', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js')
    const t = TOOLS.find(x => x.name === 'estimate_1rm')
    const server = new McpServer({ name: 'opengym', version: '0.1.0' })
    server.tool(t.name, t.description, t.schema, async p => ({ content: [{ type: 'text', text: JSON.stringify(t.handler(p || {})) }] }))
    const client = new Client({ name: 'tools-test', version: '1' })
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(st), client.connect(ct)])
    const r = await client.callTool({ name: 'estimate_1rm', arguments: { exercise_id: '' } }).then(
      x => ({ ok: !x.isError, text: x.content?.[0]?.text || '' }),
      e => ({ code: e.code, text: String(e.message) })
    )
    expect(r.ok).not.toBe(true)
    expect(String(r.code ?? r.text)).toContain('-32602')
    expect(r.text).not.toContain('pr_table')
  })

  test('a heavy warm-up is never a PR — the table matches the app, which excludes warm-ups', () => {
    // The app scans with bestSetOf(), which skips warm-ups (onerm.js). prTable used to gate on
    // s.done alone, so a ramp row heavier than the work set became a record the coach reported
    // and the athlete never saw — for the same exercise, from the same state.
    S.workouts = [{
      id: 'w-ramp', d: '2026-07-26', name: 'Legs', start: 1000, end: 1000 + 30 * 60000,
      vol: 0, prs: [],
      entries: [{
        id: LEG_PRESS_ID, target: { sets: 2, reps: 5, mode: 'reps' },
        sets: [
          { w: 200, r: 5, done: true, phase: 'warmup' },  // mistyped/greedy ramp row
          { w: 100, r: 5, done: true }                     // the only real work set
        ]
      }]
    }]
    _seedStateForTests(S)

    const app = bestSetOf(S.workouts[0].entries[0])
    expect(app.w).toBe(100)                                // the app ignores the 200 kg warm-up

    const best = call('estimate_1rm', { exercise_id: LEG_PRESS_ID }).best
    expect(best.w).toBe(100)
    expect(best.est).toBeCloseTo(app.est, 1)

    const row = call('estimate_1rm', {}).pr_table.find(p => p.exId === LEG_PRESS_ID)
    expect(row.w).toBe(100)
    expect(row.est).toBeCloseTo(app.est, 1)
  })

  test('a null estimate says which kind of null it is', () => {
    // "Never trained" and "trained, but always above the rep cap" are opposite facts that both
    // arrive as best: null. Undistinguished, the second one reads as the first and an assistant
    // reports "no records" for an exercise in the log every week.
    S.workouts = [{
      id: 'w-highrep', d: '2026-07-26', name: 'Accessories', start: 1000, end: 1000 + 20 * 60000,
      vol: 0, prs: [],
      entries: [{
        id: LEG_PRESS_ID, target: { sets: 2, reps: 20, mode: 'reps' },
        sets: [{ w: 40, r: 20, done: true }, { w: 40, r: 18, done: true }]
      }]
    }]
    _seedStateForTests(S)

    const capped = call('estimate_1rm', { exercise_id: LEG_PRESS_ID })
    expect(capped.best).toBeNull()
    expect(capped.no_estimate_reason).toMatch(/above the \d+-rep cap/)

    // An exercise that genuinely has no sets must not borrow that explanation.
    const never = call('estimate_1rm', { exercise_id: '0684' })
    expect(never.best).toBeNull()
    expect(never.no_estimate_reason).toMatch(/No completed sets/)

    // And the cap is stated on this branch at all, which it never used to be.
    expect(capped.formula_note).toMatch(/Cap at/)
  })

  test('all three formulas are accepted', () => {
    ['epley', 'brzycki', 'lombardi'].forEach(f => {
      const r = call('estimate_1rm', { exercise_id: LEG_PRESS_ID, formula: f })
      expect(r.formula).toBe(f)
      expect(r.best).not.toBeNull()
    })
  })
})

/* ---------- muscle_balance ---------- */

describe('muscle_balance', () => {
  test('reports worked + neglected muscles in head-to-toe order over all time', () => {
    const r = call('muscle_balance', { period: 'all' })
    expect(r.period).toBe('all')
    expect(r.workouts_in_period).toBeGreaterThan(0)
    expect(Array.isArray(r.worked)).toBe(true)
    expect(Array.isArray(r.neglected)).toBe(true)
    expect(r.muscle_order_head_to_toe[0]).toBe('trapezius')
    expect(r.muscle_order_head_to_toe.at(-1)).toBe('tibialis')
    r.worked.forEach(w => {
      expect(w.level).toBeGreaterThanOrEqual(1)
      expect(w.level).toBeLessThanOrEqual(4)
      expect(typeof w.name).toBe('string')
      expect(typeof w.effective_sets).toBe('number')
    })
  })

  test('worked + neglected partition every muscle exactly once', () => {
    const r = call('muscle_balance', { period: 'all' })
    const all = new Set(r.muscle_order_head_to_toe)
    const worked = new Set(r.worked.map(w => w.slug))
    const neg = new Set(r.neglected.map(n => n.slug))
    expect(worked.size + neg.size).toBe(all.size)
    expect([...worked].every(s => all.has(s))).toBe(true)
    expect([...neg].every(s => all.has(s))).toBe(true)
  })

  test('counts custom exercises — they resolve from state, not from the catalogue', () => {
    const total = r => r.worked.reduce((n, w) => n + w.effective_sets, 0)
    const before = call('muscle_balance', { period: 'all' })

    // A custom exercise is absent from EXIDX in this process: the app merges S.customEx in
    // via registerCustom() at store load, the MCP server does not. Its sets used to vanish
    // from the muscle map entirely.
    S.customEx = [{ id: 'cx-hollow-hold', n: 'Hollow hold', bp: 'waist', tg: 'abs' }]
    S.workouts[0].entries.push({
      id: 'cx-hollow-hold',
      sets: [{ sec: 45, done: true }, { sec: 45, done: true }]
    })

    const after = call('muscle_balance', { period: 'all' })
    expect(total(after)).toBeGreaterThan(total(before))
    expect(after.worked.find(w => w.slug === 'abs')?.effective_sets)
      .toBeGreaterThan(before.worked.find(w => w.slug === 'abs')?.effective_sets || 0)
  })

  test('still counts a DELETED custom, from the snapshot left on the entry', () => {
    const total = r => r.worked.reduce((n, w) => n + w.effective_sets, 0)
    const before = total(call('muscle_balance', { period: 'all' }))

    // Exactly what sheets.jsx:421-426 leaves behind when a custom exercise is deleted: the
    // customEx row is gone, the history entry keeps `n` + `muscleSnapshot`. loadOf reads that
    // snapshot off the entry — so nothing may be attached over the top of it.
    S.customEx = []
    S.workouts[0].entries.push({
      id: 'cx-deleted-hold',
      n: 'Hollow hold',
      muscleSnapshot: { n: 'Hollow hold', bp: 'waist', muscleWeights: { abs: 1 } },
      sets: [{ sec: 45, done: true }, { sec: 45, done: true }]
    })

    const after = call('muscle_balance', { period: 'all' })
    expect(total(after)).toBeGreaterThan(before)
    expect(after.worked.find(w => w.slug === 'abs')?.effective_sets).toBeGreaterThan(0)
  })

  test('period windows are inclusive: week ≤ month ≤ all', () => {
    const all = call('muscle_balance', { period: 'all' }).workouts_in_period
    const month = call('muscle_balance', { period: 'month' }).workouts_in_period
    const week = call('muscle_balance', { period: 'week' }).workouts_in_period
    expect(week).toBeLessThanOrEqual(month)
    expect(month).toBeLessThanOrEqual(all)
  })

  test('"last 7 days" is 7 calendar dates, including for workouts that carry no clock', () => {
    // Imported or hand-added sessions have no w.start and fall back to their date at local noon.
    // Against an instant 7x24h back, noon on the 7th day ago is still inside the window, so the
    // week spanned 8 dates.
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    S.workouts = Array.from({ length: 40 }, (_, i) => ({
      id: 'd' + i, d: iso(new Date(Date.now() - i * 86400000)),
      entries: [{ id: '0025', sets: [{ done: true, w: 100, r: 5 }] }]
    }))
    _seedStateForTests(S)
    expect(call('muscle_balance', { period: 'week' }).workouts_in_period).toBe(7)
    expect(call('muscle_balance', { period: 'month' }).workouts_in_period).toBe(30)
    // and the reported cutoff is the oldest date in the window
    expect(call('muscle_balance', { period: 'week' }).cutoff_iso).toBe(iso(new Date(Date.now() - 6 * 86400000)))
  })

  // TZ east of Greenwich: there the UTC date of the cutoff instant is a day behind the local one,
  // which is the bug. Node re-reads process.env.TZ, so this block owns its own zone and clock.
  describe('the reported cutoff is a local date, like every other date in this API', () => {
    const TZ = process.env.TZ
    beforeAll(() => { process.env.TZ = 'Asia/Tokyo'; vi.setSystemTime(new Date('2026-07-27T08:00:00')) })
    afterAll(() => { process.env.TZ = TZ; vi.setSystemTime(new Date(FAKE_TODAY_ISO + 'T12:00:00Z')) })

    // Workouts imported without a clock (no w.start) fall back to their date at local noon, so
    // they are the probe for which calendar dates the window really accepts.
    const dated = (id, iso) => ({ id, d: iso, entries: [{ id: '0025', sets: [{ done: true, w: 100, r: 5 }] }] })
    const dayBefore = iso => {
      const [y, m, d] = iso.split('-').map(Number)
      const p = new Date(y, m - 1, d - 1)
      return p.getFullYear() + '-' + String(p.getMonth() + 1).padStart(2, '0') + '-' + String(p.getDate()).padStart(2, '0')
    }

    for (const period of ['week', 'month']) {
      test(`${period}: cutoff_iso is the first date the filter accepts`, () => {
        const iso = call('muscle_balance', { period }).cutoff_iso
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        S.workouts = [dated('on-the-cutoff', iso), dated('the-day-before', dayBefore(iso))]
        _seedStateForTests(S)
        const r = call('muscle_balance', { period })
        expect(r.cutoff_iso).toBe(iso)
        expect(r.workouts_in_period).toBe(1)   // the reported day counts; the one before it does not
      })
    }
  })

  test('zero-workout state still returns all 18 muscles as neglected (not empty)', () => {
    S.workouts = []
    const r = call('muscle_balance', { period: 'all' })
    expect(r.workouts_in_period).toBe(0)
    expect(r.worked).toEqual([])
    expect(r.neglected.length).toBe(r.muscle_order_head_to_toe.length)
    expect(r.neglected.length).toBe(18)
  })
})

/* ---------- shared: no-state fallback ---------- */

describe('shared: no-state fallback', () => {
  test('every tool answers gracefully when state is null (fresh account, never signed in)', () => {
    _seedStateForTests(null)
    // Each tool gets the minimum args its zod schema mandates; under real LLM-client use the
    // SDK rejects missing ones before the handler runs, so we only test the post-validation path.
    const calls = {
      list_routines: {},
      get_routine: { routine_id: '0031' },
      get_week_plan: {},
      list_workouts: {},
      get_workout: { date: '2026-07-26' },
      get_bodyweight: {},
      estimate_1rm: {},
      muscle_balance: { period: 'all' }
    }
    for (const t of TOOLS) {
      const r = t.handler(calls[t.name] || {})
      expect(r).toHaveProperty('error')
    }
  })

  // Restore state after the no-state detour so a future test that forgets to seed sees the
  // failure rather than inherits null silently.
  afterAll(() => { _seedStateForTests(S = freshState()) })
})

/* ---------- preview_session ---------- */

// The gap this tool exists to close: a routine stores sets/reps/weight, but those are the
// LAST fallback the session builder consults. These tests pin the precedence — progression
// beats the confirmed working weight, which beats the routine's own number — because getting
// it backwards is how a coach ends up telling someone to squat a weight the app never shows.
describe('preview_session', () => {
  const WD = new Date(FAKE_TODAY_ISO + 'T12:00:00Z').getDay()

  // One routine, one exercise, scheduled for the pinned "today". Nothing from the demo seed,
  // so the arithmetic below is checkable by hand.
  // Linear by default: with progression off the app opens the routine's own numbers (see the
  // two tests at the end), so history-vs-plan precedence is only observable under a policy.
  function only(cfg, { prog = 'linear', workouts = [], exWeights = {}, routine = {} } = {}) {
    S.routines = [{ id: 'r-preview', name: 'Preview', emoji: 'barbell', prog, ex: [cfg], ...routine }]
    S.week = { [WD]: 'r-preview' }
    S.dayPlan = {}
    S.workouts = workouts
    S.exWeights = exWeights
    _seedStateForTests(S)
  }

  test('defaults to the routine scheduled for today', () => {
    only({ id: '0025', sets: 3, reps: 8, weight: 50 })
    const r = call('preview_session')
    expect(r.date).toBe(FAKE_TODAY_ISO)
    expect(r.routine_name).toBe('Preview')
    expect(r.exercises).toHaveLength(1)
    expect(r.exercises[0].name).toBe('barbell bench press')
  })

  test('with no history and no confirmed weight, the routine\'s own number is what opens', () => {
    only({ id: '0025', sets: 3, reps: 8, weight: 50 })
    const e = call('preview_session').exercises[0]
    expect(e.weight_source).toBe('routine_plan')
    expect(e.opening_sets.map(s => s.w)).toEqual([50, 50, 50])
    expect(e.opening_sets.map(s => s.r)).toEqual([8, 8, 8])
    expect(e.differs_from_plan).toBe(false)
    expect(call('preview_session').overridden_count).toBe(0)
  })

  test('a confirmed working weight beats the routine\'s number', () => {
    only({ id: '0025', sets: 2, reps: 8, weight: 50 }, { exWeights: { '0025': { w: 72.5, d: '2026-07-20' } } })
    const e = call('preview_session').exercises[0]
    expect(e.weight_source).toBe('confirmed_weight')
    expect(e.opening_sets.every(s => s.w === 72.5)).toBe(true)
    expect(e.changed).toEqual(['weight'])
  })

  test('the progression policy beats both, and its reason is reported', () => {
    // Every rep hit at 60 last time under linear progression → +2.5, regardless of the 100
    // the routine stores.
    only({ id: '0025', sets: 3, reps: 5, weight: 100 }, {
      prog: 'linear',
      exWeights: { '0025': { w: 100, d: '2026-07-20' } },
      workouts: [{
        id: 'w1', d: '2026-07-20', routineId: 'r-preview', name: 'Preview',
        entries: [{
          id: '0025',
          target: { id: '0025', sets: 3, reps: 5, weight: 60 },
          sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }]
        }]
      }]
    })
    const out = call('preview_session')
    const e = out.exercises[0]
    expect(e.prescription.kind).toBe('up')
    expect(e.weight_source).toBe('progression')
    expect(e.opening_sets.every(s => s.w === 62.5)).toBe(true)
    expect(e.prescription.why).toMatch(/Every rep last time/)
    expect(e.changed).toEqual(['weight'])

    expect(out.overridden_count).toBe(1)
    expect(out.overridden[0]).toMatchObject({
      name: 'barbell bench press', planned_weight: 100, opening_weight: 62.5
    })
    expect(out.overridden[0].reason).toMatch(/Every rep last time/)
  })

  const fiveLastTime = [{
    id: 'w1', d: '2026-07-20', routineId: 'r-preview', name: 'Preview',
    entries: [{
      id: '0025',
      target: { id: '0025', sets: 2, reps: 5, weight: 60 },
      sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }]
    }]
  }]

  test('reps are the routine\'s own by default, whatever was logged last time', () => {
    only({ id: '0025', sets: 2, reps: 12, weight: 60 }, { workouts: fiveLastTime })
    const out = call('preview_session')
    const e = out.exercises[0]
    expect(out.starts_from).toBe('plan')
    expect(e.opening_sets.map(s => s.r)).toEqual([12, 12])
    expect(e.reps_source).toBe('routine_plan')
    expect(e.changed).not.toContain('reps')
  })

  test('reps carry from the last session when the profile starts planned sessions from it', () => {
    only({ id: '0025', sets: 2, reps: 12, weight: 60 }, { workouts: fiveLastTime })
    S.startFrom = 'last'
    _seedStateForTests(S)
    const out = call('preview_session')
    const e = out.exercises[0]
    expect(out.starts_from).toBe('last_session')
    expect(e.opening_sets.map(s => s.r)).toEqual([5, 5])   // not the 12 the routine stores
    expect(e.reps_source).toBe('last_session')
    expect(e.changed).toContain('reps')
  })

  test('the weight comes from this routine\'s own last session, not another routine\'s (#216)', () => {
    only({ id: '0025', sets: 2, reps: 10, weight: 60 }, {
      workouts: [
        { id: 'w1', d: '2026-07-20', routineIds: ['r-preview'], name: 'Preview', entries: [{ id: '0025', rid: 'r-preview', target: { sets: 2, reps: 10, weight: 60 }, sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: true }] }] },
        { id: 'w2', d: '2026-07-22', routineIds: ['r-light'], name: 'Light', entries: [{ id: '0025', rid: 'r-light', target: { sets: 2, reps: 15, weight: 40 }, sets: [{ w: 40, r: 15, done: true }, { w: 40, r: 15, done: true }] }] },
      ]
    })
    const e = call('preview_session').exercises[0]
    expect(e.opening_sets.map(s => [s.w, s.r])).toEqual([[62.5, 10], [62.5, 10]])
    expect(e.weight_source).toBe('progression')
  })

  test('an edited routine restarts from its new reps, and says why (#275)', () => {
    only({ id: '0025', sets: 2, reps: 10, weight: 60 }, {
      workouts: [{
        id: 'w1', d: '2026-07-20', routineIds: ['r-preview'], name: 'Preview',
        entries: [{
          id: '0025', rid: 'r-preview',
          planned: { sets: 2, reps: 15, weight: 60 },
          target: { sets: 2, reps: 15, weight: 60 },
          sets: [{ w: 60, r: 15, done: true }, { w: 60, r: 15, done: true }]
        }]
      }]
    })
    const e = call('preview_session').exercises[0]
    expect(e.prescription.kind).toBe('hold')
    expect(e.prescription.why).toBe('Plan changed — starting from your new target.')
    expect(e.opening_sets.map(s => [s.w, s.r])).toEqual([[60, 10], [60, 10]])
    expect(e.reps_source).toBe('routine_plan')
    expect(e.differs_from_plan).toBe(false)
  })

  test('planned drop sets show up on the opening rows', () => {
    only({ id: '0025', sets: 2, reps: 10, weight: 50, intensifier: { type: 'dropset', count: 1, pct: 20 } })
    const e = call('preview_session').exercises[0]
    expect(e.opening_sets.every(s => s.type === 'dropset')).toBe(true)
  })

  test('an explicit routine_id overrides the schedule', () => {
    only({ id: '0025', sets: 3, reps: 8, weight: 50 })
    const other = { id: 'r-other', name: 'Other', prog: 'off', ex: [{ id: '0043', sets: 5, reps: 5, weight: 80 }] }
    S.routines.push(other)
    _seedStateForTests(S)
    expect(call('preview_session', { routine_id: 'r-other' }).routine_name).toBe('Other')
  })

  test('a rest day returns no exercises rather than an error', () => {
    only({ id: '0025', sets: 3, reps: 8, weight: 50 })
    S.week = {}
    _seedStateForTests(S)
    const r = call('preview_session')
    expect(r.rest_day).toBe(true)
    expect(r.exercises).toEqual([])
  })

  test('with progression off the routine\'s own numbers open, whatever history says (matches session-start.js)', () => {
    only({ id: '0025', sets: 3, reps: 8, weight: 50 }, {
      prog: 'off',
      exWeights: { '0025': { w: 72.5, d: '2026-07-20' } },
      workouts: [{
        id: 'w1', d: '2026-07-20', routineId: 'r-preview', name: 'Preview',
        entries: [{ id: '0025', target: { id: '0025', sets: 3, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }]
      }]
    })
    const out = call('preview_session')
    const e = out.exercises[0]
    expect(e.prescription.kind).toBe('off')
    expect(e.opening_sets.map(s => [s.w, s.r])).toEqual([[50, 8], [50, 8], [50, 8]])
    expect(e.weight_source).toBe('routine_plan')
    expect(e.reps_source).toBe('routine_plan')
    expect(e.differs_from_plan).toBe(false)
    expect(out.overridden_count).toBe(0)
  })

  test('a deload routine (excludeFromProgression) opens its own numbers even under a policy', () => {
    only({ id: '0025', sets: 3, reps: 5, weight: 50 }, {
      prog: 'linear', routine: { excludeFromProgression: true },
      workouts: [{
        id: 'w1', d: '2026-07-20', routineId: 'r-preview', name: 'Preview',
        entries: [{ id: '0025', target: { id: '0025', sets: 3, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }]
      }]
    })
    const e = call('preview_session').exercises[0]
    expect(e.prescription.kind).toBe('off')
    expect(e.opening_sets.every(s => s.w === 50 && s.r === 5)).toBe(true)
    expect(e.weight_source).toBe('routine_plan')
  })

  test('a timed exercise that progressed is listed as overridden too', () => {
    only({ id: '0025', mode: 'time', sets: 3, sec: 30, inc: 10 }, {
      prog: 'time',
      workouts: [{
        id: 'w1', d: '2026-07-20', routineId: 'r-preview', name: 'Preview',
        entries: [{ id: '0025', target: { id: '0025', mode: 'time', sets: 3, sec: 30 }, sets: [{ sec: 45, done: true }, { sec: 45, done: true }, { sec: 45, done: true }] }]
      }]
    })
    const out = call('preview_session')
    const e = out.exercises[0]
    expect(e.prescription.kind).toBe('up')
    expect(e.changed).toEqual(['sec'])
    expect(e.differs_from_plan).toBe(true)
    expect(out.overridden[0].opening_sec).toBeGreaterThan(30)
  })

  test('an unknown routine_id is an error, not an empty session', () => {
    only({ id: '0025', sets: 3, reps: 8, weight: 50 })
    expect(() => call('preview_session', { routine_id: 'nope' })).toThrow(/no routine with id/)
  })
})

/* ---------- a workout's photos and videos ---------- */

// workouts[].media — progress photos and form-check clips — are the owner's own files. The MCP
// bridge answers from the same state file, so it must not pass on a single hash, poster or even
// the key: an LLM client has nothing to do with them.
describe('workout photos and videos never leave through MCP', () => {
  const HASH = 'a1'.repeat(32), POSTER = 'b2'.repeat(32)
  test('no tool answer carries them', () => {
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
    // Another device with a wrong clock writes a 2099 row. Both tools document `to` as
    // "Defaults to today" and had no default at all, so that row was listed first and read as
    // the latest weight.
    S.workouts.push({ id: 'w-future', d: '2099-01-01', name: 'Time Machine', routineId: S.routines[0].id, start: 1, end: 2, entries: [] })
    S.bodyweight.push({ d: '2099-01-01', w: 1 })
    _seedStateForTests(S)
    const lw = call('list_workouts')
    expect(lw.workouts.map(w => w.date)).not.toContain('2099-01-01')
    expect(lw.workouts[0].date).toBe(NEWEST_WORKOUT.date)
    const bw = call('get_bodyweight')
    expect(bw.entries.map(e => e.date)).not.toContain('2099-01-01')
    expect(bw.latest.date).toBe(LATEST_BW.date)
    expect(bw.latest.weight).toBe(LATEST_BW.weight)
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
