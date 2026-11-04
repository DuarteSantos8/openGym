import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProfileV1ToV2, validateCanonicalProfile } from '../migration/profile-migration.js';
import { packProfile, unpackProfile } from '../migration/profile-pack.js';
import { legacyEntriesOf } from '../engine/index.js';
import { LIB_BY_ID } from '../coach/core/library.js';
import { muscleLoad } from '../coach/core/context.js';
import { cleanPlan } from '../coach/core/payload.js';
import { eventData } from '../integrations/events.js';
import { referencedHashes } from '../media.js';

const HASH = 'ab'.repeat(32), POSTER = 'cd'.repeat(32);
const NOW = Date.parse('2026-10-05T18:00:00Z');
const legacy = () => ({
  unit: 'kg', progDefault: 'off',
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', mode: 'reps', sets: 1, reps: 5, weight: 60, warmup: 'own', warmupRows: [{ wb: true, r: 8 }, { wp: 60, r: 5 }] }] }],
  workouts: [{ id: 'w1', d: '2026-10-05', start: NOW, end: NOW + 60000, entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true, note: 'grip slipped', edited: true, wp: 60, media: [{ kind: 'video', hash: HASH, poster: { hash: POSTER } }] }] }] }]
});

test('migration keeps profile defaults, custom warmups, set notes and form video references', () => {
  const { profile } = migrateProfileV1ToV2(legacy(), LIB_BY_ID);
  assert.deepEqual(validateCanonicalProfile(profile), { ok: true, errors: [] });
  const occ = profile.routines[0].ex[0];
  assert.equal(occ.rule.preset, 'autoregulated');
  assert.equal(occ.warmup, 'own');
  assert.deepEqual(occ.warmupRows, legacy().routines[0].ex[0].warmupRows);
  const stored = unpackProfile(packProfile(profile));
  const row = legacyEntriesOf(stored.workouts[0], stored.prescriptions)[0].sets[0];
  assert.equal(row.note, 'grip slipped');
  assert.equal(row.edited, true);
  assert.equal(row.wp, 60);
  assert.equal(row.media[0].hash, HASH);
  assert.deepEqual([...referencedHashes(stored)].sort(), [HASH, POSTER].sort());
  assert.equal(cleanPlan(stored, NOW).routines[0].ex[0].warmup, 'own');
});

test('the Coach muscle context and integration event read canonical workout performance', () => {
  const { profile } = migrateProfileV1ToV2(legacy(), LIB_BY_ID);
  assert.equal(muscleLoad(profile, NOW)[0].sets7d, 1);
  const data = eventData({ type: 'workout.finished', data: profile.workouts[0] }, profile);
  assert.deepEqual(data.workout.totals, { exercises: 1, sets: 1, reps: 5, volume: 300 });
  assert.equal(data.workout.exercises[0].id, '0025');
  assert.ok(!JSON.stringify(data).includes(HASH));
});

test('a malformed own warmup stays refused at the profile boundary', () => {
  const { profile } = migrateProfileV1ToV2(legacy(), LIB_BY_ID);
  profile.routines[0].ex[0].warmupRows = [{ wp: 900, r: 5 }];
  assert.equal(validateCanonicalProfile(profile).ok, false);
});

test('a pinned exercise keeps exact stored loads when its history is migrated', () => {
  const input = legacy();
  input.progDefault = 'linear';
  input.exUnit = { '0025': { unit: 'lb', _ts: 1 } };
  input.routines[0].ex[0].weight = 20.4117;
  input.workouts[0].routineId = 'r1';
  input.workouts[0].entries[0].rid = 'r1';
  input.workouts[0].entries[0].target = { mode: 'reps', sets: 1, reps: 5, weight: 20.4117 };
  input.workouts[0].entries[0].sets[0].w = 20.4117;
  const { profile } = migrateProfileV1ToV2(input, LIB_BY_ID);
  const p = Object.values(profile.prescriptions)[0];
  assert.equal(p.rows[0].load.value, 20.4117);
});

test('migration preserves superset labels and session timing choices', () => {
  const input = legacy();
  const timing = { sg: 'a', sgName: 'Arms', sgRest: 90, restOff: true, warmupRestOff: true, sideRestOff: true, sideRestSec: 10, autoHold: true, subs: ['0043'] };
  Object.assign(input.routines[0].ex[0], timing);
  input.workouts[0].entries[0].target = timing;
  input.workouts[0].entries[0].sg = 'a';
  const { profile } = migrateProfileV1ToV2(input, LIB_BY_ID);
  for (const [key, value] of Object.entries(timing)) assert.deepEqual(profile.routines[0].ex[0][key], value);
  assert.equal(profile.routines[0].ex[0].restFromProfile, undefined);
  const stored = unpackProfile(packProfile(profile));
  assert.equal(stored.workouts[0].exposures[0].sgRest, 90);
  assert.equal(legacyEntriesOf(stored.workouts[0], stored.prescriptions)[0].target.sgName, 'Arms');
});
