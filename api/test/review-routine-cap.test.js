/* #471: a returning lifter accepts a Coach plan, asks the Coach about it, and every answer it
 * gives comes back as "something the app couldn't use" — a single, well-formed swap included.
 *
 * Accepting a created plan never replaces anything (applyCreatedPlan → mergePlan): its routines
 * arrive next to the ones the lifter already had. Four of their own and a four-day Coach plan is
 * eight routines, and the review validator capped the plan as it stood rather than what a review
 * would grow it to — so the swap below was refused for "more than the 7 routines allowed", the
 * repair round could not change that short of deleting routines, and the job failed.
 *
 * The answer is the reporter's own, byte for byte apart from the prose; the plan is built by
 * payload.build from state, the same way the job runner builds it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { runPipeline } = await import('../coach/core/pipeline.js');
const { validateReview } = await import('../coach/core/validate.js');
const payloadLib = await import('../coach/core/payload.js');

const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const ex = (id, sets = 3, reps = 10) => ({ id, sets, reps });

// What the lifter had before the Coach: four routines and the sessions logged on them.
const OWN = [
  { id: 'own-push', name: 'Push', ex: [ex('0025'), ex('0047')] },
  { id: 'own-pull', name: 'Pull', ex: [ex('0150'), ex('0160')] },
  { id: 'own-legs', name: 'Legs', ex: [ex('0043'), ex('0085')] },
  { id: 'own-arms', name: 'Arms', ex: [ex('0294'), ex('0334')] }
];
// The accepted Coach plan, as mergePlan stores it: fresh uid() ids, scheduled over the week.
// Monday's routine carries the lever dip the reporter has no machine for.
const COACH = [
  { id: 'mumgkckgrla1g', name: 'Upper A', ex: [ex('0025', 3, 8), ex('0591'), ex('0188')] },
  { id: 'mumgkckgrla2h', name: 'Lower A', ex: [ex('0043', 3, 6), ex('0085')] },
  { id: 'mumgkckgrla3i', name: 'Upper B', ex: [ex('0047'), ex('0150'), ex('0285')] },
  { id: 'mumgkckgrla4j', name: 'Lower B', ex: [ex('0032', 3, 5), ex('0001', 3, 15)] }
];
const state = routines => ({
  routines,
  week: { 1: ['mumgkckgrla1g'], 2: ['mumgkckgrla2h'], 4: ['mumgkckgrla3i'], 5: ['mumgkckgrla4j'] },
  workouts: [20, 13, 6].map((n, i) => ({
    id: 'w' + i, d: daysAgo(n), name: 'Push',
    entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }]
  })),
  coach: { consent: { agreedAt: 1 }, profile: { goal: 'strength', daysPerWeek: 4, equipment: ['barbell', 'dumbbell', 'cable', 'body weight'] } }
});
const reviewPayload = routines => payloadLib.build(state(routines), {
  handle: 'h'.repeat(16), kind: 'review', note: 'I do not have a leverage machine, what can replace it?'
});

const ANSWER = JSON.stringify({
  coach_contract: 1,
  nochange: false,
  summary: 'Your note says you do not have a leverage machine, and the Monday routine in your weekly schedule includes a lever triceps dip, so I propose swapping it for a cable exercise you have available.',
  evidence: { from: '2026-07-20', to: '2026-09-24', sessions: 23 },
  changes: [{
    id: 'c1',
    type: 'swap-exercise',
    target: { routineId: 'mumgkckgrla1g', exId: '0591' },
    before: '0591',
    after: { id: '0194' },
    why: 'You said you do not have a leverage machine, and the Monday routine assigned in your week includes a lever overhand triceps dip. Cable overhead triceps extensions are in your available library and avoid the unavailable leverage machine.'
  }],
  notes: []
}, null, 2);

function stub(answers) {
  const calls = [];
  return {
    calls,
    adapter: { spawns: false, async invoke(req) { calls.push(req); return { code: 0, text: answers[Math.min(calls.length, answers.length) - 1] }; } }
  };
}

test('#471: the reported swap goes through on a plan that already had routines before the Coach added its own', async () => {
  const payload = reviewPayload([...OWN, ...COACH]);
  assert.equal(payload.plan.routines.length, 8, 'the lifter\'s four and the Coach\'s four');
  const s = stub([ANSWER]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'review', payload });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(s.calls.length, 1, 'a sound answer never needs the repair round');
  assert.equal(r.result.changes.length, 1);
  const c = r.result.changes[0];
  assert.equal(c.type, 'swap-exercise');
  assert.deepEqual(c.target, { routineId: 'mumgkckgrla1g', exId: '0591' });
  assert.equal(c.routineName, 'Upper A');
  assert.equal(c.after.id, '0194');
  assert.deepEqual(r.result.evidence, { from: '2026-07-20', to: '2026-09-24', sessions: 23 });
});

test('#471: and on the Coach\'s plan alone, which never reached the cap, it went through already', async () => {
  const s = stub([ANSWER]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'review', payload: reviewPayload(COACH) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(s.calls.length, 1);
});

test('#471: a plan already past the cap can still be changed in place, and shrunk', () => {
  const plan = reviewPayload([...OWN, ...COACH]).plan;
  const why = 'stalled twice';
  for (const changes of [
    [{ type: 'sets', target: { routineId: 'own-push', exId: '0025' }, after: 4, why }],
    [{ type: 'rename-routine', target: { routineId: 'own-arms' }, after: 'Arms + shoulders', why }],
    [{ type: 'remove-routine', target: { routineId: 'own-arms' }, after: null, why }],
    // One in, one out: the plan ends no bigger than it was handed over.
    [{ type: 'remove-routine', target: { routineId: 'own-arms' }, after: null, why },
      { type: 'add-routine', target: {}, after: { name: 'Arms', ex: [ex('0285')] }, why }]
  ]) {
    const r = validateReview({ coach_contract: 1, summary: 's', changes }, plan);
    assert.equal(r.ok, true, `${changes.map(c => c.type).join(' + ')}: ${JSON.stringify(r.errors)}`);
  }
});

test('#471: what the cap is for still holds — a review cannot grow a plan past seven routines', () => {
  const add = { type: 'add-routine', target: {}, after: { name: 'Extra', ex: [ex('0285')] }, why: 'a body part with no work' };
  const capped = /more than the 7 routines allowed/;
  // From seven to eight.
  const seven = reviewPayload([...OWN.slice(0, 3), ...COACH]).plan;
  const r7 = validateReview({ coach_contract: 1, summary: 's', changes: [add] }, seven);
  assert.equal(r7.ok, false);
  assert.match(r7.errors.join('\n'), capped);
  // From six to eight in one set.
  const six = reviewPayload([...OWN.slice(0, 2), ...COACH]).plan;
  const r6 = validateReview({ coach_contract: 1, summary: 's', changes: [add, { ...add, after: { ...add.after, name: 'Extra 2' } }] }, six);
  assert.equal(r6.ok, false);
  assert.match(r6.errors.join('\n'), capped);
  // From eight to nine: already past it is not a licence to keep going.
  const eight = reviewPayload([...OWN, ...COACH]).plan;
  const r8 = validateReview({ coach_contract: 1, summary: 's', changes: [add] }, eight);
  assert.equal(r8.ok, false);
  assert.match(r8.errors.join('\n'), capped);
});
