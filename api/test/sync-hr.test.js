// Heart rate per set from the Apple Watch (frontend lib/heart-rate.js): optional `hr` / `restHr` on
// a logged set. The server's PUT /api/data merge (sync-stamps.js stampPut) must carry them along
// for every kind of writer: the app that wrote them, an older app that read them and sends the
// document back without knowing them, an API client. And a document without them is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stampPut } from '../sync-stamps.js';

const clone = v => JSON.parse(JSON.stringify(v));
const doc = sets => ({ _ts: 10, unit: 'kg', workouts: [{ id: 'w1', d: '2026-10-10', _ts: 5, entries: [{ id: '0025', sets }] }], routines: [] });
const hrSets = [{ w: 60, r: 8, done: true, hr: { avg: 128, max: 149 }, restHr: { avg: 110, max: 131 } }];
const plainSets = [{ w: 60, r: 8, done: true }];

test('the fields stay through a PUT from the app that wrote them and from an older app', () => {
  const cur = doc(hrSets);
  for (const stamped of [true, false]) {
    const out = stampPut(clone(cur), clone(cur), { stamped, overRead: false, now: 20 });
    assert.deepEqual(out.workouts[0].entries[0].sets, hrSets);
  }
});

test('a document without them comes out without them', () => {
  const cur = doc(plainSets);
  for (const stamped of [true, false]) {
    const out = stampPut(clone(cur), clone(cur), { stamped, overRead: false, now: 20 });
    assert.deepEqual(out.workouts[0].entries[0].sets, plainSets);
    assert.ok(!/"hr"|restHr/.test(JSON.stringify(out)));
  }
});

test('an older app editing another workout leaves these alone', () => {
  const cur = doc(hrSets);
  const next = clone(cur);
  next.workouts.push({ id: 'w2', d: '2026-10-11', entries: [{ id: '0001', sets: plainSets }] });
  const out = stampPut(clone(cur), next, { stamped: false, overRead: false, now: 20 });
  assert.deepEqual(out.workouts.find(w => w.id === 'w1').entries[0].sets, hrSets);
});
