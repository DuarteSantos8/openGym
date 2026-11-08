// The workout's effort, 1 to 10 (frontend lib/workout-effort.js): optional `effort` / `effortBy` on
// a saved workout, and the `workoutEffort` setting. The server's PUT /api/data merge
// (sync-stamps.js stampPut) carries them along, also from an older app that does not know them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stampPut } from '../sync-stamps.js';

const clone = v => JSON.parse(JSON.stringify(v));
const sets = [{ w: 60, r: 8, done: true }];
const doc = extra => ({ _ts: 10, unit: 'kg', workoutEffort: 'auto', workouts: [{ id: 'w1', d: '2026-10-10', _ts: 5, entries: [{ id: '0025', sets }], ...extra }], routines: [] });

test('the effort stays through a PUT from the app that wrote it and from an older app', () => {
  const cur = doc({ effort: 7, effortBy: 'watch' });
  for (const stamped of [true, false]) {
    const out = stampPut(clone(cur), clone(cur), { stamped, overRead: false, now: 20 });
    assert.equal(out.workouts[0].effort, 7);
    assert.equal(out.workouts[0].effortBy, 'watch');
    assert.equal(out.workoutEffort, 'auto');
  }
});

test('an older app editing another workout leaves it alone', () => {
  const cur = doc({ effort: 4, effortBy: 'auto' });
  const next = clone(cur);
  next.workouts.push({ id: 'w2', d: '2026-10-11', entries: [{ id: '0001', sets }] });
  const out = stampPut(clone(cur), next, { stamped: false, overRead: false, now: 20 });
  assert.equal(out.workouts.find(w => w.id === 'w1').effort, 4);
});
