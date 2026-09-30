import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrescription, planFingerprint } from '../engine/index.js';
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
  assert.deepEqual(occ.map(o => o.rule.preset), ['linear', 'bodyweight_ladder', 'greyskull', 'double', 'hold_seconds', 'manual', 'manual', 'manual']);
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
  // A cardio interval's speed lives on the rule, and its sheet reads the same numbers off the occurrence.
  assert.equal(occ[7].rule.parameters.speed, 9);
  assert.deepEqual(occ[7].cardio, { sets: 1, min: 25, speed: 9 });
  assert.deepEqual(profile.migrationAudit.unsupported.map(u => [u.occurrenceId, u.field]), [['r1:o6', 'prog']]);
  assert.equal(occ.every(o => !('warmupSets' in o) && !('prog' in o) && !('weight' in o)), true);
});

test('a per-side exercise stays per side; a timed one cannot be (issue #60)', () => {
  const ex = [{ id: BENCH, sets: 3, reps: 10, weight: 20, side: true }, { id: SITUP, sets: 3, sec: 30, mode: 'time', side: true }];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Uni', ex }], workouts: [] }));
  assert.deepEqual(profile.routines[0].ex.map(o => o.side), [true, undefined]);
  assert.equal(profile.migrationAudit.unsupported.some(u => u.field === 'side'), false);
});

test('a drop-set or rest-pause plan is carried onto the occurrence; one the rule cannot run is audited', () => {
  const ex = [
    { id: BENCH, sets: 3, reps: 8, weight: 60, prog: 'linear', intensifier: { type: 'dropset', count: 2, pct: 20 } },
    { id: BENCH, sets: 1, reps: 8, weight: 60, prog: 'linear', intensifier: { type: 'restpause', totalReps: 12, restSec: 200 } },
    { id: SITUP, sets: 3, sec: 45, mode: 'time', prog: 'time', intensifier: { type: 'dropset', count: 1, pct: 20 } }
  ];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Int', ex }], workouts: [] }));
  assert.deepEqual(profile.routines[0].ex.map(o => o.intensifier), [
    { type: 'dropset', count: 2, pct: 20 },
    { type: 'restpause', totalReps: 12, restSec: 120 },
    undefined
  ]);
  assert.deepEqual(profile.migrationAudit.unsupported.map(u => [u.occurrenceId, u.field]), [['r1:o2', 'intensifier']]);
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
});

test('a record holding only its confirmed weight (topW) keeps that load, with no reps and no volume', () => {
  const { profile } = migrate(v1({ routines: [], workouts: [{ id: 'w1', d: '2026-01-05', start: 1, end: 2, entries: [
    { id: BENCH, target: { mode: 'reps' }, topW: 70, sets: [] },
    { id: BENCH, target: { mode: 'reps' }, topW: 90, sets: [row(5, 60)] }
  ] }] }));
  const [only, logged] = profile.workouts[0].exposures;
  assert.deepEqual(only.performance.sets.map(r => [r.status, r.resistance.value, r.observations.length]), [['completed', 70, 0]]);
  assert.deepEqual(logged.performance.sets.map(r => r.resistance.value), [60]);
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
});

test('a bodyweight override is carried where it differs from the catalogue', () => {
  const ex = [{ id: BENCH, sets: 3, reps: 8, bodyweight: true }, { id: SITUP, sets: 3, reps: 12, bodyweight: false }, { id: SITUP, sets: 3, reps: 12, bodyweight: true }, { id: BENCH, sets: 3, reps: 8 }];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Bw', ex }], workouts: [] }));
  assert.deepEqual(profile.routines[0].ex.map(o => o.bodyweight), [true, false, undefined, undefined]);
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
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

test('a v1 plan stamp becomes the log\'s plan fingerprint; an unstamped log records none', () => {
  const stamped = v1();
  stamped.workouts[0].entries[0].planned = { sets: 3, reps: 5, weight: 60 };
  stamped.routines[0].ex[0].reps = 8;   // the routine was edited after that session
  const { profile } = migrate(stamped);
  const logged = profile.prescriptions[profile.workouts[0].exposures[0].prescriptionId];
  assert.equal(logged.planFingerprint, planFingerprint({ parameters: { sets: { min: 3, max: 3 }, reps: { min: 5, max: 5 } } }));
  assert.notEqual(logged.planFingerprint, planFingerprint(profile.routines[0].ex[0].rule));

  const { profile: bare } = migrate(v1());
  assert.equal(bare.prescriptions[bare.workouts[0].exposures[0].prescriptionId].planFingerprint, null);
});

test('an unedited double-progression plan fingerprints like its live rule, even though the v1 stamp only recorded where the climb had gotten to', () => {
  const state = v1({
    routines: [{ id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [
      { id: BENCH, sets: 3, reps: 10, repsMin: 8, repsMax: 12, weight: 60, prog: 'double' }
    ] }],
    workouts: [{
      id: 'w1', d: '2026-01-05', start: Date.UTC(2026, 0, 5, 18), end: Date.UTC(2026, 0, 5, 19),
      routineIds: ['r1'], routineId: 'r1', name: 'Push', bw: 80,
      // plannedOf(cfg) in v1.3.9 stamps `reps` (the climb's current position, 10 of an 8-12
      // range) and `repsMin`; it never carried repsMax, so a naive rebuild reads the range as
      // 8-10 instead of the routine's real 8-12 -- the routine itself was never edited.
      entries: [{ id: BENCH, rid: 'r1', target: { sets: 3, reps: 10, repsMin: 8, weight: 60, mode: 'reps' },
        planned: { sets: 3, reps: 10, repsMin: 8, weight: 60 },
        sets: [row(10, 60, { rir: 2 }), row(10, 60), row(10, 60)] }]
    }]
  });
  const { profile } = migrate(state);
  const rule = profile.routines[0].ex[0].rule;
  const logged = profile.prescriptions[profile.workouts[0].exposures[0].prescriptionId];
  assert.equal(logged.planFingerprint, planFingerprint(rule));
});

test('an unedited plan with no `sets` configured fingerprints like its live rule, not v1\'s stamped sets: 1 default', () => {
  const state = v1({
    routines: [{ id: 'r1', name: 'Push', emoji: 'figureStrength', ex: [
      { id: BENCH, reps: 5, weight: 60, prog: 'linear' }   // no `sets` field, then or now
    ] }],
    workouts: [{
      id: 'w1', d: '2026-01-05', start: Date.UTC(2026, 0, 5, 18), end: Date.UTC(2026, 0, 5, 19),
      routineIds: ['r1'], routineId: 'r1', name: 'Push', bw: 80,
      entries: [{ id: BENCH, rid: 'r1', target: { reps: 5, weight: 60, mode: 'reps' },
        planned: { sets: 1, reps: 5, weight: 60 },   // v1's plannedOf(cfg): Math.max(1, undefined || 1)
        sets: [row(5, 60, { rir: 2 }), row(5, 60), row(5, 60)] }]
    }]
  });
  const { profile } = migrate(state);
  const rule = profile.routines[0].ex[0].rule;
  const logged = profile.prescriptions[profile.workouts[0].exposures[0].prescriptionId];
  assert.equal(logged.planFingerprint, planFingerprint(rule));
});

// ---- v1 fields the conversion must not lose (audit of the v1 data model against the output) ----

test('an exercise with no rule of its own keeps the rule v1 applied: its routine\'s, else linear on reps', () => {
  const ROLL = '0857';   // a wheel roller: no load of its own
  const ex = [
    { id: BENCH, sets: 3, reps: 5, weight: 60 },                        // nothing chosen: v1 read it as linear
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'off' },           // an explicit "no progression" wins
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'greyskull' },     // its own rule beats the routine's
    { id: SITUP, sets: 3, sec: 45, mode: 'time' },                      // no policy applies to a hold by default
    { id: CARDIO, sets: 1, mode: 'cardio', min: 20 }
  ];
  const state = v1({ routines: [{ id: 'r1', name: 'Inherit', ex }, { id: 'r2', name: 'Double', prog: 'double', ex: ex.slice(0, 4) }], workouts: [] });
  const { profile } = migrate(state);
  assert.deepEqual(profile.routines[0].ex.map(o => o.rule.preset), ['linear', 'manual', 'greyskull', 'manual', 'manual']);
  // The routine's default reaches every rep exercise that set none; a hold or cardio row cannot take it.
  assert.deepEqual(profile.routines[1].ex.map(o => o.rule.preset), ['double', 'manual', 'greyskull', 'manual']);
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
  // Nothing the routine's default could not reach is reported as needing review.
  assert.deepEqual(profile.migrationAudit.unsupported, []);

  const roll = migrate(v1({ routines: [{ id: 'r1', name: 'Core', ex: [{ id: ROLL, sets: 3, reps: 8 }, { id: ROLL, sets: 3, reps: 8, weight: 5 }] }], workouts: [] })).profile;
  assert.deepEqual(roll.routines[0].ex.map(o => o.rule.preset), ['bodyweight_ladder', 'linear']);
});

test('a double-progression window keeps both ends: `reps` is its top and `repsMin` its bottom', () => {
  const ex = [
    { id: BENCH, sets: 3, reps: 12, repsMin: 8, weight: 60, prog: 'double' },
    { id: BENCH, sets: 3, reps: 10, weight: 60, prog: 'double' },                       // no bottom: v1 read it as two below the top
    { id: BENCH, sets: 3, reps: 16, repsMin: 10, weight: 20, prog: 'double', side: true },
    { id: BENCH, sets: 3, repsMin: 8, repsMax: 12, weight: 40, prog: 'double' }         // written as a range with no `reps`
  ];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Range', ex }], workouts: [] }));
  assert.deepEqual(profile.routines[0].ex.map(o => o.rule.parameters.reps), [{ min: 8, max: 12 }, { min: 8, max: 10 }, { min: 10, max: 16 }, { min: 8, max: 12 }]);
});

test('a double-progression session that stopped short of the top of its range earns no load step', () => {
  const at = reps => v1({
    routines: [{ id: 'r1', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 12, repsMin: 8, weight: 60, prog: 'double' }] }],
    workouts: [{
      id: 'w1', d: '2026-01-05', start: Date.UTC(2026, 0, 5, 18), end: Date.UTC(2026, 0, 5, 19), routineIds: ['r1'], routineId: 'r1',
      entries: [{ id: BENCH, rid: 'r1', planned: { sets: 3, reps: 12, repsMin: 8 }, target: { sets: 3, reps: 10, repsMin: 8, weight: 60, mode: 'reps' },
        sets: [row(reps, 60), row(reps, 60), row(reps, 60)] }]
    }]
  });
  const held = migrate(at(10)).profile;    // v1: hold, aim for 11
  assert.equal(held.progression['r1:o0'].readyToIncrement, false);
  assert.deepEqual(held.routines[0].ex[0].rule.parameters.reps, { min: 8, max: 12 });
  assert.deepEqual(held.prescriptions[held.workouts[0].exposures[0].prescriptionId].parameters.reps, { min: 10, max: 12 });
  assert.equal(migrate(at(12)).profile.progression['r1:o0'].readyToIncrement, true);   // v1: top in every set -> up
});

test('a bodyweight climb keeps its ceiling: reps up to it, then sets up to v1\'s six', () => {
  const ex = [{ id: SITUP, sets: 3, reps: 10, repsMax: 20, prog: 'linear' }, { id: SITUP, sets: 3, reps: 10, prog: 'linear' }];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Bw', ex }], workouts: [] }));
  const [capped, open] = profile.routines[0].ex.map(o => o.rule.parameters);
  assert.deepEqual([capped.reps, capped.sets], [{ min: 10, max: 20 }, { min: 3, max: 6 }]);
  assert.deepEqual([open.reps, open.sets], [{ min: 10, max: 10 }, { min: 3, max: 3 }]);
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
});

test('an exercise\'s own warm-up rest is carried onto its occurrence', () => {
  const ex = [{ id: BENCH, sets: 3, reps: 5, weight: 60, warmupSets: 2, warmupRestSec: 31 }, { id: BENCH, sets: 3, reps: 5, weight: 60 }];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Rest', ex }], workouts: [] }));
  assert.deepEqual(profile.routines[0].ex.map(o => o.warmupRestSec), [31, undefined]);
});

// ---- the deload, cardio speed, timed progression and default increments (second audit pass) ----

const SQUAT = '0043', ROW = '0027';   // lower body and back: v1's bigger default step

test('a v1 exercise keeps its own deload factor and v1\'s stalls-before-deload for its policy', () => {
  const ex = [
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear', deloadFactor: 0.8 },
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' },
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'greyskull', deloadFactor: 0.7 },   // v1's Greyskull never read it
    { id: BENCH, sets: 3, reps: 8, repsMin: 6, weight: 60, prog: 'double', deloadFactor: 0.85 },
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear', deloadFactor: 0.1 },      // out of v1's 0.5-0.95: the default
    { id: SITUP, sets: 3, sec: 45, mode: 'time', prog: 'time' },
    { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'off', deloadFactor: 0.8 }          // nothing to back off
  ];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Deload', ex }], workouts: [] }));
  assert.deepEqual(profile.routines[0].ex.map(o => o.rule.deload), [
    { after: 3, factor: 0.8 }, { after: 3, factor: 0.9 }, { after: 1, factor: 0.9 }, { after: 3, factor: 0.85 }, { after: 3, factor: 0.9 }, { after: 3, factor: 0.9 }, undefined
  ]);
  assert.deepEqual(profile.migrationAudit.unsupported.map(u => [u.occurrenceId, u.field, u.value]), [['r1:o6', 'deloadFactor', 0.8]]);
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
});

test('a load step nobody chose is the body part\'s v1 default, not always 2.5', () => {
  const ex = [{ id: SQUAT, sets: 3, reps: 5, weight: 100 }, { id: ROW, sets: 3, reps: 5, weight: 60 }, { id: BENCH, sets: 3, reps: 5, weight: 60 }, { id: SQUAT, sets: 3, reps: 5, weight: 100, inc: 2.5 }];
  const kg = migrate(v1({ routines: [{ id: 'r1', name: 'Steps', ex }], workouts: [] })).profile.routines[0].ex.map(o => o.rule.increment.value);
  assert.deepEqual(kg, [5, 5, 2.5, 2.5]);
  const lb = migrate(v1({ unit: 'lb', routines: [{ id: 'r1', name: 'Steps', ex: ex.map(e => ({ ...e, weight: e.weight * 2, ...(e.inc ? { inc: 5 } : {}) })) }], workouts: [] })).profile.routines[0].ex.map(o => o.rule.increment.value);
  assert.deepEqual(lb, [10, 10, 5, 5]);
});

test('v1\'s "Add time" is a hold that grows by its own seconds step', () => {
  const ex = [{ id: SITUP, sets: 3, sec: 45, mode: 'time', prog: 'time' }, { id: SITUP, sets: 3, sec: 45, mode: 'time', prog: 'time', inc: 10 }, { id: SITUP, sets: 3, sec: 45, mode: 'time' }];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Holds', ex }], workouts: [] }));
  const [auto, own, off] = profile.routines[0].ex.map(o => o.rule);
  assert.deepEqual([auto.preset, auto.increment, own.increment, off.preset], ['hold_seconds', { type: 'seconds', value: 5 }, { type: 'seconds', value: 10 }, 'manual']);
  assert.deepEqual(auto.parameters.durationSeconds, { min: 45, max: 45 });
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
});

test('a timed hold resumes where v1\'s target left it: one step up after a clean session', () => {
  const state = v1({
    routines: [{ id: 'r1', name: 'Holds', ex: [{ id: SITUP, sets: 2, sec: 45, mode: 'time', prog: 'time', inc: 5 }] }],
    workouts: [{ id: 'w1', d: '2026-01-05', start: Date.UTC(2026, 0, 5, 18), end: Date.UTC(2026, 0, 5, 19), routineIds: ['r1'], routineId: 'r1',
      entries: [{ id: SITUP, rid: 'r1', target: { mode: 'time', sets: 2, sec: 60 }, sets: [{ sec: 60, w: 0, done: true }, { sec: 62, w: 0, done: true }] }] }]
  });
  const { profile } = migrate(state);
  assert.deepEqual(profile.routines[0].ex[0].rule.parameters.durationSeconds, { min: 60, max: 60 });
  assert.equal(profile.progression['r1:o0'].position, 1);
  const x = profile.workouts[0].exposures[0];
  const next = generatePrescription({ id: 'n', now: '2026-01-08T00:00:00.000Z', trackId: 'r1:o0', rule: profile.routines[0].ex[0].rule, state: profile.progression['r1:o0'],
    lastPrescription: profile.prescriptions[x.prescriptionId], lastLog: { ...x, id: x.exposureId } });
  assert.deepEqual(next.parameters.durationSeconds, { min: 65, max: 65 });
});

test('a cardio interval keeps its speed and minutes on the rule, and opens a session as cardio', () => {
  const state = v1({
    routines: [{ id: 'r1', name: 'Cardio', ex: [{ id: CARDIO, sets: 2, min: 25, speed: 9.5 }] }, { id: 'r2', name: 'Short', ex: [{ id: CARDIO, sets: 1, min: 10 }] }],
    workouts: [{ id: 'w1', d: '2026-01-05', start: 1, end: 2, routineIds: ['r1'], routineId: 'r1',
      entries: [{ id: CARDIO, rid: 'r1', target: { sets: 2, min: 30, speed: 10 }, sets: [{ min: 30, speed: 10, done: true }, { min: 30, speed: 10.5, done: true }] }] }]
  });
  const { profile } = migrate(state);
  const [a] = profile.routines[0].ex;
  const [b] = profile.routines[1].ex;
  // The plan owns an interval's minutes and speed, as it owns reps and sets; the logged day keeps its own.
  assert.deepEqual([a.rule.parameters.durationSeconds, a.rule.parameters.speed], [{ min: 1500, max: 1500 }, 9.5]);
  assert.deepEqual(a.cardio, { sets: 2, min: 25, speed: 9.5 });
  assert.equal(b.rule.parameters.speed, 8);   // a row with no speed opened at 8 in v1
  const day = profile.prescriptions[profile.workouts[0].exposures[0].prescriptionId];
  assert.deepEqual([day.parameters.durationSeconds, day.parameters.speed], [{ min: 1800, max: 1800 }, 10]);
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
});

test('the run of misses v1 recomputed from history is counted, so the deload comes when v1\'s would have', () => {
  const at = (day, reps) => ({
    id: 'w' + day, d: `2026-01-0${day}`, start: Date.UTC(2026, 0, day, 18), end: Date.UTC(2026, 0, day, 19), routineIds: ['r1'], routineId: 'r1',
    entries: [{ id: BENCH, rid: 'r1', planned: { sets: 3, reps: 5 }, target: { sets: 3, reps: 5, weight: 100, mode: 'reps' }, sets: [row(reps, 100), row(reps, 100), row(reps, 100)] }]
  });
  const plan = { id: 'r1', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 100, prog: 'linear' }] };
  const stalled = migrate(v1({ routines: [plan], workouts: [at(1, 5), at(2, 4), at(3, 3), at(4, 4)] })).profile;
  assert.deepEqual(['stalls', 'stallLoad', 'readyToDeload'].map(k => stalled.progression['r1:o0'][k]), [3, 100, true]);
  const x = stalled.workouts.at(-1).exposures[0];
  const next = generatePrescription({ id: 'n', now: '2026-01-08T00:00:00.000Z', trackId: 'r1:o0', rule: stalled.routines[0].ex[0].rule, state: stalled.progression['r1:o0'],
    lastPrescription: stalled.prescriptions[x.prescriptionId], lastLog: { ...x, id: x.exposureId } });
  assert.equal(next.parameters.load.resolved.value, 90);
  // A clean session in between, or an edit of the plan, ends the run; two misses are not yet three.
  assert.equal(migrate(v1({ routines: [plan], workouts: [at(1, 4), at(2, 5), at(3, 4)] })).profile.progression['r1:o0'].stalls, 1);
  assert.equal(migrate(v1({ routines: [plan], workouts: [at(1, 4), at(2, 4)] })).profile.progression['r1:o0'].readyToDeload, false);
  const edited = at(2, 4);
  edited.entries[0].planned = { sets: 4, reps: 5 };
  edited.entries[0].target.sets = 4;
  assert.equal(migrate(v1({ routines: [plan], workouts: [at(1, 4), edited, at(3, 4)] })).profile.progression['r1:o0'].stalls, 1);
});

test('what v1 prescribed for an entry no prescription could hold stays on it, verbatim', () => {
  const state = v1({
    routines: [],
    workouts: [{ id: 'w1', d: '2026-01-05', start: 1, end: 2, routineId: 'gone', entries: [
      { id: BENCH, rid: 'gone', target: { sets: 3, reps: 5, weight: 62.5, mode: 'reps', inc: 2.5, warmupRestSec: 31 }, planned: { sets: 3, reps: 5, weight: 60 }, sets: [row(5, 62.5)] },
      { id: BENCH, target: { mode: 'reps' }, noProg: true, sets: [row(5, 40)] },
      { id: SITUP, sets: [row(10, 0)] }
    ] }]
  });
  const [gone, deload, bare] = migrate(state).profile.workouts[0].exposures;
  assert.deepEqual(gone.legacyTarget, { sets: 3, reps: 5, weight: 62.5, mode: 'reps', inc: 2.5, warmupRestSec: 31 });
  assert.deepEqual(gone.legacyPlanned, { sets: 3, reps: 5, weight: 60 });
  assert.deepEqual(deload.legacyTarget, { mode: 'reps' });
  assert.equal('legacyTarget' in bare || 'legacyPlanned' in bare, false);   // nothing was recorded, nothing is invented
});

// ---- assistance machines: the load is the help given, so progression runs the other way (issue #232) ----

const assistedHistory = (loads, plan = { sets: 3, reps: 8, weight: 40, prog: 'linear' }, id = DIP) => v1({
  routines: [{ id: 'r1', name: 'Pull', ex: [{ id, ...plan }] }],
  workouts: loads.map(([w, reps], k) => ({
    id: 'w' + k, d: `2026-01-0${k + 1}`, start: Date.UTC(2026, 0, k + 1, 18), end: Date.UTC(2026, 0, k + 1, 19), routineIds: ['r1'], routineId: 'r1',
    entries: [{ id, rid: 'r1', target: { sets: 3, reps: 8, weight: w, mode: 'reps' }, sets: [row(reps, w), row(reps, w), row(reps, w)] }]
  }))
});
const nextAfter = (profile, assisted = true) => {
  const x = profile.workouts.at(-1).exposures[0];
  return generatePrescription({ id: 'n', now: '2026-02-01T00:00:00.000Z', trackId: 'r1:o0', rule: profile.routines[0].ex[0].rule, state: profile.progression['r1:o0'],
    lastPrescription: profile.prescriptions[x.prescriptionId], lastLog: { ...x, id: x.exposureId }, assisted });
};

test('a clean session on an assistance machine earns less help on the first v2 session', () => {
  const { profile } = migrate(assistedHistory([[40, 8]]));
  const p = profile.prescriptions[profile.workouts[0].exposures[0].prescriptionId];
  assert.equal(p.assisted, true);
  assert.equal(profile.progression['r1:o0'].readyToIncrement, true);
  assert.equal(nextAfter(profile).parameters.load.resolved.value, 37.5);
  assert.equal(nextAfter(profile, false).parameters.load.resolved.value, 42.5);   // the same history on a normal lift adds
});

test('a stalled assistance machine goes back to more help, from the most help it needed', () => {
  const { profile } = migrate(assistedHistory([[40, 6], [40, 5], [40, 6]]));
  assert.deepEqual(['stalls', 'readyToDeload'].map(k => profile.progression['r1:o0'][k]), [3, true]);
  assert.equal(nextAfter(profile).parameters.load.resolved.value, 42.5);
});

test('the help logged on a session is judged by its weakest set: the one with the most', () => {
  const state = assistedHistory([[40, 8]]);
  state.workouts[0].entries[0].sets = [row(8, 40), row(8, 35), row(8, 45)];
  const { profile } = migrate(state);
  const x = profile.workouts[0].exposures[0];
  assert.equal(x.actual.load.value, 45);
  assert.equal(profile.progression['r1:o0'].readyToIncrement, false);   // 45 is more help than the 40 prescribed
});

test('a routine entry can say a machine is, or is not, assisted, whatever the catalogue says', () => {
  const ex = [{ id: BENCH, sets: 3, reps: 8, weight: 20, prog: 'linear', assisted: true }, { id: DIP, sets: 3, reps: 8, weight: 20, prog: 'linear', assisted: false }, { id: DIP, sets: 3, reps: 8, weight: 20, prog: 'linear' }];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Overrides', ex }], workouts: [] }));
  assert.deepEqual(profile.routines[0].ex.map(o => o.assisted), [true, false, undefined]);
  // Nothing to freeze without a session, but the exercise that is a plain lift stays one.
  const custom = migrate(assistedHistory([[20, 8]], { sets: 3, reps: 8, weight: 20, prog: 'linear', assisted: false })).profile;
  assert.equal(custom.prescriptions[custom.workouts[0].exposures[0].prescriptionId].assisted, undefined);
  const forced = migrate(assistedHistory([[20, 8]], { sets: 3, reps: 8, weight: 20, prog: 'linear', assisted: true }, BENCH)).profile;
  assert.equal(forced.prescriptions[forced.workouts[0].exposures[0].prescriptionId].assisted, true);
});

test('an assistance machine with no help on it climbs reps, as v1 did once the stack was out of the way', () => {
  const ex = [{ id: DIP, sets: 3, reps: 8, prog: 'linear' }, { id: DIP, sets: 3, reps: 8, weight: 30, prog: 'linear' }];
  const { profile } = migrate(v1({ routines: [{ id: 'r1', name: 'Pull', ex }], workouts: [] }));
  assert.deepEqual(profile.routines[0].ex.map(o => o.rule.preset), ['bodyweight_ladder', 'linear']);
});

test('an in-progress session on an assistance machine freezes as one', () => {
  const active = { id: 'a1', d: '2026-01-08', start: Date.UTC(2026, 0, 8, 18), routineIds: ['r1'], entries: [{ id: DIP, rid: 'r1', target: { sets: 3, reps: 8, weight: 35 }, sets: [row(8, 35)] }] };
  const { profile, activeSession } = migrate({ ...assistedHistory([[40, 8]]), active });
  assert.equal(profile.prescriptions[activeSession.exposures[0].prescriptionId].assisted, true);
});
