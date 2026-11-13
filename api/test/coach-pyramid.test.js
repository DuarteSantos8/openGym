/* Pyramid slots (CONTEXT.md, frontend/src/lib/pyramid.js): one rep target per set, in order —
 * a whole number or "max" — with an optional rest and planned load per set. The app writes them
 * beside the flat `sets`/`reps` pair it keeps in step (flatFromPyramid), and the Coach has to see
 * the pyramid: without it a 12-10-8-6 slot reads as four identical sets, and the rewrite the
 * model sends back flattens it for good.
 *
 * The API image cannot import frontend/lib/pyramid.js, so the bounds here are pinned against the
 * same shapes the app's editor writes, in payload.js and in validate.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const { validatePlan, validateReview, MAX_WEIGHT } = await import('../coach/core/validate.js');
const { hashPlan } = await import('../coach/core/plan-hash.js');
const { handleFor } = await import('../coach/handle.js');

const H = handleFor('u-pyramid');
// 12 · 10 · 8 · Max, with a longer rest before the third set and a plan for the first three.
const EX = {
  id: '0001', sets: 4, reps: 12, mode: 'reps', prog: 'linear',
  pyramid: [12, 10, 8, 'max'], pyramidRest: [0, 180, 0, 0], pyramidWeight: [40, 45, 50, 0]
};
const stateWith = over => sampleState({
  routines: [{ id: 'r1', name: 'Push', emoji: '💪', ex: [{ ...EX, ...over }] }],
  week: { 1: 'r1', 3: 'r1', 5: 'r1' }
});
const planEx = (S, kind = 'review') => payload.build(S, { handle: H, kind }).plan.routines[0].ex[0];

/* ---------------- the payload ---------------- */

test('a pyramid reaches the payload whole: targets, rests and loads', () => {
  const ex = planEx(stateWith());
  assert.deepEqual(ex.pyramid, [12, 10, 8, 'max']);
  assert.deepEqual(ex.pyramidRest, [0, 180, 0, 0]);
  assert.deepEqual(ex.pyramidWeight, [40, 45, 50, 0]);
  // The flat pair stays what the plan holds; the app keeps it in step, so nothing is invented.
  assert.equal(ex.sets, 4);
  assert.equal(ex.reps, 12);
});

test('a slot without a pyramid carries no pyramid fields', () => {
  const S = stateWith();
  delete S.routines[0].ex[0].pyramid;
  delete S.routines[0].ex[0].pyramidRest;
  delete S.routines[0].ex[0].pyramidWeight;
  const ex = planEx(S);
  for (const k of ['pyramid', 'pyramidRest', 'pyramidWeight']) assert.equal(k in ex, false, k);
});

test('pyramids are bounded like the editor: whole targets, ten sets, a sane rest and load', () => {
  const long = planEx(stateWith({
    sets: 11,
    pyramid: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    pyramidRest: [0, -5, 5000],
    pyramidWeight: [0, 0, 2000.456]
  }));
  assert.equal(long.pyramid.length, payload.MAX_PYRAMID_SETS);
  assert.equal(long.pyramid[9], 10, 'the eleventh target is beyond the session');
  assert.deepEqual(long.pyramidRest.slice(0, 3), [0, 0, 900], 'a rest is never negative and never over REST_MAX');
  assert.deepEqual(long.pyramidWeight.slice(0, 3), [0, 0, 1000]);

  const odd = planEx(stateWith({ pyramid: [0, 150, 'max', '8'] }));
  assert.deepEqual(odd.pyramid, [1, 100, 'max', 8], 'a target is a whole rep count in the validator\'s range');
});

test('a pyramid is a rep-mode prescription: timed and cardio slots do not carry one', () => {
  const timed = planEx(stateWith({ mode: 'time', sec: 45, pyramid: [30, 20, 10] }));
  assert.equal('pyramid' in timed, false);
  const cardio = planEx(stateWith({ mode: 'cardio', min: 20, speed: 8, pyramid: [1, 2, 3] }));
  assert.equal('pyramid' in cardio, false);
});

/* ---------------- a plan coming back from the model ---------------- */

test('validatePlan keeps a pyramid, and the flat pair follows it', () => {
  // A model that copied the payload's pyramid but wrote a stale `sets`/`reps` must still produce
  // the plan the person had: the pyramid is the prescription.
  const r = validatePlan({ routines: [{ id: 'r1', name: 'Push', ex: [{ ...EX, sets: 9, reps: 99 }] }] },
    { workingWeights: [{ id: '0001', best: 100 }] });
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  const ex = r.bundle.routines[0].ex[0];
  assert.deepEqual(ex.pyramid, [12, 10, 8, 'max']);
  assert.equal(ex.sets, 4, 'the set count is the pyramid\'s length');
  assert.equal(ex.reps, 12, 'reps are its first numeric target');
  assert.deepEqual(ex.pyramidRest, [0, 180, 0, 0]);
  assert.deepEqual(ex.pyramidWeight, [40, 45, 50, 0]);
});

test('validatePlan bounds a pyramid the way the payload does', () => {
  const r = validatePlan({
    routines: [{
      id: 'r1', name: 'Push', ex: [{
        id: '0001', sets: 4, reps: 12,
        pyramid: [0, 150, 'max', '8', 6, 5, 4, 3, 2, 1, 12],
        pyramidRest: [0, 5000], pyramidWeight: [0, 2000.456]
      }]
    }]
  }, { workingWeights: [{ id: '0001', best: 1200 }] });
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  const ex = r.bundle.routines[0].ex[0];
  assert.equal(ex.pyramid.length, payload.MAX_PYRAMID_SETS);
  assert.deepEqual(ex.pyramid.slice(0, 4), [1, 100, 'max', 8]);
  assert.deepEqual(ex.pyramidRest.slice(0, 2), [0, 900]);
  assert.deepEqual(ex.pyramidWeight.slice(0, 2), [0, 1000]);
});

test('a dropped target does not move its set\'s rest or load', () => {
  // `[12, "bad", 8]` keeps two targets; the rest and load at index 2 must stay with the 8, not
  // slide onto it from the discarded middle entry.
  const odd = { pyramid: [12, 'bad', 8], pyramidRest: [0, 300, 120], pyramidWeight: [20, 80, 40] };
  const ex = planEx(stateWith(odd));
  assert.deepEqual(ex.pyramid, [12, 8]);
  assert.deepEqual(ex.pyramidRest, [0, 120], 'the rest at index 2 stays with the 8');
  assert.deepEqual(ex.pyramidWeight, [20, 40], 'the load at index 2 stays with the 8');

  const r = validatePlan({ routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0001', sets: 3, reps: 12, ...odd }] }] },
    { workingWeights: [{ id: '0001', best: 100 }] });
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  const v = r.bundle.routines[0].ex[0];
  assert.deepEqual(v.pyramid, [12, 8]);
  assert.deepEqual(v.pyramidRest, [0, 120]);
  assert.deepEqual(v.pyramidWeight, [20, 40]);
});

test('every planned pyramid load is held to the history cap', () => {
  const plan = pyramidWeight => ({
    routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0001', sets: 4, reps: 12, pyramid: [12, 10, 8, 6], pyramidWeight }] }]
  });
  const capped = validatePlan(plan([40, 60, 80, 20]), { workingWeights: [{ id: '0001', best: 50 }] });
  assert.equal(capped.ok, true, (capped.errors || []).join(' '));
  assert.deepEqual(capped.bundle.routines[0].ex[0].pyramidWeight, [40, 50, 50, 20], 'each set is capped, not just the first');

  // No history for the exercise means no invented loads at all, as with the flat `weight`.
  const none = validatePlan(plan([40, 60]), { workingWeights: [] });
  assert.equal(none.ok, true, (none.errors || []).join(' '));
  assert.equal('pyramidWeight' in none.bundle.routines[0].ex[0], false);
  const partial = validatePlan(plan([0, 60]), { workingWeights: [] });
  assert.equal('pyramidWeight' in partial.bundle.routines[0].ex[0], false, 'all zero is no field');
});

test('a per-side pyramid may not prescribe an odd number of reps', () => {
  const of = pyramid => validatePlan({
    routines: [{ id: 'r1', name: 'Legs', ex: [{ id: '0043', sets: 3, reps: 16, side: true, pyramid }] }]
  });
  const bad = of([16, 14, 13]);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /per-side|even number/);
  assert.equal(of([16, 14, 12]).ok, true, 'the total across both sides steps in twos');
});

test('a per-side pyramid is judged by its targets, not by a stale flat reps', () => {
  // The app keeps the flat pair in step, but a hand-edited or half-written plan can hold
  // `reps: 11` beside a valid [12, 10]. The rule is about what is trained, so the pyramid wins.
  const of = ex => validatePlan({ routines: [{ id: 'r1', name: 'Legs', ex: [{ id: '0043', side: true, ...ex }] }] });
  const ok = of({ sets: 2, reps: 11, pyramid: [12, 10] });
  assert.equal(ok.ok, true, (ok.errors || []).join(' '));
  assert.equal(ok.bundle.routines[0].ex[0].reps, 12, 'the flat pair follows the pyramid');

  const flat = of({ sets: 2, reps: 11 });
  assert.equal(flat.ok, false, 'without a pyramid the flat rule still applies');
  assert.match(flat.errors.join(' '), /per-side|even number/);
});

test('the payload and the validator share one weight ceiling', () => {
  assert.equal(payload.MAX_PYRAMID_WEIGHT, MAX_WEIGHT);
});

test('a pyramid on a timed slot is not read', () => {
  const r = validatePlan({
    routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, mode: 'time', sec: 45, pyramid: [30, 20, 10] }] }]
  });
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  assert.equal('pyramid' in r.bundle.routines[0].ex[0], false);
});

/* ---------------- a review of a pyramid slot ---------------- */

const reviewPlan = (S = stateWith()) => payload.build(S, { handle: H, kind: 'review' }).plan;
const changeOn = (type, after) => ({
  coach_contract: 1, summary: 's',
  changes: [{ id: 'c1', type, target: { routineId: 'r1', exId: '0001' }, after, why: 'The last set was missed twice.' }]
});
const flatState = () => {
  const S = stateWith();
  delete S.routines[0].ex[0].pyramid;
  delete S.routines[0].ex[0].pyramidRest;
  delete S.routines[0].ex[0].pyramidWeight;
  return S;
};

test('a review cannot write a flat field over a pyramid slot', () => {
  // Each of these is applied by overwriting one field while the pyramid stays on the entry, so
  // the session would keep training the pyramid and the card would show a number that never ran.
  const plan = reviewPlan();
  for (const [type, after] of [['sets', 6], ['reps', 5], ['repsMin', 6], ['repsMax', 6], ['exercise-prog', 'linear'], ['inc', 2.5]]) {
    const r = validateReview(changeOn(type, after), plan);
    assert.equal(r.ok, false, `${type} on a pyramid slot must be refused when it is all that was proposed`);
    const msg = r.errors.join(' ');
    assert.match(msg, /pyramid owns its sets, reps and progression/, type);
    // The repair round has to ask for something a review can express: no change type carries a
    // pyramid, so "return the pyramid" would be an instruction it cannot follow.
    assert.match(msg, /Leave this change out; to change that exercise, swap or remove it/, type);
    assert.match(msg, /exercise "0001" \(3\/4 sit-up\)/, 'the message names the exercise, not just the id');
    assert.doesNotMatch(msg, /revised plan/, type);
  }
});

test('a flat change on a pyramid slot is left out, and the rest of the review still stands', () => {
  // One stray field should not cost the person every other change the review found.
  const S = stateWith();
  S.routines[0].ex.push({ id: '0002', sets: 3, reps: 10, mode: 'reps' });
  const r = validateReview({
    coach_contract: 1, summary: 's',
    changes: [
      { id: 'c1', type: 'sets', target: { routineId: 'r1', exId: '0001' }, after: 6, why: 'The last set was missed twice.' },
      { id: 'c2', type: 'reps', target: { routineId: 'r1', exId: '0002' }, after: 12, why: 'Every set hit 10 at RIR 3.' }
    ]
  }, reviewPlan(S));
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  assert.deepEqual(r.proposal.changes.map(c => c.id), ['c2']);
});

test('a flat change on a pyramid slot still goes to repair when something else is wrong', () => {
  const r = validateReview({
    coach_contract: 1, summary: 's',
    changes: [
      { id: 'c1', type: 'sets', target: { routineId: 'r1', exId: '0001' }, after: 6, why: 'The last set was missed twice.' },
      { id: 'c2', type: 'reps', target: { routineId: 'r1', exId: 'nope' }, after: 12, why: 'Every set hit 10 at RIR 3.' }
    ]
  }, reviewPlan());
  assert.equal(r.ok, false);
  const msg = r.errors.join(' ');
  assert.match(msg, /pyramid owns its sets/, 'the pyramid refusal is reported with the rest');
  assert.match(msg, /"nope" is not in routine/);
});

test('the same changes still apply to a slot without a pyramid', () => {
  const plan = reviewPlan(flatState());
  for (const [type, after] of [['sets', 6], ['reps', 12], ['repsMin', 6], ['repsMax', 14], ['exercise-prog', 'linear'], ['inc', 2.5]]) {
    const r = validateReview(changeOn(type, after), plan);
    assert.equal(r.ok, true, `${type} on a flat slot must still be accepted: ${(r.errors || []).join(' ')}`);
  }
});

test('a swap on a pyramid slot carries the movement, not a flat pair', () => {
  const r = validateReview({
    coach_contract: 1, summary: 's',
    changes: [{
      id: 'c1', type: 'swap-exercise', target: { routineId: 'r1', exId: '0001' },
      after: { id: '0002', sets: 9, reps: 99 }, why: 'The rack is taken today.'
    }]
  }, reviewPlan());
  assert.equal(r.ok, true, (r.errors || []).join(' '));
  const after = r.proposal.changes[0].after;
  assert.equal(after.id, '0002');
  assert.equal('sets' in after, false, 'the pyramid already owns the set count');
  assert.equal('reps' in after, false, 'the pyramid already owns each set');
});

/* ---------------- the fingerprint ---------------- */

test('a pyramid moves the plan fingerprint, and its absence does not', () => {
  const plan = ex => payload.canonicalPlan({ routines: [{ id: 'r1', name: 'A', ex: [ex] }], week: { 1: 'r1' } });
  const h = ex => hashPlan(plan(ex));
  const base = { id: '0001', sets: 4, reps: 12, pyramid: [12, 10, 8, 'max'] };

  assert.equal(h(base), h({ ...base }), 'the same pyramid hashes the same');
  assert.notEqual(h(base), h({ ...base, pyramid: [12, 10, 8, 6] }), 'a changed target moves it');
  assert.notEqual(h(base), h({ ...base, pyramidRest: [0, 120, 0, 0] }), 'a changed rest moves it');
  assert.notEqual(h(base), h({ ...base, pyramidWeight: [40, 0, 0, 0] }), 'a changed load moves it');

  // Upgrade stability: a plan that never had a pyramid has to keep the fingerprint it had before
  // pyramids were hashed, or every pending proposal reads as stale the moment someone upgrades.
  const flat = { id: '0001', sets: 4, reps: 12 };
  assert.equal(h(flat), h({ ...flat, pyramid: [] }));
  assert.notEqual(h(flat), h(base));
});
