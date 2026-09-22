/* payload.js's own header comment says its duplicated reading rules are pinned against the
   frontend's originals so the copy cannot drift silently, but frontend/src/lib/coach-parity.test.js
   only ever imported three of the five: modeOf, isBw, isPerSide. isWarmupSet and readSession were
   pinned by nothing. This file closes that gap.

   It cannot live inside coach-parity.test.js itself: that file runs under vitest, and readSession
   is not exported from payload.js (only isWarmupSet is), so the only way to observe it from
   outside is through payload.build()'s aggregates, which needs a real DATA_DIR and the rest of the
   coach module graph — the same setup payload.test.js already uses under node:test. The frontend
   imports below are safe under plain node: workout-model.js and progression.js have no Vite- or
   React-only syntax, the same reason mcp/'s own tests import frontend/src/lib directly. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';
import { isWarmupRow } from '../../frontend/src/lib/workout-model.js';
import { readSession as frontendReadSession } from '../../frontend/src/lib/progression.js';

tempData();
const payload = await import('../coach/core/payload.js');
const { handleFor } = await import('../coach/handle.js');

test('isWarmupSet agrees with the frontend isWarmupRow', () => {
  const cases = [
    {}, null, undefined,
    { warmup: true }, { warmup: false }, { warmup: 'true' },
    { phase: 'warmup' }, { phase: 'warm-up' }, { phase: 'warm_up' }, { phase: 'WARMUP' },
    { phase: 'work' }, { phase: '' }, { phase: 'bogus' },
    { phase: 'warmup', warmup: false }, { phase: 'work', warmup: true },
  ];
  for (const c of cases) assert.equal(payload.isWarmupSet(c), isWarmupRow(c), JSON.stringify(c));
});

/* readSession decides whether a logged session counts as a hit, feeding stallCount and every
   progression signal the aggregates carry. It is not exported, so it is read here the way the
   engine itself reads it: through build()'s aggregates, on an exercise with three sessions (the
   inclusion floor `aggregates` applies before it will report on an exercise at all). */
const EX_ID = '0001'; // bodyweight, real catalogue id — same one coach-parity.test.js uses
const PLAN = { id: EX_ID, sets: 3, reps: 10, mode: 'reps', weight: 20, prog: 'linear' };
const set = r => ({ w: 0, r, done: true });
const entry = sets => ({ id: EX_ID, target: { sets: 3, reps: 10 }, sets });

function reviewFor(entries) {
  const S = sampleState({
    routines: [{ id: 'r1', name: 'Full body A', ex: [PLAN] }],
    workouts: entries.map((en, i) => ({
      id: 'w' + i, d: `2026-08-${String(i + 1).padStart(2, '0')}`, name: 'Full body A',
      start: 1000, end: 2000, entries: [en],
    })),
  });
  return payload.build(S, { handle: handleFor('u_parity'), kind: 'review' });
}
const exOf = p => p.aggregates.exercises.find(e => e.id === EX_ID);

test('readSession agrees with the frontend on an ordinary session', () => {
  const passing = entry([set(10), set(10), set(10)]);
  const p = reviewFor([passing, passing, passing]);
  assert.equal(exOf(p).lastOk, true);
  assert.equal(frontendReadSession(passing, PLAN).ok, true);
});

// Exact inputs: a session logged with a fourth set beyond the planned three, whose reps fall
// short of the goal. frontend/src/lib/progression.js readSession grades only the first
// `target.sets` sets (issue #233: "a hard [extra set] taken short of the target reps reported
// the whole session as missed") and calls this a hit. payload.js's copy graded every logged
// set and called the same session a miss, so stallCount reported a stall the athlete never
// had, and the Coach's review and proposal were built on it.
test('readSession agrees with the frontend on a bonus set logged beyond the plan', () => {
  const passing = entry([set(10), set(10), set(10)]);
  const bonus = entry([set(10), set(10), set(10), set(5)]);
  const p = reviewFor([passing, passing, bonus]);

  assert.equal(frontendReadSession(bonus, PLAN).ok, true, 'the frontend grades the first 3 sets and calls this a hit');
  assert.equal(exOf(p).lastOk, true, 'and so must this, or stallCount invents a stall');
  assert.equal(exOf(p).stalls, 0);

  // A short set INSIDE the plan is still a miss on both sides: the slicing must not swallow it.
  const short = entry([set(10), set(10), set(5)]);
  assert.equal(frontendReadSession(short, PLAN).ok, false);
  assert.equal(exOf(reviewFor([passing, passing, short])).lastOk, false);
  assert.equal(exOf(reviewFor([passing, passing, short])).stalls, 1);

  // Fewer sets than planned is short whichever way it is read, and `enough` says so on both
  // sides before the slicing is reached.
  const tooFew = entry([set(10), set(10)]);
  assert.equal(frontendReadSession(tooFew, PLAN).ok, false);
  assert.equal(exOf(reviewFor([passing, passing, tooFew])).lastOk, false);
});
