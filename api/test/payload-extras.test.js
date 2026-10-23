/* Exercises added during a session (`extra: true`) reach the Coach as what they are: real
 * training, apart from the plan. A session with any carries the split; one without keeps the
 * shape it always had. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const payloadLib = await import('../coach/core/payload.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');

const set = (w, r, done = true) => ({ w, r, done });
const S = {
  unit: 'kg', lang: 'en',
  routines: [{ id: 'legs', name: 'Legs', ex: [{ id: '0001', sets: 3, reps: 8 }] }],
  week: { 2: ['legs'] },
  workouts: [{
    id: 'w1', d: '2026-10-06', name: 'Legs', start: 1, end: 3600001, routineIds: ['legs'], planEx: 1,
    entries: [
      { id: '0001', rid: 'legs', sets: [set(100, 8), set(100, 8), set(100, 7)] },
      { id: '0002', rid: 'legs', extra: true, sets: [set(40, 12), set(40, 12), { ...set(20, 12), warmup: true }] }
    ]
  }],
  coach: { consent: { agreedAt: 1 } }
};

test('a review payload tells planned and extra work apart', () => {
  const p = payloadLib.build(S, { handle: 'h'.repeat(16), kind: 'review' });
  const w = p.window.workouts[0];
  assert.deepEqual(w.summary, { plannedExercises: 1, plannedSets: 3, extraExercises: 1, extraSets: 2 });
  assert.equal(w.entries[1].extra, true);
  assert.equal(w.entries[0].extra, undefined);
});

test('a session without extras keeps exactly its old shape', () => {
  const S2 = { ...S, workouts: [{ ...S.workouts[0], entries: [S.workouts[0].entries[0]] }] };
  const w = payloadLib.build(S2, { handle: 'h'.repeat(16), kind: 'debrief' }).session;
  assert.equal(w.summary, undefined);
  assert.ok(w.entries.every(e => !('extra' in e)));
});

test('the rules tell the model what an extra is', () => {
  const p = payloadLib.build(S, { handle: 'h'.repeat(16), kind: 'review' });
  assert.match(buildPromptParts('review', p, null).system, /`extra: true` was added during that session/);
});
