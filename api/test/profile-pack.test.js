// The compact storage/wire form of the v2 profile (REPORT.md M5): lossless, and small enough for the sync cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORT, packProfile, unpackProfile } from '../migration/profile-pack.js';
import { assertSyncSize, syncSize } from '../migration/profile-size.js';
import { migrateProfileV1ToV2, validateCanonicalProfile } from '../migration/profile-migration.js';
import { LIB_BY_ID } from '../coach/core/library.js';

const migrate = state => migrateProfileV1ToV2(JSON.parse(JSON.stringify(state)), LIB_BY_ID).profile;
const BENCH = '0025', CARDIO = '3220';
const row = (r, w, extra = {}) => ({ r, w, done: true, ...extra });
const wk = (id, d, entries, extra = {}) => ({ id, d, start: Date.parse(`${d}T18:00:00Z`), end: Date.parse(`${d}T19:00:00Z`), routineIds: ['r1'], routineId: 'r1', name: 'R', entries, ...extra });
const entry = (id, target, sets, planned, extra = {}) => ({ id, rid: 'r1', target: { mode: 'reps', ...target }, ...(planned ? { planned } : {}), sets, ...extra });
const v1 = (ex, workouts, over = {}) => ({ unit: 'kg', restSec: 90, routines: [{ id: 'r1', name: 'R', ex }], workouts, ...over });

let big;
const bigProfile = () => {
  if (!big) {
    const ids = [BENCH, '0026', '0285', '0584', '0027', '0293'];
    const ex = ids.map(id => ({ id, sets: 4, reps: 8, weight: 60, prog: 'linear', warmupSets: 2 }));
    const workouts = Array.from({ length: 1000 }, (_, i) => wk(`w${i}`, new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10),
      ids.map(id => entry(id, { sets: 4, reps: 8, weight: 60 + (i % 40) }, [row(8, 30, { phase: 'warmup' }), row(8, 30, { phase: 'warmup' }), ...[0, 1, 2, 3].map(() => row(8, 60 + (i % 40), { rir: 2 }))], { sets: 4, reps: 8, weight: 60 }))));
    big = migrate(v1(ex, workouts));
  }
  return structuredClone(big);
};

test('round trip: unpack(pack(x)) is the same profile, and packing is idempotent', () => {
  const x = bigProfile();
  const once = unpackProfile(packProfile(x));
  assert.deepEqual(once, x);                                   // the migration already writes the full fields
  assert.deepEqual(unpackProfile(packProfile(once)), once);
  assert.ok(validateCanonicalProfile(once).ok);
});

test('the M5 history fits the sync cap', () => {
  assertSyncSize(bigProfile());
  assert.ok(syncSize(bigProfile()) < 9.5 * 1024 * 1024);
});

test('rows with sides, drops, rest-pause clusters, lb unit and free-form subtrees survive', () => {
  const s = v1([{ id: BENCH, sets: 3, reps: 5, weight: 135, prog: 'linear' }, { id: CARDIO, mode: 'cardio', sets: 1, min: 20, speed: 8 }], [wk('w1', '2026-01-01', [
    entry(BENCH, { sets: 3, reps: 5, weight: 135 }, [
      row(8, 65, { phase: 'warmup' }),
      row(5, 135, { type: 'dropset', drops: [{ w: 110, r: 6 }] }),
      row(5, 135, { type: 'restpause', clusters: [3, 2] }),
      { ...row(10, 135, { rpe: 8 }), sides: { L: row(5, 135), R: row(5, 135) } }
    ], { sets: 3, reps: 5, weight: 135 }, { muscleSnapshot: { value: 1, a: 2 } }),
    { id: CARDIO, rid: 'r1', target: { mode: 'cardio', sets: 1, min: 20, speed: 8 }, sets: [{ min: 20, speed: 9.5, done: true }] }])], { unit: 'lb' });
  const x = migrate(s);
  x.workouts[0].exposures[0].performance.sets[1].observations.push({ metric: 'tempo', unit: 'x', value: 3 });
  const packed = packProfile(x);
  assert.equal(packed.packed, 1);
  assert.deepEqual(unpackProfile(packed), x);
  assert.deepEqual(unpackProfile(JSON.parse(JSON.stringify(packed))), x);   // through real JSON
});

test('a key that collides with a short name disables packing instead of corrupting', () => {
  const x = bigProfile();
  x.workouts[0].exposures[0].performance.sets[0].obs = 1;      // 'obs' is a short name
  assert.equal(packProfile(x), x);
});

test('the dictionary is unambiguous: short names are unique and never equal a long name or a real v2 key', () => {
  const shorts = Object.values(SHORT);
  assert.equal(new Set(shorts).size, shorts.length);
  assert.ok(shorts.every(s => !(s in SHORT)));
  // a real profile must actually pack: a silent collision would only show up as a too-big sync body
  assert.notEqual(packProfile(bigProfile()), bigProfile());
  assert.equal(packProfile(bigProfile()).packed, 1);
});

test('v1 and already-packed documents pass through', () => {
  const old = { unit: 'kg', routines: [], workouts: [] };
  assert.equal(packProfile(old), old);
  const p = packProfile(bigProfile());
  assert.equal(packProfile(p), p);
  assert.equal(unpackProfile(old), old);
});
