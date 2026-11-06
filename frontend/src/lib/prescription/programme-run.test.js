// A programme run replayed (docs/superpowers/specs/2026-11-04-programme-coach-effort-v2-design.md,
// sections 7, 8, 10, 17 and the worked examples of 12). The default run starts on Monday
// 2026-11-02 (UTC, weeks from Monday) with three appointments a week: A on Monday, B on Wednesday,
// C on Friday. Every exposure is generated against its slot; rounding is nearest 0.5 kg.
import { expect, test } from 'vitest'
import { dateIn } from '../../../../api/engine/programme-run.js'
import { contentHash, defaultPlanRule, deriveRun, generatePrescription, referenceProposals, slotFor, slotInputs, summarizeActual, weeklyTemplate } from './index.js'

const RUN = 'run1'
const ROUNDING = { mode: 'nearest', step: 0.5 }
const REPEAT = { onFailure: 'repeat', onSkipped: 'repeat' }
const range = (min, max = min) => ({ min, max })
const kg = value => ({ value, unit: 'kg' })
const abs = value => ({ mode: 'absolute', value, unit: 'kg' })
/** Week k of the default run (Monday 2026-11-02 is week 1), `wd` days after its Monday. */
const date = (k, wd = 0) => new Date(Date.UTC(2026, 10, 2 + 7 * (k - 1) + wd)).toISOString().slice(0, 10)
const iso = (day, hh = 10) => `${day}T${String(hh).padStart(2, '0')}:00:00.000Z`
const plus = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10)

// Every occurrence the programme binds: linear 3 × 5 at 80 kg, +2.5 kg on success, no goal.
const occRule = (more = {}) => defaultPlanRule('linear', { id: 'occ', exerciseId: 'bench', routineId: 'rA', unit: 'kg', load: abs(80), rounding: ROUNDING, target: { mode: 'none' }, completion: [], ...more })
const PLAIN = occRule()
// An authored fixed week at a load expression.
const phase = load => ({
  id: 'week', parameters: { sets: range(3), reps: range(5), load, restSeconds: 90 }, target: { mode: 'none' },
  groups: [{ id: 'sets', count: 'parameters', reps: 'parameters', load: { basis: 'anchor', percent: 100 } }],
  success: { scope: 'all', load: 'ignore', effort: 'ignore' }, progression: [], exit: null
})
const stage = (id, more = {}) => ({ id, kind: 'work', targets: {}, ...more })
const stages = (...ids) => ids.map(id => stage(id))
// A track: `slots` are occurrence ids ('rA:o0' is routine rA's first exercise).
const trackOf = (id, slots, st = stages('w1', 'w2', 'w3', 'w4'), more = {}) => ({
  id, exerciseId: id, slots: slots.map(oid => ({ rid: oid.split(':')[0], oid })), stages: st, refs: 'inherit', ...more
})
const WEEK = { mode: 'weeks', appts: [{ rid: 'rA', day: 1 }, { rid: 'rB', day: 3 }, { rid: 'rC', day: 5 }] }
const def = (tracks = [trackOf('bench', ['rA:o0'])], more = {}) => ({
  id: 'pg', name: 'Block', at: 0, rev: 1, schedule: WEEK, duration: { n: 8, unit: 'weeks' }, end: 'stop', refs: 'inherit', tracks, ...more
})
const rotation = (tracks, sequence = ['rA', 'rB', 'rC'], n = 4) => def(tracks, { schedule: { mode: 'rotation', sequence }, duration: { n, unit: 'blocks' } })
function run(d = def(), { policy = REPEAT, ...more } = {}) {
  return {
    id: RUN, programmeId: 'pg', def: d, startedOn: '2026-11-02', weekStart: 1, tz: 'UTC', at: iso('2026-11-02', 8), end: 'stop', cycle: 1, bump: 0,
    firstWeek: d.schedule.mode === 'weeks' ? d.schedule.appts.map((_, i) => i) : [],
    tracks: Object.fromEntries(d.tracks.map(t => [t.id, { policy, ack: 'user', refs: 'ask' }])), ...more
  }
}
let seq = 0
const ev = (type, fields = {}) => ({ id: `e${String(++seq).padStart(4, '0')}`, runId: RUN, type, at: iso(date(1)), ...fields })

// A saved exposure as finish-session writes it: the summary, and one performance row per set done.
const performanceRow = s => ({
  prescribed: true, setId: 'r' + s.row, role: 'work', status: 'completed',
  observations: [{ metric: 'repetitions', unit: 'reps', value: s.reps }],
  resistance: s.load ? { kind: 'external-load', ...s.load } : { kind: 'bodyweight' }, segments: []
})
const P = {}   // every prescription a fixture generated, by id
const U = { reps: 5, load: null }   // a set done with no weight typed: the slot is unknown
/**
 * A saved programme exposure for `slot` ('p2:a0:rA:o0'): `sets` are the reps of each set done at
 * its prescribed load (U: no weight typed). By default it is generated against the plain 3 × 5 at
 * 80 kg on the morning of its appointment's day and finished that evening.
 */
function ex(slot, sets = [5, 5, 5], { track = 'bench', stage: st = 'w1', attempt = 1, role = 'work', at, gen, id, p } = {}) {
  const [, k, a] = slot.match(/^p(\d+):a(\d+):/)
  const done = at ?? iso(date(+k, 2 * +a), 18)
  const n = ++seq
  const oid = slot.split(':').slice(2).join(':')
  p ??= generatePrescription({ id: 'px' + n, now: gen ?? done.replace(/T\d\d/, 'T09'), trackId: `run:${RUN}:${track}:${oid}`, rule: PLAIN })
  P[p.id] = p
  const performed = sets.map((s, row) => (typeof s === 'number' ? { row, reps: s, load: p.rows[row]?.load ?? kg(80) } : { row, ...s }))
  return {
    exposureId: id ?? 'x' + String(n).padStart(4, '0'), exerciseId: track, trackId: p.trackId, prescriptionId: p.id, completedAt: done,
    programme: { runId: RUN, rev: 1, trackId: track, slot, stage: st, attempt, role },
    actual: summarizeActual(p, performed), performance: { sets: performed.map(performanceRow) }
  }
}
// The same exposure while its session is still open: nothing saved yet.
const live = (slot, more) => { const { actual, ...x } = ex(slot, [], more); return { ...x, performance: { sets: [] } } }
const derive = (r, xs = [], events = [], today = date(2), more = {}) =>
  deriveRun({ run: r, events, workouts: xs.map((x, i) => ({ id: 'w' + i, exposures: [x] })), prescriptions: P, today, ...more })
const rows = x => P[x.prescriptionId].rows.map(row => row.load.value)

/**
 * A session as the app runs it: slotFor places it, and with an occurrence rule slotInputs feeds
 * generatePrescription (else it is the plain 3 × 5 at 80). Every set is done at its aim unless
 * `sets` says otherwise. Returns the saved exposure, or null when the run gives it no slot.
 */
function perform(r, w, { rid, oid, date: day, sets, occRule: rule }) {
  const view = derive(r, w.xs, w.events, day)
  const { assignment: a } = slotFor({ view, run: r, rid, oid, date: day })
  if (!a) return null
  let p
  if (rule) {
    p = generatePrescription({ id: 'pp' + ++seq, now: iso(day, 9), ...slotInputs({ view, run: r, assignment: a, occRule: rule }) })
    P[p.id] = p
  }
  const x = ex(a.slot, sets ?? (p ? p.rows.map(row => row.reps.min) : undefined), { track: a.trackId, stage: a.stage, attempt: a.attempt, role: a.role, at: iso(day, 18), p })
  w.xs.push(x)
  return x
}
const world = () => ({ xs: [], events: [] })

const R100 = { id: 'orm100', exerciseId: 'bench', value: 100, unit: 'kg', source: 'estimated', capturedAt: '2026-10-01T10:00:00.000Z' }
const R110 = { ...R100, id: 'orm110', value: 110, capturedAt: '2026-11-03T10:00:00.000Z' }
const pct = { own: 'set', phase: phase({ mode: 'percent_1rm', percent: 75 }) }
const pctTrack = (oids = ['rA:o0', 'rC:o0']) => trackOf('bench', oids, ['w1', 'w2'].map(id => stage(id, { targets: Object.fromEntries(oids.map(o => [o, pct])) })))

test.each([['advance', 'advance', 'advance'], ['advance', 'repeat', 'repeat'], ['repeat', 'advance', 'repeat'], ['repeat', 'repeat', 'repeat']])(
  'failed + skipped with onFailure %s, onSkipped %s gives %s', (onFailure, onSkipped, action) => {
    const r = run(def([trackOf('bench', ['rA:o0', 'rB:o0'])]), { policy: { onFailure, onSkipped } })
    const bench = derive(r, [ex('p1:a0:rA:o0', [5, 5, 3])]).tracks.bench
    expect(bench.decisions).toEqual([{
      stage: 'w1', attempt: 1, period: 1, action, policy: { onFailure, onSkipped }, at: date(1, 6),
      reasons: { failed: ['p1:a0:rA:o0'], skipped: ['p1:a1:rB:o0'], unknown: [] }
    }])
    expect(bench).toMatchObject(action === 'repeat' ? { stage: 'w1', attempt: 2, period: 2 } : { stage: 'w2', attempt: 1, period: 2 })
  })

test('two bench sessions a week: Friday fails, both repeat with fresh ids, squat moves on (spec 12.6)', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rC:o0']), trackOf('squat', ['rA:o1'])]))
  const xs = [ex('p1:a0:rA:o0'), ex('p1:a0:rA:o1', undefined, { track: 'squat' }), ex('p1:a2:rC:o0', [5, 5, 4])]
  const view = derive(r, xs)
  expect(view.tracks.bench.decisions.map(d => [d.action, d.reasons.failed])).toEqual([['repeat', ['p1:a2:rC:o0']]])
  expect(view.tracks.bench).toMatchObject({ state: 'active', stage: 'w1', attempt: 2, period: 2 })
  // Both slots again, with this window's ids; Monday's earlier success credits nothing here.
  expect(view.tracks.bench.slots).toEqual([
    { id: 'p2:a0:rA:o0', rid: 'rA', oid: 'rA:o0', appt: 0, required: true, outcome: 'pending', reasons: [] },
    { id: 'p2:a2:rC:o0', rid: 'rC', oid: 'rC:o0', appt: 2, required: true, outcome: 'pending', reasons: [] }
  ])
  expect(view.tracks.squat).toMatchObject({ state: 'active', stage: 'w2', attempt: 1, period: 2 })
  expect(slotFor({ view, run: r, rid: 'rA', oid: 'rA:o0', date: date(2) })).toEqual({
    assignment: { slot: 'p2:a0:rA:o0', trackId: 'bench', stage: 'w1', attempt: 2, role: 'work', period: 2 }, bypass: []
  })
})

test('repeat restores the week-start values: a successful Monday does not leak into the retry', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rC:o0'], stages('w1', 'w2'))]))
  const w = world()
  const rule = occRule()
  expect(rows(perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(1), occRule: rule }))).toEqual([80, 80, 80])
  perform(r, w, { rid: 'rC', oid: 'rC:o0', date: date(1, 4), occRule: rule, sets: [5, 5, 3] })
  // Monday earned 82.5 inside the failed week; the retry opens at the week's 80, from nothing logged.
  const retry = perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(2), occRule: rule })
  expect(retry.programme).toMatchObject({ stage: 'w1', attempt: 2 })
  expect(rows(retry)).toEqual([80, 80, 80])
  expect(P[retry.prescriptionId].prefill.reps).toBe(5)
  expect(P[retry.prescriptionId].provenance.sourceLogId).toBeNull()
  // A clean retry commits what the week earned: week 2 opens at 82.5.
  perform(r, w, { rid: 'rC', oid: 'rC:o0', date: date(2, 4), occRule: rule })
  const next = perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(3), occRule: rule })
  expect(next.programme).toMatchObject({ stage: 'w2', attempt: 1 })
  expect(rows(next)).toEqual([82.5, 82.5, 82.5])
})

test('a new step enters at its seed, and copy after an adaptive week takes its last qualified load', () => {
  // Week 2 is its own phase: fixed 70 kg as authored, a new reps step 5 to 8, entered at 6 reps and week 1's load.
  const reps = { id: 'reps', metric: 'reps', when: 'success', step: 1, resetOnCarry: true }
  const w2 = { ...phase(abs(70)), id: 'w2p', parameters: { ...phase(abs(70)).parameters, reps: range(5, 8) }, progression: [reps] }
  const st = [stage('w1'), stage('w2', { targets: { 'rA:o0': { own: 'set', phase: w2, seed: { reps: 6, load: 'copy' } } } })]
  const r = run(def([trackOf('bench', ['rA:o0'], st)]))
  const w = world()
  const rule = occRule()
  perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(1), occRule: rule })
  const next = perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(2), occRule: rule })
  expect(next.programme).toMatchObject({ stage: 'w2', attempt: 1 })
  expect(P[next.prescriptionId].rows.map(row => `${row.reps.min}@${row.load.value}`)).toEqual(['6@80', '6@80', '6@80'])
  // The run's captured seed is where an occurrence with nothing logged in the run opens.
  const seeded = run(def([trackOf('bench', ['rA:o0'], stages('w1'))]))
  seeded.tracks.bench.seed = { 'rA:o0': { load: abs(90) } }
  expect(rows(perform(seeded, world(), { rid: 'rA', oid: 'rA:o0', date: date(1), occRule: rule }))).toEqual([90, 90, 90])
})

test('unknown holds only its track; a confirmed failure on another slot still repeats', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rC:o0']), trackOf('squat', ['rA:o1'])]))
  const squat = ex('p1:a0:rA:o1', undefined, { track: 'squat' })
  const held = derive(r, [ex('p1:a0:rA:o0', [5, 5, U]), ex('p1:a2:rC:o0'), squat])
  expect(held.tracks.bench).toMatchObject({ state: 'held', stage: 'w1', attempt: 1, period: 1 })
  expect(held.tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'hold', reasons: { failed: [], skipped: [], unknown: ['p1:a0:rA:o0'] } })])
  expect(held.tracks.squat).toMatchObject({ state: 'active', stage: 'w2', period: 2 })
  // Friday's confirmed miss already decides: repeat, the unknown kept as a reason.
  const failed = derive(r, [ex('p1:a0:rA:o0', [5, 5, U]), ex('p1:a2:rC:o0', [5, 5, 3]), squat])
  expect(failed.tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'repeat', reasons: { failed: ['p1:a2:rC:o0'], skipped: [], unknown: ['p1:a0:rA:o0'] } })])
  expect(failed.tracks.bench).toMatchObject({ state: 'active', stage: 'w1', attempt: 2 })
})

test('an active session holds its track and is never also skipped', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rC:o0'])]))
  const active = { exposures: [live('p1:a2:rC:o0')] }
  const view = derive(r, [ex('p1:a0:rA:o0')], [ev('close', { period: 1, at: iso(date(1, 6)) })], date(2), { active })
  expect(view.tracks.bench).toMatchObject({ state: 'held', period: 1 })
  expect(view.tracks.bench.slots[1]).toMatchObject({ id: 'p1:a2:rC:o0', outcome: 'pending', reasons: ['active'] })
  expect(view.tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'hold', reasons: { failed: [], skipped: [], unknown: [] } })])
  // The held week takes no new credit: this week's Friday is extra work.
  expect(slotFor({ view, run: r, rid: 'rC', oid: 'rC:o0', date: date(2, 4) }).assignment).toMatchObject({ slot: 'p2:a2:rC:o0', role: 'extra' })
})

test('Wednesday session done Thursday fills Wednesday, no penalty; Friday first does not skip it (spec 12.9)', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rB:o0']), trackOf('row', ['rC:o0'])]))
  const thursday = ex('p1:a1:rB:o0', undefined, { at: iso(date(1, 3), 18) })
  const view = derive(r, [ex('p1:a0:rA:o0'), thursday])
  expect(view.tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'advance', at: date(1, 6), reasons: { failed: [], skipped: [], unknown: [] } })])
  expect(view.tracks.bench).toMatchObject({ stage: 'w2', attempt: 1, period: 2 })
  // Friday's C recorded first: Wednesday's B is still due, and nothing is bypassed in a weekday schedule.
  const friday = derive(r, [ex('p1:a0:rA:o0'), ex('p1:a2:rC:o0', undefined, { track: 'row' })], [], date(1, 4))
  expect(friday.tracks.bench.slots[1]).toMatchObject({ id: 'p1:a1:rB:o0', outcome: 'pending' })
  expect(slotFor({ view: friday, run: r, rid: 'rB', oid: 'rB:o0', date: date(1, 5) })).toEqual({
    assignment: { slot: 'p1:a1:rB:o0', trackId: 'bench', stage: 'w1', attempt: 1, role: 'work', period: 1 }, bypass: []
  })
})

test('ordered week: acknowledged A to C skips B before the week closes; a displaced C does not', () => {
  const r = run(def([trackOf('squat', ['rA:o0']), trackOf('bench', ['rB:o0']), trackOf('row', ['rC:o0'])], { schedule: { ...WEEK, ordered: true } }))
  const monday = ex('p1:a0:rA:o0', undefined, { track: 'squat' })
  const before = derive(r, [monday], [], date(1, 2))
  expect(slotFor({ view: before, run: r, rid: 'rC', oid: 'rC:o0', date: date(1, 2) })).toEqual({
    assignment: { slot: 'p1:a2:rC:o0', trackId: 'row', stage: 'w1', attempt: 1, role: 'work', period: 1 }, bypass: ['p1:a1']
  })
  const xs = [monday, ex('p1:a2:rC:o0', undefined, { track: 'row', at: iso(date(1, 2), 18) })]
  const acked = derive(r, xs, [ev('bypass', { period: 1, appts: [1], at: iso(date(1, 2), 17) })], date(1, 3))
  expect(acked.tracks.bench.slots).toEqual([expect.objectContaining({ id: 'p1:a1:rB:o0', outcome: 'skipped', reasons: ['bypass'] })])
  // Without the acknowledgment C is only displaced: B stays due until the week closes.
  expect(derive(r, xs, [], date(1, 3)).tracks.bench.slots[0]).toMatchObject({ outcome: 'pending' })
})

test('a later B assigned to a closed week replaces its skip and keeps later prescriptions; a changed branch is a conflict', () => {
  const bench = trackOf('bench', ['rA:o0', 'rB:o0'])
  // Advance on a skip: the late B only changes the reasons, never the branch.
  const lenient = run(def([bench]), { policy: { onFailure: 'repeat', onSkipped: 'advance' } })
  const mon1 = ex('p1:a0:rA:o0'), next = ex('p2:a0:rA:o0', undefined, { stage: 'w2' })
  const late = ex('p2:a1:rB:o0', undefined, { at: iso(date(2, 1), 18), stage: 'w2' })
  const assign = ev('assign', { exposureId: late.exposureId, slot: 'p1:a1:rB:o0', at: iso(date(2, 1), 19) })
  expect(derive(lenient, [mon1, next], [], date(2, 2)).tracks.bench.decisions[0].reasons.skipped).toEqual(['p1:a1:rB:o0'])
  const fixed = derive(lenient, [mon1, next, late], [assign], date(2, 2))
  expect(fixed.tracks.bench.decisions).toEqual([expect.objectContaining({ period: 1, action: 'advance', reasons: { failed: [], skipped: [], unknown: [] } })])
  expect(fixed.tracks.bench.slots[0]).toMatchObject({ id: 'p2:a0:rA:o0', outcome: 'succeeded', exposureId: next.exposureId })
  // The correction is history: it does not push week 2 back, and there is nothing to reconcile.
  expect(fixed.tracks.bench).toMatchObject({ stage: 'w2', attempt: 1, period: 2 })
  expect(fixed.conflicts).toEqual([])

  // Repeat on a skip: week 2 was generated as week 1's retry, a branch the late B invalidates.
  const strict = run(def([bench]))
  const retry = ex('p2:a0:rA:o0', undefined, { attempt: 2 })
  const hash = P[retry.prescriptionId].contentHash
  expect(derive(strict, [mon1, retry], [], date(2, 2)).tracks.bench).toMatchObject({ stage: 'w1', attempt: 2 })
  const conflict = derive(strict, [mon1, retry, late], [assign], date(2, 2))
  expect(conflict.tracks.bench.decisions[0]).toMatchObject({ period: 1, action: 'advance' })
  expect(conflict.conflicts).toEqual([{ trackId: 'bench', exposureId: retry.exposureId }])
  // Until resolved the recorded branch holds, and no prescription is regenerated.
  expect(conflict.tracks.bench).toMatchObject({ stage: 'w1', attempt: 2, period: 2 })
  expect(P[retry.prescriptionId].contentHash).toBe(hash)
  const recorded = derive(strict, [mon1, retry, late], [assign, ev('conflict', { trackId: 'bench', exposureId: retry.exposureId, keep: 'recorded', at: iso(date(2, 2)) })], date(2, 2))
  expect(recorded.conflicts).toEqual([])
  expect(recorded.tracks.bench).toMatchObject({ stage: 'w1', attempt: 2 })
  const recomputed = derive(strict, [mon1, retry, late], [assign, ev('conflict', { trackId: 'bench', exposureId: retry.exposureId, keep: 'recomputed', at: iso(date(2, 2)) })], date(2, 2))
  expect(recomputed.conflicts).toEqual([])
  expect(recomputed.tracks.bench).toMatchObject({ stage: 'w2', attempt: 1, period: 2 })
  expect(recomputed.tracks.bench.slots[0]).toMatchObject({ id: 'p2:a0:rA:o0', outcome: 'pending', reasons: ['recomputed'] })
})

test('a conflict event settles only the conflict it names; recomputed work frees its slot for a redo', () => {
  const bench = trackOf('bench', ['rA:o0', 'rB:o0'])
  const r = run(def([bench]))
  // Weeks 1 and 2 clean; week 2's B is only recorded late, so week 3 was generated as week 2's retry.
  const a1 = ex('p1:a0:rA:o0'), b1 = ex('p1:a1:rB:o0'), a2 = ex('p2:a0:rA:o0', undefined, { stage: 'w2' })
  const a3 = ex('p3:a0:rA:o0', undefined, { stage: 'w2', attempt: 2 })
  const b2 = ex('p3:a1:rB:o0', undefined, { stage: 'w2', attempt: 2, at: iso(date(3, 2), 18) })
  const assign = ev('assign', { exposureId: b2.exposureId, slot: 'p2:a1:rB:o0', at: iso(date(3, 2), 19) })
  // An older resolution, for another exposure, does not hide this new conflict.
  const old = ev('conflict', { trackId: 'bench', exposureId: a2.exposureId, keep: 'recorded', at: iso(date(1, 3)) })
  expect(derive(r, [a1, b1, a2, a3, b2], [old, assign], date(3, 3)).conflicts).toEqual([{ trackId: 'bench', exposureId: a3.exposureId }])

  // Recomputed: week 3 is w3, Monday's w2 retry credits nothing, and a redo of Monday takes the slot.
  const recompute = ev('conflict', { trackId: 'bench', exposureId: a3.exposureId, keep: 'recomputed', at: iso(date(3, 3), 8) })
  const events = [old, assign, recompute]
  const view = derive(r, [a1, b1, a2, a3, b2], events, date(3, 3))
  expect(view.conflicts).toEqual([])
  expect(view.tracks.bench).toMatchObject({ stage: 'w3', attempt: 1, period: 3 })
  expect(slotFor({ view, run: r, rid: 'rA', oid: 'rA:o0', date: date(3, 3) })).toEqual({
    assignment: { slot: 'p3:a0:rA:o0', trackId: 'bench', stage: 'w3', attempt: 1, role: 'work', period: 3 }, bypass: []
  })
  const redo = ex('p3:a0:rA:o0', undefined, { stage: 'w3', at: iso(date(3, 3), 18) })
  const b3 = ex('p3:a1:rB:o0', undefined, { stage: 'w3', at: iso(date(3, 4), 18) })
  const done = derive(r, [a1, b1, a2, a3, b2, redo, b3], events, date(4))
  expect(done.tracks.bench.decisions.at(-1)).toMatchObject({ period: 3, stage: 'w3', action: 'advance', reasons: { failed: [], skipped: [], unknown: [] } })
  expect(done.tracks.bench).toMatchObject({ stage: 'w4', period: 4 })
  // Without a redo the done work is never read as unattempted: the week waits for a redo or a resolve.
  const waiting = derive(r, [a1, b1, a2, a3, b2, b3], events, date(4))
  expect(waiting.tracks.bench).toMatchObject({ state: 'held', period: 3 })
  expect(waiting.tracks.bench.decisions.at(-1)).toMatchObject({ action: 'hold', reasons: { failed: [], skipped: [], unknown: ['p3:a0:rA:o0'] } })
})

test('free rotation: days off leave B due; bypass skips B; next is the next round A (spec 12.10)', () => {
  const r = run(rotation([trackOf('squat', ['rA:o0']), trackOf('bench', ['rB:o0']), trackOf('row', ['rC:o0'])]))
  const a = ex('p1:a0:rA:o0', undefined, { track: 'squat', at: iso('2026-11-02', 18) })
  const idle = derive(r, [a], [], '2026-11-12')
  expect(idle.period).toEqual({ index: 1, next: 1 })
  expect(idle.tracks.bench.slots).toEqual([expect.objectContaining({ id: 'p1:a1:rB:o0', outcome: 'pending' })])
  expect(slotFor({ view: idle, run: r, rid: 'rC', oid: 'rC:o0', date: '2026-11-12' })).toEqual({
    assignment: { slot: 'p1:a2:rC:o0', trackId: 'row', stage: 'w1', attempt: 1, role: 'work', period: 1 }, bypass: ['p1:a1']
  })
  const c = ex('p1:a2:rC:o0', undefined, { track: 'row', at: iso('2026-11-12', 18) })
  const view = derive(r, [a, c], [ev('bypass', { period: 1, appts: [1], at: iso('2026-11-12', 17) })], '2026-11-12')
  expect(view.tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'repeat', reasons: { failed: [], skipped: ['p1:a1:rB:o0'], unknown: [] } })])
  expect(view.tracks.bench).toMatchObject({ stage: 'w1', attempt: 2, period: 2 })
  expect(view.period).toEqual({ index: 2, next: 0 })
  expect(slotFor({ view, run: r, rid: 'rA', oid: 'rA:o0', date: '2026-11-13' }).assignment).toMatchObject({ slot: 'p2:a0:rA:o0', role: 'work', stage: 'w2' })
  // An active B is never offered for a bypass.
  const busy = derive(r, [a], [], '2026-11-12', { active: { exposures: [live('p1:a1:rB:o0', { at: iso('2026-11-12', 9) })] } })
  expect(slotFor({ view: busy, run: r, rid: 'rC', oid: 'rC:o0', date: '2026-11-12' }).bypass).toEqual([])
})

test('an older B synced late is history, no new skip, no double credit', () => {
  const r = run(rotation([trackOf('squat', ['rA:o0']), trackOf('bench', ['rB:o0']), trackOf('row', ['rC:o0'])]))
  const a1 = ex('p1:a0:rA:o0', undefined, { track: 'squat', at: iso('2026-11-02', 18) })
  const b1 = ex('p1:a1:rB:o0', undefined, { at: iso('2026-11-03', 18) })   // logged on another device
  const c1 = ex('p1:a2:rC:o0', undefined, { track: 'row', at: iso('2026-11-04', 18) })
  const bypass = ev('bypass', { period: 1, appts: [1], at: iso('2026-11-04', 17) })   // this device had not seen it
  const a2 = ex('p2:a0:rA:o0', undefined, { track: 'squat', stage: 'w2', at: iso('2026-11-05', 18) })
  expect(derive(r, [a1, c1, a2], [bypass], '2026-11-06').tracks.bench.decisions[0].action).toBe('repeat')
  const view = derive(r, [a1, c1, a2, b1], [bypass], '2026-11-06')
  expect(view.tracks.bench.decisions).toEqual([expect.objectContaining({ period: 1, action: 'advance', reasons: { failed: [], skipped: [], unknown: [] } })])
  expect(view.tracks.bench).toMatchObject({ stage: 'w2', attempt: 1, period: 2 })
  // Round 2's B is still due: the old B credits only its own round.
  expect(view.tracks.bench.slots).toEqual([expect.objectContaining({ id: 'p2:a1:rB:o0', outcome: 'pending' })])
  expect(view.period).toEqual({ index: 2, next: 1 })
  expect(view.conflicts).toEqual([])
})

test('close on Sunday: next week Monday; last resolve on Thursday: the Monday after', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rB:o0'])]), { policy: { onFailure: 'repeat', onSkipped: 'advance' } })
  const sunday = derive(r, [ex('p1:a0:rA:o0')], [ev('close', { period: 1, at: iso(date(1, 6), 20) })], date(1, 6))
  expect(sunday.tracks.bench.decisions).toEqual([expect.objectContaining({ period: 1, action: 'advance', at: date(1, 6), reasons: { failed: [], skipped: ['p1:a1:rB:o0'], unknown: [] } })])
  expect(sunday.tracks.bench).toMatchObject({ stage: 'w2', attempt: 1, period: 2 })
  expect(derive(r, [ex('p1:a0:rA:o0')], [], date(2)).period).toEqual({ index: 2, from: date(2), to: date(2, 6) })

  const strict = run(def([trackOf('bench', ['rA:o0'])]))
  const unknown = ex('p1:a0:rA:o0', [5, 5, U])
  const resolve = ev('resolve', { slot: 'p1:a0:rA:o0', as: 'failed', at: iso(date(2, 3), 12) })
  const view = derive(strict, [unknown], [resolve], date(2, 4))
  expect(view.tracks.bench.decisions).toEqual([
    expect.objectContaining({ period: 1, action: 'hold', at: date(1, 6), reasons: { failed: [], skipped: [], unknown: ['p1:a0:rA:o0'] } }),
    expect.objectContaining({ period: 1, action: 'repeat', at: date(2, 3), reasons: { failed: ['p1:a0:rA:o0'], skipped: [], unknown: [] } })
  ])
  // Thursday's resolve: no shortened week 2, the retry waits for the Monday after.
  expect(view.tracks.bench).toMatchObject({ stage: 'w1', attempt: 2, period: 3 })
  expect(slotFor({ view, run: strict, rid: 'rA', oid: 'rA:o0', date: date(2, 4) }).assignment).toMatchObject({ role: 'extra' })
})

test('pause in week 2 for 14 days: still week 2 after resume, nominal end two weeks later', () => {
  const r = run()
  const events = [ev('pause', { at: iso(date(2, 2)) }), ev('resume', { at: iso(date(4, 2)) })]
  const paused = derive(r, [], events.slice(0, 1), date(3, 2))
  expect(paused).toMatchObject({ status: 'paused', period: { index: 2, from: date(2), to: null }, nominal: { used: 1, of: 8, unit: 'weeks' } })
  // Nothing closes while paused: week 2's slot is not skipped.
  expect(paused.tracks.bench.decisions.map(d => d.period)).toEqual([1])
  expect(paused.tracks.bench.slots).toEqual([expect.objectContaining({ id: 'p2:a0:rA:o0', outcome: 'pending' })])
  expect(slotFor({ view: paused, run: r, rid: 'rA', oid: 'rA:o0', date: date(3, 2) }).assignment).toBeNull()
  expect(derive(r, [], events, date(4, 2))).toMatchObject({ status: 'running', period: { index: 2, from: date(4), to: date(4, 6) }, nominal: { used: 1 } })
  expect(derive(r, [], events, date(5))).toMatchObject({ period: { index: 3 }, nominal: { used: 2 } })
  // Week 8 now ends on calendar week 10's Sunday.
  expect(derive(r, [], events, date(10, 6))).toMatchObject({ status: 'running', period: { index: 8 } })
  expect(derive(r, [], events, date(11))).toMatchObject({ status: 'stopped', nominal: { used: 8 } })
})

test('windows across 2026-03-29 and 2026-10-25 in Europe/Rome are seven days each', () => {
  // [run start, the DST Sunday, Sunday 23:30 local in UTC, Monday 00:30 local in UTC]
  for (const [startedOn, sunday, sundayLate, mondayEarly] of [
    ['2026-03-23', '2026-03-29', '2026-03-29T21:30:00.000Z', '2026-03-29T22:30:00.000Z'],
    ['2026-10-19', '2026-10-25', '2026-10-25T22:30:00.000Z', '2026-10-25T23:30:00.000Z']
  ]) {
    const r = run(def(), { startedOn, tz: 'Europe/Rome' })
    const monday = plus(sunday, 1)
    expect(derive(r, [], [], sunday).period).toEqual({ index: 1, from: startedOn, to: sunday })
    expect(derive(r, [], [], monday).period).toEqual({ index: 2, from: monday, to: plus(monday, 6) })
    // A resolve before local midnight closes week 1 on time; one after it, already Monday in Rome
    // though still Sunday in UTC, defers the retry to week 3.
    const unknown = ex('p1:a0:rA:o0', [5, 5, U], { at: `${startedOn}T17:00:00.000Z` })
    const retryAt = at => derive(r, [unknown], [ev('resolve', { slot: 'p1:a0:rA:o0', as: 'failed', at })], plus(monday, 3)).tracks.bench.period
    expect(retryAt(sundayLate)).toBe(2)
    expect(retryAt(mondayEarly)).toBe(3)
  }
})

// Spec 12.8: an eight-week programme; bench and row reach their goal in week 2, squat repeats its
// week 3 and is at training week 7 in calendar week 8.
function eightWeeks(end) {
  const bench = trackOf('bench', ['rA:o0'], [stage('w1'), stage('w2', { cycleEnd: true })], { tm: { value: 100, unit: 'kg', increment: 2.5 } })
  const squat = trackOf('squat', ['rA:o1'], stages('s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'))
  const r = run(def([bench, trackOf('row', ['rC:o0'], stages('w1', 'w2')), squat]), { end })
  const w = world()
  for (let k = 1; k <= 8; k++) {
    perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(k) })
    perform(r, w, { rid: 'rA', oid: 'rA:o1', date: date(k), sets: k === 3 ? [5, 5, 3] : undefined })
    perform(r, w, { rid: 'rC', oid: 'rC:o0', date: date(k, 4) })
  }
  return { r, w }
}

test('stop at week 8 with squat at week 7: stopped, squat unfinished, bench and row achieved (spec 12.8)', () => {
  const { r, w } = eightWeeks('stop')
  // Achieved tracks kept their slots as maintenance while the run went on.
  expect(w.xs.filter(x => x.programme.trackId === 'bench').map(x => x.programme.role)).toEqual(['work', 'work', ...Array(6).fill('maintenance')])
  const view = derive(r, w.xs, w.events, date(9))
  expect(view).toMatchObject({ status: 'stopped', nominal: { used: 8, of: 8, unit: 'weeks' } })
  expect(view.tracks.squat.achieved).toBeUndefined()
  expect(view.tracks.squat.decisions.at(-1)).toMatchObject({ period: 8, stage: 's7', action: 'advance' })
  expect(view.tracks.squat.decisions.filter(d => d.action === 'repeat')).toEqual([expect.objectContaining({ period: 3, stage: 's3' })])
  for (const t of ['bench', 'row']) expect(view.tracks[t]).toMatchObject({ state: 'achieved', achieved: { stage: 'w2' } })
  // No appointment after the nominal end.
  expect(slotFor({ view, run: r, rid: 'rA', oid: 'rA:o1', date: date(9) }).assignment).toBeNull()
})

test('extend: squat continues, bench and row repeat their achieved work unchanged, no TM or cycle credit', () => {
  const { r, w } = eightWeeks('extend')
  const view = derive(r, w.xs, w.events, date(9))
  expect(view.status).toBe('running')
  expect(slotFor({ view, run: r, rid: 'rA', oid: 'rA:o1', date: date(9) }).assignment).toEqual({ slot: 'p9:a0:rA:o1', trackId: 'squat', stage: 's8', attempt: 1, role: 'work', period: 9 })
  const kept = slotFor({ view, run: r, rid: 'rA', oid: 'rA:o0', date: date(9) }).assignment
  expect(kept).toMatchObject({ slot: 'p9:a0:rA:o0', trackId: 'bench', stage: 'w2', role: 'maintenance' })
  // The achieved work, its steps removed and logged without moving anything.
  const inputs = slotInputs({ view, run: r, assignment: kept, occRule: occRule() })
  expect(inputs.rule.program).toMatchObject({ adaptive: false, phases: [{ progression: [] }] })
  const p = generatePrescription({ id: 'pm', now: iso(date(9), 9), ...inputs })
  expect(p.rows.map(row => `${row.reps.min}@${row.load.value}`)).toEqual(['5@80', '5@80', '5@80'])
  // Six maintenance weeks added no decision and no training-max credit: one increment, from the goal week.
  expect(view.tracks.bench).toMatchObject({ state: 'maintenance', tm: { value: 102.5, unit: 'kg' } })
  expect(view.tracks.bench.decisions.map(d => d.action)).toEqual(['advance', 'achieve'])
  expect(view.tracks.row.decisions.map(d => d.action)).toEqual(['advance', 'achieve'])
})

test('a maintenance miss keeps the goal; all goals reached ends the run complete', () => {
  const { r, w } = eightWeeks('extend')
  perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(9), sets: [5, 5, 2] })   // bench maintenance, missed
  perform(r, w, { rid: 'rA', oid: 'rA:o1', date: date(9) })                      // squat's last week, done
  perform(r, w, { rid: 'rC', oid: 'rC:o0', date: date(9, 4) })
  const during = derive(r, w.xs, w.events, date(9, 5))
  expect(during.tracks.bench).toMatchObject({ state: 'maintenance', achieved: { stage: 'w2' } })
  expect(during.tracks.bench.slots).toEqual([expect.objectContaining({ id: 'p9:a0:rA:o0', outcome: 'failed' })])
  const view = derive(r, w.xs, w.events, date(10))
  expect(view.status).toBe('complete')
  expect(view.tracks.squat).toMatchObject({ state: 'achieved', achieved: { stage: 's8' } })
  expect(view.tracks.bench).toMatchObject({ state: 'achieved', achieved: { stage: 'w2' } })
  expect(view.tracks.bench.decisions.map(d => d.action)).toEqual(['advance', 'achieve'])
  expect(slotFor({ view, run: r, rid: 'rA', oid: 'rA:o0', date: date(10) }).assignment).toBeNull()
})

test('eight-round rotation programme counts rounds, not weeks', () => {
  const r = run(rotation([trackOf('bench', ['rA:o0']), trackOf('squat', ['rB:o0'])], ['rA', 'rB'], 8))
  const w = world()
  for (let d = 0; d < 6; d++) perform(r, w, { rid: d % 2 ? 'rB' : 'rA', oid: d % 2 ? 'rB:o0' : 'rA:o0', date: plus('2026-11-02', d) })
  const view = derive(r, w.xs, w.events, '2026-11-07')
  expect(view).toMatchObject({ status: 'running', nominal: { used: 3, of: 8, unit: 'blocks' }, period: { index: 4, next: 0 } })
  expect(view.tracks.bench).toMatchObject({ stage: 'w4', attempt: 1, period: 4 })
  // Ten weeks without training consume no round.
  expect(derive(r, w.xs, w.events, '2027-01-20')).toMatchObject({ status: 'running', nominal: { used: 3 }, period: { index: 4 } })
})

test('two years away under repeat stays bounded and shows one span per exercise', () => {
  const r = run(def([trackOf('bench', ['rA:o0']), trackOf('squat', ['rA:o1'])]), { end: 'extend' })
  const view = derive(r, [], [], '2028-11-06')   // the Monday of calendar week 106
  for (const [t, oid] of [['bench', 'rA:o0'], ['squat', 'rA:o1']]) {
    expect(view.tracks[t].decisions).toEqual([{
      stage: 'w1', attempt: 1, period: 1, through: 105, action: 'repeat', policy: REPEAT, at: date(105, 6),
      reasons: { failed: [], skipped: [`p1:a0:${oid}`], unknown: [] }
    }])
    expect(view.tracks[t]).toMatchObject({ stage: 'w1', attempt: 106, period: 106 })
  }
  // A ceiling, not a loop: twenty years replay 520 windows.
  const far = derive(r, [], [], '2046-11-05')
  expect(far.tracks.bench.decisions).toEqual([expect.objectContaining({ period: 1, through: 520 })])
  expect(far.period.index).toBe(521)
})

test('the same slot finished twice credits once: earliest completedAt, then exposureId', () => {
  const r = run()
  const early = ex('p1:a0:rA:o0', [5, 5, 3], { at: iso(date(1), 10) }), later = ex('p1:a0:rA:o0', [5, 5, 5], { at: iso(date(1), 18) })
  expect(derive(r, [later, early], [], date(1, 1)).tracks.bench.slots[0]).toMatchObject({ outcome: 'failed', exposureId: early.exposureId })
  const a = ex('p1:a0:rA:o0', [5, 5, 5], { id: 'xa' }), b = ex('p1:a0:rA:o0', [5, 5, 3], { id: 'xb' })
  expect(derive(r, [b, a], [], date(1, 1)).tracks.bench.slots[0]).toMatchObject({ outcome: 'succeeded', exposureId: 'xa' })
  // One credit, one step: the week advances once.
  const view = derive(r, [a, b, later], [], date(2))
  expect(view.tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'advance' })])
  expect(view.tracks.bench).toMatchObject({ stage: 'w2', attempt: 1, period: 2 })
})

const ctx = (key, percents, more = {}) => ({ key, exerciseId: 'bench', ref: R100, pref: 'ask', percents, rounding: ROUNDING, ...more })
const oneRepMaxes = { orm100: R100, orm110: R110 }

test('reference 100 to 110 kg at 75% proposes 75 to 82.5 kg; 60 kg absolute has no proposal (spec 12.7)', () => {
  expect(referenceProposals({ contexts: [ctx('run:run1:bench', [75]), ctx('occ:rB:o0', [])], oneRepMaxes, reviews: {} })).toEqual([
    { key: 'run:run1:bench', exerciseId: 'bench', from: R100, to: R110, candidateId: 'orm110', samples: [{ percent: 75, from: 75, to: 82.5 }] }
  ])
  // Nothing to ask: kept on purpose, already adopted, a training max (rebased on its own), no 1RM yet.
  const quiet = [ctx('a', [75], { pref: 'keep' }), ctx('b', [75], { ref: R110 }), ctx('c', [75], { tm: kg(90) }), ctx('d', [75], { ref: null })]
  expect(referenceProposals({ contexts: quiet, oneRepMaxes, reviews: {} })).toEqual([])
})

test('accept for the routine leaves the programme at 100; accept for the run starts at its next unstarted week', () => {
  const r = run(def([pctTrack()]))
  r.tracks.bench.ref = R100
  const w = world()
  const rule = occRule()
  expect(rows(perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(1), occRule: rule }))).toEqual([75, 75, 75])
  // An accept for the routine writes its occurrence, not the run: the programme still reads 100.
  expect(derive(r, w.xs, w.events, date(1, 2)).tracks.bench).toMatchObject({ ref: R100, nextRef: R100 })
  // Accepted for the run on Wednesday: this week started at 100 and keeps it to Friday.
  w.events.push(ev('reference', { trackId: 'bench', ref: R110, from: 'orm100', at: iso(date(1, 2)) }))
  expect(rows(perform(r, w, { rid: 'rC', oid: 'rC:o0', date: date(1, 4), occRule: rule }))).toEqual([75, 75, 75])
  expect(derive(r, w.xs, w.events, date(1, 5)).tracks.bench).toMatchObject({ ref: R100, nextRef: R110 })
  expect(rows(perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(2), occRule: rule }))).toEqual([82.5, 82.5, 82.5])
  // Before anything of a week was generated, an accept applies to that week at once.
  const fresh = derive(r, [], [ev('reference', { trackId: 'bench', ref: R110, from: 'orm100', at: iso(date(1), 6) })], date(1))
  expect(fresh.tracks.bench.ref).toEqual(R110)
})

test('an active session keeps 75 kg and its hash after an accepted update', () => {
  const r = run(def([pctTrack()]))
  r.tracks.bench.ref = R100
  const view = derive(r, [], [], date(1))
  const { assignment } = slotFor({ view, run: r, rid: 'rA', oid: 'rA:o0', date: date(1) })
  const p = generatePrescription({ id: 'pactive', now: iso(date(1), 9), ...slotInputs({ view, run: r, assignment, occRule: occRule() }) })
  P[p.id] = p
  const { contentHash: hash, ...body } = p
  const active = { exposures: [{ exposureId: 'xactive', prescriptionId: p.id, programme: { runId: RUN, rev: 1, ...assignment }, performance: { sets: [] } }] }
  const accepted = derive(r, [], [ev('reference', { trackId: 'bench', ref: R110, from: 'orm100', at: iso(date(1), 12) })], date(1), { active })
  expect(accepted.tracks.bench.slots[0]).toMatchObject({ id: 'p1:a0:rA:o0', outcome: 'pending', reasons: ['active'] })
  expect(accepted.tracks.bench).toMatchObject({ ref: R100, nextRef: R110 })
  expect(p.rows.map(row => row.load.value)).toEqual([75, 75, 75])
  expect(contentHash(body)).toBe(hash)
  // The rest of the started week keeps 100 too.
  const friday = slotFor({ view: accepted, run: r, rid: 'rC', oid: 'rC:o0', date: date(1, 4) }).assignment
  expect(slotInputs({ view: accepted, run: r, assignment: friday, occRule: occRule() }).oneRm).toEqual(R100)
})

test('keep hides the same candidate; a newer candidate is offered again; later stays listed', () => {
  const contexts = [ctx('run:run1:bench', [75])]
  const keep = { 'run:run1:bench': { candidateId: 'orm110', decision: 'keep', at: iso(date(1)) } }
  expect(referenceProposals({ contexts, oneRepMaxes, reviews: keep })).toEqual([])
  const R115 = { ...R100, id: 'orm115', value: 115, capturedAt: '2026-11-04T10:00:00.000Z' }
  expect(referenceProposals({ contexts, oneRepMaxes: { ...oneRepMaxes, orm115: R115 }, reviews: keep })).toEqual([
    expect.objectContaining({ candidateId: 'orm115', samples: [{ percent: 75, from: 75, to: 86.5 }] })
  ])
  const later = { 'run:run1:bench': { candidateId: 'orm110', decision: 'later', at: iso(date(1)) } }
  expect(referenceProposals({ contexts, oneRepMaxes, reviews: later }).map(x => x.candidateId)).toEqual(['orm110'])
})

test('a stale or second accept with the same from applies once', () => {
  const r = run(def([pctTrack()]))
  r.tracks.bench.ref = R100
  const R105 = { ...R100, id: 'orm105', value: 105 }
  const accept = (ref, from, at, id) => ev('reference', { trackId: 'bench', ref, from, at, ...(id ? { id } : {}) })
  const events = [accept(R110, 'orm100', iso(date(1), 8)), accept(R105, 'orm100', iso(date(1), 9)), accept(R105, 'orm-gone', iso(date(1), 7)), accept(R110, 'orm100', iso(date(1), 10))]
  expect(derive(r, [], events, date(1)).tracks.bench.nextRef).toEqual(R110)
  // At the same instant the lower event id wins, whatever order they arrive in.
  const tie = [accept(R105, 'orm100', iso(date(1), 8), 'z2'), accept(R110, 'orm100', iso(date(1), 8), 'z1')]
  expect(derive(r, [], tie, date(1)).tracks.bench.nextRef).toEqual(R110)
  expect(derive(r, [], [...tie].reverse(), date(1)).tracks.bench.nextRef).toEqual(R110)
  // The adopted 110 can itself be replaced, once, by an accept that names it.
  expect(derive(r, [], [...events, accept(R105, 'orm110', iso(date(1), 11))], date(1)).tracks.bench.nextRef).toEqual(R105)
})

test('5/3/1 TM grows once per qualifying cycle, not after a repeated week, never from a 1RM accept', () => {
  const rule = occRule()
  const cycle = c => weeklyTemplate('five_three_one', { oid: 'rA:o0', occRule: rule }).map(s => ({ ...s, id: `c${c}${s.id}` }))
  const bench = trackOf('bench', ['rA:o0'], [...cycle(1), ...cycle(2)], { tm: { value: 90, unit: 'kg', increment: 2.5 } })
  const r = run(def([bench], { duration: { n: 12, unit: 'weeks' } }))
  r.tracks.bench.ref = R100
  const w = world()
  // Week 2 fails and repeats; a 1RM accept lands in week 3; week 5 leaves the first cycle.
  const results = { 2: [5, 5, 3], 7: [5, 5, 3] }
  for (let k = 1; k <= 5; k++) perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(k), sets: results[k] })
  w.events.push(ev('reference', { trackId: 'bench', ref: R110, from: 'orm100', at: iso(date(3), 12) }))
  // From the second cycle a missed week moves on: that cycle no longer qualifies.
  w.events.push(ev('policy', { trackId: 'bench', policy: { onFailure: 'advance', onSkipped: 'repeat' }, at: iso(date(5, 2)) }))
  const after = derive(r, w.xs, w.events, date(6))
  expect(after.tracks.bench.decisions.map(d => `${d.stage}:${d.action}`)).toEqual(['c1w1:advance', 'c1w2:repeat', 'c1w2:advance', 'c1w3:advance', 'c1w4:advance'])
  expect(after.tracks.bench).toMatchObject({ stage: 'c2w1', tm: { value: 92.5, unit: 'kg' }, nextRef: R110 })
  // The new cycle's weights come from the grown training max: 65/75/85 % of 92.5.
  const monday = slotFor({ view: after, run: r, rid: 'rA', oid: 'rA:o0', date: date(6) }).assignment
  const inputs = slotInputs({ view: after, run: r, assignment: monday, occRule: rule })
  expect(generatePrescription({ id: 'p531', now: iso(date(6), 9), ...inputs }).rows.map(row => row.load.value)).toEqual([60, 69.5, 78.5])
  for (let k = 6; k <= 9; k++) perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(k), sets: results[k] })
  const done = derive(r, w.xs, w.events, date(10))
  expect(done.tracks.bench.decisions.slice(5).map(d => `${d.stage}:${d.action}`)).toEqual(['c2w1:advance', 'c2w2:advance', 'c2w3:achieve', 'c2w4:advance'])
  expect(done.tracks.bench.decisions[6]).toMatchObject({ policy: { onFailure: 'advance', onSkipped: 'repeat' }, reasons: { failed: ['p7:a0:rA:o0'] } })
  expect(done.tracks.bench.tm).toEqual({ value: 92.5, unit: 'kg' })
  expect(done.status).toBe('complete')
})

test('started on Thursday: Monday and Wednesday are not owed in week 1 unless firstWeek includes them', () => {
  const d = def([trackOf('bench', ['rA:o0', 'rB:o0', 'rC:o0'])])
  const friday = ex('p1:a2:rC:o0')
  const owed = derive(run(d, { startedOn: '2026-11-05', firstWeek: [2] }), [friday])
  expect(owed.tracks.bench.decisions).toEqual([expect.objectContaining({ period: 1, action: 'advance', reasons: { failed: [], skipped: [], unknown: [] } })])
  expect(derive(run(d, { startedOn: '2026-11-05', firstWeek: [2] }), [], [], date(1, 4)).tracks.bench.slots.map(s => s.id)).toEqual(['p1:a2:rC:o0'])
  const all = derive(run(d, { startedOn: '2026-11-05', firstWeek: [0, 1, 2] }), [friday])
  expect(all.tracks.bench.decisions[0]).toMatchObject({ action: 'repeat', reasons: { skipped: ['p1:a0:rA:o0', 'p1:a1:rB:o0'] } })
})

test('an amend that drops an exercise closes its open week as removed, never as succeeded', () => {
  const d = def([trackOf('bench', ['rA:o0']), trackOf('squat', ['rA:o1'])])
  const r = run(d)
  const xs = [ex('p1:a0:rA:o0'), ex('p1:a0:rA:o1', undefined, { track: 'squat' })]
  const amend = ev('amend', { def: { ...d, rev: 2, tracks: [d.tracks[0]] }, at: iso(date(1, 2)) })
  const view = derive(r, xs, [amend], date(2))
  expect(view.tracks.squat).toMatchObject({ state: 'removed', stage: 'w1', period: 1, decisions: [] })
  expect(view.tracks.bench).toMatchObject({ state: 'active', stage: 'w2', decisions: [expect.objectContaining({ action: 'advance' })] })
  expect(slotFor({ view, run: r, rid: 'rA', oid: 'rA:o1', date: date(2) }).assignment).toBeNull()
})

test('a percent stage without a reference is blocked until a first capture; two first captures keep the earliest', () => {
  const r = run(def([pctTrack(['rA:o0'])]))
  const inputs = view => slotInputs({ view, run: r, assignment: slotFor({ view, run: r, rid: 'rA', oid: 'rA:o0', date: date(1) }).assignment, occRule: occRule() })
  expect(inputs(derive(r, [], [], date(1)))).toEqual({ blocked: 'reference-missing' })
  const R90 = { ...R100, id: 'orm90', value: 90 }
  const capture = (ref, at) => ev('reference', { trackId: 'bench', ref, from: null, at })
  const view = derive(r, [], [capture(R100, iso(date(1), 9)), capture(R90, iso(date(1), 8))], date(1))
  expect(view.tracks.bench.ref).toEqual(R90)
  expect(inputs(view).oneRm).toEqual(R90)
  expect(generatePrescription({ id: 'pfirst', now: iso(date(1), 9), ...inputs(view) }).rows.map(row => row.load.value)).toEqual([67.5, 67.5, 67.5])
  // At the same instant: the lower canonical content hash, in either arrival order.
  const same = [R100, R90].map(ref => capture(ref, iso(date(1), 8)))
  const first = contentHash(R100) < contentHash(R90) ? R100 : R90
  expect(derive(r, [], same, date(1)).tracks.bench.ref).toEqual(first)
  expect(derive(r, [], [...same].reverse(), date(1)).tracks.bench.ref).toEqual(first)
})

test('a removed occurrence blocks its track only', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rB:o0']), trackOf('squat', ['rA:o1'])]))
  const routines = [{ id: 'rA', ex: [{ occurrenceId: 'rA:o0' }, { occurrenceId: 'rA:o1' }] }, { id: 'rB', ex: [] }]
  const xs = [ex('p1:a0:rA:o0'), ex('p1:a0:rA:o1', undefined, { track: 'squat' })]
  // Wednesday's bench is gone while its week is open: no skip, no failure, the track waits for a repair.
  const view = derive(r, xs, [], date(1, 5), { routines })
  expect(view.tracks.bench).toMatchObject({ state: 'blocked', stage: 'w1', attempt: 1, period: 1, decisions: [] })
  expect(view.tracks.bench.slots[1]).toMatchObject({ id: 'p1:a1:rB:o0', outcome: 'pending' })
  expect(slotFor({ view, run: r, rid: 'rA', oid: 'rA:o0', date: date(1, 5) }).assignment).toBeNull()
  expect(view.tracks.squat).toMatchObject({ state: 'active', stage: 'w1', period: 1 })
  const assignment = { slot: 'p1:a1:rB:o0', trackId: 'bench', stage: 'w1', attempt: 1, role: 'work', period: 1 }
  expect(slotInputs({ view, run: r, assignment, occRule: null })).toEqual({ blocked: 'occurrence-missing' })
  // A closed week keeps the closure it had; the open week is the one that waits. Squat moves on.
  const later = derive(r, xs, [], date(2), { routines })
  expect(later.tracks.bench).toMatchObject({ state: 'blocked', stage: 'w1', attempt: 2, period: 2 })
  expect(later.tracks.bench.decisions).toEqual([expect.objectContaining({ period: 1, action: 'repeat', reasons: { failed: [], skipped: ['p1:a1:rB:o0'], unknown: [] } })])
  expect(later.tracks.squat).toMatchObject({ state: 'active', stage: 'w2', period: 2 })
})

test('a date before startedOn is period 0', () => {
  const r = run()
  const before = derive(r, [], [], '2026-10-30')
  expect(before.period).toEqual({ index: 0, from: '2026-11-02', to: '2026-11-08' })
  // Started on Thursday and viewed on the Tuesday before: the window that opens on Thursday.
  expect(derive(run(def(), { startedOn: '2026-11-05', firstWeek: [2] }), [], [], '2026-11-03').period).toEqual({ index: 0, from: '2026-11-05', to: '2026-11-08' })
  expect(derive(run(def(), { startedOn: '2026-11-05', firstWeek: [2] }), [], [], '2026-11-06').period).toEqual({ index: 1, from: '2026-11-05', to: '2026-11-08' })
  expect(before.tracks.bench).toMatchObject({ stage: 'w1', attempt: 1, period: 1, decisions: [] })
  expect(slotFor({ view: derive(r, [], [], date(1)), run: r, rid: 'rA', oid: 'rA:o0', date: '2026-11-01' })).toEqual({ assignment: null, bypass: [] })
  const loop = run(rotation([trackOf('bench', ['rA:o0'])], ['rA']))
  expect(derive(loop, [], [], '2026-10-30').period).toEqual({ index: 0, next: 0 })
})

test('an amend reaches a held or blocked track: a drop removes it, a rebind repairs it', () => {
  const d = def([trackOf('bench', ['rA:o0'], stages('w1')), trackOf('squat', ['rA:o1'], stages('s1'))])
  const r = run(d)
  // Bench reaches its goal in week 1; squat's week 1 is unknown and waits. Squat is dropped in week 3.
  const xs = [ex('p1:a0:rA:o0'), ex('p1:a0:rA:o1', [5, 5, U], { track: 'squat', stage: 's1' })]
  expect(derive(r, xs, [], date(4)).tracks.squat.state).toBe('held')
  const drop = ev('amend', { def: { ...d, rev: 2, tracks: [d.tracks[0]] }, at: iso(date(3, 1)) })
  const view = derive(r, xs, [drop], date(4))
  expect(view.tracks.squat).toMatchObject({ state: 'removed', decisions: [expect.objectContaining({ action: 'hold' })] })
  expect(view.status).toBe('complete')
  expect(slotFor({ view: derive(r, xs, [drop], date(3, 2)), run: r, rid: 'rA', oid: 'rA:o1', date: date(3, 2) }).assignment).toBeNull()

  // Bench's Wednesday occurrence is gone in week 1, and on Thursday an amend drops or rebinds it.
  const d2 = def([trackOf('bench', ['rA:o0', 'rB:o0']), trackOf('squat', ['rA:o1'])])
  const r2 = run(d2)
  const routines = [{ id: 'rA', ex: [{ occurrenceId: 'rA:o0' }, { occurrenceId: 'rA:o1' }] }, { id: 'rB', ex: [] }]
  const done = [ex('p1:a0:rA:o0'), ex('p1:a0:rA:o1', undefined, { track: 'squat' })]
  expect(derive(r2, done, [], date(1, 2), { routines }).tracks.bench.state).toBe('blocked')
  const dropped = ev('amend', { def: { ...d2, rev: 2, tracks: [d2.tracks[1]] }, at: iso(date(1, 3)) })
  expect(derive(r2, done, [dropped], date(4), { routines }).tracks.bench.state).toBe('removed')
  // Rebound to Monday only: a repair inside the open week holds nothing, and the week closes on time.
  const fixed = { ...d2, rev: 2, tracks: [trackOf('bench', ['rA:o0']), d2.tracks[1]] }
  const rebound = ev('amend', { def: fixed, at: iso(date(1, 3)) })
  expect(derive(r2, done, [rebound], date(1, 4), { routines }).tracks.bench).toMatchObject({ state: 'active', period: 1, slots: [expect.objectContaining({ id: 'p1:a0:rA:o0', outcome: 'succeeded' })] })
  const repaired = derive(r2, done, [rebound], date(2), { routines })
  expect(repaired.tracks.bench).toMatchObject({ state: 'active', stage: 'w2', attempt: 1, period: 2 })
  expect(repaired.tracks.bench.decisions.map(x => [x.period, x.action, x.at])).toEqual([[1, 'advance', date(1, 6)]])
  // A later, unrelated amend (a rename) changes nothing already decided, nor the week-2 work.
  const week2 = [...done, ex('p2:a0:rA:o0', undefined, { stage: 'w2' }), ex('p2:a0:rA:o1', undefined, { track: 'squat', stage: 'w2' })]
  const rename = ev('amend', { def: { ...fixed, rev: 3, name: 'Renamed' }, at: iso(date(2, 3)) })
  const brief = v => [v.tracks.bench.stage, v.tracks.bench.attempt, v.tracks.bench.period, v.tracks.bench.decisions]
  expect(brief(derive(r2, week2, [rebound, rename], date(3), { routines }))).toEqual(brief(derive(r2, week2, [rebound], date(3), { routines })))
  expect(derive(r2, week2, [rebound, rename], date(3), { routines }).tracks.bench).toMatchObject({ stage: 'w3', period: 3 })
})

test('an occurrence removed after its week closed does not reopen that week', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rB:o0'])]))
  // Week 1's Wednesday was not done (skipped, repeat); weeks 2 and 3 were done in full.
  const xs = [ex('p1:a0:rA:o0'), ex('p2:a0:rA:o0', undefined, { attempt: 2 }), ex('p2:a1:rB:o0', undefined, { attempt: 2 }),
    ex('p3:a0:rA:o0', undefined, { stage: 'w2' }), ex('p3:a1:rB:o0', undefined, { stage: 'w2' })]
  const live = [{ id: 'rA', ex: [{ occurrenceId: 'rA:o0' }] }, { id: 'rB', ex: [{ occurrenceId: 'rB:o0' }] }]
  const history = v => v.tracks.bench.decisions.map(x => [x.period, x.stage, x.attempt, x.action])
  const kept = [[1, 'w1', 1, 'repeat'], [2, 'w1', 2, 'advance'], [3, 'w2', 1, 'advance']]
  expect(history(derive(r, xs, [], date(4, 2), { routines: live }))).toEqual(kept)
  // Then the user removes the Wednesday occurrence: only the open week 4 waits for a repair.
  const gone = [{ id: 'rA', ex: [{ occurrenceId: 'rA:o0' }] }, { id: 'rB', ex: [] }]
  const blocked = derive(r, xs, [], date(4, 2), { routines: gone })
  expect(history(blocked)).toEqual(kept)
  expect(blocked.tracks.bench).toMatchObject({ state: 'blocked', stage: 'w3', period: 4 })
  // A rebind in week 4 repairs week 4 and rewrites nothing before it.
  const rebind = ev('amend', { def: { ...r.def, rev: 2, tracks: [trackOf('bench', ['rA:o0'])] }, at: iso(date(4, 1)) })
  const repaired = derive(r, xs, [rebind], date(4, 2), { routines: gone })
  expect(history(repaired)).toEqual(kept)
  expect(repaired.tracks.bench).toMatchObject({ state: 'active', stage: 'w3', attempt: 1, period: 4, slots: [expect.objectContaining({ id: 'p4:a0:rA:o0' })] })
})

test('rotation: exercises of one session finished minutes apart close their round together', () => {
  const r = run(rotation([trackOf('row', ['rA:o0']), trackOf('squat', ['rB:o0']), trackOf('bench', ['rB:o1'])], ['rA', 'rB']))
  const xs = [
    ex('p1:a0:rA:o0', undefined, { track: 'row', at: '2026-11-02T18:00:00.000Z' }),
    ex('p1:a1:rB:o0', undefined, { track: 'squat', at: '2026-11-03T18:00:00.000Z' }),
    ex('p1:a1:rB:o1', undefined, { track: 'bench', at: '2026-11-03T18:10:00.000Z' })
  ]
  const view = derive(r, xs, [], '2026-11-04')
  for (const t of ['row', 'squat', 'bench']) expect(view.tracks[t]).toMatchObject({ stage: 'w2', period: 2 })
  expect(slotFor({ view, run: r, rid: 'rB', oid: 'rB:o1', date: '2026-11-05' })).toEqual({
    assignment: { slot: 'p2:a1:rB:o1', trackId: 'bench', stage: 'w2', attempt: 1, role: 'work', period: 2 }, bypass: ['p2:a0']
  })
})

test('a rest week advances with no credit; recovery needs its work unless it closes with the calendar', () => {
  const rest = run(def([trackOf('bench', ['rA:o0'], [stage('w1'), stage('r', { kind: 'rest' }), stage('w2')])]))
  const week1 = [ex('p1:a0:rA:o0')]
  const view = derive(rest, week1, [], date(3))
  expect(view.tracks.bench.decisions[1]).toEqual({ stage: 'r', attempt: 1, period: 2, action: 'advance', reasons: { failed: [], skipped: [], unknown: [] }, policy: REPEAT, at: date(2, 6) })
  expect(view.tracks.bench).toMatchObject({ stage: 'w2', period: 3 })
  // Training in the rest week is logged as extra work.
  expect(slotFor({ view: derive(rest, week1, [], date(2)), run: rest, rid: 'rA', oid: 'rA:o0', date: date(2) }).assignment).toMatchObject({ stage: 'r', role: 'extra' })
  const recovery = close => run(def([trackOf('bench', ['rA:o0'], [stage('w1'), stage('d', { kind: 'recovery', ...(close ? { close } : {}) }), stage('w2')])]))
  // Not done: by default (completion) the skipped recovery week repeats; a calendar one moves on.
  expect(derive(recovery(), week1, [], date(3)).tracks.bench.decisions[1]).toMatchObject({ stage: 'd', action: 'repeat', reasons: { skipped: ['p2:a0:rA:o0'] } })
  expect(derive(recovery('completion'), week1, [], date(3)).tracks.bench).toMatchObject({ stage: 'd', attempt: 2 })
  expect(derive(recovery('calendar'), week1, [], date(3)).tracks.bench.decisions[1]).toMatchObject({ stage: 'd', action: 'advance' })
  expect(derive(recovery('calendar'), week1, [], date(3)).tracks.bench).toMatchObject({ stage: 'w2', period: 3 })
})

test('optional slots never block a week and never credit a required one', () => {
  const t = { ...trackOf('bench', []), slots: [{ rid: 'rA', oid: 'rA:o0' }, { rid: 'rC', oid: 'rC:o0', optional: true }] }
  const r = run(def([t]))
  const monday = ex('p1:a0:rA:o0')
  expect(derive(r, [monday], [], date(1, 5)).tracks.bench.slots.map(s => [s.id, s.required])).toEqual([['p1:a0:rA:o0', true], ['p1:a2:rC:o0', false]])
  for (const xs of [[monday], [monday, ex('p1:a2:rC:o0', [5, 5, 2])]]) {
    expect(derive(r, xs).tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'advance', reasons: { failed: [], skipped: [], unknown: [] } })])
  }
  expect(derive(r, [ex('p1:a2:rC:o0')]).tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'repeat', reasons: { failed: [], skipped: ['p1:a0:rA:o0'], unknown: [] } })])
})

test('an end-policy event counts before the nominal end, never after it', () => {
  const r = run(def([trackOf('bench', ['rA:o0'], stages('w1'))], { duration: { n: 2, unit: 'weeks' } }))
  const missed = [1, 2].map(k => ex(`p${k}:a0:rA:o0`, [5, 5, 3], { attempt: k }))
  expect(derive(r, missed, [], date(4)).status).toBe('stopped')
  expect(derive(r, missed, [ev('end-policy', { end: 'extend', at: iso(date(2, 1)) })], date(4))).toMatchObject({ status: 'running', tracks: { bench: { stage: 'w1', attempt: 4, period: 4 } } })
  // Too late: the run had already stopped at its nominal end.
  expect(derive(r, missed, [ev('end-policy', { end: 'extend', at: iso(date(3, 1)) })], date(4)).status).toBe('stopped')
})

test('an amend of targets applies from the next unstarted week: Friday stays 80, the next week is 70', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rC:o0'], stages('w1', 'w2'))]))
  const w = world()
  const rule = occRule()
  expect(rows(perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(1), occRule: rule }))).toEqual([80, 80, 80])
  const fixed = { own: 'set', phase: phase(abs(70)) }
  const targets = { 'rA:o0': fixed, 'rC:o0': fixed }
  w.events.push(ev('amend', { def: { ...r.def, rev: 2, tracks: [trackOf('bench', ['rA:o0', 'rC:o0'], [stage('w1', { targets }), stage('w2', { targets })])] }, at: iso(date(1, 1)) }))
  expect(rows(perform(r, w, { rid: 'rC', oid: 'rC:o0', date: date(1, 4), occRule: rule }))).toEqual([80, 80, 80])
  const next = perform(r, w, { rid: 'rA', oid: 'rA:o0', date: date(2), occRule: rule })
  expect(next.programme).toMatchObject({ stage: 'w2', attempt: 1 })
  expect(rows(next)).toEqual([70, 70, 70])
})

test('an explicit skip applies onSkipped; a discard after a work row is a failure', () => {
  const r = run(def([trackOf('bench', ['rA:o0', 'rC:o0'])]), { policy: { onFailure: 'repeat', onSkipped: 'advance' } })
  const monday = [ex('p1:a0:rA:o0')]
  const skip = derive(r, monday, [ev('skip', { slot: 'p1:a2:rC:o0', at: iso(date(1, 4)) })], date(1, 5))
  // The skip is the slot's disposition at once, before the week closes.
  expect(skip.tracks.bench.slots[1]).toMatchObject({ outcome: 'skipped', reasons: ['skip'] })
  expect(derive(r, monday, [ev('skip', { slot: 'p1:a2:rC:o0', at: iso(date(1, 4)) })], date(2)).tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'advance', reasons: { failed: [], skipped: ['p1:a2:rC:o0'], unknown: [] } })])
  const discard = derive(r, monday, [ev('discard', { slot: 'p1:a2:rC:o0', worked: true, at: iso(date(1, 4)) })], date(2))
  expect(discard.tracks.bench.decisions).toEqual([expect.objectContaining({ action: 'repeat', reasons: { failed: ['p1:a2:rC:o0'], skipped: [], unknown: [] } })])
  expect(derive(r, monday, [ev('discard', { slot: 'p1:a2:rC:o0', worked: false, at: iso(date(1, 4)) })], date(2)).tracks.bench.decisions[0]).toMatchObject({ action: 'advance', reasons: { skipped: ['p1:a2:rC:o0'] } })
})

test('the replay does not depend on the order exposures and events arrive in', () => {
  const { r, w } = eightWeeks('extend')
  const turn = (a, n) => [...a.slice(n), ...a.slice(0, n)].reverse()
  const base = JSON.stringify(derive(r, w.xs, w.events, date(9)))
  for (const n of [1, 5, 11]) expect(JSON.stringify(derive(r, turn(w.xs, n), turn(w.events, n), date(9)))).toBe(base)
  const events = [ev('pause', { at: iso(date(2, 2)) }), ev('resume', { at: iso(date(3, 2)) }), ev('reference', { trackId: 'bench', ref: R110, from: null, at: iso(date(2)) })]
  const keyed = Object.fromEntries(turn(events, 1).map(e => [e.id, e]))
  expect(JSON.stringify(derive(r, w.xs, keyed, date(9)))).toBe(JSON.stringify(derive(r, w.xs, events, date(9))))
})

test('a converted legacy run starts past its spent weeks, credits old work only through assign, and its captured seed never moves a fixed week', () => {
  // Weeks 1 and 2 were spent under the old calendar (api/migration/programme-upgrade.js): the run opens on w3.
  const st = [stage('w1'), stage('w2'), stage('w3', { targets: { 'rA:o0': { own: 'set', phase: phase(abs(70)) } } }), stage('w4')]
  const legacy = (weekOffset) => {
    const r = run(def([trackOf('bench', ['rA:o0'], st)], { duration: { n: 4, unit: 'weeks' } }), { policy: { onFailure: 'advance', onSkipped: 'advance' }, legacy: { weekOffset } })
    r.tracks.bench.seed = { 'rA:o0': { load: abs(90) } }
    return r
  }
  const r = legacy(2)
  // Monday's session, saved before the run existed: no programme stamp of its own.
  const { programme, ...plain } = ex('p1:a0:rA:o0')
  const old = { ...plain, routineId: 'rA', occurrenceId: 'rA:o0' }
  const v = derive(r, [old], [ev('assign', { exposureId: old.exposureId, slot: 'p1:a0:rA:o0' })], date(1, 2))
  expect(v.tracks.bench).toMatchObject({ stage: 'w3', period: 1 })
  expect(v.tracks.bench.slots[0]).toMatchObject({ exposureId: old.exposureId, outcome: 'succeeded' })
  expect(v.nominal).toEqual({ used: 2, of: 4, unit: 'weeks' })
  expect(derive(r, [old], [], date(1, 2)).tracks.bench.slots[0].exposureId).toBeUndefined()
  // Old work of another exercise (routine B's squat) is never credited to bench, whatever an assign event says.
  const squat = { ...plain, exposureId: 'squat1', exerciseId: 'squat', routineId: 'rB', occurrenceId: 'rB:o0' }
  expect(derive(r, [squat], [ev('assign', { exposureId: 'squat1', slot: 'p1:a0:rA:o0' })], date(1, 2)).tracks.bench.slots[0].exposureId).toBeUndefined()
  // The fixed 70 kg week stands over the seed; the adaptive w4 of a run one week further opens at it.
  expect(rows(perform(r, world(), { rid: 'rA', oid: 'rA:o0', date: date(1), occRule: PLAIN }))).toEqual([70, 70, 70])
  expect(rows(perform(legacy(3), world(), { rid: 'rA', oid: 'rA:o0', date: date(1), occRule: PLAIN }))).toEqual([90, 90, 90])
  // Every week spent: the run reads as stopped.
  expect(derive(legacy(4), [], [], date(1)).status).toBe('stopped')
})

test('dateIn gives the zone\'s local calendar day as YYYY-MM-DD', () => {
  expect(dateIn('2026-03-01T23:30:00.000Z', 'Pacific/Kiritimati')).toBe('2026-03-02')
  expect(dateIn('2026-03-01T23:30:00.000Z', 'America/Los_Angeles')).toBe('2026-03-01')
  expect(dateIn('2026-03-09', 'Asia/Tokyo')).toBe('2026-03-09')
})

test('a routine planned twice in a week takes the appointment picked, while it is open; else the earliest open one', () => {
  const d = def([trackOf('bench', ['rA:o0'])], { schedule: { mode: 'weeks', appts: [{ rid: 'rA', day: 1 }, { rid: 'rA', day: 4 }] } })
  const r = run(d)
  const at = (xs, appt) => slotFor({ view: derive(r, xs, [], date(1)), run: r, rid: 'rA', oid: 'rA:o0', date: date(1), appt }).assignment
  expect(at([], null)).toMatchObject({ slot: 'p1:a0:rA:o0', role: 'work' })
  expect(at([], 1)).toMatchObject({ slot: 'p1:a1:rA:o0', role: 'work' })
  // Thursday's is taken: picking it again gives the one still open.
  expect(at([ex('p1:a1:rA:o0')], 1)).toMatchObject({ slot: 'p1:a0:rA:o0', role: 'work' })
})
