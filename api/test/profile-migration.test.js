import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrescription } from '../engine/index.js';
import { isLegacyProfile, migrateProfileV1ToV2, migrationStatus, validateCanonicalProfile } from '../migration/profile-migration.js';
import { LIB_BY_ID } from '../coach/core/library.js';

const migrate = state => migrateProfileV1ToV2(state, LIB_BY_ID);

const BENCH = '0025', SITUP = '0001', CARDIO = '3220', DIP = '0009';   // barbell, body weight, cardio, assisted machine
const row = (r, w, extra = {}) => ({ r, w, done: true, ...extra });
const v1 = (over = {}) => ({
  unit: 'kg', restSec: 90, _rev: 7, _ts: 5, week: { 1: 'r1' }, exWeights: {}, bodyweight: [], customEx: [],
  routines: [{ id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear', warmupSets: 3 },
    { id: SITUP, sets: 3, reps: 12, prog: 'linear' }
  ] }],
  workouts: [{
    id: 'w1', d: '2026-01-05', start: Date.UTC(2026, 0, 5, 18), end: Date.UTC(2026, 0, 5, 19),
    routineIds: ['r1'], routineId: 'r1', name: 'Push', bw: 80, note: 'good', prs: [{ id: BENCH, w: 62.5 }],
    entries: [{ id: BENCH, rid: 'r1', target: { sets: 3, reps: 5, weight: 62.5, mode: 'reps' },
      sets: [row(8, 30, { phase: 'warmup' }), row(5, 62.5, { rir: 2 }), row(5, 62.5), row(5, 62.5, { rpe: 9 })] }]
  }],
  ...over
});
const nextFor = (profile, trackId, rule) => {
  const state = profile.progression[trackId];
  const x = profile.workouts.flatMap(w => w.exposures).find(e => e.exposureId === state.lastCompletedLogId);
  return generatePrescription({ id: 'next', now: '2026-01-08T00:00:00.000Z', trackId, rule, state,
    lastPrescription: profile.prescriptions[state.lastPrescriptionId], lastLog: { ...x, id: x.exposureId } });
};

test('engineSchemaVersion alone decides; a future schema is refused', () => {
  for (const v of [undefined, null, '2', 1, 1.5]) assert.equal(migrationStatus({ engineSchemaVersion: v }).required, true, String(v));
  assert.deepEqual(migrationStatus(v1(), 123), { required: true, schemaVersion: 1, revision: 7, summary: { routines: 1, workouts: 1, bytes: 123 } });
  assert.deepEqual(migrationStatus({ engineSchemaVersion: 2, _rev: 3 }), { required: false, schemaVersion: 2, revision: 3, summary: null });
  assert.throws(() => migrationStatus({ engineSchemaVersion: 3 }), /unsupported-schema/);
  assert.throws(() => migrationStatus([]), /profile-not-an-object/);
  assert.throws(() => migrationStatus({ routines: {} }), /invalid-v1-routines/);
  assert.equal(isLegacyProfile({ engineSchemaVersion: 3 }), false);
});

test('v2 comes back by reference; v1 input is never mutated and the output is deterministic', () => {
  const v2 = { engineSchemaVersion: 2, routines: [], workouts: [] };
  assert.equal(migrate(v2).profile, v2);
  const input = v1({ active: { id: 'a1', d: '2026-01-06', start: 1, routineIds: ['r1'], entries: [{ id: BENCH, rid: 'r1', target: { sets: 3, reps: 5, weight: 65 }, sets: [row(5, 65)] }] } });
  const before = JSON.stringify(input);
  const a = migrate(input);
  const b = migrate(JSON.parse(before));
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(migrate(a.profile).profile, a.profile);
  assert.deepEqual(validateCanonicalProfile(a.profile), { ok: true, errors: [] });
});

test('root: canonical dictionaries added, preferences and _rev kept, active split out', () => {
  const { profile } = migrate(v1({ active: { id: 'a1', d: '2026-01-06', start: 1, entries: [] }, theme: 'light' }));
  assert.equal(profile.engineSchemaVersion, 2);
  assert.deepEqual([profile._rev, profile.theme, profile.week], [7, 'light', { 1: 'r1' }]);
  assert.equal('active' in profile, false);
  for (const k of ['prescriptions', 'oneRepMaxes', 'progression']) assert.equal(typeof profile[k], 'object', k);
});

test('routine entries become occurrences with the mapped preset and warm-up recipe', () => {
  const ex = [
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear', warmupSets: 3, sg: 'A', note: 'grip' },
    { id: SITUP, sets: 3, reps: 12, prog: 'linear' },
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'greyskull' },
    { id: BENCH, sets: 3, repsMin: 8, repsMax: 12, weight: 40, prog: 'double' },
    { id: SITUP, sets: 3, sec: 45, mode: 'time', prog: 'time' },
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'off', warmupSets: 0 },
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'wave', warmupSets: 9 },
    { id: CARDIO, sets: 1, mode: 'cardio', min: 25, speed: 9 }
  ];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'All', ex }], workouts: [] }));
  const occ = profile.routines[0].ex;
  assert.deepEqual(occ.map(o => o.rule.preset), ['linear', 'bodyweight_ladder', 'greyskull', 'double', 'duration', 'manual', 'manual', 'manual']);
  assert.deepEqual(occ.map(o => o.occurrenceId), ex.map((_, i) => `r1:o${i}`));
  assert.deepEqual(occ[0].rule.parameters.load, { mode: 'absolute', value: 60, unit: 'kg' });
  assert.deepEqual([occ[0].rule.parameters.sets, occ[0].rule.parameters.reps, occ[0].rule.parameters.restSeconds], [{ min: 3, max: 3 }, { min: 5, max: 5 }, 90]);
  assert.deepEqual([occ[0].rule.target, occ[0].rule.completion], [{ mode: 'none' }, []]);
  assert.deepEqual([occ[0].warmup, occ[0].sg, occ[0].note], [{ mode: 'smart', count: 3 }, 'A', 'grip']);
  assert.deepEqual(occ[1].rule.parameters.load, { mode: 'empty' });
  assert.deepEqual(occ[3].rule.parameters.reps, { min: 8, max: 12 });
  assert.deepEqual(occ[4].rule.parameters.durationSeconds, { min: 45, max: 45 });
  assert.equal(occ[5].warmup, undefined);
  assert.deepEqual(occ[6].warmup, { mode: 'smart', count: 5 });
  assert.deepEqual(occ[7].rule.parameters.durationSeconds, { min: 1500, max: 1500 });
  assert.deepEqual(profile.migrationAudit.unsupported.map(u => [u.occurrenceId, u.field]), [['r1:o6', 'prog'], ['r1:o7', 'speed']]);
  assert.equal(occ.every(o => !('warmupSets' in o) && !('prog' in o) && !('weight' in o)), true);
});

test('recorded loads survive the rule rounding — off-grid and microplate loads included', () => {
  const s = v1({
    routines: [{ id: 'r1', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 61, prog: 'linear', inc: 1.25 }] }],
    workouts: [{ id: 'w1', d: '2026-01-05', start: 1, routineIds: ['r1'], entries: [{ id: BENCH, rid: 'r1', target: { sets: 3, reps: 5, weight: 61.25 }, sets: [row(5, 61.25), row(5, 61.25), row(5, 61.25)] }] }]
  });
  const { profile } = migrate(s);
  const [p] = Object.values(profile.prescriptions);
  const rule = profile.routines[0].ex[0].rule;
  assert.equal(p.rows[0].load.value, 61.25);
  assert.equal(rule.parameters.load.value, 61.25);
  assert.deepEqual(rule.increment, { type: 'absolute', value: 1.25, unit: 'kg' });
  assert.equal(nextFor(profile, 'r1:o0', rule).parameters.load.resolved.value, 62.5);
});

test('an unambiguous entry joins its track and seeds the next engine prescription', () => {
  const { profile } = migrate(v1());
  const [x] = profile.workouts[0].exposures;
  assert.deepEqual([x.trackId, x.occurrenceId, x.excludedFromProgression], ['r1:o0', 'r1:o0', false]);
  assert.ok(profile.prescriptions[x.prescriptionId]);
  assert.equal(x.completedAt, new Date(Date.UTC(2026, 0, 5, 19)).toISOString());
  const state = profile.progression['r1:o0'];
  assert.deepEqual([state.readyToIncrement, state.status, state.lastCompletedLogId], [true, 'active', x.exposureId]);
  const rule = profile.routines[0].ex[0].rule;
  assert.equal(rule.parameters.load.value, 62.5);
  assert.equal(nextFor(profile, 'r1:o0', rule).parameters.load.resolved.value, 65);
});

test('a missed rep keeps the load; no failure streak or deload is invented', () => {
  const s = v1();
  s.workouts[0].entries[0].sets[3] = row(3, 62.5);
  const { profile } = migrate(s);
  const state = profile.progression['r1:o0'];
  assert.deepEqual([state.readyToIncrement, state.status], [false, 'active']);
  assert.equal(nextFor(profile, 'r1:o0', profile.routines[0].ex[0].rule).parameters.load.resolved.value, 62.5);
});

test('ambiguous, targetless, excluded and orphaned entries stay visible as legacy exposures', () => {
  const entry = over => ({ id: BENCH, target: { sets: 3, reps: 5, weight: 60 }, sets: [row(5, 60)], ...over });
  const s = v1({
    routines: [
      { id: 'r1', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }, { id: BENCH, sets: 3, reps: 8, weight: 50, prog: 'linear' }] },
      { id: 'r2', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }] }
    ],
    workouts: [
      { id: 'w1', d: '2026-01-01', start: 1, routineIds: ['r1'], entries: [entry({ rid: 'r1' })] },                     // same exercise twice in r1
      { id: 'w2', d: '2026-01-02', start: 2, routineIds: ['r2'], entries: [entry({ rid: 'r2', target: undefined })] },  // targetless (CSV import)
      { id: 'w3', d: '2026-01-03', start: 3, routineIds: ['r2'], entries: [entry({ rid: 'r2', noProg: true })] },
      { id: 'w4', d: '2026-01-04', start: 4, routineIds: ['gone'], entries: [entry({ rid: 'gone' })] },                 // routine deleted since
      { id: 'w5', d: '2026-01-05', start: 5, routineIds: ['r1', 'r2'], entries: [entry({})] }                           // combined session, no rid
    ]
  });
  const { profile } = migrate(s);
  for (const w of profile.workouts) {
    const [x] = w.exposures;
    assert.deepEqual([x.kind, x.prescriptionId, x.excludedFromProgression], ['legacy', null, true], w.id);
    assert.equal(x.performance.sets.length, 1, w.id);
  }
  assert.deepEqual(profile.progression, {});
  assert.deepEqual(profile.prescriptions, {});
});

test('duplicate routine ids get deterministic, unique occurrence ids', () => {
  const r = { id: 'r1', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }] };
  const { profile } = migrate(v1({ routines: [r, r], workouts: [] }));
  assert.deepEqual(profile.routines.map(x => x.ex[0].occurrenceId), ['r1:o0', 'r1~2:o0']);
  assert.equal(validateCanonicalProfile(profile).ok, true);
});

test('rows keep warm-up role, effort, drops, sides, rest-pause clusters and cardio metrics', () => {
  const s = v1({ workouts: [{ id: 'w1', d: '2026-01-05', start: 1, entries: [
    { id: BENCH, sets: [
      row(8, 30, { warmup: true }),
      row(6, 60, { rir: 2, rpe: 8, type: 'dropset', drops: [{ w: 40, r: 6 }] }),
      { w: 20, r: 10, done: true, sides: { L: { w: 20, r: 10, done: true }, R: { w: 20, r: 9, done: false } } },
      { w: 50, r: 9, done: true, type: 'restpause', clusters: [5, 2, 2] },
      { r: 5, w: 60, done: false }
    ] },
    { id: CARDIO, target: { mode: 'cardio' }, sets: [{ min: 20, speed: 9.5, done: true }] }
  ] }] });
  const [lift, cardio] = migrate(s).profile.workouts[0].exposures;
  const rows = lift.performance.sets;
  assert.deepEqual(rows.map(r => [r.role, r.status]), [['warmup', 'completed'], ['work', 'completed'], ['work', 'completed'], ['work', 'completed'], ['work', 'skipped']]);
  assert.deepEqual([rows[1].rir, rows[1].rpeEntered], [2, 8]);
  assert.deepEqual(rows[1].segments.map(x => x.resistance.value), [40]);
  assert.deepEqual([rows[2].sides.L.status, rows[2].sides.R.status], ['completed', 'skipped']);
  assert.deepEqual(rows[3].clusters, [5, 2, 2]);
  assert.equal(cardio.mode, 'cardio');
  assert.deepEqual(cardio.performance.sets[0].observations, [{ metric: 'duration', unit: 's', value: 1200 }, { metric: 'speed', unit: 'kmh', value: 9.5 }]);
  assert.equal(cardio.performance.sets[0].resistance.kind, 'none');
});

test('workout metadata survives: date, bodyweight, notes, PRs, volume', () => {
  const w = migrate(v1()).profile.workouts[0];
  assert.deepEqual([w.id, w.d, w.bw, w.note, w.status, w.routineIds], ['w1', '2026-01-05', 80, 'good', 'completed', ['r1']]);
  assert.deepEqual(w.prs, [{ id: BENCH, w: 62.5 }]);
  assert.equal(w.vol, 3 * 5 * 62.5);
  assert.equal('entries' in w, false);
});

test('1RM: the best estimate is recorded unless a stronger record exists; assisted machines never', () => {
  const [r] = Object.values(migrate(v1()).profile.oneRepMaxes);
  assert.deepEqual([r.exerciseId, r.value, r.source, r.unit], [BENCH, 72.9, 'estimated', 'kg']);
  const strong = { x: { id: 'x', exerciseId: BENCH, value: 100, unit: 'kg', source: 'manual', capturedAt: '2025-01-01T00:00:00.000Z' } };
  assert.deepEqual(migrate(v1({ oneRepMaxes: strong })).profile.oneRepMaxes, strong);
  const dip = v1({ workouts: [{ id: 'w1', d: '2026-01-05', start: 1, entries: [{ id: DIP, sets: [row(5, 30)] }] }] });
  assert.deepEqual(migrate(dip).profile.oneRepMaxes, {});
});

test('an in-progress v1 workout becomes a local active session with frozen prescriptions', () => {
  const active = {
    id: 'a1', d: '2026-01-08', start: Date.UTC(2026, 0, 8, 18), name: 'Push', routineIds: ['r1'], note: 'n',
    entries: [
      { id: BENCH, rid: 'r1', target: { sets: 3, reps: 5, weight: 65 },
        sets: [row(8, 30, { phase: 'warmup', done: false }), row(5, 65), { r: 5, w: 65, done: false }, { r: 5, w: 65, done: false }, row(3, 65)] },
      { id: CARDIO, sets: [{ min: 10, speed: 8, done: true }] }
    ]
  };
  const { profile, activeSession } = migrate(v1({ active }));
  assert.equal('active' in profile, false);
  assert.deepEqual([activeSession.id, activeSession.name, activeSession.note], ['a1', 'Push', 'n']);
  const [bench, cardio] = activeSession.exposures;
  assert.deepEqual([bench.trackId, bench.excludedFromProgression], ['r1:o0', false]);
  assert.equal(profile.prescriptions[bench.prescriptionId].rows[0].load.value, 65);
  assert.equal(cardio.excludedFromProgression, true);
  assert.ok(profile.prescriptions[cardio.prescriptionId]);
  const rows = activeSession.entries[0].sets;
  assert.deepEqual(rows.map(r => r.setId ?? null), [null, 'r0', 'r1', 'r2', null]);   // the 4th work row is past the 3 prescribed
  assert.equal(rows[1].done, true);
  assert.deepEqual(activeSession.entries.map(e => e.exposureId), activeSession.exposures.map(x => x.exposureId));
});

test('the validator rejects a dangling prescription, legacy entries, a leftover active and warmupSets', () => {
  const bad = JSON.parse(JSON.stringify(migrate(v1()).profile));
  bad.workouts[0].exposures[0].prescriptionId = 'nope';
  bad.workouts[0].entries = [];
  bad.active = {};
  bad.routines[0].ex[0].warmupSets = 2;
  const { ok, errors } = validateCanonicalProfile(bad);
  assert.equal(ok, false);
  for (const m of [/does not resolve/, /legacy entries/, /active/, /warmupSets/]) assert.ok(errors.some(e => m.test(e)), String(m));
});

test('refuses to run without the exercise catalogue', () => {
  assert.throws(() => migrateProfileV1ToV2(v1()), /migration-needs-catalogue/);
});
