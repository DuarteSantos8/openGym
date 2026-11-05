// Programmes (#159) on engine contract 1: the definitions, a run (start, weeks, pause, end, repeat)
// replayed by the engine, the choices a start needs, references, and the targets a session opens
// with (session-start.js), now generated from the run's stage.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import {
  programmesOf, programmeById, newProgramme, saveProgramme, deleteProgramme, resizeWeeks, stepWeek, cleanWeek,
  programmeView, startProgramme, pauseProgramme, resumeProgramme, endProgramme, repeatProgramme, programmeChip,
  pctWeight, programmeRoutineIds, rpeAs, refPreference, referenceContexts, acceptReference, reviewReference,
  legacyWeeksOf, setLegacyWeek, setLegacyWeeks, closeWeek, skipSlot, resolveSlot, setRunPolicy, setRunEnd, markBrokenProgrammes,
} from './programmes.js'
import { migratedFixture } from './test-fixtures.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { isWarmupRow } from './workout-model.js'
import { queueOf } from './queue.js'
import { todayISO } from './format.js'
import { planPhase, referenceProposals } from './prescription/index.js'
import { validateCanonicalProfile } from '../../../api/migration/profile-validation.js'

// A fixed clock for the whole file, local noon on a Wednesday: every date here is a calendar date
// in the device's own zone. Only Date is faked, so nothing waits on timers.
const at = (...ymdhm) => vi.setSystemTime(new Date(...ymdhm))
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
afterEach(() => { at(2026, 9, 21, 12, 0) })
afterAll(() => { vi.useRealTimers() })
at(2026, 9, 21, 12, 0)

const BENCH = '0025', SQUAT = '0043'
const BENCH_A = 'A:o0', SQUAT_A = 'A:o1', SQUAT_B = 'B:o0'
const ADVANCE = { onFailure: 'advance', onSkipped: 'advance' }
const clone = v => JSON.parse(JSON.stringify(v))
const work = e => e.sets.filter(s => !isWarmupRow(s))
const routines = () => [
  { id: 'A', name: 'Day A', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60 }, { id: SQUAT, sets: 3, reps: 5, weight: 80 }] },
  { id: 'B', name: 'Day B', ex: [{ id: SQUAT, sets: 3, reps: 8, weight: 70 }] },
  { id: 'C', name: 'Other', ex: [{ id: BENCH, sets: 3, reps: 10, weight: 40 }] },
]
const logged = (d, exId, w, r, rid = 'C') => ({
  id: 'w' + d + exId, d, start: Date.parse(d + 'T10:00:00'), routineIds: [rid], name: 'x', end: Date.parse(d + 'T11:00:00'),
  entries: [{ id: exId, rid, target: { id: exId, sets: 3, reps: r, weight: w }, sets: Array.from({ length: 3 }, () => ({ w, r, done: true })) }],
})
// A v2 profile on contract 1, from v1 routines (and history) through the canonical migration.
const state = (extra = {}, workouts = []) => ({ ...migratedFixture({ unit: 'kg', weekStart: extra.weekStart ?? 1, routines: routines(), workouts }), week: { 1: ['C'] }, dayPlan: {}, programmes: {}, programme: null, ...extra })
const block = (extra = {}) => ({
  id: 'P', name: 'Strength block', at: 1, days: { 1: ['A'], 4: ['B'] },
  weeks: [{ rpe: 7, t: { [BENCH]: { pct: 75 } } }, { rpe: 8, t: { [BENCH]: { pct: 80 }, [`B:${SQUAT}`]: { pct: 70, rpe: 9 } } }, { deload: true }],
  ...extra,
})
// The block as a definition: converted the way every programme is (lib/programmes.js setLegacyWeeks).
function withBlock(s, extra = {}) {
  const { id, name, at: made, weeks, days, sequence } = block(extra)
  const def = setLegacyWeeks({ id, name, at: made, rev: 1, end: 'stop', refs: 'inherit' }, weeks, s, sequence ? { sequence } : { days })
  s.programmes = { ...s.programmes, [id]: def }
  return def
}
const policies = (s, id = 'P', policy = ADVANCE) => Object.fromEntries(programmeById(s, id).tracks.map(t => [t.id, policy]))
const start = (s, today, id = 'P', more = {}) => startProgramme(s, id, { policies: policies(s, id), end: 'stop', today, now: Date.parse(today + 'T08:00:00Z'), ...more })
const runOf = s => s.programmeRuns[s.programme.runId]
const events = (s, type) => Object.values(s.programmeEvents || {}).filter(e => e.type === type)

describe('the programme model', () => {
  it('a new programme takes the schedule you train by now, one track per occurrence it plans', () => {
    const s = state({ week: { 1: ['A'], 4: ['B'] } })
    const p = newProgramme(s, 'N', 6)
    expect(p).toMatchObject({ name: 'N', rev: 1, schedule: { mode: 'weeks', appts: [{ rid: 'A', day: 1 }, { rid: 'B', day: 4 }] }, duration: { n: 6, unit: 'weeks' } })
    expect(p.tracks.map(t => t.id)).toEqual([`t:${p.id}:${BENCH_A}`, `t:${p.id}:${SQUAT_A}`, `t:${p.id}:${SQUAT_B}`])
    expect(p.tracks[0].stages.map(st => st.targets[BENCH_A])).toEqual(Array(6).fill({ own: 'inherit' }))
    // A loop waits for a weekly binding before it can run.
    const loop = state({ rotation: { id: 'r', sequence: ['A', 'rest', 'B'] }, scheduleMode: 'rotation' })
    expect(newProgramme(loop, 'N').needs).toEqual(['binding'])
  })

  it('lists definitions newest first, leaves anything else out, and names the routines it plans', () => {
    const s = state()
    const def = withBlock(s)
    s.programmes = { ...s.programmes, old: { ...def, id: 'old', at: 0 }, bad: 'x', legacy: { id: 'legacy', weeks: [{}] } }
    expect(programmesOf(s).map(p => p.id)).toEqual(['P', 'old'])
    expect(programmeById(s, 'legacy')).toBeNull()
    expect(programmeById(s, 'constructor')).toBeNull()
    expect(programmeRoutineIds(s, def)).toEqual(['A', 'B'])
  })

  it('saving bumps the revision; a programme a routine edit broke is marked for repair, never refused', () => {
    const s = state()
    withBlock(s)
    expect(saveProgramme(s, s.programmes.P).rev).toBe(2)
    s.routines = s.routines.map(r => (r.id === 'B' ? { ...r, ex: [] } : r))
    markBrokenProgrammes(s)
    expect(s.programmes.P.needs).toEqual(['repair'])
    expect(validateCanonicalProfile(s).ok).toBe(true)
  })

  it('the bridge reads the weeks back as they were written, and edits one week', () => {
    const s = state()
    const def = withBlock(s)
    expect(legacyWeeksOf(def)).toEqual(block().weeks)
    const next = setLegacyWeek(def, 2, { deload: true, rpe: 6 }, s)
    expect(legacyWeeksOf(next)[2]).toEqual({ deload: true, rpe: 6 })
    expect(next.rev).toBe(def.rev)
    expect(legacyWeeksOf(setLegacyWeeks(def, resizeWeeks(legacyWeeksOf(def), 4), s))).toHaveLength(4)
  })

  it('keeps the legacy week helpers the editor uses', () => {
    expect(resizeWeeks([{ rpe: 7 }, { rpe: 8, deload: true }], 4)).toEqual([{ rpe: 7 }, { rpe: 8, deload: true }, { rpe: 8 }, { rpe: 8 }])
    expect(stepWeek({ rpe: 8, deload: true, t: { a: { pct: 75 }, b: { rpe: 9 } } })).toEqual({ rpe: 8, t: { a: { pct: 77.5 }, b: { rpe: 9 } } })
    expect(cleanWeek({ rpe: 3, t: { a: { pct: 500 }, b: { pct: 72.3, rpe: 8.2 } } })).toEqual({ t: { b: { pct: 72.5, rpe: 8 } } })
    expect(rpeAs(8, 'rir')).toEqual({ k: 'RIR', v: 2 })
    expect(rpeAs(8, 'rpe')).toEqual({ k: 'RPE', v: 8 })
  })
})

describe('starting a programme', () => {
  it('start without both choices for every exercise and an end choice is refused with missing', () => {
    const s = state()
    withBlock(s)
    const all = policies(s)
    const one = { ...all, [Object.keys(all)[0]]: { onFailure: 'advance' } }
    expect(startProgramme(s, 'P', { policies: {}, today: '2026-10-19' })).toEqual({ ok: false, missing: ['policy', 'end'] })
    expect(startProgramme(s, 'P', { policies: one, end: 'stop', today: '2026-10-19' })).toEqual({ ok: false, missing: ['policy'] })
    expect(startProgramme(s, 'P', { policies: all, end: 'maybe', today: '2026-10-19' })).toEqual({ ok: false, missing: ['end'] })
    expect(s.programme).toBeNull()
    expect(s.week).toEqual({ 1: ['C'] })
    expect(startProgramme(s, 'P', { policies: all, end: 'extend', today: '2026-10-19' })).toEqual({ ok: true })
    expect(runOf(s)).toMatchObject({ end: 'extend', startedOn: '2026-10-19', tracks: { [`t:P:${BENCH_A}`]: { policy: ADVANCE, ack: 'user' } } })
    // A programme that waits on a binding or a repair does not start either.
    s.programmes.Q = { ...s.programmes.P, id: 'Q', needs: ['binding'] }
    expect(startProgramme(s, 'Q', { policies: policies(s, 'Q'), end: 'stop', today: '2026-10-19' })).toEqual({ ok: false, missing: ['binding'] })
  })

  it('operational effort with effort logging off is refused with effort-off', () => {
    const s = state({ effort: 'none' })
    const def = withBlock(s)
    def.tracks[0].stages[0].targets[BENCH_A] = { ...def.tracks[0].stages[0].targets[BENCH_A], effort: { mode: 'operational', rpe: 8 } }
    expect(startProgramme(s, 'P', { policies: policies(s), end: 'stop', today: '2026-10-19' })).toEqual({ ok: false, missing: ['effort-off'] })
    s.effort = 'rir'
    expect(startProgramme(s, 'P', { policies: policies(s), end: 'stop', today: '2026-10-19' }).ok).toBe(true)
  })

  it('writes its weekdays in, adopts each 1RM, and puts your plan back at the end', () => {
    const s = state({}, [logged('2026-10-01', BENCH, 100, 5)])
    withBlock(s)
    expect(start(s, '2026-10-21')).toEqual({ ok: true })
    expect(s.week).toEqual({ 1: ['A'], 4: ['B'] })
    expect(runOf(s).tracks[`t:P:${BENCH_A}`].ref).toMatchObject({ exerciseId: BENCH, value: 116.7 })
    // Wednesday start: Monday's appointment of this week is not owed.
    expect(runOf(s).firstWeek).toEqual([1])
    expect(validateCanonicalProfile(s).ok).toBe(true)
    endProgramme(s, '2026-10-30')
    expect(s.week).toEqual({ 1: ['C'] })
    expect(s.programme).toBeNull()
    expect(events(s, 'end')).toHaveLength(1)
  })

  it('runs a loop programme as a loop of its own and gives your loop back', () => {
    const s = state({ week: {}, rotation: { id: 'mine', sequence: ['C'], label: '' }, scheduleMode: 'rotation' })
    s.queue = { ids: ['C'], since: 1, startsOn: '2026-10-01', label: '', rotationId: 'mine' }
    const def = withBlock(s, { days: undefined, sequence: ['A', 'rest', 'B'] })
    // A legacy loop is bound to weeks only once someone says how; here the binding is accepted as it is.
    s.programmes.P = { ...def, needs: undefined, schedule: { mode: 'rotation', sequence: ['A', 'rest', 'B'] }, duration: { n: 3, unit: 'blocks' } }
    expect(start(s, '2026-10-21')).toEqual({ ok: true })
    expect(s.rotation.id).not.toBe('mine')
    expect(s.rotation.sequence).toEqual(['A', 'rest', 'B'])
    expect(queueOf(s).ids).toEqual(['A'])
    expect(s.programme.saved.rotation.id).toBe('mine')
    endProgramme(s, '2026-10-30', 200)
    expect(s.rotation.id).toBe('mine')
    expect(queueOf(s)).toMatchObject({ ids: ['C'], rotationId: 'mine' })
  })

  it('counts calendar weeks from the week it started in, and is done after the last', () => {
    const s = state()
    withBlock(s)
    start(s, '2026-10-22')   // a Thursday
    expect(programmeView(s, '2026-10-25').period.index).toBe(1)
    expect(programmeView(s, '2026-10-26').period.index).toBe(2)
    at(2026, 9, 27, 12, 0)
    expect(programmeChip(s)).toBe('Week 2 of 3')
    at(2026, 10, 9, 12, 0)
    expect(programmeView(s).status).toBe('stopped')
    expect(programmeChip(s)).toBe('Programme done')
  })

  it('a pause holds the week, and resuming leaves out the weeks it lasted', () => {
    const s = state()
    withBlock(s)
    start(s, '2026-10-19')
    pauseProgramme(s, Date.parse('2026-10-27T10:00:00Z'))
    expect(programmeView(s, '2026-11-12')).toMatchObject({ status: 'paused', period: { index: 2 } })
    at(2026, 10, 12, 12, 0)
    expect(programmeChip(s)).toBe('Strength block, paused')
    resumeProgramme(s, Date.parse('2026-11-12T10:00:00Z'))
    expect(programmeView(s, '2026-11-12')).toMatchObject({ status: 'running', period: { index: 2 } })
    expect(programmeView(s, '2026-11-16').period.index).toBe(3)
  })

  it('starting another programme ends the first and keeps the plan from before both', () => {
    const s = state()
    withBlock(s)
    withBlock(s, { id: 'Q', days: { 2: ['B'] } })
    start(s, '2026-10-21')
    const first = s.programme.runId
    start(s, '2026-10-22', 'Q')
    expect(s.week).toEqual({ 2: ['B'] })
    expect(events(s, 'end').map(e => e.runId)).toEqual([first])
    endProgramme(s, '2026-10-23')
    expect(s.week).toEqual({ 1: ['C'] })
  })

  it('deleting the running programme ends it first; a selector with no run puts the plan back', () => {
    const s = state()
    withBlock(s)
    start(s, '2026-10-21')
    deleteProgramme(s, 'P', '2026-10-22')
    expect(s.programmes).toEqual({})
    expect(s.programme).toBeNull()
    expect(s.week).toEqual({ 1: ['C'] })
    const gone = state({ week: { 1: ['A'] }, programme: { runId: null, saved: { week: { 2: ['B'] }, scheduleMode: null, rotation: null, pass: false } } })
    expect(programmeView(gone)).toBeNull()
    expect(programmeChip(gone)).toBeNull()
    endProgramme(gone, '2026-10-22')
    expect(gone.week).toEqual({ 2: ['B'] })
    expect(gone.programme).toBeNull()
  })

  it('records the run-time choices as events of the current run', () => {
    const s = state()
    withBlock(s)
    start(s, '2026-10-19')
    const now = Date.parse('2026-10-21T10:00:00Z')
    closeWeek(s, now); skipSlot(s, 'p1:a1:B:o0', now); resolveSlot(s, 'p1:a1:B:o0', 'skipped', now)
    setRunPolicy(s, `t:P:${SQUAT_B}`, { onFailure: 'repeat', onSkipped: 'advance' }, now); setRunEnd(s, 'extend', now)
    expect(Object.values(s.programmeEvents).map(e => e.type)).toEqual(['close', 'skip', 'resolve', 'policy', 'end-policy'])
    expect(validateCanonicalProfile(s).ok).toBe(true)
  })
})

describe('ending and repeating', () => {
  // A finished Monday of the block: bench at 75 % of the adopted 116.7, squat on its own run track.
  function trained() {
    const s = state({}, [logged('2026-10-01', BENCH, 100, 5)])
    withBlock(s)
    start(s, '2026-10-19')
    const now = Date.parse('2026-10-19T17:00:00Z')
    const exposures = buildSessionExposures(s, s.routines.find(r => r.id === 'A'), { now, newId: x => x })
    const entries = entriesForExposures(exposures, s.prescriptions)
    entries.forEach(e => e.sets.forEach(row => { row.done = true }))
    const done = exposures.map(x => ({ ...x, completedAt: '2026-10-19T18:00:00.000Z', actual: { sets: 3, reps: 5 }, performance: { sets: [] } }))
    s.workouts = [...s.workouts, { id: 'mon', d: '2026-10-19', start: now, end: now + 3600000, exposures: done }]
    return s
  }

  it('end with keepReached edits the occurrence rule; without it the routine is as before the programme', () => {
    const plain = trained()
    const before = clone(plain.routines)
    endProgramme(plain, '2026-10-21')
    expect(plain.routines).toEqual(before)
    const kept = trained()
    endProgramme(kept, '2026-10-21', Date.now(), { keepReached: true })
    expect(planPhase(kept.routines[0].ex[0].rule).parameters.load).toMatchObject({ mode: 'absolute', value: 87.5 })
    expect(kept.routines[0].ex[0].rule.revision).toBe(before[0].ex[0].rule.revision)
    expect(kept.routines[2]).toEqual(before[2])
  })

  it('repeat starts a new run with fresh references and bumps percent stages only', () => {
    const s = trained()
    const first = runOf(s)
    s.oneRepMaxes = { ...s.oneRepMaxes, fresh: { id: 'fresh', exerciseId: BENCH, value: 120, unit: 'kg', source: 'manual', capturedAt: '2026-11-01T00:00:00.000Z' } }
    expect(repeatProgramme(s, '2026-11-09', 2.5)).toBe(true)
    const next = runOf(s)
    expect(next.id).not.toBe(first.id)
    expect(next).toMatchObject({ cycle: 2, bump: 2.5, startedOn: '2026-11-09' })
    expect(next.tracks[`t:P:${BENCH_A}`]).toMatchObject({ ref: { id: 'fresh' }, policy: ADVANCE })
    const pct = (run, oid, i) => run.def.tracks.find(t => t.slots[0].oid === oid).stages[i].targets[oid]
    expect(pct(next, BENCH_A, 0).phase.parameters.load.percent).toBe(77.5)
    expect(pct(next, SQUAT_B, 1).phase.parameters.load.percent).toBe(72.5)
    expect(pct(next, SQUAT_A, 0)).toEqual(pct(first, SQUAT_A, 0))   // an inherited week has no %1RM to raise
    expect(events(s, 'end').map(e => e.runId)).toEqual([first.id])
    expect(s.programme.saved).toEqual({ week: { 1: ['C'] }, scheduleMode: null, rotation: null, pass: false })
  })
})

describe('references', () => {
  it('reference preference: Config ask, routine keep, occurrence inherit gives keep from routine; a Config change after start leaves the run as it was', () => {
    const s = state({ refUpdates: 'ask' })
    s.routines[0] = { ...s.routines[0], refs: 'keep', ex: s.routines[0].ex.map(o => ({ ...o, refs: 'inherit' })) }
    expect(refPreference(s, { routine: s.routines[0], occ: s.routines[0].ex[0] })).toEqual({ pref: 'keep', from: 'routine' })
    expect(refPreference(s, { routine: s.routines[0], occ: { ...s.routines[0].ex[0], refs: 'ask' } })).toEqual({ pref: 'ask', from: 'occurrence' })
    const def = withBlock(s)
    expect(refPreference(s, { def, track: def.tracks[0] })).toEqual({ pref: 'ask', from: 'config' })
    expect(refPreference(s, { def: { ...def, refs: 'keep' }, track: def.tracks[0] })).toEqual({ pref: 'keep', from: 'programme' })
    start(s, '2026-10-19')
    s.refUpdates = 'keep'
    expect(runOf(s).tracks[def.tracks[0].id].refs).toBe('ask')
    expect(refPreference(s, { run: runOf(s), trackId: def.tracks[0].id })).toEqual({ pref: 'ask', from: 'run' })
  })

  it('a newer 1RM is proposed per context, accepted atomically, and a stale accept writes nothing', () => {
    const s = state({}, [logged('2026-10-01', BENCH, 100, 5)])
    withBlock(s)
    start(s, '2026-10-19')
    s.oneRepMaxes = { ...s.oneRepMaxes, new: { id: 'new', exerciseId: BENCH, value: 130, unit: 'kg', source: 'manual', capturedAt: '2026-10-20T00:00:00.000Z' } }
    const key = `run:${s.programme.runId}:t:P:${BENCH_A}`
    const [proposal] = referenceProposals({ contexts: referenceContexts(s), oneRepMaxes: s.oneRepMaxes, reviews: s.refReviews })
    expect(proposal).toMatchObject({ key, from: { value: 116.7 }, to: { id: 'new' }, samples: [{ percent: 75 }, { percent: 80 }] })
    reviewReference(s, [key], proposal, 'keep', 5)
    expect(referenceProposals({ contexts: referenceContexts(s), oneRepMaxes: s.oneRepMaxes, reviews: s.refReviews })).toEqual([])
    expect(acceptReference(s, [key], proposal)).toEqual({ ok: true })
    expect(events(s, 'reference')).toMatchObject([{ trackId: `t:P:${BENCH_A}`, ref: { id: 'new' }, from: proposal.from.id }])
    expect(programmeView(s).tracks[`t:P:${BENCH_A}`].nextRef.id).toBe('new')
    // The same proposal again is stale: the context no longer adopts what it reviewed.
    expect(acceptReference(s, [key], proposal)).toEqual({ ok: false, stale: true })
    expect(events(s, 'reference')).toHaveLength(1)
    expect(validateCanonicalProfile(s).ok).toBe(true)
  })

  it('%1RM resolves from the adopted reference, else the best estimate, snapped to the step or to what you own', () => {
    const s = state({}, [logged('2026-10-01', BENCH, 100, 5)])   // Epley: 116.7
    expect(pctWeight(s, BENCH, 75)).toBe(87.5)
    expect(pctWeight(s, BENCH, 75, { step: 5 })).toBe(90)
    expect(pctWeight(s, BENCH, 75, { owned: [80, 86, 90] })).toBe(86)
    expect(pctWeight(s, BENCH, 30, { floor: 40 })).toBe(40)
    expect(pctWeight(s, BENCH, 75, {}, { value: 100, unit: 'kg' })).toBe(75)
    expect(pctWeight(state(), BENCH, 75)).toBeNull()
  })
})

// The session builder reads "today" off the clock. Each case runs at instants that sit on the edges
// a week count can trip over: just after midnight on a Monday (the week start), just before
// midnight on the Sunday before it, both European clock changes (23 and 25-hour days) and a US one.
// The programme is started "today" by the same local date the builder reads.
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
  const withHistory = () => state({}, [logged('2026-01-05', BENCH, 100, 5, 'A'), logged('2026-01-05', SQUAT, 120, 5, 'B')])
  beforeAll(() => { at(...clock) })
  const now = () => { at(...clock); return todayISO() }
  const entriesOf = (S, rid) => {
    const exposures = buildSessionExposures(S, S.routines.find(r => r.id === rid), { now: Date.now(), date: todayISO(), newId: x => x })
    return entriesForExposures(exposures, S.prescriptions).map((e, i) => ({ ...e, exposure: exposures[i] }))
  }

  it('opens at the %1RM weight and the routine\'s reps, not at the policy\'s', () => {
    const s = withHistory()
    const today = now()
    expect(work(entriesOf(clone(s), 'A')[0]).map(x => x.w)).toEqual([102.5, 102.5, 102.5])   // linear: one step up
    withBlock(s)
    start(s, today, 'P', { firstWeek: [0, 1] })
    const [bench, squat] = entriesOf(s, 'A')
    expect(work(bench).map(x => [x.w, x.r])).toEqual([[87.5, 5], [87.5, 5], [87.5, 5]])   // 75 % of the adopted 116.7
    expect(bench.exposure.programme).toMatchObject({ stage: 's1', attempt: 1, role: 'work', effort: { mode: 'advisory', rpe: 7 } })
    expect(bench.exposure.excludedFromProgression).toBe(false)
    // An RPE alone leaves the weight to the occurrence's own progression, carried on by the run.
    expect(work(squat).map(x => x.w)).toEqual([80, 80, 80])
    expect(squat.exposure.programme).toMatchObject({ stage: 's1', effort: { rpe: 7 } })
  })

  it('"Your last session" does not move a programme\'s reps', () => {
    const s = { ...withHistory(), startFrom: 'last' }
    withBlock(s)
    start(s, now(), 'P', { firstWeek: [0, 1] })
    const [bench] = entriesOf(s, 'A')
    expect(work(bench).map(x => x.r)).toEqual([5, 5, 5])
    expect(bench.carried).toBeUndefined()
  })

  it('a deload week takes the weight down and stays out of progression', () => {
    const s = withHistory()
    withBlock(s)
    start(s, daysBefore(now(), 14), 'P', { firstWeek: [0, 1] })
    const [bench] = entriesOf(s, 'A')
    expect(bench.exposure.programme).toMatchObject({ stage: 's3', role: 'work' })
    expect(work(bench)[0].w).toBe(92.5)   // the run's 102.5 × 0.9, on the 2.5 grid
    expect(bench.exposure.excludedFromProgression).toBe(true)
  })

  it('a routine the programme does not schedule builds as always', () => {
    const s = withHistory()
    const today = now()
    const plain = entriesOf(clone(s), 'C').map(({ exposure, ...e }) => e)
    withBlock(s)
    start(s, today)
    expect(entriesOf(s, 'C').map(({ exposure, ...e }) => e)).toEqual(plain)
  })
})

// The week count is calendar arithmetic on local dates in the run's zone: a 23 or 25-hour day never
// moves a date, and a week starts on the profile's week start.
describe('week boundaries across the clock changes', () => {
  const weekOf = (startedOn, weekStart = 1) => {
    const s = state({ weekStart })
    withBlock(s, { weeks: Array(8).fill({}) })
    start(s, startedOn)
    return d => programmeView(s, d)?.period.index
  }
  it('EU autumn change (Sunday 2026-10-25): week 2 starts on the Monday after', () => {
    expect(['2026-10-19', '2026-10-24', '2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02'].map(weekOf('2026-10-19'))).toEqual([1, 1, 1, 2, 2, 3])
  })
  it('EU spring change (Sunday 2027-03-28)', () => {
    expect(['2027-03-27', '2027-03-28', '2027-03-29', '2027-04-04', '2027-04-05'].map(weekOf('2027-03-22'))).toEqual([1, 1, 2, 2, 3])
  })
  it('US changes (2026-11-01, 2027-03-14)', () => {
    expect(['2026-11-01', '2026-11-02'].map(weekOf('2026-10-26'))).toEqual([1, 2])
    expect(['2027-03-14', '2027-03-15'].map(weekOf('2027-03-08'))).toEqual([1, 2])
  })
  it('a Sunday week start turns over on Sunday, on the change day itself', () => {
    expect(['2026-10-24', '2026-10-25', '2026-10-31', '2026-11-01'].map(weekOf('2026-10-24', 0))).toEqual([1, 2, 2, 3])
  })
  it('a start on the week\'s last day still counts that week as week 1', () => {
    expect(['2026-10-25', '2026-10-26'].map(weekOf('2026-10-25'))).toEqual([1, 2])
    expect(['2027-03-28', '2027-03-29'].map(weekOf('2027-03-28'))).toEqual([1, 2])
  })
})
