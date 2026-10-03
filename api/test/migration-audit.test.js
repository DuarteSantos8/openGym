// Audit of the v1 → v2 migration (see REPORT.md). Tests marked `todo` assert the CORRECT behaviour
// of a confirmed bug: they currently fail, node:test reports them as "todo" and the suite stays
// green. When a bug is fixed, drop its `todo` flag. The unflagged tests pin behaviour that holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePrescription, resolveProgressionContext, planFingerprint } from '../engine/index.js';
import { migrateProfileV1ToV2, validateCanonicalProfile } from '../migration/profile-migration.js';
import { assertSyncSize } from '../migration/profile-size.js';
import { LIB_BY_ID } from '../coach/core/library.js';

const migrate = state => migrateProfileV1ToV2(JSON.parse(JSON.stringify(state)), LIB_BY_ID);
const BENCH = '0025', SQUAT = '0026', DIP = '0009', PULLUP = '3293', CARDIO = '3220';
const row = (r, w, extra = {}) => ({ r, w, done: true, ...extra });
const wk = (id, d, entries, extra = {}) => ({ id, d, start: Date.parse(`${d}T18:00:00Z`), end: Date.parse(`${d}T19:00:00Z`), routineIds: ['r1'], routineId: 'r1', name: 'R', entries, ...extra });
const entry = (id, target, sets, planned) => ({ id, rid: 'r1', target: { mode: 'reps', ...target }, ...(planned ? { planned } : {}), sets });
const v1 = (ex, workouts, over = {}) => ({ unit: 'kg', restSec: 90, routines: [{ id: 'r1', name: 'R', ex }], workouts, ...over });

// What the app shows for the next session of slot `j` (the same call the session start makes).
function nextPrescription(profile, j = 0) {
  const occ = profile.routines[0].ex[j];
  const ctx = resolveProgressionContext({ trackId: occ.occurrenceId, exerciseId: occ.exerciseId, rule: occ.rule, workouts: profile.workouts, prescriptions: profile.prescriptions, progression: profile.progression, assisted: false });
  return generatePrescription({
    id: 'next', now: '2026-06-01T00:00:00.000Z', trackId: occ.occurrenceId, rule: occ.rule, state: ctx.state, lastPrescription: ctx.lastPrescription,
    lastLog: ctx.baseline && { ...ctx.baseline, id: ctx.baseline.exposureId }, reset: ctx.reset, heldLoad: ctx.heldLoad
  });
}
const loadOf = p => p.parameters.load.resolved?.value;

test('determinism: the same v1 document always migrates to the same bytes', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }], [wk('w1', '2026-01-01', [entry(BENCH, { sets: 3, reps: 5, weight: 60 }, [row(5, 60), row(5, 60), row(5, 60)], { sets: 3, reps: 5, weight: 60 })])]);
  assert.equal(JSON.stringify(migrate(s)), JSON.stringify(migrate(s)));
  assert.ok(validateCanonicalProfile(migrate(s).profile).ok);
});

test('no logged row is lost: every v1 row (warm-up, drops, sides, cardio) has a v2 row', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }, { id: CARDIO, mode: 'cardio', sets: 1, min: 20, speed: 8 }], [wk('w1', '2026-01-01', [
    entry(BENCH, { sets: 3, reps: 5, weight: 60 }, [row(8, 30, { phase: 'warmup' }), row(5, 60, { type: 'dropset', drops: [{ w: 48, r: 6 }] }), row(5, 60), row(5, 60, { done: false })]),
    { id: CARDIO, rid: 'r1', target: { mode: 'cardio', sets: 1, min: 20, speed: 8 }, sets: [{ min: 20, speed: 9.5, done: true }] }])]);
  const [bench, cardio] = migrate(s).profile.workouts[0].exposures;
  assert.equal(bench.performance.sets.length, 4);
  assert.equal(bench.performance.sets[1].segments.length, 1);
  assert.equal(cardio.performance.sets[0].observations.find(o => o.metric === 'speed').value, 9.5);
});

// ---- M1/M2/M8: the rounding grid chosen by the migration changes the loads v1 would have prescribed ----

test('M1: a 1.25 kg step on v1 one-decimal loads (21.3 = 21.25) stays on the 1.25 grid like v1 (22.5)', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 20, inc: 1.25, prog: 'linear' }], [wk('w1', '2026-01-01', [entry(BENCH, { sets: 3, reps: 5, weight: 21.3 }, [row(5, 21.3), row(5, 21.3), row(5, 21.3)], { sets: 3, reps: 5, weight: 20 })])]);
  assert.equal(loadOf(nextPrescription(migrate(s).profile)), 22.5);
});

test('M2: a load off the increment grid (52 kg, +2.5) goes to 54.5 like v1, not 55', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 52, prog: 'linear' }], [wk('w1', '2026-01-01', [entry(BENCH, { sets: 3, reps: 5, weight: 52 }, [row(5, 52), row(5, 52), row(5, 52)], { sets: 3, reps: 5, weight: 52 })])]);
  assert.equal(loadOf(nextPrescription(migrate(s).profile)), 54.5);
});

test('M4: the weight last lifted in a routine-less (legacy) log is held exactly (52.5), not snapped to the plan grid', () => {
  const legacy = wk('w1', '2026-01-01', [{ id: SQUAT, sets: [row(5, 52.5), row(5, 52.5), row(5, 52.5)] }], { routineIds: [], routineId: null });
  const p = nextPrescription(migrate(v1([{ id: SQUAT, sets: 3, reps: 5, weight: 50, prog: 'linear' }], [legacy])).profile);
  assert.equal(loadOf(p), 52.5);
});

// ---- M3: assistance/bodyweight ladder restarts once it reaches zero help ----

test('M3: an assisted exercise that reaches 0 kg of help keeps climbing reps (v1: 14) instead of restarting at the plan', () => {
  const h = [[12, 7.5], [13, 2.5], [13, 0]].map(([r, w], i) => wk(`w${i}`, `2026-01-0${i + 1}`, [entry(DIP, { sets: 1, reps: 13, weight: w }, [row(r, w)], { sets: 1, reps: 13, weight: 7.5 })]));
  const m = migrate(v1([{ id: DIP, sets: 1, reps: 13, weight: 7.5, inc: 5, prog: 'linear' }], h)).profile;
  const occ = m.routines[0].ex[0];
  const p = nextPrescription(m);
  assert.equal(p.prefill.reps, 14, `reset=${p.provenance?.sourceLogId} fingerprint rule=${planFingerprint(occ.rule)} last=${m.prescriptions['w2:p0'].planFingerprint}`);
});

// ---- M6: robustness ----

test('M6: one workout with an unparseable date must not block the whole migration', () => {
  const s = v1([], [{ id: 'w1', d: '2026-1-5', start: 1000, entries: [] }, wk('w2', '2026-01-06', [])]);
  assert.doesNotThrow(() => migrate(s));
});

test('M7: a migrated cardio log is not flagged `incomplete` and keeps its duration/speed summary', () => {
  const s = v1([{ id: CARDIO, mode: 'cardio', sets: 1, min: 20, speed: 8 }], [wk('w1', '2026-01-01', [{ id: CARDIO, rid: 'r1', target: { mode: 'cardio', sets: 1, min: 20, speed: 8 }, sets: [{ min: 20, speed: 9, done: true }] }])]);
  const { actual } = migrate(s).profile.workouts[0].exposures[0];
  assert.notEqual(actual.incomplete, true);
  assert.equal(actual.durationSeconds, 1200);
});

test('P1 (migration): a linked entry with no completed work row is converted but excluded, never a miss', () => {
  const skipped = i => wk(`w${i}`, `2026-01-0${i}`, [entry(BENCH, { sets: 3, reps: 5, weight: 60 },
    [row(8, 30, { phase: 'warmup' }), row(5, 60, { done: false }), row(5, 60, { done: false }), row(5, 60, { done: false })], { sets: 3, reps: 5, weight: 60 })]);
  const { profile } = migrate(v1([{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }], [1, 2, 3].map(skipped)));
  const x = profile.workouts[0].exposures[0];
  assert.ok(x.prescriptionId && x.kind !== 'legacy');          // converted, not legacy
  assert.equal(x.excludedFromProgression, true);
  assert.equal(profile.progression['r1:o0']?.stalls ?? 0, 0);
  assert.equal(loadOf(nextPrescription(profile)), 60);
});

test('M8: an absurd `sets` value cannot make the migration emit more than the sync cap', () => {
  const s = v1([{ id: BENCH, sets: 1e6, reps: 5, weight: 60, prog: 'linear' }], [wk('w1', '2026-01-01', [entry(BENCH, { sets: 1e6, reps: 5, weight: 60 }, [row(5, 60)])])]);
  const { profile } = migrate(s);
  assertSyncSize(profile);
});

test('M2 (lb): the step also divides the increment in pounds (+5 lb on 135 lb stays on 140)', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 135, prog: 'linear' }], [wk('w1', '2026-01-01', [entry(BENCH, { sets: 3, reps: 5, weight: 135 }, [row(5, 135), row(5, 135), row(5, 135)], { sets: 3, reps: 5, weight: 135 })])], { unit: 'lb' });
  assert.equal(loadOf(nextPrescription(migrate(s).profile)), 140);
});

test('M6 (no fallback date): a workout with an empty d and no start still migrates and is audited', () => {
  const { profile } = migrate(v1([], [{ id: 'w1', d: '', entries: [] }, wk('w2', '2026-01-06', [])]));
  assert.equal(profile.workouts.length, 2);
  assert.ok(profile.migrationAudit.unsupported.some(u => u.field === 'date' && u.path === 'workouts[0].d'));
});

test('M13: an invalid root unit ("lbs") migrates as kg and the profile says kg', () => {
  const { profile } = migrate(v1([], [], { unit: 'lbs' }));
  assert.equal(profile.unit, 'kg');
});

test('M10: routineIds [] with a scalar routineId keeps the routine association', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' }], [wk('w1', '2026-01-01', [entry(BENCH, { sets: 3, reps: 5, weight: 60 }, [row(5, 60), row(5, 60), row(5, 60)], { sets: 3, reps: 5, weight: 60 })], { routineIds: [] })]);
  assert.deepEqual(migrate(s).profile.workouts[0].routineIds, ['r1']);
});

// ---- M5: size ----

test('M5: a 1000-session × 6-exercise history (2.5 MB in v1) still fits the 16 MB sync cap after migration', { todo: 'v2 is ~7× the v1 size (17 MB): server answers profile-too-large, the user stays on the gate' }, () => {
  const ids = [BENCH, SQUAT, '0285', '0584', '0027', '0293'];
  const ex = ids.map(id => ({ id, sets: 4, reps: 8, weight: 60, prog: 'linear', warmupSets: 2 }));
  const workouts = Array.from({ length: 1000 }, (_, i) => wk(`w${i}`, new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    ids.map(id => entry(id, { sets: 4, reps: 8, weight: 60 + (i % 40) }, [row(8, 30, { phase: 'warmup' }), row(8, 30, { phase: 'warmup' }), ...[0, 1, 2, 3].map(() => row(8, 60 + (i % 40), { rir: 2 }))], { sets: 4, reps: 8, weight: 60 }))));
  const { profile } = migrate(v1(ex, workouts));
  assertSyncSize(profile);
});
