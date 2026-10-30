import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewedAtOf } from '../coach/cadence.js';

const run = (outcome, errorClass, at) => ({ kind: 'review', outcome, errorClass, at });

test('a review the model answered counts as the last review', () => {
  assert.equal(reviewedAtOf([run('ready', null, 100)]), 100);
  assert.equal(reviewedAtOf([run('nochange', null, 200)]), 200);
  assert.equal(reviewedAtOf([run('failed', 'unusable', 300)]), 300);
});

test('a provider failure that a retry will not fix counts as the last review', () => {
  for (const errorClass of ['auth', 'provider', 'missing', 'unprivileged']) {
    assert.equal(reviewedAtOf([run('failed', errorClass, 400)]), 400, errorClass);
  }
});

test('timeouts and state problems are retried, so they do not count', () => {
  for (const errorClass of ['timeout', 'consent', 'off', 'nostate', 'forgotten']) {
    assert.equal(reviewedAtOf([run('failed', errorClass, 500)]), 0, errorClass);
  }
});

test('a scheduled debrief counts as the last review, a manual one does not', () => {
  const sched = { kind: 'debrief', trigger: 'scheduled', outcome: 'ready', at: 700 };
  const manual = { kind: 'debrief', trigger: 'manual', outcome: 'ready', at: 800 };
  assert.equal(reviewedAtOf([sched]), 700);
  assert.equal(reviewedAtOf([sched, manual]), 700);
});

test('the newest counting review wins, and debriefs or asks are ignored', () => {
  const history = [
    run('ready', null, 100),
    run('failed', 'provider', 300),
    run('failed', 'timeout', 400),
    { kind: 'debrief', outcome: 'ready', at: 900 },
    { kind: 'ask', outcome: 'ready', at: 950 }
  ];
  assert.equal(reviewedAtOf(history), 300);
  assert.equal(reviewedAtOf([]), 0);
  assert.equal(reviewedAtOf(undefined), 0);
});
