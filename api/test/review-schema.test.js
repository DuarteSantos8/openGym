import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { CONTRACT } from '../coach/core/payload.js';
import { REVIEW_SCHEMA, SCHEMAS } from '../coach/core/schemas.js';

const accepts = new Ajv({ strict: false }).compile(REVIEW_SCHEMA);

test('every generated answer schema requires the current Coach contract version', () => {
  for (const task of ['review', 'create', 'refine', 'debrief']) {
    assert.deepEqual(SCHEMAS[task].properties.coach_contract, { const: CONTRACT }, task);
    assert.ok(SCHEMAS[task].required.includes('coach_contract'), task);
  }
});

test('the review schema rejects the two unusable answers seen on the phone', () => {
  const missingExercise = {
    coach_contract: 1,
    changes: [{
      type: 'remove-exercise',
      target: { routineId: 'r1' },
      after: null,
      why: 'The exercise no longer fits the plan.'
    }]
  };

  assert.equal(accepts(missingExercise), false);
  assert.equal(accepts({ coach_contract: 1 }), false);
});

test('the review schema accepts complete change and no-change answers', () => {
  const removeExercise = {
    coach_contract: 1,
    changes: [{
      type: 'remove-exercise',
      target: { routineId: 'r1', exId: '0001' },
      after: null,
      why: 'The exercise no longer fits the plan.'
    }]
  };
  const noChange = {
    coach_contract: 1,
    nochange: true,
    reading: 'The plan is working as written.',
    changes: []
  };

  assert.equal(accepts(removeExercise), true, JSON.stringify(accepts.errors));
  assert.equal(accepts(noChange), true, JSON.stringify(accepts.errors));
});
