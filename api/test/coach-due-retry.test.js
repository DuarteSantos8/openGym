// B9 (Discord "Scheduled coach review doesn't trigger", idea from #983): a scheduled review that
// failed for a reason no retry fixes was queued again every minute, spent the day's cap and never
// reached the provider. It now settles the round; a passing failure waits a quarter of an hour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewedAtOf, retryWaiting, RETRY_AFTER_MS } from '../coach/core/due.js';

const rev = (outcome, at, extra = {}) => ({ kind: 'review', trigger: 'scheduled', outcome, at, ...extra });

test('a failure no retry fixes counts as the last review', () => {
  assert.equal(reviewedAtOf([rev('ready', 100), rev('failed', 200, { errorClass: 'auth' })]), 200);
  assert.equal(reviewedAtOf([rev('failed', 300, { errorClass: 'missing' })]), 300);
  assert.equal(reviewedAtOf([rev('failed', 300, { errorClass: 'unusable' })]), 300);
});

test('a passing failure does not, and other kinds never do', () => {
  assert.equal(reviewedAtOf([rev('nochange', 100), rev('failed', 200, { errorClass: 'timeout' })]), 100);
  assert.equal(reviewedAtOf([{ kind: 'debrief', outcome: 'ready', at: 500 }]), 0);
});

test('after a passing failure the schedule waits before it tries again', () => {
  const now = 10_000_000;
  const h = [rev('failed', now - 60000, { errorClass: 'unreachable' })];
  assert.equal(retryWaiting(h, now), true);
  assert.equal(retryWaiting(h, now + RETRY_AFTER_MS), false);
  assert.equal(retryWaiting([rev('failed', now - 60000, { errorClass: 'auth' })], now), false);
  assert.equal(retryWaiting([{ ...rev('failed', now - 60000, { errorClass: 'timeout' }), trigger: 'manual' }], now), false);
});
