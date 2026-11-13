/* The person's own exercises (a `customEx` entry such as "Sandbag carry", or a lift named in
 * another language) are not in the catalogue, so `LIB_BY_ID` cannot name them. Every name the Coach reads
 * — the plan it is asked to change, the sets that were logged, the stall list, the working
 * weights it may not exceed — has to fall back to the profile's own entries, or a real exercise
 * arrives at the provider as `name: null` and reads as a broken id.
 *
 * A proposal that brings one in has the mirror problem on the way back: `validateReview` and
 * `validateAdapt` name what they accepted, and the client renders `toName`/`after.name` on the
 * approval card. The pipeline resolves those from the library slice, which is the only place
 * the model was shown the name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const { validateAdapt, validateReview } = await import('../coach/core/validate.js');
const { runPipeline } = await import('../coach/core/pipeline.js');
const { handleFor } = await import('../coach/handle.js');

const H = handleFor('u-custom-names');
const CUSTOM = { id: 'cx1', n: 'Sandbag carry', bp: 'back', custom: true };

/* One custom exercise in the plan, its sets logged, and the weight it was carried at. */
const withCustom = () => {
  const S = sampleState({ customEx: [CUSTOM] });
  S.routines[0].ex.push({ id: 'cx1', sets: 3, reps: 10, mode: 'reps' });
  S.workouts[0].entries.push({
    id: 'cx1', n: 'Sandbag carry', target: { sets: 3, reps: 10, weight: 30 },
    sets: [{ w: 30, r: 8, done: true }, { w: 30, r: 7, done: true }]
  });
  return S;
};

test('a custom exercise is named in the plan, the window, the stalls and the working weights', () => {
  const S = withCustom();
  const review = payload.build(S, { handle: H, kind: 'review' });
  assert.equal(review.plan.routines[0].ex.find(e => e.id === 'cx1').name, 'Sandbag carry');
  assert.equal(review.window.workouts[0].entries.find(e => e.id === 'cx1').name, 'Sandbag carry');
  assert.equal(review.aggregates.exercises.find(e => e.id === 'cx1').name, 'Sandbag carry');
  assert.equal(review.aggregates.setsByBodyPart.back, 2, 'its body part is the profile\'s, not the catalogue\'s');

  const create = payload.build(S, { handle: H, kind: 'create' });
  assert.equal(create.history.workingWeights.find(w => w.id === 'cx1').name, 'Sandbag carry');
});

test('a custom body part is bounded before it becomes an aggregate key', () => {
  // The key is free text from the profile; every other custom field is capped, so this one is too.
  const long = withCustom();
  long.customEx[0].bp = 'x'.repeat(5000);
  const keys = Object.keys(payload.build(long, { handle: H, kind: 'review' }).aggregates.setsByBodyPart);
  assert.equal(keys.some(k => k.length > 40), false, 'no body-part key outlives the 40-character bound');
  assert.equal(keys.includes('x'.repeat(40)), true, 'the value still counts, at the bound');

  const odd = withCustom();
  odd.customEx[0].bp = { not: 'a string' };
  const q = payload.build(odd, { handle: H, kind: 'review' }).aggregates.setsByBodyPart;
  assert.equal('[object Object]' in q, false, 'a non-string body part is not a key');
});

test('an exercise the catalogue does know is still named from the catalogue', () => {
  const S = withCustom();
  S.routines[0].ex.push({ id: 'no-such-exercise', sets: 3, reps: 10, mode: 'reps' });
  const p = payload.build(S, { handle: H, kind: 'review' });
  assert.equal(p.plan.routines[0].ex[0].name, '3/4 sit-up');
  assert.equal(p.plan.routines[0].ex.find(e => e.id === 'no-such-exercise').name, null);
});

/* The client shows `after.name` on the approval card; a review that swaps in someone's own
   exercise used to show `null` there. */
test('a review change that brings in a custom exercise is named from the slice the model saw', () => {
  const S = sampleState({ customEx: [CUSTOM] });
  const p = payload.build(S, { handle: H, kind: 'review' });
  const ctx = {
    customIds: p.library.filter(e => e.custom).map(e => e.id),
    customNames: new Map(p.library.filter(e => e.custom).map(e => [e.id, e.n])),
    offered: new Set(p.library.map(e => e.id))
  };
  const r = validateReview({
    coach_contract: 1, summary: 'Sandbag work instead of the sit-up.',
    changes: [{
      id: 'c1', type: 'swap-exercise', target: { routineId: 'r1', exId: '0001' },
      before: '0001', after: { id: 'cx1', sets: 3, reps: 10 }, why: 'You asked for your own carry.'
    }]
  }, p.plan, ctx);
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  assert.equal(r.proposal.changes[0].after.name, 'Sandbag carry');
  assert.equal(r.proposal.changes[0].after.id, 'cx1');
});

test('an adapt change that swaps in a custom exercise carries toName', () => {
  const today = {
    entries: [{
      id: '0001', target: { sets: 3, reps: 10, weight: 20 },
      sets: [{ w: 20, r: 5, done: false }]
    }]
  };
  const r = validateAdapt({
    coach_contract: 1, summary: 'Rack is taken; use the sandbag.',
    changes: [{ type: 'swap', entry: 0, exId: '0001', to: 'cx1', reps: 10, why: 'The rack is busy.' }]
  }, today, { customIds: ['cx1'], customNames: new Map([['cx1', 'Sandbag carry']]) });
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  assert.equal(r.proposal.changes[0].toName, 'Sandbag carry');
});

/* `swapSlice` stops after ten custom exercises, so the eleventh is not in `ctx.customNames` even
   though the running session's entry was named when the payload was built. The card must still
   say what the person is looking at, not `null`. */
test('an adapt change names an entry the library slice left out', () => {
  const customEx = Array.from({ length: 11 }, (_, i) => ({ id: 'cx' + (i + 1), n: 'Carry ' + (i + 1), bp: 'back' }));
  const S = sampleState({ customEx });
  const today = {
    entries: [{ id: 'cx11', target: { sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 5, done: false }] }]
  };
  const p = payload.build(S, { handle: H, kind: 'adapt', today, focus: { entry: 0, reason: 'other' } });
  assert.equal(p.today.entries[0].name, 'Carry 11');
  const names = new Map(p.library.filter(e => e.custom).map(e => [e.id, e.n]));
  assert.equal(names.has('cx11'), false, 'the slice stops at ten customs');

  const r = validateAdapt({
    coach_contract: 1, summary: 'One less set today.',
    changes: [{ type: 'sets', entry: 0, exId: 'cx11', sets: 0, why: 'You are short on time.' }]
  }, p.today, { customIds: [...names.keys()], customNames: names });
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  assert.equal(r.proposal.changes[0].name, 'Carry 11');
});

/* The unit tests above could pass while the pipeline forgets to hand `customNames` over — the
   wiring is the bug. This runs the same path a live review does, with a canned answer. */
test('the pipeline threads the slice\'s custom names into validation', async () => {
  const S = sampleState({ customEx: [CUSTOM] });
  const p = payload.build(S, { handle: H, kind: 'review' });
  const answer = {
    coach_contract: 1, summary: 'Sandbag work instead of the sit-up.',
    evidence: { from: '2026-07-01', to: '2026-07-20', sessions: 1 },
    changes: [{
      id: 'c1', type: 'swap-exercise', target: { routineId: 'r1', exId: '0001' },
      before: '0001', after: { id: 'cx1', sets: 3, reps: 10 }, why: 'You asked for your own carry.'
    }],
    notes: []
  };
  const adapter = { spawns: false, async invoke() { return { code: 0, text: JSON.stringify(answer) }; } };
  const r = await runPipeline({ adapter, cfg: {}, kind: 'review', payload: p });
  assert.equal(r.ok, true, JSON.stringify(r.errors || r));
  assert.equal(r.result.changes[0].after.name, 'Sandbag carry');
});
