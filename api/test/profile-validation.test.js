import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProfileV1ToV2, validateCanonicalProfile } from '../migration/profile-migration.js';
import { contentHash } from '../engine/index.js';
import { LIB_BY_ID } from '../coach/core/library.js';
const original = () => migrateProfileV1ToV2({ unit: 'kg', routines: [{ id: 'r', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60, prog: 'linear' }] }], workouts: [{ id: 'w', start: 1, entries: [{ id: '0025', rid: 'r', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ done: true, w: 60, r: 5 }] }] }] }, LIB_BY_ID).profile;
const p = s => Object.values(s.prescriptions)[0];
const x = s => s.workouts[0].exposures[0];
const mutations = {
  'null prescription row': s => p(s).rows = [null],
  'tampered prescription hash': s => p(s).contentHash = '0000000000000000',
  'null 1RM': s => s.oneRepMaxes.bad = null,
  'null progression': s => s.progression.bad = null,
  'null observation': s => x(s).performance.sets[0].observations = [null],
  'null segment': s => x(s).performance.sets[0].segments = [null],
  'invalid observation value': s => x(s).performance.sets[0].observations[0].value = 'five',
  'invalid resistance': s => x(s).performance.sets[0].resistance = { kind: 'oops' },
  'mismatched 1RM id': s => Object.values(s.oneRepMaxes)[0].id = 'wrong',
  'mismatched progression track': s => Object.values(s.progression)[0].trackId = 'wrong',
  'broken progression source': s => Object.values(s.progression)[0].lastCompletedLogId = 'missing',
  'null actual load': s => x(s).actual = { sets: 1, reps: 5, load: { value: 'bad', unit: 'kg' } },
};
for (const [name, mutate] of Object.entries(mutations)) test(`A33: rejects ${name} without throwing`, () => {
  const s = JSON.parse(JSON.stringify(original())); mutate(s);
  assert.equal(validateCanonicalProfile(s).ok, false);
});
test('A33: unusual finite execution remains valid', () => {
  const s = original(); x(s).performance.sets[0].observations[0].value = 137;
  assert.deepEqual(validateCanonicalProfile(s), { ok: true, errors: [] });
});
for (const [name, mutate] of Object.entries({
  'null resolved load wrapper': s => p(s).parameters.load = null,
  'missing load expression': s => p(s).parameters.load = { resolved: { value: 60, unit: 'kg' } },
  'invalid prefill': s => p(s).prefill.reps = 'five',
  'invalid target resolution': s => p(s).target.resolved = { value: 'heavy', unit: 'kg' },
  'invalid position': s => p(s).position = null,
})) test(`A33: rejects rehashed ${name}`, () => {
  const s = JSON.parse(JSON.stringify(original())); mutate(s);
  const prescription = p(s), { contentHash: hash, ...body } = prescription;
  prescription.contentHash = contentHash(body);
  assert.equal(validateCanonicalProfile(s).ok, false);
});
