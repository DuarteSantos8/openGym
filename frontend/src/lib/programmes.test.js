// Programmes (#159): the model, the run (start, weeks, pause, end, repeat) and the targets a
// session opens with (session-start.js).
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import {
  normalizeProgramme, programmesOf, newProgramme, saveProgramme, deleteProgramme, resizeWeeks, stepWeek,
  programmeStatus, startProgramme, pauseProgramme, resumeProgramme, endProgramme, repeatProgramme,
  programmeSlot, pctWeight, importedProgramme, bundleProgramme, programmeRoutineIds, MAX_WEEKS, rpeAs, cleanWeek,
  IMPORT_MAX_SEQUENCE, IMPORT_MAX_TARGETS, IMPORT_MAX_PROGRAMMES,
} from './programmes.js'
import { buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { isWarmupRow } from './workout-model.js'
import { queueOf } from './queue.js'
import { progressionGuidance } from './progression-copy.js'
import { buildPlanBundle, buildProgrammeBundle, parsePlan, mergePlan } from './plan-share.js'
import { todayISO } from './format.js'

// A fixed clock for the whole file, local noon on a Wednesday: every date here is a calendar date
// in the device's own zone, and the run must not depend on the day or hour the suite happens to run.
// Only Date is faked, so nothing waits on timers.
const at = (...ymdhm) => vi.setSystemTime(new Date(...ymdhm))
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
afterEach(() => { at(2026, 9, 21, 12, 0) })
afterAll(() => { vi.useRealTimers() })
at(2026, 9, 21, 12, 0)

const BENCH = '0025', SQUAT = '0043'
const clone = v => JSON.parse(JSON.stringify(v))
const work = e => e.sets.filter(s => !isWarmupRow(s))
const routines = () => [
  { id: 'A', name: 'Day A', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60 }, { id: SQUAT, sets: 3, reps: 5, weight: 80 }] },
  { id: 'B', name: 'Day B', ex: [{ id: SQUAT, sets: 3, reps: 8, weight: 70 }] },
  { id: 'C', name: 'Other', ex: [{ id: BENCH, sets: 3, reps: 10, weight: 40 }] },
]
const state = (extra = {}) => ({ unit: 'kg', weekStart: 1, exWeights: {}, routines: routines(), workouts: [], week: { 1: ['C'] }, dayPlan: {}, programmes: {}, programme: null, ...extra })
// A logged session of `exId` at w × r, for an estimated 1RM to come from.
const logged = (d, exId, w, r, rid = 'C') => buildCompletedWorkout({
  id: 'w' + d + exId, d, start: Date.parse(d + 'T10:00:00'), routineIds: [rid], name: 'x',
  entries: [{ id: exId, rid, target: { id: exId, sets: 1, reps: r, weight: w }, sets: [{ w, r, done: true }] }],
}, { end: Date.parse(d + 'T11:00:00') })

const block = (extra = {}) => ({
  id: 'P', name: 'Strength block', at: 1,
  days: { 1: ['A'], 4: ['B'] },
  weeks: [
    { rpe: 7, t: { [BENCH]: { pct: 75 } } },
    { rpe: 8, t: { [BENCH]: { pct: 80 }, [`B:${SQUAT}`]: { pct: 70, rpe: 9 } } },
    { deload: true },
  ],
  ...extra,
})

describe('the programme model', () => {
  it('keeps 1 to 16 weeks and only targets that mean something', () => {
    const p = normalizeProgramme({ id: 'x', name: '  Block ', weeks: [{ rpe: 3, t: { a: { pct: 500 }, b: { pct: 72.3, rpe: 8.2 } } }, ...Array(20).fill({})] })
    expect(p.name).toBe('Block')
    expect(p.weeks).toHaveLength(MAX_WEEKS)
    expect(p.weeks[0]).toEqual({ t: { b: { pct: 72.5, rpe: 8 } } })
    expect(normalizeProgramme({ id: 'y' }).weeks).toEqual([{}])
    expect(normalizeProgramme(null)).toBeNull()
    expect(normalizeProgramme({ name: 'no id' })).toBeNull()
  })

  it('keeps fields a newer app wrote', () => {
    expect(normalizeProgramme({ id: 'x', weeks: [{}], future: { a: 1 } }).future).toEqual({ a: 1 })
  })

  it('a loop wins over weekdays, and an all-rest loop is none', () => {
    expect(normalizeProgramme({ id: 'x', sequence: ['A', 'rest', 'B'], days: { 1: ['A'] } })).toMatchObject({ sequence: ['A', 'rest', 'B'] })
    expect(normalizeProgramme({ id: 'x', sequence: ['A'], days: { 1: ['A'] } }).days).toBeUndefined()
    expect(normalizeProgramme({ id: 'x', sequence: ['rest'], days: { 1: ['A'] } })).toMatchObject({ days: { 1: ['A'] } })
  })

  it('a new programme takes the schedule you train by now', () => {
    const s = state()
    expect(newProgramme(s, 'N', 6).days).toEqual({ 1: ['C'] })
    expect(newProgramme(s, 'N', 6).weeks).toHaveLength(6)
    const loop = state({ rotation: { id: 'r', sequence: ['A', 'rest', 'B'] }, scheduleMode: 'rotation' })
    expect(newProgramme(loop, 'N').sequence).toEqual(['A', 'rest', 'B'])
  })

  it('lists newest first and leaves broken entries out', () => {
    const s = state({ programmes: { a: { id: 'a', at: 1, weeks: [{}] }, b: { id: 'b', at: 5, weeks: [{}] }, bad: 'x' } })
    expect(programmesOf(s).map(p => p.id)).toEqual(['b', 'a'])
  })

  it('resizes weeks by copying the last one, never its deload', () => {
    expect(resizeWeeks([{ rpe: 7 }, { rpe: 8, deload: true }], 4)).toEqual([{ rpe: 7 }, { rpe: 8, deload: true }, { rpe: 8 }, { rpe: 8 }])
    expect(resizeWeeks([{ rpe: 7 }, { rpe: 8 }], 1)).toEqual([{ rpe: 7 }])
  })

  it('steps a week up by 2.5 points of 1RM', () => {
    expect(stepWeek({ rpe: 8, deload: true, t: { a: { pct: 75 }, b: { rpe: 9 } } })).toEqual({ rpe: 8, t: { a: { pct: 77.5 }, b: { rpe: 9 } } })
  })

  it('lists the routines it schedules that still exist', () => {
    const s = state()
    expect(programmeRoutineIds(s, block())).toEqual(['A', 'B'])
    expect(programmeRoutineIds(s, { sequence: ['B', 'rest', 'Z', 'A', 'B'] })).toEqual(['B', 'A'])
  })

  it('shows RPE as RIR for a profile that logs reps in reserve', () => {
    expect(rpeAs(8, 'rir')).toEqual({ k: 'RIR', v: 2 })
    expect(rpeAs(8, 'rpe')).toEqual({ k: 'RPE', v: 8 })
  })
})

describe('running a programme', () => {
  it('writes its weekdays in and puts your plan back at the end', () => {
    const s = state()
    saveProgramme(s, block())
    expect(startProgramme(s, 'P', '2026-10-21')).toBe(true)
    expect(s.week).toEqual({ 1: ['A'], 4: ['B'] })
    expect(s.programme).toMatchObject({ id: 'P', startedOn: '2026-10-21', cycle: 1 })
    endProgramme(s, '2026-10-30')
    expect(s.week).toEqual({ 1: ['C'] })
    expect(s.programme).toBeNull()
  })

  it('runs a loop programme as a loop of its own and gives your loop back', () => {
    const s = state({ week: {}, rotation: { id: 'mine', sequence: ['C'], label: '' }, scheduleMode: 'rotation' })
    s.queue = { ids: ['C'], since: 1, startsOn: '2026-10-01', label: '', rotationId: 'mine' }
    saveProgramme(s, block({ days: undefined, sequence: ['A', 'rest', 'B'] }))
    startProgramme(s, 'P', '2026-10-21', 100)
    expect(s.rotation.id).not.toBe('mine')
    expect(s.rotation.sequence).toEqual(['A', 'rest', 'B'])
    expect(queueOf(s).ids).toEqual(['A'])
    expect(s.programme.saved.rotation.id).toBe('mine')
    endProgramme(s, '2026-10-30', 200)
    expect(s.rotation.id).toBe('mine')
    expect(queueOf(s)).toMatchObject({ ids: ['C'], rotationId: 'mine' })
    expect(s.scheduleMode).toBe('rotation')
  })

  it('counts calendar weeks from the week it started in', () => {
    const s = state()
    saveProgramme(s, block())
    startProgramme(s, 'P', '2026-10-22')   // a Thursday
    expect(programmeStatus(s, '2026-10-25')).toMatchObject({ week: 1, weeks: 3, done: false })
    expect(programmeStatus(s, '2026-10-26')).toMatchObject({ week: 2 })
    expect(programmeStatus(s, '2026-11-02').week).toBe(3)
    expect(programmeStatus(s, '2026-11-09')).toMatchObject({ done: true, current: null, week: 3 })
  })

  it('follows a Sunday week start', () => {
    const s = state({ weekStart: 0 })
    saveProgramme(s, block())
    startProgramme(s, 'P', '2026-10-24')   // a Saturday
    expect(programmeStatus(s, '2026-10-25').week).toBe(2)
  })

  it('a pause holds the week, and resuming moves the start on by the weeks it lasted', () => {
    const s = state()
    saveProgramme(s, block())
    startProgramme(s, 'P', '2026-10-19')
    pauseProgramme(s, '2026-10-27')
    expect(programmeStatus(s, '2026-11-12')).toMatchObject({ week: 2, paused: true, current: null })
    resumeProgramme(s, '2026-11-12')
    expect(s.programme.pausedOn).toBeUndefined()
    expect(programmeStatus(s, '2026-11-12')).toMatchObject({ week: 2, paused: false })
    expect(programmeStatus(s, '2026-11-16').week).toBe(3)
  })

  it('repeats from week 1 with a heavier %1RM, keeping your old plan to go back to', () => {
    const s = state()
    saveProgramme(s, block())
    startProgramme(s, 'P', '2026-10-01')
    repeatProgramme(s, '2026-10-26', 2.5)
    expect(s.programme).toMatchObject({ cycle: 2, bump: 2.5, startedOn: '2026-10-26' })
    expect(programmeSlot(s, 'A', BENCH, '2026-10-26').pct).toBe(77.5)
    endProgramme(s, '2026-10-27')
    expect(s.week).toEqual({ 1: ['C'] })
  })

  it('starting another programme ends the first and keeps the plan from before both', () => {
    const s = state()
    saveProgramme(s, block())
    saveProgramme(s, block({ id: 'Q', days: { 2: ['B'] } }))
    startProgramme(s, 'P', '2026-10-21')
    startProgramme(s, 'Q', '2026-10-22')
    expect(s.week).toEqual({ 2: ['B'] })
    endProgramme(s, '2026-10-23')
    expect(s.week).toEqual({ 1: ['C'] })
  })

  it('deleting the running programme ends it first', () => {
    const s = state()
    saveProgramme(s, block())
    startProgramme(s, 'P', '2026-10-21')
    deleteProgramme(s, 'P', '2026-10-22')
    expect(s.programmes).toEqual({})
    expect(s.programme).toBeNull()
    expect(s.week).toEqual({ 1: ['C'] })
  })

  it('a run whose programme is gone (removed on another device) reads as none', () => {
    const s = state({ programme: { id: 'gone', startedOn: '2026-10-21' } })
    expect(programmeStatus(s, '2026-10-22')).toBeNull()
    expect(programmeSlot(s, 'A', BENCH, '2026-10-22')).toBeNull()
  })
})

describe('the target of one exercise', () => {
  const running = () => {
    const s = state()
    saveProgramme(s, block())
    startProgramme(s, 'P', '2026-10-19')
    return s
  }

  it('per exercise, per routine slot, the week RPE, and only for the routines it schedules', () => {
    const s = running()
    expect(programmeSlot(s, 'A', BENCH, '2026-10-20')).toMatchObject({ pct: 75, rpe: 7, week: 1, weeks: 3, deload: false })
    expect(programmeSlot(s, 'A', SQUAT, '2026-10-20')).toMatchObject({ rpe: 7 })
    expect(programmeSlot(s, 'A', SQUAT, '2026-10-20').pct).toBeUndefined()
    expect(programmeSlot(s, 'B', SQUAT, '2026-10-27')).toMatchObject({ pct: 70, rpe: 9 })
    expect(programmeSlot(s, 'A', SQUAT, '2026-10-27')).toMatchObject({ rpe: 8 })
    expect(programmeSlot(s, 'A', SQUAT, '2026-10-27').pct).toBeUndefined()
    expect(programmeSlot(s, 'C', BENCH, '2026-10-20')).toBeNull()
    expect(programmeSlot(s, 'A', BENCH, '2026-11-03')).toMatchObject({ deload: true, week: 3 })
  })

  it('nothing while paused or once done', () => {
    const s = running()
    pauseProgramme(s, '2026-10-20')
    expect(programmeSlot(s, 'A', BENCH, '2026-10-21')).toBeNull()
    resumeProgramme(s, '2026-10-21')
    expect(programmeSlot(s, 'A', BENCH, '2026-11-10')).toBeNull()
  })

  it('%1RM resolves from the best estimate, snapped to the step or to what you own', () => {
    const s = state({ workouts: [logged('2026-10-01', BENCH, 100, 5)] })   // Epley: 116.7
    expect(pctWeight(s, BENCH, 75)).toBe(87.5)
    expect(pctWeight(s, BENCH, 75, { step: 5 })).toBe(90)
    expect(pctWeight(s, BENCH, 75, { owned: [80, 86, 90] })).toBe(86)
    expect(pctWeight(s, BENCH, 30, { floor: 40 })).toBe(40)
    expect(pctWeight(state(), BENCH, 75)).toBeNull()
  })
})

// The session builder reads "today" off the clock (todayISO, local). Each case runs at instants
// that sit on the edges a week count can trip over: just after midnight on a Monday (the week
// start), just before midnight on the Sunday before it, both European clock changes (2026-10-25,
// 2027-03-28, 23 and 25-hour days) and a US one (2026-11-01). The programme is started "today" by
// the same local date the builder reads, never by a UTC date (toISOString), which on a Monday just
// after midnight in Zurich is still Sunday and once made this test think it was week 2.
const CLOCKS = [
  ['Monday 00:30 after the EU autumn change', [2026, 9, 26, 0, 30]],
  ['Sunday 23:30, the 25-hour day', [2026, 9, 25, 23, 30]],
  ['Sunday 02:30, inside the repeated hour', [2026, 9, 25, 2, 30]],
  ['Sunday 01:30, the US autumn change', [2026, 10, 1, 1, 30]],
  ['Monday 00:30 after the EU spring change', [2027, 2, 29, 0, 30]],
  ['Sunday 02:30, the skipped hour', [2027, 2, 28, 2, 30]],
  ['an ordinary Wednesday noon', [2026, 9, 21, 12, 0]],
]
const daysBefore = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

describe.each(CLOCKS)('a session in a running programme (session-start.js), %s', (_, clock) => {
  const routine = (s, id) => s.routines.find(r => r.id === id)
  const withHistory = () => {
    const s = state({ workouts: [logged('2026-01-05', BENCH, 100, 5, 'A'), logged('2026-01-05', SQUAT, 120, 5, 'B')] })
    saveProgramme(s, block())
    return s
  }
  beforeAll(() => { at(...clock) })
  // afterEach (file level) puts the default clock back; each test sets its own again.
  const now = () => { at(...clock); return todayISO() }

  it('opens at the %1RM weight and the routine\'s reps, not at the policy\'s', () => {
    const s = withHistory()
    const today = now()
    const before = buildSessionEntries(s, routine(s, 'A'))[0]
    expect(work(before).map(x => x.w)).toEqual([102.5, 102.5, 102.5])   // linear: one step up
    startProgramme(s, 'P', today)
    const [bench, squat] = buildSessionEntries(s, routine(s, 'A'))
    expect(work(bench).map(x => [x.w, x.r])).toEqual([[87.5, 5], [87.5, 5], [87.5, 5]])
    expect(bench.target.weight).toBe(87.5)
    expect(bench.plan).toMatchObject({ kind: 'programme', prog: { week: 1, weeks: 3, pct: 75, rpe: 7 } })
    expect(progressionGuidance(bench.plan)).toMatchObject({ policyLabel: 'Programme', prog: { rpe: 7 } })
    // An RPE alone leaves the weight to the policy.
    expect(work(squat).map(x => x.w)).toEqual(work(buildSessionEntries({ ...s, programme: null }, routine(s, 'A'))[1]).map(x => x.w))
    expect(squat.plan.prog).toEqual({ week: 1, weeks: 3, rpe: 7 })
    expect(bench.noProg).toBeUndefined()
  })

  it('"Your last session" does not move a programme\'s reps', () => {
    const s = { ...withHistory(), startFrom: 'last' }
    s.workouts[0].entries[0].sets = [{ w: 100, r: 7, done: true }]
    startProgramme(s, 'P', now())
    const [bench] = buildSessionEntries(s, routine(s, 'A'))
    expect(work(bench).map(x => x.r)).toEqual([5, 5, 5])
    expect(bench.carried).toBeUndefined()
  })

  it('a deload week takes the weight down and stays out of progression', () => {
    const s = withHistory()
    startProgramme(s, 'P', daysBefore(now(), 14))
    const [bench] = buildSessionEntries(s, routine(s, 'A'))
    expect(bench.plan.prog).toMatchObject({ week: 3, deload: true })
    expect(work(bench)[0].w).toBe(92.5)   // 102.5 × 0.9, on the 2.5 grid
    expect(bench.noProg).toBe(true)
  })

  it('a routine the programme does not schedule builds as always', () => {
    const s = withHistory()
    const plain = buildSessionEntries(s, routine(s, 'C'))
    startProgramme(s, 'P', now())
    expect(buildSessionEntries(s, routine(s, 'C'))).toEqual(plain)
  })
})

// The week count is calendar arithmetic on local dates: weekKey (format.js) takes noon, so a 23 or
// 25-hour day never moves a date, and the day difference is rounded to whole days.
describe('week boundaries across the clock changes', () => {
  const run = (startedOn, weekStart = 1) => {
    const s = state({ weekStart, programmes: { P: { id: 'P', at: 1, days: { 1: ['A'] }, weeks: Array(8).fill({}) } } })
    s.programme = { id: 'P', startedOn, cycle: 1, bump: 0 }
    return d => programmeStatus(s, d)?.week
  }
  it('EU autumn change (Sunday 2026-10-25): week 2 starts on the Monday after', () => {
    const w = run('2026-10-19')
    expect(['2026-10-19', '2026-10-24', '2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02'].map(w)).toEqual([1, 1, 1, 2, 2, 3])
  })
  it('EU spring change (Sunday 2027-03-28)', () => {
    const w = run('2027-03-22')
    expect(['2027-03-27', '2027-03-28', '2027-03-29', '2027-04-04', '2027-04-05'].map(w)).toEqual([1, 1, 2, 2, 3])
  })
  it('US changes (2026-11-01, 2027-03-14)', () => {
    expect(['2026-11-01', '2026-11-02'].map(run('2026-10-26'))).toEqual([1, 2])
    expect(['2027-03-14', '2027-03-15'].map(run('2027-03-08'))).toEqual([1, 2])
  })
  it('a Sunday week start turns over on Sunday, on the change day itself', () => {
    const w = run('2026-10-24', 0)   // a Saturday: week 1 is Sun 10-18 to Sat 10-24
    expect(['2026-10-24', '2026-10-25', '2026-10-31', '2026-11-01'].map(w)).toEqual([1, 2, 2, 3])
  })
  it('a start on the week\'s last day still counts that week as week 1', () => {
    expect(['2026-10-25', '2026-10-26'].map(run('2026-10-25'))).toEqual([1, 2])
    expect(['2027-03-28', '2027-03-29'].map(run('2027-03-28'))).toEqual([1, 2])
  })
  it('a pause across a clock change moves the start by whole weeks', () => {
    const s = state({ programmes: { P: { id: 'P', at: 1, days: { 1: ['A'] }, weeks: Array(8).fill({}) } } })
    startProgramme(s, 'P', '2026-10-21')
    pauseProgramme(s, '2026-10-22')
    resumeProgramme(s, '2026-11-04')
    expect(s.programme.startedOn).toBe('2026-11-04')
    expect(programmeStatus(s, '2026-11-08').week).toBe(1)
    expect(programmeStatus(s, '2026-11-09').week).toBe(2)
  })
})

describe('sharing a programme', () => {
  it('maps routine and exercise ids, drops what did not come along', () => {
    const shared = bundleProgramme(block())
    expect(shared.at).toBeUndefined()
    const got = importedProgramme(shared, { A: 'a1', B: 'b1' }, {}, 7)
    expect(got.id).not.toBe('P')
    expect(got.at).toBe(7)
    expect(got.days).toEqual({ 1: ['a1'], 4: ['b1'] })
    expect(got.weeks[1].t).toEqual({ [BENCH]: { pct: 80 }, [`b1:${SQUAT}`]: { pct: 70, rpe: 9 } })
    expect(importedProgramme(shared, {})).toBeNull()
    const loop = importedProgramme(bundleProgramme(block({ days: undefined, sequence: ['A', 'rest', 'Z'] })), { A: 'a1' })
    expect(loop.sequence).toEqual(['a1', 'rest'])
  })

  it('a file brings only what a programme is, at a size a programme has', () => {
    const file = JSON.parse(`{"name":"Block","days":{"1":["A"]},"weeks":[{"t":{"__proto__":{"pct":80},"constructor":{"pct":75},"A:toString":{"pct":70}}}],
      "src":"strength-4","run":{"startedOn":"2026-01-01"},"blob":"${'x'.repeat(1000)}"}`)
    const got = importedProgramme(file, { A: 'a1' })
    expect(Object.keys(got).sort()).toEqual(['at', 'days', 'id', 'name', 'weeks'])
    // Inherited names are plain exercise ids, never Object's own functions.
    expect(got.weeks[0].t).toEqual({ constructor: { pct: 75 }, 'a1:toString': { pct: 70 } })
    expect(Object.getPrototypeOf(got.weeks[0].t)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(cleanWeek(file.weeks[0]).t)).toBe(Object.prototype)
    expect(importedProgramme({ ...file, days: { 1: ['constructor'] } }, { A: 'a1' })).toBeNull()
    const long = importedProgramme({ name: 'Loop', sequence: Array(500).fill('A'), weeks: [{ t: Object.fromEntries(Array.from({ length: 900 }, (_, i) => ['e' + i, { pct: 70 }])) }] }, { A: 'a1' })
    expect(long.sequence).toHaveLength(IMPORT_MAX_SEQUENCE)
    expect(Object.keys(long.weeks[0].t)).toHaveLength(IMPORT_MAX_TARGETS)
  })

  it('survives a JSON round trip unchanged', () => {
    const p = normalizeProgramme(block())
    expect(normalizeProgramme(clone(p))).toEqual(p)
  })
})

describe('a programme in a plan file (plan-share.js)', () => {
  const friend = () => ({ unit: 'lb', routines: [], week: { 2: ['mine'] }, customEx: [], programmes: {} })

  it('round-trips through the file: routines, weekdays and weeks, under new ids', () => {
    const s = state()
    saveProgramme(s, block())
    const file = JSON.parse(JSON.stringify(buildProgrammeBundle(s, 'P')))
    expect(file).toMatchObject({ opengym_plan: 1, programme_fmt: 1, name: 'Strength block', week: { 1: ['A'], 4: ['B'] } })
    expect(file.routines.map(r => r.id)).toEqual(['A', 'B'])
    const parsed = parsePlan(JSON.stringify(file), 'lb')
    const f = friend()
    expect(mergePlan(f, parsed).programmes).toBe(1)
    const [p] = Object.values(f.programmes)
    const [a, b] = f.routines
    expect(p.days).toEqual({ 1: [a.id], 4: [b.id] })
    expect(p.weeks).toEqual([
      { rpe: 7, t: { [BENCH]: { pct: 75 } } },
      { rpe: 8, t: { [BENCH]: { pct: 80 }, [`${b.id}:${SQUAT}`]: { pct: 70, rpe: 9 } } },
      { deload: true },
    ])
    // Imported, not started: your own week is untouched.
    expect(f.week).toEqual({ 2: ['mine'] })
    expect(f.programme).toBeUndefined()
  })

  it('a whole plan export carries every programme', () => {
    const s = state()
    saveProgramme(s, block())
    expect(buildPlanBundle(s, '').programmes).toHaveLength(1)
    expect(buildPlanBundle(state(), '').programmes).toBeUndefined()
  })

  it('an older file has none, a newer programme format is skipped, the routines still come in', () => {
    const s = state()
    saveProgramme(s, block())
    const file = buildProgrammeBundle(s, 'P')
    expect(parsePlan({ ...file, programmes: undefined, programme_fmt: undefined }).programmes).toEqual([])
    const newer = parsePlan({ ...file, programme_fmt: 2 })
    expect(newer.programmes).toEqual([])
    expect(newer.routineCount).toBe(2)
  })

  it('a file with more programmes than anyone makes brings the first ones', () => {
    const s = state()
    saveProgramme(s, block())
    const file = buildProgrammeBundle(s, 'P')
    expect(parsePlan({ ...file, programmes: Array(100).fill(file.programmes[0]) }).programmes).toHaveLength(IMPORT_MAX_PROGRAMMES)
  })
})
