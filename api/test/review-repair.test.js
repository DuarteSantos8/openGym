/* #313: a review that proposes an exercise the routine already has. The rule used to live only
 * in the validator, so a temperature-0 model repeated the answer in its one repair round and
 * the job failed every time. The prompt now states it, and the repair round names it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { runPipeline } = await import('../coach/core/pipeline.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');

const plan = {
  routines: [{ id: 'push', name: 'Push Day', ex: [{ id: '0001', sets: 3, reps: 8 }, { id: '0007', sets: 3, reps: 10 }] }],
  week: { 1: ['push'] }
};
const payload = { coach_contract: 1, plan, library: [] };
const dupSwap = JSON.stringify({
  coach_contract: 1, summary: 's',
  changes: [{ id: 'c1', type: 'swap-exercise', target: { routineId: 'push', exId: '0001' }, after: { id: '0007', sets: 4, reps: 8 }, why: 'stalled four times' }]
});
const fixed = JSON.stringify({
  coach_contract: 1, summary: 's',
  changes: [{ id: 'c1', type: 'swap-exercise', target: { routineId: 'push', exId: '0001' }, after: { id: '0009', sets: 4, reps: 8 }, why: 'stalled four times' }]
});

function stub(answers) {
  const calls = [];
  return {
    calls,
    adapter: { spawns: false, async invoke(req) { calls.push(req); return { code: 0, text: answers[calls.length - 1] }; } }
  };
}

test('#313: the review rules state that an incoming exercise must not already be in the routine', () => {
  const { system } = buildPromptParts('review', payload, null);
  assert.match(system, /`after\.id` of a `swap-exercise` or `add-exercise` must \*\*not already be in\*\* that routine/);
  assert.match(system, /`target\.exId` must be an exercise of `target\.routineId`/);
});

test('#313: the repair round names the rule and the offending id, and a corrected answer goes through', async () => {
  const s = stub([dupSwap, fixed]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'review', payload });
  assert.equal(r.ok, true);
  assert.equal(r.result.changes[0].after.id, '0009');
  assert.equal(s.calls.length, 2);
  const repair = s.calls[1].prompt;
  assert.match(repair, /brings in after\.id "0007", which is already in routine "Push Day" \(routineId "push"\)/);
  assert.match(repair, /Pick a different library id, or leave this change out/);
  assert.match(repair, /whose `after\.id` is already in the target routine/);
});

test('#313: repeating the duplicate in the repair round still fails as unusable, never applies it', async () => {
  const s = stub([dupSwap, dupSwap]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'review', payload });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, 'unusable');
  assert.equal(s.calls.length, 2);
});
