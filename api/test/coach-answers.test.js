import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReview, numbersOf } from '../coach/core/validate.js';

// The review's first try must answer every plan check and copy its numbers (COACH_EVIDENCE.md).
const plan = { routines: [{ id: 'up', name: 'Upper', ex: [{ id: '0025', sets: 6, reps: 8 }] }] };
const checks = [{ id: 'sets-per-exercise:up:0025', tag: 'sets-per-exercise', routine: 'up', exercise: '0025', sets: 6, cap: 4 }];
const cut = (why, ref = 'sets-per-exercise:up:0025') => ({ type: 'sets', target: { routineId: 'up', exId: '0025' }, after: 4, why, ref });
const strict = { checks, answerChecks: true, numbers: numbersOf({ records: [{ trendPct: 16.7, best: 88.7 }], adherence: { sessionsInWindow: 32 } }) };

test('a check nobody answered sends the review back once', () => {
  const r = validateReview({ summary: 'Fine.', changes: [], nochange: true, reading: 'All good.' }, plan, strict);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /the sets-per-exercise checks \("sets-per-exercise:up:0025"\) have no answer/);
  // The repair round takes it as it is.
  assert.equal(validateReview({ nochange: true, reading: 'All good.' }, plan, { ...strict, answerChecks: false }).ok, true);
});

test('one answer per kind: a change citing one check of it, its tag, or a kept reason', () => {
  const two = [...checks, { id: 'volume-low:lats', tag: 'volume', muscle: 'lats', sets: 2, low: 10, high: 20 }, { id: 'volume-low:calves', tag: 'volume', muscle: 'calves', sets: 0, low: 8, high: 16 }];
  const add = { type: 'sets', target: { routineId: 'up', exId: '0025' }, after: 4, why: 'Back to 4.', ref: 'sets-per-exercise' };
  const r = validateReview({ summary: 'S.', changes: [add], kept: [{ ref: 'volume-low:lats', why: 'Their back day starts next month.' }] }, plan, { ...strict, checks: two });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.proposal.notes, ['Their back day starts next month.']);
  const missing = validateReview({ summary: 'S.', changes: [add] }, plan, { ...strict, checks: two });
  assert.match(missing.errors.join(), /the volume checks \("volume-low:lats", "volume-low:calves"\) have no answer/);
});

test('a change citing the check, or a kept reason, answers it', () => {
  assert.equal(validateReview({ summary: 'One change.', changes: [cut('Six sets on one lift is past the cap.')] }, plan, strict).ok, true);
  const kept = validateReview({ nochange: true, reading: 'Steady.', kept: [{ ref: 'sets-per-exercise:up:0025', why: 'They asked to keep the bench as it is.' }] }, plan, strict);
  assert.equal(kept.ok, true);
  assert.equal(kept.reading, 'Steady. They asked to keep the bench as it is.');
  const withChange = validateReview({ summary: 'S.', changes: [cut('Back to 4.')], kept: [{ ref: 'nope', why: 'x' }] }, plan, strict);
  assert.deepEqual(withChange.proposal.notes, []);
});

test('a number the data does not hold is sent back; copied ones, dates and small counts pass', () => {
  const bad = validateReview({ summary: 'Bench is up about 17% in roughly 25 minutes.', changes: [cut('Cut it.')] }, plan, strict);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(), /numbers not in the data: 17, 25/);
  const good = validateReview({ summary: 'Across 32 sessions from 2026-09-21, bench is up 16.7% to 88.7 kg.', changes: [cut('Six sets is past 4; drop 2.')] }, plan, strict);
  assert.equal(good.ok, true, JSON.stringify(good.errors));
});

test('without answerChecks nothing changes (the ask job and old callers)', () => {
  assert.equal(validateReview({ nochange: true, reading: 'Up 99%.' }, plan, { checks }).ok, true);
});
