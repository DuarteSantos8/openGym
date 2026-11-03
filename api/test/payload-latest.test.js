import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, latestWindow } from '../coach/core/payload.js';

const HANDLE = 'h'.repeat(16);
// Twelve workouts, one a day, oldest first, all inside the 12-week window.
const day = i => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
const workouts = Array.from({ length: 12 }, (_, i) => ({ id: 'w' + i, d: day(i), name: 'Day', entries: [] }));
const stateWith = cadence => ({ workouts, coach: { consent: { agreedAt: 1 }, cadence, log: [], chat: [] } });
const reviewDates = S => build(S, { handle: HANDLE, kind: 'review' }).window.workouts.map(w => w.d);

test('latestWindow takes the newest N workouts and holds N to 1 to 10', () => {
  assert.deepEqual(latestWindow({ workouts }, 3).map(w => w.id), ['w9', 'w10', 'w11']);
  assert.equal(latestWindow({ workouts }, 0).length, 1);
  assert.equal(latestWindow({ workouts }, 50).length, 10);
});

test('with latestOnly on, a review reads only the latest N workouts', () => {
  assert.deepEqual(reviewDates(stateWith({ everyWorkouts: 3, latestOnly: true })), [day(9), day(10), day(11)]);
});

test('with latestOnly off, the review keeps its usual window', () => {
  assert.equal(reviewDates(stateWith({ everyWorkouts: 3 })).length, 12);
  assert.equal(reviewDates(stateWith({ everyWorkouts: 3, latestOnly: false })).length, 12);
});

test('latestOnly does nothing outside the every-N cadence', () => {
  assert.equal(reviewDates(stateWith({ weekly: { day: 0, time: '18:00' }, latestOnly: true })).length, 12);
});
