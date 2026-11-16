// The contract-1 upgrade of today's programmes (docs/superpowers/specs/2026-11-04-programme-coach-effort-v2-design.md
// section 15): the shipped starters and hand-made programmes become engine definitions, a running one
// continues as a run at its calendar week, and no historical record changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStarterProgramme } from '../../frontend/src/lib/starter.js';
import { LIB_BY_ID } from '../coach/core/library.js';
import { canonicalJSON, contentHash, defaultPlanRule, deriveRun, generatePrescription, referenceProposals, slotFor, slotInputs, stageRule, summarizeActual, validateProgramme } from '../engine/index.js';
import { convertLegacyProgramme, upgradeEngineContract } from '../migration/programme-upgrade.js';
import { migrateProfileV1ToV2, validateCanonicalActive, validateCanonicalProfile } from '../migration/profile-migration.js';
import { packProfile, unpackProfile } from '../migration/profile-pack.js';
import { MAX_SYNC_BODY, syncSize } from '../migration/profile-size.js';

const SQUAT = 'rA:o0', BENCH = 'rA:o1', ROW = 'rA:o2', OHP = 'rB:o1';   // 5×5 A: squat, bench, row; B: rdl, dumbbell press, pulldown
const SAVED = { week: { 1: 'rX' }, scheduleMode: null, rotation: null, pass: false };
const at = (d, h = 18) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`);
const lift = (id, rid, w, sets = 5, reps = 5) => ({ id, rid, target: { mode: 'reps', sets, reps, weight: w }, planned: { sets, reps }, sets: Array.from({ length: sets }, () => ({ r: reps, w, done: true })) });
const session = (id, d, rid, entries) => ({ id, d, start: at(d), end: at(d, 19), routineIds: [rid], routineId: rid, entries });
// 5×5 A at the given squat / bench / row loads (0 leaves that lift out).
const dayA = (id, d, sq = 60, be = 50, ro = 40) => session(id, d, 'rA', [['0043', sq], ['0025', be], ['0027', ro]].filter(([, w]) => w > 0).map(([ex, w]) => lift(ex, 'rA', w)));
const manual = (exerciseId, value, unit = 'kg') => ({ id: `orm:${exerciseId}`, exerciseId, value, unit, source: 'manual', capturedAt: '2026-10-01T00:00:00.000Z' });
const ONE_RMS = { 'orm:0043': manual('0043', 100), 'orm:0025': manual('0025', 100) };

// A starter programme as today's app wrote it, with readable ids: v1 routines rA, rB, rC… in plan
// order (each exercise `{ id, sets, reps, weight: 0 }`, as the v1 starters were), programme pg.
function starter(kind) {
  const { routines, legacy } = buildStarterProgramme(kind, kind, 1000);
  const ids = Object.fromEntries(routines.map((r, i) => [r.id, `r${'ABCD'[i]}`]));
  const v1 = o => { const ph = o.rule.program.phases[0].parameters; return { id: o.exerciseId, sets: ph.sets.min, reps: ph.reps.min, weight: 0 }; };
  return {
    routines: routines.map(r => ({ id: ids[r.id], name: r.name, emoji: r.emoji, ex: r.ex.map(v1) })),
    programme: { ...legacy, id: 'pg', days: Object.fromEntries(Object.entries(legacy.days).map(([d, rs]) => [d, rs.map(r => ids[r])])) }
  };
}
// A v1 profile: a starter's routines and programme, optionally running.
function v1(kind, { run, programme, routines, workouts = [], ...over } = {}) {
  const s = starter(kind);
  return {
    unit: 'kg', weekStart: 1, restSec: 90, routines: routines ?? s.routines, workouts, programmes: { pg: programme ?? s.programme },
    ...(run ? { programme: { id: 'pg', cycle: 1, bump: 0, saved: SAVED, ...run } } : {}), ...over
  };
}
// The same profile as a v2 one written before contract 1: the legacy programmes ride along untouched.
function contract0({ programmes, programme, ...rest }) {
  const { engineContractRevision, ...p } = migrateProfileV1ToV2(structuredClone(rest), LIB_BY_ID).profile;
  return { ...p, programmes: structuredClone(programmes), ...(programme !== undefined ? { programme: structuredClone(programme) } : {}) };
}
const up = s => upgradeEngineContract(s, LIB_BY_ID);

const trackOf = (def, oid) => def.tracks.find(t => t.id === `t:pg:${oid}`);
const targets = (def, oid) => trackOf(def, oid).stages.map(s => s.targets[oid]);
const occOf = (s, oid) => s.routines.flatMap(r => r.ex).find(o => o.occurrenceId === oid);
const compile = (s, def, oid, stage) => stageRule({ def, track: trackOf(def, oid), stage: trackOf(def, oid).stages.find(x => x.id === stage), oid, occRule: occOf(s, oid).rule, runId: 'r' });
const gen = (rule, extra = {}) => generatePrescription({ id: 'p', now: '2026-11-02T18:00:00.000Z', trackId: 't', rule, ...extra });
const loads = p => p.rows.map(r => r.load?.value);
const view = (s, runId, today) => deriveRun({ run: s.programmeRuns[runId], events: s.programmeEvents, workouts: s.workouts, prescriptions: s.prescriptions, today, routines: s.routines });

// One session of routine `rid` on `date`, logged the way the app logs programme work: each
// occurrence goes through slotFor → slotInputs → generatePrescription and is saved done at its aim.
// Returns each generated prescription's row loads, by occurrence.
function train(s, runId, date, rid) {
  const run = s.programmeRuns[runId];
  const v = view(s, runId, date);
  const out = {}, exposures = [];
  for (const occ of s.routines.find(r => r.id === rid).ex) {
    const { assignment } = slotFor({ view: v, run, rid, oid: occ.occurrenceId, date });
    const inputs = assignment && slotInputs({ view: v, run, assignment, occRule: occ.rule });
    if (!inputs || inputs.blocked) continue;
    const p = generatePrescription({ id: `p:${date}:${occ.occurrenceId}`, now: `${date}T18:00:00.000Z`, ...inputs });
    s.prescriptions[p.id] = p;
    const { period, ...stamp } = assignment;
    exposures.push({
      exposureId: `x:${date}:${occ.occurrenceId}`, exerciseId: occ.exerciseId, mode: 'reps', routineId: rid, occurrenceId: occ.occurrenceId, trackId: inputs.trackId,
      prescriptionId: p.id, excludedFromProgression: false, programme: { runId, rev: run.def.rev, ...stamp }, audit: [], completedAt: `${date}T19:00:00.000Z`,
      actual: summarizeActual(p, p.rows.map((r, i) => ({ row: i, reps: r.reps.min, load: r.load }))),
      performance: { sets: p.rows.map((r, i) => ({ prescribed: true, setId: `r${i}`, role: 'work', status: 'completed', observations: [{ metric: 'repetitions', unit: 'reps', value: r.reps.min }], resistance: r.load ? { kind: 'external-load', ...r.load } : { kind: 'bodyweight' }, segments: [] })) }
    });
    out[occ.occurrenceId] = loads(p);
  }
  s.workouts.push({ id: `w:${date}`, d: date, status: 'completed', routineIds: [rid], exposures });
  return out;
}

test('strength-4 keeps 72.5/77.5/82.5 % and one 60 % recovery week, advisory RPE 7/8/8.5/6', () => {
  const s = contract0(v1('strength-4'));
  const { state } = up(s);
  const def = state.programmes.pg;
  assert.equal(validateCanonicalProfile(state).ok, true);
  assert.equal(def.needs, undefined);
  assert.deepEqual(def.schedule, { mode: 'weeks', appts: [{ rid: 'rA', day: 1 }, { rid: 'rB', day: 3 }, { rid: 'rC', day: 5 }] });
  assert.deepEqual(def.duration, { n: 4, unit: 'weeks' });
  assert.equal(def.end, 'stop');
  assert.equal(def.src, 'strength-4');
  // Every occurrence of every scheduled routine is its own track.
  assert.deepEqual(def.tracks.map(t => t.id), ['rA:o0', 'rA:o1', 'rA:o2', 'rB:o0', 'rB:o1', 'rB:o2', 'rC:o0', 'rC:o1', 'rC:o2'].map(o => `t:pg:${o}`));
  // The barbell squat: four fixed percentages, the steps removed, the last week a calendar recovery.
  const squat = trackOf(def, SQUAT);
  assert.deepEqual(squat.stages.map(st => [st.id, st.kind, st.close ?? null]), [['s1', 'work', null], ['s2', 'work', null], ['s3', 'work', null], ['s4', 'recovery', 'calendar']]);
  assert.deepEqual(targets(def, SQUAT).map(t => [t.own, t.phase.parameters.load.percent, t.phase.progression.length, t.effort, t.deload]),
    [['set', 72.5, 0, { mode: 'advisory', rpe: 7 }, undefined], ['set', 77.5, 0, { mode: 'advisory', rpe: 8 }, undefined],
      ['set', 82.5, 0, { mode: 'advisory', rpe: 8.5 }, undefined], ['set', 60, 0, { mode: 'advisory', rpe: 6 }, undefined]]);
  const oneRm = { value: 100, unit: 'kg' };
  assert.deepEqual(['s1', 's2', 's3', 's4'].map(id => loads(gen(compile(state, def, SQUAT, id), { oneRm }))), [[72.5, 72.5, 72.5, 72.5, 72.5], [77.5, 77.5, 77.5, 77.5, 77.5], [82.5, 82.5, 82.5, 82.5, 82.5], [60, 60, 60, 60, 60]]);
  // One reduction at most: the 60 % week is used as authored, logged without moving the track.
  assert.equal(compile(state, def, SQUAT, 's4').program.adaptive, false);
  // The dumbbell press has no percentage: it keeps its own progression, its last week deloaded once.
  assert.deepEqual(targets(def, OHP), [{ own: 'inherit', effort: { mode: 'advisory', rpe: 7 } }, { own: 'inherit', effort: { mode: 'advisory', rpe: 8 } },
    { own: 'inherit', effort: { mode: 'advisory', rpe: 8.5 } }, { own: 'inherit', deload: { factor: 0.9 }, effort: { mode: 'advisory', rpe: 6 } }]);
});

test('hypertrophy-6 keeps adaptive loads: inherit with advisory RPE 7 to 9, week 6 recovery factor 0.9', () => {
  const s = contract0(v1('hypertrophy-6', {
    run: { startedOn: '2026-11-02' },
    workouts: [session('h1', '2026-10-30', 'rA', [lift('0025', 'rA', 50, 3, 8)])]
  }));
  const { state, summary } = up(s);
  const def = state.programmes.pg;
  assert.deepEqual(def.schedule.appts, [{ rid: 'rA', day: 1 }, { rid: 'rB', day: 2 }, { rid: 'rC', day: 4 }, { rid: 'rD', day: 5 }]);
  for (const t of def.tracks) {
    const oid = t.slots[0].oid;
    assert.deepEqual(t.stages.map(st => st.targets[oid].effort.rpe), [7, 7.5, 8, 8.5, 9, 6], t.id);
    assert.ok(t.stages.every(st => st.targets[oid].own === 'inherit'), t.id);
    assert.deepEqual(t.stages.map(st => st.kind), ['work', 'work', 'work', 'work', 'work', 'recovery'], t.id);
    assert.equal(t.stages[5].close, 'calendar');
  }
  assert.deepEqual(targets(def, 'rA:o0')[5].deload, { factor: 0.9 });
  // The inherited week is the occurrence's own rule, its load step kept.
  assert.deepEqual(compile(state, def, 'rA:o0', 's1').program.phases.map(ph => ph.progression.map(op => op.metric)), [['load']]);
  // The run opens bench where the ordinary track stands (50 lifted, +2.5), not at the routine's 0.
  const runId = 'run:pg:2026-11-02:1';
  assert.deepEqual(state.programmeRuns[runId].tracks['t:pg:rA:o0'].seed, { 'rA:o0': { load: { mode: 'absolute', value: 52.5, unit: 'kg' } } });
  assert.ok(!summary.some(x => x.kind === 'reference' || x.kind === 'reference-missing'));
  const s2 = structuredClone(state);
  assert.deepEqual(train(s2, runId, '2026-11-02', 'rA')['rA:o0'], [52.5, 52.5, 52.5]);
  const inputs = slotInputs({ view: view(s2, runId, '2026-11-09'), run: s2.programmeRuns[runId], assignment: slotFor({ view: view(s2, runId, '2026-11-09'), run: s2.programmeRuns[runId], rid: 'rA', oid: 'rA:o0', date: '2026-11-09' }).assignment, occRule: occOf(s2, 'rA:o0').rule });
  assert.deepEqual(inputs.effort, { mode: 'advisory', rpe: 7.5 });
  assert.deepEqual(loads(gen(inputs.rule, inputs)), [55, 55, 55]);
});

test('linear-12 keeps ordinary progression between recovery weeks 4, 8 and 12', () => {
  const s = contract0(v1('linear-12', { run: { startedOn: '2026-11-02' }, workouts: [dayA('h1', '2026-10-30')] }));
  const { state } = up(s);
  const def = state.programmes.pg;
  assert.equal(def.duration.n, 12);
  for (const t of def.tracks) {
    const oid = t.slots[0].oid;
    assert.deepEqual(t.stages.filter(st => st.kind === 'recovery').map(st => [st.id, st.close]), [['s4', 'calendar'], ['s8', 'calendar'], ['s12', 'calendar']], t.id);
    assert.ok(t.stages.every(st => st.targets[oid].own === 'inherit' && !st.targets[oid].effort), t.id);
  }
  assert.deepEqual(targets(def, BENCH).map(t => t.deload?.factor ?? null), [null, null, null, 0.9, null, null, null, 0.9, null, null, null, 0.9]);
  // Bench, done at its aim every Monday: it climbs from the ordinary 52.5, the deload week takes the
  // progressed 60 down once (54, on the bar's 1.25 grid 53.75) without moving the track, and week 5 goes on at 60.
  const runId = 'run:pg:2026-11-02:1';
  const s2 = structuredClone(state);
  const bench = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'].map(d => train(s2, runId, d, 'rA')[BENCH][0]);
  assert.deepEqual(bench, [52.5, 55, 57.5, 53.75, 60]);
  assert.deepEqual(view(s2, runId, '2026-11-30').tracks[`t:pg:${BENCH}`].decisions.map(d => [d.stage, d.action]), [['s1', 'advance'], ['s2', 'advance'], ['s3', 'advance'], ['s4', 'advance']]);
});

test('an empty week is inherit, never fixed work', () => {
  const { routines } = starter('strength-4');
  const programme = { id: 'pg', name: 'Mixed', at: 5, days: { 1: ['rA'] }, weeks: [{ t: { '0043': { pct: 70 } } }, {}, { rpe: 8 }] };
  const s = contract0(v1('strength-4', { routines, programme, workouts: [dayA('h1', '2026-10-30', 80)] }));
  const { state } = up(s);
  const def = state.programmes.pg;
  assert.equal(def.needs, undefined);
  assert.equal(validateProgramme(def, { routines: state.routines }).ok, true);
  // After the fixed 70 % week the squat's own steps come back, opening at the ordinary track's 85.
  assert.deepEqual(targets(def, SQUAT).slice(1), [{ own: 'inherit', seed: { load: 85 } }, { own: 'inherit', effort: { mode: 'advisory', rpe: 8 } }]);
  assert.deepEqual(targets(def, BENCH), [{ own: 'inherit' }, { own: 'inherit' }, { own: 'inherit', effort: { mode: 'advisory', rpe: 8 } }]);
  for (const oid of [SQUAT, BENCH]) {
    const rule = compile(state, def, oid, 's2');
    assert.equal(rule.program.phases[0].progression[0].metric, 'load', oid);
    assert.equal(rule.program.phases[0].parameters.load.mode, 'absolute', oid);
  }
  assert.equal(compile(state, def, SQUAT, 's2').program.phases[0].parameters.load.value, 85);
});

test('a routine-specific target wins over the generic one; the generic one expands per occurrence without linking', () => {
  const routines = [{ id: 'rA', name: 'A', ex: [{ id: '0025', sets: 3, reps: 5, weight: 0 }] }, { id: 'rB', name: 'B', ex: [{ id: '0025', sets: 3, reps: 5, weight: 0 }] }];
  const programme = { id: 'pg', name: 'Bench twice', at: 5, days: { 1: ['rA'], 4: ['rB'] }, weeks: [
    { t: { '0025': { pct: 70 }, 'rB:0025': { pct: 80, rpe: 9 } } },
    { rpe: 7, t: { '0025': { pct: 75 }, 'rA:0025': { rpe: 8 } } }
  ] };
  const { state } = up(contract0(v1('strength-4', { routines, programme })));
  const def = state.programmes.pg;
  assert.deepEqual(def.tracks.map(t => [t.id, t.slots]), [['t:pg:rA:o0', [{ rid: 'rA', oid: 'rA:o0' }]], ['t:pg:rB:o0', [{ rid: 'rB', oid: 'rB:o0' }]]]);
  const rA = targets(def, 'rA:o0'), rB = targets(def, 'rB:o0');
  assert.deepEqual([rA[0].phase.parameters.load.percent, rA[0].effort], [70, undefined]);
  assert.deepEqual([rB[0].phase.parameters.load.percent, rB[0].effort], [80, { mode: 'advisory', rpe: 9 }]);
  // The specific entry replaces the generic one whole, as lib/programmes.js programmeSlot reads it.
  assert.deepEqual(rA[1], { own: 'inherit', seed: { load: 0 }, effort: { mode: 'advisory', rpe: 8 } });
  assert.deepEqual([rB[1].phase.parameters.load.percent, rB[1].effort], [75, { mode: 'advisory', rpe: 7 }]);
});

test('lb profile and an lb-pinned bar keep percent targets unit-free and capture the reference in its unit', () => {
  const lb = up(contract0(v1('strength-4', { unit: 'lb', run: { startedOn: '2026-11-02' }, oneRepMaxes: { 'orm:0043': manual('0043', 225, 'lb') } }))).state;
  assert.deepEqual(targets(lb.programmes.pg, SQUAT)[0].phase.parameters.load, { mode: 'percent_1rm', percent: 72.5 });
  assert.deepEqual(lb.programmeRuns['run:pg:2026-11-02:1'].tracks[`t:pg:${SQUAT}`].ref, manual('0043', 225, 'lb'));
  const pinned = up(contract0(v1('strength-4', { run: { startedOn: '2026-11-02' }, exUnit: { '0025': { unit: 'lb', _ts: 1 } }, oneRepMaxes: ONE_RMS }))).state;
  assert.deepEqual(targets(pinned.programmes.pg, BENCH)[0].phase.parameters.load, { mode: 'percent_1rm', percent: 72.5 });
  assert.deepEqual(pinned.programmeRuns['run:pg:2026-11-02:1'].tracks[`t:pg:${BENCH}`].ref, manual('0025', 100));
  assert.deepEqual(pinned.exUnit, { '0025': { unit: 'lb', _ts: 1 } });
});

test('no 1RM: no reference, summary says reference-missing', () => {
  // Started on a Wednesday: Monday's appointment was never owed in that first week.
  const { state, summary } = up(contract0(v1('strength-4', { run: { startedOn: '2026-11-04' } })));
  const runId = 'run:pg:2026-11-04:1';
  const run = state.programmeRuns[runId];
  assert.deepEqual([run.startedOn, run.firstWeek, run.legacy], ['2026-11-04', [1, 2], { weekOffset: 0 }]);
  assert.equal(run.tracks[`t:pg:${SQUAT}`].ref, undefined);
  assert.deepEqual(summary.filter(x => x.kind === 'reference-missing').map(x => [x.trackId, x.exerciseId]),
    [['rA:o0', '0043'], ['rA:o1', '0025'], ['rA:o2', '0027'], ['rB:o0', '0085'], ['rC:o1', '0047']].map(([o, e]) => [`t:pg:${o}`, e]));
  assert.ok(!summary.some(x => x.kind === 'reference'));
  const v = view(state, runId, '2026-11-04');
  assert.deepEqual(v.tracks[`t:pg:${SQUAT}`].slots, []);
  const inputs = oid => slotInputs({ view: v, run, assignment: slotFor({ view: v, run, rid: oid.slice(0, 2), oid, date: '2026-11-04' }).assignment, occRule: occOf(state, oid).rule });
  assert.deepEqual(inputs(SQUAT), { blocked: 'reference-missing' });
  assert.equal(inputs(OHP).blocked, undefined);
});

test('bodyweight, assisted and timed lifts never get a percent load', () => {
  const routines = [{ id: 'rA', name: 'A', ex: [{ id: '0043', sets: 3, reps: 5, weight: 60 }, { id: '0001', sets: 3, reps: 12 }, { id: '0009', sets: 3, reps: 8 }, { id: '0464', mode: 'time', sets: 3, sec: 30 }] }];
  const pct = Object.fromEntries(['0043', '0001', '0009', '0464'].map(id => [id, { pct: 70 }]));
  const programme = { id: 'pg', name: 'Mixed', at: 5, days: { 1: ['rA'] }, weeks: [{ t: pct }, { deload: true, t: pct }, { deload: true }] };
  const { state } = up(contract0(v1('strength-4', { routines, programme })));
  const def = state.programmes.pg;
  assert.equal(def.needs, undefined);
  assert.equal(targets(def, 'rA:o0')[0].own, 'set');
  for (const oid of ['rA:o1', 'rA:o2', 'rA:o3']) {
    assert.deepEqual(targets(def, oid), [{ own: 'inherit' }, { own: 'inherit' }, { own: 'inherit' }], oid);
    assert.deepEqual(trackOf(def, oid).stages.map(st => [st.kind, st.close ?? null]), [['work', null], ['recovery', 'calendar'], ['recovery', 'calendar']], oid);
  }
  // The barbell squat: the 70 % deload week as authored, then a plain deload of its own steps.
  assert.equal(targets(def, 'rA:o0')[1].phase.parameters.load.percent, 70);
  assert.deepEqual(targets(def, 'rA:o0')[2], { own: 'inherit', deload: { factor: 0.9 }, seed: { load: 60 } });
});

test('pyramid anchors keep their ratios; 5/3/1 training-max groups are inherit plus repair', () => {
  const s = contract0(v1('strength-4', { oneRepMaxes: ONE_RMS }));
  const rA = s.routines.find(r => r.id === 'rA');
  rA.ex[0].rule = defaultPlanRule('five_three_one', { id: 'rule:rA:o0', exerciseId: '0043', routineId: 'rA', unit: 'kg' });
  rA.ex[1].rule = defaultPlanRule('pyramid', { id: 'rule:rA:o1', exerciseId: '0025', routineId: 'rA', unit: 'kg' });
  const { state, summary } = up(s);
  const def = state.programmes.pg;
  const bench = targets(def, BENCH)[0];
  assert.deepEqual(bench.phase.groups.map(g => g.load), [70, 85, 100].map(percent => ({ basis: 'anchor', percent })));
  assert.deepEqual(bench.phase.parameters.load, { mode: 'percent_1rm', percent: 72.5 });
  assert.deepEqual(loads(gen(compile(state, def, BENCH, 's1'), { oneRm: { value: 100, unit: 'kg' } })), [50, 62.5, 72.5]);
  // 5/3/1 groups are percentages of a training max: never guessed from a flat 1RM percentage.
  assert.deepEqual(targets(def, SQUAT).map(t => t.own), ['inherit', 'inherit', 'inherit', 'inherit']);
  assert.deepEqual(targets(def, SQUAT)[3].deload, { factor: 0.9 });
  assert.deepEqual(def.needs, ['repair']);
  assert.deepEqual(summary.filter(x => x.kind === 'repair'), [{ kind: 'repair', programmeId: 'pg', trackId: `t:pg:${SQUAT}`, reason: 'training-max' }]);
  assert.equal(validateProgramme(def, { routines: state.routines }).ok, true);
  // The 5/3/1 occurrence's own rule needs a 1RM: it adopts the current one as its reference.
  assert.deepEqual(occOf(state, SQUAT).ref, manual('0043', 100));
  assert.equal(occOf(state, BENCH).ref, undefined);
  assert.deepEqual(summary.filter(x => x.kind === 'reference'), [{ kind: 'reference', occurrenceId: SQUAT, exerciseId: '0043', ref: manual('0043', 100) }]);
});

test('a running programme continues at its calendar week with legacy-labelled advance/advance and stop', () => {
  // Started three Mondays ago; this week only the squat has been done so far.
  const s = contract0(v1('strength-4', { run: { startedOn: '2026-10-19' }, oneRepMaxes: ONE_RMS,
    workouts: [dayA('h1', '2026-10-19'), dayA('h2', '2026-10-26'), dayA('h3', '2026-11-02', 60, 0, 0)] }));
  const { state, summary } = up(s);
  const runId = 'run:pg:2026-10-19:1';
  const run = state.programmeRuns[runId];
  assert.deepEqual(state.programme, { runId, saved: SAVED });
  assert.deepEqual({ ...run, def: undefined, tracks: undefined }, {
    id: runId, programmeId: 'pg', def: undefined, startedOn: '2026-11-02', weekStart: 1, tz: 'UTC', at: '2026-11-02', end: 'stop', cycle: 1, bump: 0,
    firstWeek: [0, 1, 2], tracks: undefined, legacy: { weekOffset: 2 }
  });
  assert.deepEqual(run.def, state.programmes.pg);
  for (const t of Object.values(run.tracks)) {
    assert.deepEqual(t.policy, { onFailure: 'advance', onSkipped: 'advance' });
    assert.equal(t.ack, 'legacy');
    assert.equal(t.refs, 'ask');
  }
  assert.deepEqual(summary.filter(x => x.kind === 'legacy-choices'), [{ kind: 'legacy-choices', runId, policy: { onFailure: 'advance', onSkipped: 'advance' }, end: 'stop' }]);
  const v = view(state, runId, '2026-11-02');
  assert.equal(v.status, 'running');
  assert.deepEqual(v.nominal, { used: 2, of: 4, unit: 'weeks' });
  assert.deepEqual(Object.values(v.tracks).map(t => [t.stage, t.period]), Array(9).fill(['s3', 1]));
  assert.deepEqual(v.tracks[`t:pg:${SQUAT}`].decisions, []);   // no invented history for weeks 1 and 2
  // Next Monday is week 4, the 60 % week, for the squat credited this week and the bench that waited:
  // the bench's ordinary 52.5 never replaces a fixed percentage.
  const s2 = structuredClone(state);
  const next = train(s2, runId, '2026-11-09', 'rA');
  assert.deepEqual([next[SQUAT], next[BENCH]], [[60, 60, 60, 60, 60], [60, 60, 60, 60, 60]]);
  assert.deepEqual(run.tracks[`t:pg:${BENCH}`].seed, { [BENCH]: { load: { mode: 'absolute', value: 52.5, unit: 'kg' } } });
  assert.equal(view(s2, runId, '2026-11-16').status, 'stopped');
});

test('a paused run becomes a pause event; a finished run derives as stopped; cycle 2 with bump 2.5 raises percent stages only', () => {
  const paused = up(contract0(v1('strength-4', { run: { startedOn: '2026-10-19', pausedOn: '2026-10-28' }, oneRepMaxes: ONE_RMS, workouts: [dayA('h1', '2026-11-02')] }))).state;
  const pid = 'run:pg:2026-10-19:1';
  assert.deepEqual(Object.values(paused.programmeEvents), [{ id: `${pid}:pause`, runId: pid, type: 'pause', at: '2026-10-28' }]);
  assert.deepEqual([paused.programmeRuns[pid].startedOn, paused.programmeRuns[pid].legacy], ['2026-10-26', { weekOffset: 1 }]);
  const pv = view(paused, pid, '2026-11-02');
  assert.equal(pv.status, 'paused');
  assert.equal(pv.tracks[`t:pg:${SQUAT}`].stage, 's2');
  // Sessions during a pause had no programme targets: none is credited.
  assert.ok(!Object.values(paused.programmeEvents).some(e => e.type === 'assign'));

  const done = up(contract0(v1('strength-4', { run: { startedOn: '2026-09-07' }, workouts: [dayA('h1', '2026-11-02')] }))).state;
  const did = 'run:pg:2026-09-07:1';
  assert.deepEqual(done.programmeRuns[did].legacy, { weekOffset: 4 });
  const dv = view(done, did, '2026-11-02');
  assert.equal(dv.status, 'stopped');
  assert.deepEqual(dv.nominal, { used: 4, of: 4, unit: 'weeks' });

  const again = up(contract0(v1('strength-4', { run: { startedOn: '2026-11-02', cycle: 2, bump: 2.5 }, oneRepMaxes: ONE_RMS }))).state;
  const rid = 'run:pg:2026-11-02:2';
  const run = again.programmeRuns[rid];
  assert.deepEqual([run.cycle, run.bump], [2, 2.5]);
  assert.deepEqual(targets(run.def, SQUAT).map(t => t.phase.parameters.load.percent), [75, 80, 85, 62.5]);
  assert.deepEqual(targets(again.programmes.pg, SQUAT).map(t => t.phase.parameters.load.percent), [72.5, 77.5, 82.5, 60]);
  // Nothing else moves: the same tracks, the same group ratios, the same kg steps and deloads.
  const percents = def => def.tracks.flatMap(t => t.stages.flatMap(st => Object.values(st.targets).filter(x => x.own === 'set').map(x => x.phase.parameters.load.percent)));
  const strip = def => JSON.parse(JSON.stringify(def, (k, v) => (k === 'percent' && typeof v === 'number' ? 0 : v)));
  assert.deepEqual(percents(run.def), percents(again.programmes.pg).map(p => p + 2.5));
  assert.deepEqual(strip(run.def), strip(again.programmes.pg));
  assert.deepEqual(trackOf(run.def, SQUAT).stages[0].targets[SQUAT].phase.groups, trackOf(again.programmes.pg, SQUAT).stages[0].targets[SQUAT].phase.groups);
});

test('this week s logged sessions are credited once through assign events listed in the summary', () => {
  const routines = [...starter('strength-4').routines, { id: 'rX', name: 'Extra', ex: [{ id: '0025', sets: 3, reps: 5, weight: 40 }] }];
  const s = contract0(v1('strength-4', { routines, run: { startedOn: '2026-10-26' }, oneRepMaxes: ONE_RMS, workouts: [
    dayA('h1', '2026-10-26'), dayA('h2', '2026-11-02'), dayA('h3', '2026-11-03'),
    session('h4', '2026-11-03', 'rX', [lift('0025', 'rX', 40, 3, 5)])
  ] }));
  const { state, summary } = up(s);
  const runId = 'run:pg:2026-10-26:1';
  const credits = summary.filter(x => x.kind === 'credit');
  assert.deepEqual(credits.map(x => [x.exposureId, x.slot, x.trackId]), [SQUAT, BENCH, ROW].map((oid, j) => [`h2:x${j}`, `p1:a0:${oid}`, `t:pg:${oid}`]));
  assert.deepEqual(Object.values(state.programmeEvents).map(e => [e.id, e.type, e.exposureId, e.slot]), credits.map(x => [`${runId}:assign:${x.exposureId}`, 'assign', x.exposureId, x.slot]));
  // Monday's work fills the week's A; Tuesday's second A and the extra routine earn nothing.
  const v = view(state, runId, '2026-11-03');
  const slot = v.tracks[`t:pg:${SQUAT}`].slots.find(x => x.id === `p1:a0:${SQUAT}`);
  assert.deepEqual([slot.exposureId, slot.outcome], ['h2:x0', 'succeeded']);
  assert.ok(!Object.values(v.tracks).some(t => t.slots.some(x => ['h3:x0', 'h4:x0'].includes(x.exposureId))));
  const later = view(state, runId, '2026-11-09').tracks[`t:pg:${SQUAT}`];
  assert.deepEqual(later.decisions.map(d => [d.stage, d.action, d.reasons]), [['s2', 'advance', { failed: [], skipped: [], unknown: [] }]]);
  assert.deepEqual([later.stage, later.period], ['s3', 2]);
});

test('this week is the week the sessions were logged in, whatever the zone; ties go by code point', () => {
  // Monday evening in Los Angeles is Tuesday in UTC; Monday morning in Sydney is still Sunday in UTC.
  const at = (id, d, start, rid = 'rA') => ({ ...dayA(id, d), start: Date.parse(start), end: Date.parse(start) + 3600000, routineIds: [rid], routineId: rid });
  const cases = [['la', '2026-11-03T02:00:00Z', 'America/Los_Angeles'], ['syd', '2026-11-01T20:00:00Z', 'Australia/Sydney']];
  for (const [id, start, tz] of cases) {
    for (const reminder of [undefined, { on: true, tz, time: '18:00' }]) {
      const { state, summary } = up(contract0(v1('strength-4', { run: { startedOn: '2026-10-26' }, oneRepMaxes: ONE_RMS, ...(reminder ? { reminder } : {}),
        workouts: [at(`${id}0`, '2026-10-26', start.replace('11-03', '10-27').replace('11-01', '10-25')), at(id, '2026-11-02', start)] })));
      const runId = 'run:pg:2026-10-26:1';
      assert.equal(state.programmeRuns[runId].tz, reminder ? tz : 'UTC');
      assert.deepEqual(summary.filter(x => x.kind === 'credit').map(x => [x.exposureId, x.slot]), [SQUAT, BENCH, ROW].map((oid, j) => [`${id}:x${j}`, `p1:a0:${oid}`]), `${id} ${reminder ? tz : 'UTC'}`);
      const slot = view(state, runId, '2026-11-03').tracks[`t:pg:${SQUAT}`].slots[0];
      assert.deepEqual([slot.exposureId, slot.outcome], [`${id}:x0`, 'succeeded']);
    }
  }
  // Two sessions finished at the same instant: the lower exposure id by code point ('B' before 'a'), on every runtime.
  const { summary } = up(contract0(v1('strength-4', { run: { startedOn: '2026-10-26' }, oneRepMaxes: ONE_RMS, workouts: [dayA('a1', '2026-11-02'), dayA('B1', '2026-11-02')] })));
  assert.deepEqual(summary.filter(x => x.kind === 'credit').map(x => x.exposureId), ['B1:x0', 'B1:x1', 'B1:x2']);
});

test('an active legacy workout and every prescription keep their bytes and hashes', () => {
  const active = { id: 'a1', d: '2026-11-04', start: at('2026-11-04'), routineIds: ['rB'], routineId: 'rB', cur: 0,
    entries: [{ id: '0085', rid: 'rB', target: { mode: 'reps', sets: 5, reps: 5, weight: 70 }, planned: { sets: 5, reps: 5 }, sets: [{ r: 5, w: 70, done: true }, { r: 5, w: 70, done: false }] }] };
  const input = v1('strength-4', { run: { startedOn: '2026-10-26' }, oneRepMaxes: ONE_RMS, active, workouts: [dayA('h1', '2026-10-26'), dayA('h2', '2026-11-02')] });
  const { programmes, programme, ...plain } = input;
  const withRun = migrateProfileV1ToV2(structuredClone(input), LIB_BY_ID);
  const without = migrateProfileV1ToV2(structuredClone(plain), LIB_BY_ID);
  assert.deepEqual(withRun.activeSession, without.activeSession);
  assert.equal(JSON.stringify(withRun.profile.prescriptions), JSON.stringify(without.profile.prescriptions));
  assert.equal(JSON.stringify(withRun.profile.workouts), JSON.stringify(without.profile.workouts));
  for (const [id, p] of Object.entries(withRun.profile.prescriptions)) { const { contentHash: hash, ...body } = p; assert.equal(hash, contentHash(body), id); }
  assert.ok(validateCanonicalActive(withRun.profile, withRun.activeSession).ok);
  // The open session is not credited: it has no slot until the app gives it one.
  const activeId = withRun.activeSession.exposures[0].exposureId;
  assert.ok(!Object.values(withRun.profile.programmeEvents).some(e => e.exposureId === activeId));
  // The same holds for a v2 profile upgraded on its own.
  const before = contract0(input);
  const after = up(before).state;
  assert.equal(canonicalJSON(after.prescriptions), canonicalJSON(before.prescriptions));
  assert.equal(canonicalJSON(after.workouts), canonicalJSON(before.workouts));
  assert.equal(canonicalJSON(after.progression), canonicalJSON(before.progression));
  assert.equal(canonicalJSON(after.oneRepMaxes), canonicalJSON(before.oneRepMaxes));
});

test('a loop programme is marked needs binding and its run keeps calendar weeks', () => {
  const s0 = starter('strength-4');
  const { days, ...rest } = s0.programme;
  const programme = { ...rest, sequence: ['rA', 'rest', 'rB', 'rest', 'rC', 'rest', 'rest'] };
  const { state, summary } = up(contract0(v1('strength-4', { programme, run: { startedOn: '2026-10-19' }, oneRepMaxes: ONE_RMS, workouts: [dayA('h1', '2026-11-02')] })));
  const def = state.programmes.pg;
  assert.deepEqual(def.schedule, { mode: 'weeks', appts: [{ rid: 'rA' }, { rid: 'rB' }, { rid: 'rC' }] });
  assert.deepEqual(def.needs, ['binding']);
  assert.deepEqual(summary.filter(x => x.kind === 'binding'), [{ kind: 'binding', programmeId: 'pg' }]);
  const runId = 'run:pg:2026-10-19:1';
  assert.deepEqual(state.programmeRuns[runId].legacy, { weekOffset: 2 });
  const v = view(state, runId, '2026-11-04');
  assert.deepEqual([v.period.index, v.tracks[`t:pg:${SQUAT}`].stage], [1, 's3']);
  assert.equal(view(state, runId, '2026-11-09').tracks[`t:pg:${SQUAT}`].stage, 's4');
});

test('a programme over 50 tracks keeps every week and target in its source, pending repair', () => {
  const ids = ['0043', '0025', '0027', '0085', '0047', '0426', '2330', '1323', '0739', '0031'];
  const routines = ['rA', 'rB', 'rC', 'rD', 'rE', 'rF'].map(id => ({ id, name: id, ex: ids.map(ex => ({ id: ex, sets: 3, reps: 5, weight: 40 })) }));
  const week = pct => ({ rpe: 8, t: { ...Object.fromEntries(ids.map(ex => [ex, { pct }])), 'rF:0025': { pct: pct + 5, rpe: 9 } } });
  const programme = { id: 'pg', name: 'Big', at: 7, src: 'mine', days: { 1: ['rA'], 2: ['rB'], 3: ['rC'], 4: ['rD'], 5: ['rE'], 6: ['rF'] }, weeks: [week(70), week(75), { ...week(60), deload: true }] };
  const input = contract0(v1('strength-4', { routines, programme, run: { startedOn: '2026-11-02' }, oneRepMaxes: ONE_RMS }));
  const { state, summary } = up(structuredClone(input));
  const def = state.programmes.pg;
  assert.equal(def.tracks.length, 50);
  assert.deepEqual(def.needs, ['repair']);
  assert.deepEqual(summary.find(x => x.reason === 'too-many-tracks'), { kind: 'repair', programmeId: 'pg', reason: 'too-many-tracks', tracks: ids.map((_, j) => `t:pg:rF:o${j}`) });
  // Nothing is lost: the legacy programme rides along verbatim, every week and target in it.
  assert.deepEqual(def.src, programme);
  assert.deepEqual(state.programmeRuns['run:pg:2026-11-02:1'].def.src, programme);
  assert.equal(validateCanonicalProfile(state).ok, true);
  assert.deepEqual(up(structuredClone(input)), up(structuredClone(input)));
  // Its weight in the synced document: the legacy source twice (programme and run), a few kB.
  const extra = syncSize(state) - syncSize({ ...state, programmes: { pg: { ...def, src: 'mine' } }, programmeRuns: { 'run:pg:2026-11-02:1': { ...state.programmeRuns['run:pg:2026-11-02:1'], def: { ...def, src: 'mine' } } } });
  assert.ok(extra > 0 && extra < 8 * 1024, String(extra));
});

test('no reference decision, review or user acknowledgement is invented', () => {
  const { state } = up(contract0(v1('strength-4', { run: { startedOn: '2026-10-26' }, oneRepMaxes: ONE_RMS, workouts: [dayA('h1', '2026-11-02')] })));
  const runId = 'run:pg:2026-10-26:1';
  assert.deepEqual([...new Set(Object.values(state.programmeEvents).map(e => e.type))], ['assign']);
  for (const k of ['refReviews', 'refUpdates', 'programmeEnd']) assert.equal(state[k], undefined, k);
  assert.ok(Object.values(state.programmeRuns[runId].tracks).every(t => t.ack === 'legacy'));
  // A newer 1RM after the upgrade is a proposal to review, never an adopted reference.
  const ref = state.programmeRuns[runId].tracks[`t:pg:${SQUAT}`].ref;
  const newer = { ...state.oneRepMaxes, 'orm:new': { ...manual('0043', 110), id: 'orm:new', capturedAt: '2026-11-03T00:00:00.000Z' } };
  const proposals = referenceProposals({ contexts: [{ key: `run:${runId}:t:pg:${SQUAT}`, exerciseId: '0043', ref, pref: 'ask', percents: [82.5], rounding: { mode: 'nearest', step: 1.25 } }], oneRepMaxes: newer, reviews: state.refReviews ?? {} });
  assert.deepEqual(proposals.map(p => [p.from.value, p.to.value, p.samples]), [[100, 110, [{ percent: 82.5, from: 82.5, to: 91.25 }]]]);
  assert.equal(view({ ...state, oneRepMaxes: newer }, runId, '2026-11-03').tracks[`t:pg:${SQUAT}`].ref.value, 100);
});

test('upgrade is deterministic and idempotent; pack then unpack is lossless; size stays under the cap', () => {
  const input = contract0(v1('strength-4', { run: { startedOn: '2026-10-26', pausedOn: '2026-11-05' }, oneRepMaxes: ONE_RMS, workouts: [dayA('h1', '2026-10-26'), dayA('h2', '2026-11-02')] }));
  const copy = structuredClone(input);
  const a = up(structuredClone(input)), b = up(structuredClone(input));
  assert.deepEqual(a, b);
  assert.deepEqual(input, copy);                        // the input is never written to
  assert.equal(a.state.engineContractRevision, 1);
  const again = up(a.state);
  assert.equal(again.state, a.state);                   // a contract-1 profile comes back as it is
  assert.deepEqual(again.summary, []);
  assert.deepEqual(unpackProfile(JSON.parse(JSON.stringify(packProfile(a.state)))), a.state);
  assert.equal(packProfile(a.state).packed, 1);
  assert.ok(syncSize(a.state) < MAX_SYNC_BODY);
  // A profile without programmes only gains the marker.
  const bare = contract0(v1('strength-4'));
  delete bare.programmes;
  assert.deepEqual(up(bare).state, { ...bare, engineContractRevision: 1 });
});

test('an output that fails validateCanonicalProfile throws and returns nothing', () => {
  const input = contract0(v1('strength-4', { run: { startedOn: '2026-11-02' }, workouts: [dayA('h1', '2026-10-30')] }));
  const [id, p] = Object.entries(input.prescriptions)[0];
  input.prescriptions[id] = { ...p, rows: [{ ...p.rows[0], reps: { min: 9, max: 9 } }, ...p.rows.slice(1)] };   // its content hash no longer matches
  const copy = structuredClone(input);
  let out;
  assert.throws(() => { out = up(input); }, /invalid-upgrade/);
  assert.equal(out, undefined);
  assert.deepEqual(input, copy);
});

test('validation refuses the event, run and assignment shapes a replay cannot read', () => {
  const { state } = up(contract0(v1('strength-4', { run: { startedOn: '2026-10-26' }, oneRepMaxes: ONE_RMS, workouts: [dayA('h1', '2026-11-02')] })));
  const runId = 'run:pg:2026-10-26:1';
  assert.equal(validateCanonicalProfile(state).ok, true);
  const event = (e) => ({ ...state, programmeEvents: { ...state.programmeEvents, bad: { id: 'bad', runId, at: '2026-11-03', ...e } } });
  for (const bad of [{ type: 'pause', at: undefined }, { type: 'skip' }, { type: 'amend' }, { type: 'bypass', period: 1, appts: 1 }, { type: 'conflict', trackId: 't', keep: 'recorded' },
    { type: 'resolve', slot: 'p1:a0:rA:o0', as: 'maybe' }, { type: 'reference', trackId: 't', ref: { value: 1 }, from: null }, { type: 'nap' }, { type: 'amend', def: { id: 'pg', rev: 1 } }]) {
    assert.equal(validateCanonicalProfile(event(bad)).ok, false, JSON.stringify(bad));
  }
  assert.equal(validateCanonicalProfile(event({ type: 'skip', slot: 'p1:a0:rA:o0' })).ok, true);
  assert.equal(validateCanonicalProfile(event({ type: 'conflict', trackId: 't', exposureId: 'x', keep: 'recorded' })).ok, true);
  const tooLong = structuredClone(state);
  tooLong.programmeRuns[runId].def.duration.n = 17;
  assert.equal(validateCanonicalProfile(tooLong).ok, false);
  const tz = structuredClone(state);
  tz.programmeRuns[runId].tz = 'Mars/Olympus';
  assert.equal(validateCanonicalProfile(tz).ok, false);
  const day = structuredClone(state);
  day.programmeRuns[runId].startedOn = '2026-02-30';       // the shape of a date, not a day on the calendar
  assert.equal(validateCanonicalProfile(day).ok, false);
  const twoTracks = structuredClone(state), tracks = twoTracks.programmeRuns[runId].def.tracks;
  tracks.push(structuredClone(tracks[0]));                 // replay would take the first of two tracks with one id
  assert.equal(validateCanonicalProfile(twoTracks).ok, false);
  const twoStages = structuredClone(state), stages = twoStages.programmeRuns[runId].def.tracks[0].stages;
  stages.push(structuredClone(stages[0]));
  assert.equal(validateCanonicalProfile(twoStages).ok, false);
  // Old squat work is never assigned to the bench slot.
  assert.equal(validateCanonicalProfile(event({ type: 'assign', exposureId: 'h1:x0', slot: `p1:a0:${BENCH}` })).ok, false);
  const stamped = structuredClone(state);
  stamped.workouts[0].exposures[0].programme = { runId, rev: 1, trackId: 't', stage: 's1', attempt: 1, role: 'work' };   // no slot
  assert.equal(validateCanonicalProfile(stamped).ok, false);
  const broken = structuredClone(state);
  broken.programmes.pg.tracks[0].slots[0].oid = 'rA:o9';   // a slot on an occurrence the routine does not have
  assert.equal(validateCanonicalProfile(broken).ok, false);
  broken.programmes.pg.needs = ['repair'];                 // archived pending repair: readable, not runnable
  assert.equal(validateCanonicalProfile(broken).ok, true);
});

test('a start date that is not on the calendar is not a running programme', () => {
  const { state } = up(contract0(v1('strength-4', { run: { startedOn: '2026-02-30' } })));
  assert.deepEqual(Object.keys(state.programmeRuns ?? {}), []);
});

test('an occurrence the app made without a stored mode takes its %1RM; a hold or cardio one does not', () => {
  const occ = (oid, exerciseId, opts) => ({ occurrenceId: oid, exerciseId, rule: defaultPlanRule('linear', { id: oid, exerciseId, routineId: 'rA', unit: 'kg', ...opts }) });
  const routines = [{ id: 'rA', name: 'A', ex: [occ('rA:o0', '0025', { sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 } }), { ...occ('rA:o1', '0025', {}), rule: defaultPlanRule('manual', { id: 'rA:o1', exerciseId: '0025', routineId: 'rA', durationSeconds: { min: 30, max: 30 }, reps: { min: 1, max: 1 } }) }, { ...occ('rA:o2', '3666', {}), rule: defaultPlanRule('manual', { id: 'rA:o2', exerciseId: '3666', routineId: 'rA' }) }] }];
  const def = convertLegacyProgramme({ id: 'pg', name: 'X', at: 1, days: { 1: ['rA'] }, weeks: [{ t: { '0025': { pct: 75 }, '3666': { pct: 75 } } }] }, { routines, catalogue: LIB_BY_ID });
  const own = oid => def.tracks.find(t => t.slots[0].oid === oid).stages[0].targets[oid].own;
  assert.deepEqual(['rA:o0', 'rA:o1', 'rA:o2'].map(own), ['set', 'inherit', 'inherit']);
});
