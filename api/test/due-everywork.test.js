import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDue, scheduledRun } from '../coach/core/due.js';

// Workouts with no `end` fall back to their day, and a zero reviewedAt means all of them are new.
const workouts = n => Array.from({ length: n }, (_, i) => ({ d: '2026-10-01', id: i }));
const coach = everyWorkouts => ({ cadence: { everyWorkouts } });

test('every N workouts is due once N new workouts exist', () => {
  assert.equal(isDue(coach(3), { workouts: workouts(2) }, null, 0), false);
  assert.equal(isDue(coach(3), { workouts: workouts(3) }, null, 0), true);
});

test('a count above 10 is held to 10, so 10 workouts are enough', () => {
  assert.equal(isDue(coach(50), { workouts: workouts(9) }, null, 0), false);
  assert.equal(isDue(coach(50), { workouts: workouts(10) }, null, 0), true);
});

test('a count of 1 is due on the first new workout', () => {
  assert.equal(isDue(coach(1), { workouts: workouts(1) }, null, 0), true);
});

test('every 1 with latest-only on runs a debrief of the newest workout', () => {
  const S = { workouts: workouts(3), coach: { cadence: { everyWorkouts: 1, latestOnly: true } } };
  assert.deepEqual(scheduledRun(S), { kind: 'debrief', workoutId: S.workouts[2].id });
});

test('anything else runs a review', () => {
  const w = workouts(3);
  assert.equal(scheduledRun({ workouts: w, coach: { cadence: { everyWorkouts: 1 } } }).kind, 'review');
  assert.equal(scheduledRun({ workouts: w, coach: { cadence: { everyWorkouts: 2, latestOnly: true } } }).kind, 'review');
  assert.equal(scheduledRun({ workouts: [], coach: { cadence: { everyWorkouts: 1, latestOnly: true } } }).kind, 'review');
});
