// The Coach in the demo build: the canned provider behind lib/coach-api.js when DEMO is set.
//
// Nothing here is a render test. What matters about this module is the job machine (one job at
// a time, an answer 2.2 s later, a pending proposal that survives until it is resolved) and the
// fact that every proposal it makes is aimed at the demo profile's OWN ids — so applying one
// exercises the same validate → snapshot → apply → revert path a live instance does. The
// asserts below are therefore about the change-set and the state machine, not about strings.
//
// The module keeps `job`, `pending` and `timer` at module scope with no reset hook, so every
// test here starts a job and then drains it. A test that leaves one running would 409 the next.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  demoStatus, demoPlan, demoReview, demoRefine, demoDebrief, demoResolve, demoCohort, demoDisclosure
} from './coach-demo.js'
import { EXDB, EXIDX } from './exercises.js'
import { planHash, validateProposal, applyChangeSet } from './coach.js'
import { DATA_CATEGORIES } from '../../../api/coach/core/categories.js'

const DELAY = 2200                       // the module's own thinking time
const NOW = new Date('2026-09-22T12:00:00Z').getTime()
const day = n => new Date(NOW - n * 864e5).toISOString().slice(0, 10)

// Real catalogue ids, so EXIDX lookups and the body-part search behave as they do in the app.
const PRESS = EXDB.find(e => e.bp === 'chest').id
const ROW = EXDB.find(e => e.bp === 'back').id
const SQUAT = EXDB.find(e => e.bp === 'upper legs').id
const PLANK = EXDB.find(e => e.bp === 'waist').id

const workout = (over = {}) => ({
  id: 'w1', d: day(1), start: NOW - 864e5, end: NOW - 864e5 + 3600e3, prs: [],
  entries: [{ id: PRESS, target: { sets: 3, reps: 8 }, sets: [
    { done: true, w: 60, r: 8 }, { done: true, w: 60, r: 8 }, { done: true, w: 60, r: 8 }
  ] }],
  ...over
})

const state = (over = {}) => ({
  unit: 'kg', lang: 'en', customEx: [], bodyweight: [], exWeights: {}, dayPlan: {},
  routines: [
    { id: 'r1', name: 'Push', ex: [{ id: PRESS, sets: 3, reps: 8, mode: 'reps' }, { id: ROW, sets: 3, reps: 10, mode: 'reps' }] },
    { id: 'r2', name: 'Legs', ex: [{ id: SQUAT, sets: 4, reps: 5, mode: 'reps' }] }
  ],
  week: { 1: 'r1', 4: 'r2' },
  workouts: [workout()],
  coach: { consent: { agreedAt: '2026-09-01T00:00:00Z', version: 1 }, profile: null, log: [], snapshots: [], chat: [], timings: [] },
  ...over
})

// Start a job and let the 2.2 s land; returns whatever the module parked as `pending`.
const think = start => { start(); vi.advanceTimersByTime(DELAY); return demoStatus().pending }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  demoResolve()                          // no pending proposal leaks between tests
})
afterEach(() => { vi.useRealTimers() })

describe('coach-demo — the job machine', () => {
  it('is idle until asked, and reports the same cap shape the real status does', () => {
    expect(demoStatus()).toEqual({ job: null, pending: null, cap: { used: 0, limit: 0 }, lastError: null })
  })

  it('answers 2.2 s later, not before — the job is visible for the whole wait', () => {
    const S = state()
    const { job } = demoPlan(S, null)
    expect(job).toMatchObject({ id: 'demo-create', kind: 'create', state: 'running', startedAt: NOW })
    expect(demoStatus().job).toBe(job)

    vi.advanceTimersByTime(DELAY - 1)
    expect(demoStatus().job).toBe(job)
    expect(demoStatus().pending).toBe(null)

    vi.advanceTimersByTime(1)
    expect(demoStatus().job).toBe(null)
    expect(demoStatus().pending).toMatchObject({ kind: 'create' })
  })

  it('refuses a second request while one is running, with the 409 the UI reads', () => {
    const S = state()
    demoPlan(S, null)
    let err
    try { demoReview(S) } catch (e) { err = e }
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(409)
    expect(err.message).toBe('The Coach is already thinking about your training.')
    // and the running job is untouched by the refusal
    expect(demoStatus().job.kind).toBe('create')
    vi.advanceTimersByTime(DELAY)
  })

  it('a pending proposal survives until it is resolved, and resolving clears only it', () => {
    const S = state()
    expect(think(() => demoReview(S))).toBeTruthy()
    vi.advanceTimersByTime(864e5)
    expect(demoStatus().pending).toBeTruthy()
    expect(demoResolve()).toEqual({ ok: true })
    expect(demoStatus()).toEqual({ job: null, pending: null, cap: { used: 0, limit: 0 }, lastError: null })
  })

  it('a builder that throws ends the job, records the failure, and does not refuse the next request', () => {
    // Before this a throw inside the timer left `job` at 'running' for ever and every later
    // request answered 409 until the page was reloaded. Any throw will do; a getter is the one
    // way to provoke it that no later hardening of the builders can quietly remove.
    const S = state()
    Object.defineProperty(S, 'workouts', { get() { throw new Error('boom') } })
    demoPlan(S, null)
    expect(demoStatus().job).toMatchObject({ kind: 'create', state: 'running' })
    expect(() => vi.advanceTimersByTime(DELAY)).not.toThrow()

    expect(demoStatus().job).toBe(null)
    expect(demoStatus().pending).toBe(null)
    // The shape CoachChat reads off the server's status: `lastError.errorClass` picks the line,
    // `detail` rides along for the phone's own-words rendering.
    expect(demoStatus().lastError).toEqual({ errorClass: 'nostate', detail: 'boom' })

    // and the next request is taken, not 409'd, and starts with a clean slate
    expect(() => demoReview(state())).not.toThrow()
    expect(demoStatus().job).toMatchObject({ kind: 'review', state: 'running' })
    expect(demoStatus().lastError).toBe(null)
    vi.advanceTimersByTime(DELAY)
    expect(demoStatus().pending).toMatchObject({ kind: 'review' })
  })
})

describe('coach-demo — the starter plan', () => {
  it('schedules the preferred days round-robin across the two routines', () => {
    const p = think(() => demoPlan(state(), { preferredDays: [2, 4, 6, 0], equipment: [] }))
    expect(Object.keys(p.bundle.week).map(Number).sort((a, b) => a - b)).toEqual([2, 4, 6])   // sliced to 3
    expect(p.bundle.week).toEqual({ 2: 'dr1', 4: 'dr2', 6: 'dr1' })
  })

  it('falls back to Mon/Wed/Fri when the intake named no days', () => {
    expect(think(() => demoPlan(state(), { equipment: [] })).bundle.week).toEqual({ 1: 'dr1', 3: 'dr2', 5: 'dr1' })
    expect(think(() => demoPlan(state(), null)).bundle.week).toEqual({ 1: 'dr1', 3: 'dr2', 5: 'dr1' })
  })

  it('builds every exercise from the first listed equipment, falling back to the catalogue', () => {
    const p = think(() => demoPlan(state(), { equipment: ['dumbbell', 'barbell'] }))
    const ids = p.bundle.routines.flatMap(r => r.ex.map(e => e.id))
    expect(ids).toHaveLength(6)
    for (const bp of ['upper legs', 'chest', 'back', 'shoulders', 'upper arms']) {
      const want = (EXDB.find(e => e.bp === bp && e.eq === 'dumbbell') || EXDB.find(e => e.bp === bp)).id
      expect(ids).toContain(want)
    }
    // every id resolves in the catalogue — the whole point of building from EXDB
    ids.forEach(id => expect(EXIDX[id]).toBeTruthy())
  })

  it('says whether it had any history to go on', () => {
    expect(think(() => demoPlan(state(), null)).bundle.basedOn)
      .toBe('Based on the training already in this demo profile.')
    expect(think(() => demoPlan(state({ workouts: [] }), null)).bundle.basedOn)
      .toBe('No training history yet — starting conservatively.')
  })

  it('stamps the plan hash of the state it was built from, so the app can spot a stale one', () => {
    const S = state()
    expect(think(() => demoPlan(S, null)).planHash).toBe(planHash(S))
  })

  it('produces a bundle the app’s own validator accepts', () => {
    const p = think(() => demoPlan(state(), null))
    expect(validateProposal(p)).toBe(true)
    expect(p.bundle.opengym_plan).toBe(1)
    expect(Object.values(p.bundle.week).every(id => p.bundle.routines.some(r => r.id === id))).toBe(true)
  })
})

describe('coach-demo — refining a plan', () => {
  it('counts iterations off the proposal on the table and keeps the rest of the plan', () => {
    const S = state()
    const first = think(() => demoPlan(S, { preferredDays: [2, 4] }))
    expect(first.iteration).toBe(1)

    const second = think(() => demoRefine(S))
    expect(second.iteration).toBe(2)
    expect(second.summary.startsWith('Revised as you asked.')).toBe(true)
    expect(think(() => demoRefine(S)).iteration).toBe(3)
  })

  it('a refine with nothing pending still starts at iteration 2', () => {
    expect(demoStatus().pending).toBe(null)
    expect(think(() => demoRefine(state())).iteration).toBe(2)
  })

  it('a refined plan keeps the days the intake chose', () => {
    // The answers live in S.coach.profile once the intake has saved them, and that is where the
    // server's payload reads them from when a refine carries no intake of its own. Built from
    // nothing, every revised plan went back to Mon/Wed/Fri.
    const S = state()
    S.coach.profile = { preferredDays: [2, 4, 6], equipment: [] }
    think(() => demoPlan(S, S.coach.profile))
    expect(think(() => demoRefine(S)).bundle.week).toEqual({ 2: 'dr1', 4: 'dr2', 6: 'dr1' })
    // and still the default when there are no answers on file
    expect(think(() => demoRefine(state())).bundle.week).toEqual({ 1: 'dr1', 3: 'dr2', 5: 'dr1' })
  })
})

describe('coach-demo — the review', () => {
  it('aims three changes at the profile’s own routines, and swaps in something it does not already have', () => {
    const S = state()
    const p = think(() => demoReview(S))
    expect(p.changes.map(c => c.id)).toEqual(['d1', 'd2', 'd3'])
    expect(p.changes.map(c => c.type)).toEqual(['swap-exercise', 'sets', 'week'])

    const [swap, sets, week] = p.changes
    expect(swap.target).toEqual({ routineId: 'r1', exId: PRESS })
    expect(EXIDX[swap.after.id].bp).toBe(EXIDX[PRESS].bp)           // same body part
    expect(S.routines[0].ex.some(e => e.id === swap.after.id)).toBe(false)  // not already in the routine
    expect(sets.target).toEqual({ routineId: 'r1', exId: ROW })
    expect(sets.before).toBe(3)
    expect(sets.after).toBe(2)
    expect(week).toMatchObject({ target: { weekday: 6 }, before: null, after: 'r2' })
    expect(validateProposal(p)).toBe(true)
  })

  it('never proposes fewer than one set, and reads a missing set count as three', () => {
    const S = state()
    S.routines[0].ex[1] = { id: ROW, reps: 10, mode: 'reps' }        // no `sets` key at all
    expect(think(() => demoReview(S)).changes[1]).toMatchObject({ before: 3, after: 2 })

    const S1 = state()
    S1.routines[0].ex[1].sets = 1
    expect(think(() => demoReview(S1)).changes[1]).toMatchObject({ before: 1, after: 1 })
  })

  it('still finds a swap for a body part the catalogue has no dumbbell for', () => {
    const NECK = EXDB.find(e => e.bp === 'neck').id
    expect(EXDB.some(e => e.bp === 'neck' && e.eq === 'dumbbell')).toBe(false)
    const S = state({ routines: [{ id: 'r1', name: 'Neck', ex: [{ id: NECK, sets: 3, reps: 10, mode: 'reps' }, { id: ROW, sets: 3, reps: 10, mode: 'reps' }] }] })
    const swap = think(() => demoReview(S)).changes[0]
    expect(swap.target.exId).toBe(NECK)
    expect(EXIDX[swap.after.id].bp).toBe('neck')
    expect(swap.after.id).not.toBe(NECK)
  })

  it('leaves out the weekday change when there is only one routine', () => {
    const S = state({ routines: [state().routines[0]], week: { 1: 'r1' } })
    expect(think(() => demoReview(S)).changes.map(c => c.type)).toEqual(['swap-exercise', 'sets'])
  })

  it('reports the last nine sessions as its evidence window', () => {
    const workouts = Array.from({ length: 12 }, (_, i) => workout({ id: 'w' + i, d: day(12 - i) }))
    const p = think(() => demoReview(state({ workouts })))
    expect(p.evidence).toEqual({ from: day(9), to: day(1), sessions: 9 })
  })

  it('falls back to a four-week window when the profile has never trained', () => {
    const p = think(() => demoReview(state({ workouts: [] })))
    expect(p.evidence).toEqual({ from: day(28), to: day(0), sessions: 9 })
  })

  it('refuses up front when no routine has two exercises to work with, and starts no job', () => {
    // The canned review swaps one exercise and cuts a set from another, so it needs a routine
    // with two. Refused before the job starts, the way demoDebrief refuses with no workout;
    // before this the job ran the whole wait and vanished with neither a proposal nor an error.
    const S = state({ routines: [{ id: 'r1', name: 'Solo', ex: [{ id: PRESS, sets: 3, reps: 8, mode: 'reps' }] }] })
    let err
    try { demoReview(S) } catch (e) { err = e }
    expect(err.status).toBe(409)
    expect(err.code).toBe('noroutine')
    expect(err.message).toBe('There is no routine to review yet — build one with at least two exercises first.')
    expect(demoStatus().job).toBe(null)
    vi.advanceTimersByTime(DELAY)
    expect(demoStatus().pending).toBe(null)
  })
})

describe('coach-demo — the debrief', () => {
  it('refuses up front when there is nothing to look at, and starts no job', () => {
    let err
    try { demoDebrief(state({ workouts: [] })) } catch (e) { err = e }
    expect(err.status).toBe(409)
    expect(err.code).toBe('noworkout')
    expect(err.message).toBe('There is no workout to look at yet — log one first.')
    expect(demoStatus().job).toBe(null)
  })

  it('reads the workout it was named, and the latest one when it was named nothing', () => {
    const S = state({ workouts: [workout({ id: 'old', d: day(9) }), workout({ id: 'new', d: day(1) })] })
    expect(think(() => demoDebrief(S, 'old')).workout.id).toBe('old')
    expect(think(() => demoDebrief(S, 'nope')).workout.id).toBe('new')
    expect(think(() => demoDebrief(S)).workout.id).toBe('new')
  })

  it('scores a clean session 8, a clean session with records 9, and a short one 7', () => {
    const S = state()
    expect(think(() => demoDebrief(S)).score).toBe(8)
    expect(think(() => demoDebrief(state({ workouts: [workout({ prs: ['a', 'b'] })] }))).score).toBe(9)

    const short = workout()
    short.entries[0].sets[2].done = false
    expect(think(() => demoDebrief(state({ workouts: [short] }))).score).toBe(7)
  })

  it('counts neither warm-up rows nor their volume', () => {
    const w = workout()
    w.entries[0].sets.unshift({ done: true, w: 20, r: 10, phase: 'warmup' })
    const p = think(() => demoDebrief(state({ workouts: [w] })))
    expect(p.workout.sets).toBe(3)                                   // 4 rows logged, 3 of them work
    expect(p.highlights[0]).toBe('Every planned set done — 3 of 3.')
    expect(p.workout.vol).toBe(3 * 60 * 8)                           // the 20×10 warm-up is not in it
  })

  it('trusts a stored volume over recomputing it', () => {
    const p = think(() => demoDebrief(state({ workouts: [workout({ vol: 1234.4 })] })))
    expect(p.workout.vol).toBe(1234)
  })

  it('warns about the clock only past eighty minutes, and about missing effort otherwise', () => {
    const long = workout({ start: NOW - 864e5, end: NOW - 864e5 + 81 * 60e3 })
    expect(think(() => demoDebrief(state({ workouts: [long] }))).watch)
      .toEqual(['81 minutes is long — rest periods may be creeping up.'])
    expect(think(() => demoDebrief(state({ workouts: [workout()] }))).watch[0])
      .toMatch(/^Top sets logged without an effort rating/)
  })

  it('reports no minutes at all when the workout was never clocked', () => {
    const p = think(() => demoDebrief(state({ workouts: [workout({ start: undefined, end: undefined })] })))
    expect(p.workout.minutes).toBe(null)
    expect(p.watch[0]).toMatch(/^Top sets logged without an effort rating/)
  })
})

describe('coach-demo — the cohort panel', () => {
  it('compares your own bests against a median it derives from them', () => {
    const c = demoCohort(state())
    expect(c).toMatchObject({ ok: true, enabled: true, sharing: true, people: 5, minPeople: 3, unit: 'kg', rankPct: 62 })
    const mine = c.exercises.find(e => e.id === PRESS)
    expect(mine.you).toBeGreaterThan(0)
    expect(mine.median).toBe(Math.round(mine.you * 0.92))
    expect(mine.name).toBe(EXIDX[PRESS].n)
  })

  it('shows an untrained exercise as a flat 60 with no number of your own', () => {
    expect(demoCohort(state()).exercises.find(e => e.id === SQUAT)).toEqual({
      id: SQUAT, name: EXIDX[SQUAT].n, people: 4, median: 60, you: null
    })
  })

  it('takes at most five distinct exercises across every routine', () => {
    const ids = EXDB.slice(0, 8).map(e => e.id)
    const S = state({
      routines: [
        { id: 'r1', name: 'A', ex: ids.slice(0, 5).map(id => ({ id, sets: 3, reps: 8 })) },
        { id: 'r2', name: 'B', ex: [...ids.slice(0, 5), ...ids.slice(5)].map(id => ({ id, sets: 3, reps: 8 })) }
      ]
    })
    const c = demoCohort(S)
    expect(c.exercises.map(e => e.id)).toEqual(ids.slice(0, 5))
  })

  it('reports your sessions per week over the last eight weeks', () => {
    const workouts = Array.from({ length: 8 }, (_, i) => workout({ id: 'w' + i, start: NOW - (i + 1) * 864e5 }))
    workouts.push(workout({ id: 'ancient', d: day(400), start: NOW - 400 * 864e5 }))
    expect(demoCohort(state({ workouts })).sessionsPerWeek).toEqual({ median: 3, you: 1 })
    expect(demoCohort(state({ workouts: [] })).sessionsPerWeek).toEqual({ median: 3, you: 0 })
  })
})

describe('coach-demo — the disclosure', () => {
  it('names exactly the categories the consent screen is built from', () => {
    expect(demoDisclosure()).toEqual({
      provider: 'demo', providerLabel: 'the configured AI provider',
      categories: [...DATA_CATEGORIES], version: 1
    })
  })
})

describe('coach-demo — defects found while writing these tests', () => {
  // DEFECT 1 (fixed in coach-demo.js, see the report): when a routine's only rep-mode exercise
  // sits at index 1, `first` and `second` resolved to the same entry, so the demo proposed
  // swapping an exercise away AND changing the set count of the exercise it had just swapped
  // away. Accepting both is what the review screen's "Apply" does by default, and the apply
  // engine throws `missing target` on the second change — which aborts the whole change-set.
  it('never aims two changes at the same exercise', () => {
    const S = state({
      routines: [
        { id: 'r1', name: 'Core + press', ex: [{ id: PLANK, sec: 45, mode: 'time' }, { id: PRESS, sets: 3, reps: 8, mode: 'reps' }] },
        { id: 'r2', name: 'Legs', ex: [{ id: SQUAT, sets: 4, reps: 5, mode: 'reps' }] }
      ]
    })
    const p = think(() => demoReview(S))
    const targets = p.changes.filter(c => c.target?.exId).map(c => c.target.exId)
    expect(new Set(targets).size).toBe(targets.length)

    // and the whole change-set applies cleanly, which is what the contradiction broke
    const s = structuredClone(S)
    expect(() => applyChangeSet(s, p, p.changes.map(c => c.id))).not.toThrow()
  })

  // DEFECT 2 (fixed in coach-demo.js, see the report): buildDebrief guards `w.entries` twice
  // and then hands the raw workout to workoutVolume(), which does `w.entries.forEach`. A
  // workout carrying a date but no entries threw *inside the 2.2 s timer*, where nothing
  // catches it — `job` stayed 'running' for ever and every later request 409'd, so the demo
  // Coach was bricked until the page was reloaded.
  it('survives a workout that carries a date and nothing else', () => {
    const S = state({ workouts: [{ id: 'bare', d: day(1) }] })
    expect(() => think(() => demoDebrief(S))).not.toThrow()
    expect(demoStatus().pending).toMatchObject({ kind: 'debrief', workout: { id: 'bare', vol: 0, sets: 0 } })
    expect(demoStatus().job).toBe(null)
  })
})
