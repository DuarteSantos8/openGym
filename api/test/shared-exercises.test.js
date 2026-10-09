import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSharedExercises } from '../shared-exercises.js';

const exercise = (over = {}) => ({ id: 'ctest', n: 'Custom row', bp: 'back', eq: 'barbell', ...over });
const admin = { id: 'admin' };
function setup(t, extra = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-shared-unit-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const options = { data, atomicWrite: (file, content) => fs.writeFileSync(file, content), ...extra };
  return { data, options, store: createSharedExercises(options) };
}
const status = (code, errorCode) => e => e.status === code && (!errorCode || e.code === errorCode);

test('publishing sanitizes metadata and never copies unrelated profile fields', t => {
  const { store } = setup(t);
  const row = store.put(exercise({ n: ' Row ', workouts: [{ private: true }], admin: true, publisherId: 'forged',
    primaries: ['back', 'back', null], secondaries: ['biceps'], url: 'https://example.com/exercise', bodyweight: true }), admin);
  assert.equal(row.n, 'Row'); assert.equal(row.publisherId, admin.id); assert.equal(row.serverRevision, 1);
  assert.deepEqual(row.primaries, ['back']); assert.equal(row.workouts, undefined); assert.equal(row.admin, undefined);
  assert.equal(row.bodyweight, true); assert.equal(row.serverShared, true);
});
test('updates require the current revision and survive restarting', t => {
  const { store, options } = setup(t); const first = store.put(exercise(), admin);
  assert.throws(() => store.put(exercise({ n: 'Stale' }), admin), status(409));
  const next = store.put(exercise({ n: 'Renamed' }), { id: 'other-admin' }, first.serverRevision);
  assert.equal(next.publisherId, admin.id); assert.equal(next.serverRevision, 2);
  assert.equal(createSharedExercises(options).list()[0].n, 'Renamed');
});
test('withdraw and republish do not reuse revisions or revive stale editors', t => {
  const { store, options } = setup(t); const first = store.put(exercise(), admin);
  store.remove(first.id, first.serverRevision);
  assert.throws(() => store.put(exercise(), admin, first.serverRevision), status(409));
  const republished = createSharedExercises(options).put(exercise(), admin);
  assert.ok(republished.serverRevision > first.serverRevision);
  assert.throws(() => createSharedExercises(options).remove(first.id, first.serverRevision), status(409));
});
test('duplicate names, invalid custom IDs and unsafe links are refused', t => {
  const { store } = setup(t); store.put(exercise(), admin);
  assert.throws(() => store.put(exercise({ id: 'cother', n: 'custom ROW' }), admin), status(409, 'shared-exercise-duplicate'));
  for (const id of ['builtin', '../x', 'c', 'c' + 'a'.repeat(96)]) assert.throws(() => store.put(exercise({ id }), admin), status(400));
  for (const url of ['javascript:alert(1)', 'https://user:password@example.com/x', 'invalid'])
    assert.throws(() => store.put(exercise({ id: 'cother', n: 'Other', url }), admin), status(400));
});
test('invalid or absent definitions are rejected', t => {
  const { store } = setup(t);
  for (const value of [null, [], {}, exercise({ n: ' ' }), exercise({ eq: '' })]) assert.throws(() => store.put(value, admin), status(400));
});
test('a failed atomic write preserves the previous catalogue', t => {
  let fail = false; const { store } = setup(t, { atomicWrite: (file, bytes) => { if (fail) throw new Error('disk full'); fs.writeFileSync(file, bytes); } });
  const old = store.put(exercise(), admin); fail = true;
  assert.throws(() => store.put(exercise({ n: 'Unsaved' }), admin, old.serverRevision), /disk full/);
  assert.equal(store.list()[0].n, old.n); assert.equal(store.list()[0].serverRevision, 1);
});
test('corrupt catalogues fail closed rather than being silently replaced', t => {
  const { data, options } = setup(t);
  fs.writeFileSync(path.join(data, 'shared-exercises.json'), '{broken');
  assert.throws(() => createSharedExercises(options));
});
test('legacy catalogues migrate revisions and full catalogues reject new entries', t => {
  const { data, options } = setup(t);
  fs.writeFileSync(path.join(data, 'shared-exercises.json'), JSON.stringify({ exercises: Array.from({ length: 1000 }, (_, i) => exercise({ id: 'c' + i, n: 'Row ' + i, serverRevision: 4 })) }));
  const store = createSharedExercises(options);
  assert.throws(() => store.put(exercise(), admin), status(400));
  assert.equal(store.put(exercise({ id: 'c0', n: 'Edited' }), admin, 4).serverRevision, 5);
});
test('withdraw requires a revision and is idempotent after removal', t => {
  const { store } = setup(t); const row = store.put(exercise(), admin);
  assert.throws(() => store.remove(row.id, 0), status(409));
  store.remove(row.id, row.serverRevision); store.remove(row.id, row.serverRevision);
  assert.deepEqual(store.list(), []);
});
