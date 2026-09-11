// Floating coach week — effectiveRoutineId() queue rule, used by the day-reminder tick in
// server.js. Pure function, no server needed: the tick only calls this one export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRoutineId } from '../queue.js';

const routines = [
  { id: 'r1', name: 'Push' },
  { id: 'r2', name: 'Pull' },
  { id: 'r3', name: 'Legs' },
];
const base = { routines, dayPlan: {}, week: {}, workouts: [] };

test('no queue: unchanged weekday/override behaviour', () => {
  const S = { ...base, week: { 1: 'r1' }, dayPlan: { '2026-09-09': 'rest', '2026-09-10': 'r2' } };
  assert.equal(effectiveRoutineId(S, '2026-09-07'), 'r1'); // Monday -> week[1]
  assert.equal(effectiveRoutineId(S, '2026-09-09'), null); // rest override
  assert.equal(effectiveRoutineId(S, '2026-09-10'), 'r2'); // routine override
  assert.equal(effectiveRoutineId(S, '2026-09-08'), null); // Tuesday, nothing planned
});

test('queue: returns the first not-done session once startsOn is reached', () => {
  const S = { ...base, queue: { ids: ['r1', 'r2', 'r3'], since: 1000, startsOn: '2026-09-07', label: 'W1' } };
  assert.equal(effectiveRoutineId(S, '2026-09-07'), 'r1');
  assert.equal(effectiveRoutineId(S, '2026-09-08'), 'r1'); // still first undone, any later day
});

test('queue: waiting for startsOn falls back to the weekday answer', () => {
  const S = {
    ...base,
    week: { 6: 'r3' }, // Saturday
    queue: { ids: ['r1', 'r2'], since: 1000, startsOn: '2026-09-14', label: 'W2' },
  };
  // 2026-09-12 is a Saturday, still before the Monday startsOn: the queue has nothing to say
  // yet, so the plain weekday assignment for that day shows through instead of going quiet.
  assert.equal(effectiveRoutineId(S, '2026-09-12'), 'r3');
  assert.equal(effectiveRoutineId(S, '2026-09-11'), null); // Friday, no weekday plan either
});

test('queue: a session is done once a finished workout on it landed at/after since', () => {
  const S = {
    ...base,
    queue: { ids: ['r1', 'r2', 'r3'], since: 1000, startsOn: '2026-09-07', label: 'W1' },
    workouts: [{ d: '2026-09-07', start: 2000, routineIds: ['r1'], name: 'Push' }],
  };
  assert.equal(effectiveRoutineId(S, '2026-09-08'), 'r2'); // r1 done, r2 is next
});

test('queue: a workout logged before "since" counts only when it is dated inside the week and its name still matches', () => {
  const S = {
    ...base,
    queue: { ids: ['r1', 'r2'], since: 5000, startsOn: '2026-09-07', label: 'W1' },
    workouts: [{ d: '2026-09-07', start: 1000, routineId: 'r1', name: 'Push' }], // early clock, dated in the week, name matches -> done
  };
  assert.equal(effectiveRoutineId(S, '2026-09-07'), 'r2');
  const S0 = {
    ...base,
    queue: { ids: ['r1', 'r2'], since: 5000, startsOn: '2026-09-07', label: 'W1' },
    workouts: [{ d: '2026-09-02', start: 1000, routineId: 'r1', name: 'Push' }], // a past week's session with the same name -> not done
  };
  assert.equal(effectiveRoutineId(S0, '2026-09-07'), 'r1');

  const S2 = {
    ...base,
    queue: { ids: ['r1', 'r2'], since: 5000, startsOn: '2026-09-07', label: 'W1' },
    workouts: [{ d: '2026-09-06', start: 1000, routineId: 'r1', name: 'Old Push Name' }], // before since, name stale -> not done
  };
  assert.equal(effectiveRoutineId(S2, '2026-09-07'), 'r1');
});

test('queue: keeps slot order even when a later session is logged out of order', () => {
  const S = {
    ...base,
    queue: { ids: ['r1', 'r2', 'r3'], since: 1000, startsOn: '2026-09-07', label: 'W1' },
    workouts: [{ d: '2026-09-07', start: 2000, routineIds: ['r2'], name: 'Pull' }],
  };
  assert.equal(effectiveRoutineId(S, '2026-09-08'), 'r1'); // r2 done out of order, r1 is still first undone
});

test('queue: complete week falls back to the weekday answer', () => {
  const S = {
    ...base,
    week: { 1: 'r3' },
    queue: { ids: ['r1', 'r2'], since: 1000, startsOn: '2026-09-07', label: 'W1' },
    workouts: [
      { d: '2026-09-07', start: 2000, routineIds: ['r1'], name: 'Push' },
      { d: '2026-09-08', start: 3000, routineIds: ['r2'], name: 'Pull' },
    ],
  };
  assert.equal(effectiveRoutineId(S, '2026-09-14'), 'r3'); // Monday, week complete -> weekday plan shows through
});

test('queue: per-date overrides still win over the queue', () => {
  const S = {
    ...base,
    dayPlan: { '2026-09-07': 'rest' },
    queue: { ids: ['r1', 'r2'], since: 1000, startsOn: '2026-09-07', label: 'W1' },
  };
  assert.equal(effectiveRoutineId(S, '2026-09-07'), null);
});

test('queue: a session whose routine was deleted is dropped; a missing startsOn means active now', () => {
  const S = { ...base, queue: { ids: ['gone', 'r1', 'r2'], since: 1000, startsOn: '2026-09-07', label: 'W1' } };
  assert.equal(effectiveRoutineId(S, '2026-09-08'), 'r1');
  const noStart = { ...base, queue: { ids: ['r2'], since: 1000, label: 'W1' } };
  assert.equal(effectiveRoutineId(noStart, '2026-09-08'), 'r2');
  const bad = { ...base, week: { 2: 'r3' }, queue: { ids: 'r1' } };
  assert.equal(effectiveRoutineId(bad, '2026-09-08'), 'r3');   // Tuesday: a malformed queue reads as none
});
