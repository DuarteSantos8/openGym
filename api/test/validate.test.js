/* The validator, on its own — no queue, no child process, no provider.
 *
 * This is the file that decides whether something a language model said is allowed to touch a
 * training plan, so the tests are written as the attacks and accidents it exists to stop: an
 * invented change type, an exercise id that resolves to nothing, a target in the wrong routine,
 * a plan that ignores what the user asked for.
 *
 * The closed list gets its own sweep at the bottom: every member of CHANGE_TYPES must have a
 * well-formed instance here, so adding a type without an apply implementation and a test is a
 * red build rather than a discovery.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { validatePlan, validateReview, CHANGE_TYPES } = await import('../coach/validate.js');

const PLAN = {
  routines: [{
    id: 'r1', name: 'Full body A',
    ex: [{ id: '0001', sets: 3, reps: 10 }, { id: '0007', sets: 3, sec: 45 }]
  }, {
    id: 'r2', name: 'Full body B', ex: [{ id: '0009', sets: 3, reps: 8 }]
  }, {
    // The v1.2.4 shapes, as cleanEx would hand them over: a unilateral exercise whose reps are
    // the total across both sides, and a bodyweight one with a rep ceiling.
    id: 'r3', name: 'Legs',
    ex: [
      { id: '0043', sets: 3, reps: 16, side: true },
      { id: '0001', sets: 3, reps: 12, repsMin: 8, repsMax: 20, bodyweight: true }
    ]
  }],
  week: { 1: 'r1', 3: 'r2' }
};
const change = over => ({ id: 'c1', type: 'sets', target: { routineId: 'r1', exId: '0001' }, before: 3, after: 4, why: 'stalled twice', ...over });
const review = changes => validateReview({ coach_contract: 1, summary: 's', changes }, PLAN);

/* ---------------- created plans ---------------- */

test('a plan referencing an unknown exercise is rejected, not quietly trimmed', () => {
  const r = validatePlan({
    routines: [{ name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }, { id: 'not-a-real-id', sets: 3, reps: 10 }] }]
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('not-a-real-id')));
});

test('a plan may reference a custom exercise it defines in the same answer', () => {
  const r = validatePlan({
    routines: [{ name: 'A', ex: [{ id: 'cx1', sets: 3, reps: 10 }] }],
    customEx: [{ id: 'cx1', n: 'Sandbag carry', bp: 'back' }]
  });
  assert.equal(r.ok, true);
  assert.equal(r.bundle.customEx[0].n, 'Sandbag carry');
});

test('the week may only point at routines the plan actually defines', () => {
  const r = validatePlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { 1: 'ghost' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('ghost')));
});

test('proposed baselines are capped at what the lifter has actually handled', () => {
  const r = validatePlan(
    { routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10, weight: 100 }] }] },
    { workingWeights: [{ id: '0001', best: 40 }] }
  );
  assert.equal(r.ok, true);
  assert.equal(r.bundle.routines[0].ex[0].weight, 40, 'optimism is clamped to evidence');
});

test('a plan that ignores the requested number of training days is rejected', () => {
  const r = validatePlan(
    { routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1' } },
    { daysPerWeek: 3 }
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('4 days') && e.includes('3')));
});

test('an unknown progression policy is rejected', () => {
  const r = validatePlan({ routines: [{ name: 'A', prog: 'vibes', ex: [{ id: '0001', sets: 3, reps: 10 }] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('vibes')));
});

/* ---------------- the two v1.2.4 flags ---------------- */

test('a created plan carries the rep ceiling and the two flags through unchanged', () => {
  const r = validatePlan({
    routines: [{
      id: 'r1', name: 'A', ex: [
        { id: '0001', sets: 3, reps: 12, repsMin: 8, repsMax: 20, bodyweight: true },
        { id: '0043', sets: 3, reps: 16, side: true }
      ]
    }]
  });
  assert.equal(r.ok, true);
  const [bw, side] = r.bundle.routines[0].ex;
  assert.equal(bw.repsMax, 20, 'without the ceiling the Coach cannot say how a push-up progresses');
  assert.equal(bw.bodyweight, true);
  assert.equal(side.side, true);
  assert.equal(bw.side, undefined, 'a flag nobody set stays absent, so the catalogue still decides');
});

test('unilateral reps are a total across both sides, so an odd one is refused', () => {
  const odd = validatePlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0043', sets: 3, reps: 15, side: true }] }] });
  assert.equal(odd.ok, false);
  assert.ok(odd.errors.some(e => e.includes('even')));
  // The same number is perfectly fine on an exercise that is not per-side.
  assert.equal(validatePlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0043', sets: 3, reps: 15 }] }] }).ok, true);
});

test('a rep ceiling below its own floor is refused at both ends', () => {
  const created = validatePlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10, repsMin: 12, repsMax: 8 }] }] });
  assert.equal(created.ok, false);
  assert.ok(created.errors.some(e => e.includes('repsMax')));
  // …and on review, checked against the floor the plan already has (r3's second exercise: 8).
  const tgt = { routineId: 'r3', exId: '0001' };
  assert.equal(review([change({ type: 'repsMax', target: tgt, after: 6 })]).ok, false);
  assert.equal(review([change({ type: 'repsMax', target: tgt, after: 25 })]).ok, true);
});

test('a review cannot prescribe an odd total on a per-side exercise', () => {
  const tgt = { routineId: 'r3', exId: '0043' };
  assert.equal(review([change({ type: 'reps', target: tgt, after: 17 })]).ok, false);
  assert.equal(review([change({ type: 'reps', target: tgt, after: 18 })]).ok, true);
  // The rule follows the plan, not the change: the same value on r1's 0001 is fine.
  assert.equal(review([change({ type: 'reps', after: 17 })]).ok, true);
});

/* ---------------- review change-sets ---------------- */

test('an invented change type does nothing at all', () => {
  const r = review([change({ type: 'delete-all-workouts' })]);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('not allowed'));
  assert.ok(!CHANGE_TYPES.includes('delete-all-workouts'));
});

test('every change must target something that exists', () => {
  assert.equal(review([change({ target: { routineId: 'ghost', exId: '0001' } })]).ok, false);
  assert.equal(review([change({ target: { routineId: 'r1', exId: '9999' } })]).ok, false, 'exercise not in that routine');
  assert.equal(review([change({ target: { routineId: 'r2', exId: '0001' } })]).ok, false, 'right exercise, wrong routine');
});

test('a change without a rationale is rejected', () => {
  const r = review([change({ why: '' })]);
  assert.equal(r.ok, false);
  assert.ok(r.errors[0].includes('why'));
});

test('values are type-checked per change type', () => {
  assert.equal(review([change({ type: 'sets', after: 'four' })]).ok, false);
  assert.equal(review([change({ type: 'sets', after: 99 })]).ok, false);
  assert.equal(review([change({ type: 'reps', after: 0 })]).ok, false);
  assert.equal(review([change({ type: 'exercise-prog', after: 'linear' })]).ok, true);
  assert.equal(review([change({ type: 'exercise-prog', after: 'vibes' })]).ok, false);
  assert.equal(review([change({ type: 'inc', after: -5 })]).ok, false);
});

test('adding an exercise requires a real library id', () => {
  const ok = review([change({ type: 'add-exercise', target: { routineId: 'r1' }, after: { id: '0009', sets: 3, reps: 12 } })]);
  assert.equal(ok.ok, true);
  assert.equal(ok.proposal.changes[0].after.name, 'assisted chest dip (kneeling)');
  assert.equal(review([change({ type: 'add-exercise', target: { routineId: 'r1' }, after: { id: 'made-up' } })]).ok, false);
});

test('an added exercise may declare itself bodyweight, per-side and capped', () => {
  const r = review([change({
    type: 'add-exercise', target: { routineId: 'r1' },
    after: { id: '0043', sets: 3, reps: 16, side: true, bodyweight: true, repsMin: 10, repsMax: 24 }
  })]);
  assert.equal(r.ok, true);
  assert.deepEqual(
    (({ side, bodyweight, repsMin, repsMax }) => ({ side, bodyweight, repsMin, repsMax }))(r.proposal.changes[0].after),
    { side: true, bodyweight: true, repsMin: 10, repsMax: 24 }
  );
  // And the parity rule applies to what it declares about itself.
  assert.equal(review([change({
    type: 'add-exercise', target: { routineId: 'r1' }, after: { id: '0043', sets: 3, reps: 15, side: true }
  })]).ok, false);
});

test('a reorder must be a permutation of what is already there', () => {
  assert.equal(review([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0007', '0001'] })]).ok, true);
  assert.equal(review([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0007'] })]).ok, false, 'dropping one is not a reorder');
  assert.equal(review([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0007', '0009'] })]).ok, false, 'nor is smuggling one in');
  // The one that satisfies both a length check and a membership check while still deleting an
  // exercise — and reorder is the change type the review screen shows no diff for.
  assert.equal(review([change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0001', '0001'] })]).ok, false, 'naming one twice drops the other');
});

test('a superset needs a partner that is not itself', () => {
  assert.equal(review([change({ type: 'superset', after: { link: true, with: '0007' } })]).ok, true);
  assert.equal(review([change({ type: 'superset', after: { link: true, with: '0001' } })]).ok, false, 'the anchor cannot be its own partner');
  assert.equal(review([change({ type: 'superset', after: { link: false } })]).ok, true, 'unlinking needs no partner');
});

test('a new routine is refused whole when it names an exercise nobody has', () => {
  const withEx = ex => review([change({ type: 'add-routine', target: {}, after: { name: 'C', ex } })]);
  assert.equal(withEx([{ id: '0001', sets: 3, reps: 10 }]).ok, true);
  // Not trimmed to the exercises that did resolve: that would hand someone a routine they were
  // never shown, under the summary of the one they were.
  const r = withEx([{ id: '0001', sets: 3, reps: 10 }, { id: 'not-a-real-exercise', sets: 3, reps: 10 }]);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /not-a-real-exercise/, 'and the repair round is told which one');
});

test('before is read off the plan, never taken from the answer', () => {
  // Unchecked in every other respect: the model can say anything here, and whatever it says
  // reaches the synced Coach log and the staleness check that decides what stays applicable.
  const huge = { junk: 'x'.repeat(100000) };
  const r = review([change({ type: 'sets', before: huge, after: 4 })]);
  assert.equal(r.ok, true);
  assert.equal(r.proposal.changes[0].before, 3, 'the plan says 3 sets, so before is 3');

  // A merely mistyped before is the same bug wearing a smaller hat: it survives validation and
  // then silently disables the change, because markStale compares it against a number.
  const typed = review([change({ type: 'sets', before: '3 sets', after: 4 })]);
  assert.equal(typed.proposal.changes[0].before, 3);

  // Structural changes have no scalar to compare; null is what the client reads as "skip".
  const structural = review([change({ type: 'reorder', target: { routineId: 'r1' }, before: 'anything', after: ['0007', '0001'] })]);
  assert.equal(structural.proposal.changes[0].before, null);

  // And a field the plan does not carry reads as absent rather than as the model's guess.
  const absent = review([change({ type: 'inc', before: 2.5, after: 5 })]);
  assert.equal(absent.proposal.changes[0].before, null);
});

test('a week change may only schedule a routine that exists, rest, or nothing', () => {
  assert.equal(review([change({ type: 'week', target: { weekday: 6 }, after: 'r2' })]).ok, true);
  assert.equal(review([change({ type: 'week', target: { weekday: 6 }, after: 'rest' })]).ok, true);
  assert.equal(review([change({ type: 'week', target: { weekday: 6 }, after: null })]).ok, true);
  assert.equal(review([change({ type: 'week', target: { weekday: 9 }, after: 'r1' })]).ok, false);
  assert.equal(review([change({ type: 'week', target: { weekday: 6 }, after: 'ghost' })]).ok, false);
});

test('"nothing to change" is a first-class answer, and so is an empty change list', () => {
  const a = validateReview({ nochange: true, reading: 'Plan is working.' }, PLAN);
  assert.equal(a.nochange, true);
  assert.equal(a.reading, 'Plan is working.');
  const b = review([]);
  assert.equal(b.nochange, true, 'no changes and "no changes" are the same outcome');
});

test('advice-only notes survive but carry no change', () => {
  const r = validateReview({ summary: 's', changes: [change()], notes: ['Body weight is flat — eat more.'] }, PLAN);
  assert.equal(r.proposal.notes.length, 1);
  assert.equal(r.proposal.changes.length, 1);
});

test('one bad change fails the whole set — nothing is ever half-applied', () => {
  const r = review([change(), change({ id: 'c2', type: 'not-a-type' })]);
  assert.equal(r.ok, false);
});

test('every allowed change type has a validator that accepts a well-formed instance', () => {
  const good = {
    'add-exercise': change({ type: 'add-exercise', target: { routineId: 'r1' }, after: { id: '0009', sets: 3, reps: 10 } }),
    'remove-exercise': change({ type: 'remove-exercise' }),
    'swap-exercise': change({ type: 'swap-exercise', after: { id: '0009' } }),
    sets: change({ type: 'sets', after: 4 }),
    reps: change({ type: 'reps', after: 12 }),
    repsMin: change({ type: 'repsMin', after: 8 }),
    repsMax: change({ type: 'repsMax', after: 20 }),
    sec: change({ type: 'sec', target: { routineId: 'r1', exId: '0007' }, after: 60 }),
    cardio: change({ type: 'cardio', after: { min: 25, speed: 9 } }),
    reorder: change({ type: 'reorder', target: { routineId: 'r1' }, after: ['0007', '0001'] }),
    superset: change({ type: 'superset', after: { link: true, with: '0007' } }),
    'routine-prog': change({ type: 'routine-prog', target: { routineId: 'r1' }, after: 'double' }),
    'exercise-prog': change({ type: 'exercise-prog', after: 'greyskull' }),
    inc: change({ type: 'inc', after: 2.5 }),
    'add-routine': change({ type: 'add-routine', target: {}, after: { name: 'C', ex: [{ id: '0001', sets: 3, reps: 10 }] } }),
    'remove-routine': change({ type: 'remove-routine', target: { routineId: 'r2' } }),
    'rename-routine': change({ type: 'rename-routine', target: { routineId: 'r1' }, after: 'Upper' }),
    week: change({ type: 'week', target: { weekday: 2 }, after: 'r1' })
  };
  for (const type of CHANGE_TYPES) {
    assert.ok(good[type], `no fixture for change type "${type}" — add one`);
    const r = review([good[type]]);
    assert.equal(r.ok, true, `${type} should validate: ${JSON.stringify(r.errors)}`);
  }
});

test('a cardio change may be prescribed by distance, not just by a speed dial', () => {
  const tgt = { routineId: 'r1', exId: '0007' };   // any exercise in the plan
  // Distance alone is a complete prescription: that is how a run or a row is actually set.
  const byDist = review([change({ type: 'cardio', target: tgt, after: { dist: 5000 } })]);
  assert.equal(byDist.ok, true);
  assert.equal(byDist.proposal.changes[0].after.dist, 5000);

  // The old shapes keep working, unchanged.
  assert.equal(review([change({ type: 'cardio', target: tgt, after: { min: 30 } })]).ok, true);
  assert.equal(review([change({ type: 'cardio', target: tgt, after: { min: 25, speed: 9 } })]).ok, true);

  // Bounds: metres, capped well past any real session, so a unit slip is caught here.
  assert.equal(review([change({ type: 'cardio', target: tgt, after: { dist: 0 } })]).ok, false);
  assert.equal(review([change({ type: 'cardio', target: tgt, after: { dist: 500000 } })]).ok, false);
  assert.equal(review([change({ type: 'cardio', target: tgt, after: {} })]).ok, false);
});

test('the first-party endurance exercises are in the library the validator checks against', () => {
  // The vendored dataset has no rowing machine and nothing for running outdoors; these are
  // openGym's own rows, and a proposal naming one has to resolve like any other exercise.
  for (const id of ['og-run-outdoor', 'og-rower', 'og-treadmill-run', 'og-elliptical-run']) {
    const r = review([change({
      type: 'add-exercise', target: { routineId: 'r1' },
      after: { id, sets: 1, mode: 'cardio' }
    })]);
    assert.equal(r.ok, true, `${id} should resolve: ${JSON.stringify(r.errors)}`);
  }
});
