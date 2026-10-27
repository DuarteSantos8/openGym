/* "I own no dumbbells" (Discord, deamondo): the app's switch, stored in the synced dumbbell map
 * as `none`, keeps dumbbell lifts out of what the Coach is offered, what it is told the person
 * has, and what the validator lets through, whatever the Coach's own equipment answer says. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const { validatePlan } = await import('../coach/core/validate.js');
const { handleFor } = await import('../coach/handle.js');

const eqOf = id => (payload.LIBRARY.find(e => e.id === id) || {}).eq;
const NONE = { none: { on: true, _ts: 1 } };
const aDumbbellLift = payload.LIBRARY.find(e => e.eq === 'dumbbell').id;

test('the library slice leaves dumbbell lifts out when the person owns none', () => {
  assert.ok(payload.librarySlice({}, []).some(e => eqOf(e.id) === 'dumbbell'), 'the plain slice has some');
  assert.ok(!payload.librarySlice({ dumbbells: NONE }, []).some(e => eqOf(e.id) === 'dumbbell'));
  assert.ok(!payload.librarySlice({ dumbbells: NONE }, ['dumbbell', 'barbell']).some(e => eqOf(e.id) === 'dumbbell'));
  // Switched back off (a stamped false), they return.
  assert.ok(payload.librarySlice({ dumbbells: { none: { on: false, _ts: 2 } } }, []).some(e => eqOf(e.id) === 'dumbbell'));
  // One they already train still travels: a review has to be able to name it.
  assert.ok(payload.librarySlice({ dumbbells: NONE }, [], { keep: [aDumbbellLift] }).some(e => e.id === aDumbbellLift));
});

test('the Coach is told no dumbbells even when its own answer listed them', () => {
  const S = sampleState();
  S.coach = { ...(S.coach || {}), profile: { goal: 'muscle', daysPerWeek: 3, equipment: ['dumbbell', 'barbell'] } };
  S.dumbbells = NONE;
  const p = payload.build(S, { handle: handleFor('u1'), kind: 'create' });
  assert.deepEqual(p.coachProfile.equipment, ['barbell']);
  assert.equal(p.noDumbbells, true);
  const trained = new Set((S.workouts || []).flatMap(w => (w.entries || []).map(en => en.id)));
  assert.ok(!p.library.some(e => eqOf(e.id) === 'dumbbell' && !trained.has(e.id)));
  // Without the switch nothing changes.
  delete S.dumbbells;
  const plain = payload.build(S, { handle: handleFor('u1'), kind: 'create' });
  assert.deepEqual(plain.coachProfile.equipment, ['dumbbell', 'barbell']);
  assert.equal(plain.noDumbbells, undefined);
});

test('a plan with a dumbbell lift goes back for repair, even with no equipment stated', () => {
  const plan = { routines: [{ name: 'A', ex: [{ id: aDumbbellLift, sets: 3, reps: 10 }] }] };
  const r = validatePlan(plan, { equipment: [], offered: new Set(), noDumbbells: true });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /needs equipment the user does not have/);
  assert.equal(validatePlan(plan, { equipment: [], offered: new Set() }).ok, true);
  // One they were offered (already in their training) stays allowed.
  assert.equal(validatePlan(plan, { equipment: [], offered: new Set([aDumbbellLift]), noDumbbells: true }).ok, true);
});
