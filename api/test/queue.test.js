// Floating coach week — effectiveRoutineId() queue rule, used by the day-reminder tick in
// server.js. Pure function, no server needed: the tick only calls this one export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRoutineId, pinState } from '../queue.js';

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

// ---- pins: a per-date override naming a queue session re-dates it (pinState) ----
// Mirrors the "pins —" block in frontend/src/lib/queue.test.js and the pin cases in
// lib/history.test.js. Here `today` is always the date asked about (the reminder tick).

const own = { id: 'own', name: 'Core' };
const W1 = { ids: ['r1', 'r2', 'r3'], since: 1000, startsOn: '2026-09-07', label: 'W1' };
const P = (over = {}) => ({ ...base, routines: [...routines, own], queue: W1, ...over });
const done = (id, d = '2026-09-08') => ({ d, start: 2000, routineIds: [id], name: routines.find(r => r.id === id).name });
const TODAY = '2026-09-09'; // Wednesday
const FRI = '2026-09-11';

test('pins: a session pinned to another day is skipped by the floating rule, and is that day\'s session when it comes', () => {
  const S = P({ dayPlan: { [FRI]: 'r1' } });
  assert.equal(effectiveRoutineId(S, TODAY), 'r2'); // r1 is Friday's, today floats past it
  assert.equal(effectiveRoutineId(S, FRI), 'r1');   // on its day, ahead of the floating order
  assert.equal(pinState(S, 'r1'), 'open');
});

test('pins: a session pinned to the day asked about wins over the floating order', () => {
  assert.equal(effectiveRoutineId(P({ dayPlan: { [TODAY]: 'r3' } }), TODAY), 'r3');
  // A pin on a day the weekday model also fills: the pin still answers first (a single id here).
  assert.equal(effectiveRoutineId(P({ dayPlan: { [TODAY]: 'r3' }, week: { 3: 'own' } }), TODAY), 'r3');
});

test('pins: a pin on a past day is stale — the session floats again', () => {
  const S = P({ dayPlan: { '2026-09-08': 'r1' } });
  assert.equal(effectiveRoutineId(S, TODAY), 'r1'); // Tuesday's pin was never met, r1 is first undone again
});

test('pins: a fulfilled pin reads as no override, so the day falls through to the next floating session or the weekday', () => {
  const S = P({ dayPlan: { [FRI]: 'r1' }, workouts: [done('r1')], week: { 5: 'own' } });
  assert.equal(pinState(S, 'r1'), 'done');
  assert.equal(effectiveRoutineId(S, FRI), 'r2');   // not r1 (done), not own (queue still live) -> next floating
  assert.equal(effectiveRoutineId(S, TODAY), 'r2');
  // Done early on the pinned day itself: today's answer is the next floating session.
  assert.equal(effectiveRoutineId(P({ dayPlan: { [TODAY]: 'r1' }, workouts: [done('r1')] }), TODAY), 'r2');
  // Week complete with a fulfilled pin on the day: the weekday plan shows through, not the pinned id.
  const complete = P({
    queue: { ...W1, ids: ['r1', 'r2'] },
    dayPlan: { [FRI]: 'r1' },
    workouts: [done('r1'), done('r2')],
    week: { 5: 'own' },
  });
  assert.equal(effectiveRoutineId(complete, FRI), 'own');
  assert.equal(effectiveRoutineId(P({ queue: { ...W1, ids: ['r1'] }, dayPlan: { [FRI]: 'r1' }, workouts: [done('r1')] }), FRI), null);
});

test('pins: every remaining session pinned to other days — nothing floats, the weekday plan (or nothing) shows through', () => {
  const pins = { [FRI]: 'r1', '2026-09-12': 'r2', '2026-09-13': 'r3' };
  assert.equal(effectiveRoutineId(P({ dayPlan: pins }), TODAY), null);
  assert.equal(effectiveRoutineId(P({ dayPlan: pins, week: { 3: 'own' } }), TODAY), 'own');
  // Each pinned day still answers with its own session.
  assert.equal(effectiveRoutineId(P({ dayPlan: pins }), '2026-09-12'), 'r2');
});

test('pins: \'rest\' still wins over a pin, and a plain routine override is still single-pick', () => {
  assert.equal(effectiveRoutineId(P({ dayPlan: { [TODAY]: 'rest', [FRI]: 'r1' } }), TODAY), null);
  assert.equal(effectiveRoutineId(P({ dayPlan: { [TODAY]: 'own' } }), TODAY), 'own');
});

test('pins: a pin dated before a future startsOn is honoured on its day; once the start day arrives the unmet pin is past, so the session floats', () => {
  const S = P({ queue: { ...W1, startsOn: '2026-09-14' }, dayPlan: { '2026-09-12': 'r1' } });
  assert.equal(effectiveRoutineId(S, '2026-09-12'), 'r1');
  assert.equal(effectiveRoutineId(S, TODAY), null); // before startsOn, the queue has nothing to say
  // The reminder asks on the day itself (`today === iso`): a 09-12 pin is stale by 09-14, r1 floats.
  assert.equal(effectiveRoutineId(S, '2026-09-14'), 'r1');
});

test('pinState: open for a session still to do, done once logged, null for anything else', () => {
  assert.equal(pinState(P(), 'r2'), 'open');
  assert.equal(pinState(P({ workouts: [done('r2')] }), 'r2'), 'done');
  assert.equal(pinState(P(), 'own'), null);       // a routine override, not a queue session
  assert.equal(pinState(P(), 'rest'), null);
  assert.equal(pinState(P(), undefined), null);
  assert.equal(pinState(P({ queue: null }), 'r1'), null);
  assert.equal(pinState(P({ queue: undefined }), 'r1'), null);
  assert.equal(pinState(P({ queue: { ids: 'r1' } }), 'r1'), null); // malformed queue reads as none
  // A pinned session whose routine was deleted is not a pin any more; the override falls through.
  const gone = P({ routines: [routines[1], routines[2], own], dayPlan: { [TODAY]: 'r1' } });
  assert.equal(pinState(gone, 'r1'), null);
  assert.equal(effectiveRoutineId(gone, TODAY), 'r2');
});

test('pins: no queue — a dayPlan entry is the plain override it always was', () => {
  const S = { ...base, routines: [...routines, own], week: { 3: 'own' }, dayPlan: { [TODAY]: 'r1', [FRI]: 'rest' } };
  assert.equal(pinState(S, 'r1'), null);
  assert.equal(effectiveRoutineId(S, TODAY), 'r1');
  assert.equal(effectiveRoutineId(S, FRI), null);
  assert.equal(effectiveRoutineId(S, '2026-09-16'), 'own'); // next Wednesday, weekday plan
});

test('pins: with every remaining session pinned to other days, a coach pointer on the weekday stays hidden', () => {
  const S = P({ dayPlan: { [FRI]: 'r1', '2026-09-12': 'r2', '2026-09-13': 'r3' }, week: { 3: ['r2', 'own'] } });
  assert.equal(effectiveRoutineId(S, TODAY), 'own');
  assert.equal(effectiveRoutineId(P({ dayPlan: { [FRI]: 'r1', '2026-09-12': 'r2', '2026-09-13': 'r3' }, week: { 3: 'r1' } }), TODAY), null);
  // A complete week hands the weekday back whole, coach pointer included, as before.
  const complete = P({ workouts: [done('r1'), done('r2'), done('r3')], week: { 3: ['r2', 'own'] } });
  assert.equal(effectiveRoutineId(complete, TODAY), 'r2');
});
