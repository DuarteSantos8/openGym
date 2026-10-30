import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDue } from '../coach/core/due.js';

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
