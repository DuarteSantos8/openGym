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

// v1.4.3: the heart rate read back from Health Connect / Apple Health adds the session's reading
// (`w.hr` with its source) and marks weigh-ins read from there (`bodyweight[].src`). Both ride
// along through every kind of writer, like the set fields above.
const docHub = () => ({
  _ts: 10, unit: 'kg',
  workouts: [{ id: 'w1', d: '2026-10-15', _ts: 5, hr: { avg: 131, max: 162, src: 'hc', n: 601 }, entries: [{ id: '0025', sets: hrSets }] }],
  bodyweight: [{ d: '2026-10-14', w: 81, t: 3 }, { d: '2026-10-15', w: 80.4, t: 4, src: 'hc' }],
  routines: [],
});

test('the session heart rate and the imported weigh-in mark stay through every writer', () => {
  const cur = docHub();
  for (const stamped of [true, false]) {
    const out = stampPut(clone(cur), clone(cur), { stamped, overRead: false, now: 20 });
    assert.deepEqual(out.workouts[0].hr, cur.workouts[0].hr);
    assert.deepEqual(out.bodyweight, cur.bodyweight);
  }
});

test('an older app that drops the session heart rate on another edit gets it put back', () => {
  const cur = docHub();
  const next = clone(cur);
  delete next.workouts[0].hr;
  next.workouts[0].name = 'Push';
  const out = stampPut(clone(cur), next, { stamped: false, overRead: false, now: 20 });
  assert.deepEqual(out.workouts[0].hr, cur.workouts[0].hr);
});
