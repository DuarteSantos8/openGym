/* Machines per gym (#923): an equipment profile may list the machine kinds it has. With the app
 * filtering by it, the Coach is offered no machine exercise of another kind, is told which kinds
 * there are, and the validator sends a plan that names one back for repair. No list, no change. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/core/payload.js');
const { validatePlan } = await import('../coach/core/validate.js');
const { gymMachines, machineAllows, LIBRARY, swapSlice } = await import('../coach/core/library.js');
const { handleFor } = await import('../coach/handle.js');

const byName = n => LIBRARY.find(e => e.n === n);
const LEG_EXT = byName('lever leg extension').id;
const LEG_PRESS = byName('sled 45° leg press').id;
const mkOf = id => LIBRARY.find(e => e.id === id)?.mk;
const gymState = (machines, on = true) => ({
  equipFilterOn: on, activeEquipId: 'g',
  equipProfiles: [{ id: 'g', name: 'Gym', equipment: ['leverage machine', 'sled machine', 'dumbbell'], ...(machines ? { machines } : {}) }]
});

test('the library index knows each machine exercise\'s kind, and only those', () => {
  assert.equal(mkOf(LEG_EXT), 'leg-extension');
  assert.equal(mkOf(LEG_PRESS), 'leg-press');
  assert.ok(!LIBRARY.some(e => e.mk && !['leverage machine', 'sled machine', 'smith machine', 'assisted'].includes(e.eq)));
  assert.ok(!LIBRARY.some(e => e.mk === 'none'), 'a row that needs no machine carries no kind');
});

test('the active gym\'s list, only while the app filters by it', () => {
  assert.deepEqual(gymMachines(gymState(['leg-press'])), ['leg-press']);
  assert.equal(gymMachines(gymState(['leg-press'], false)), null);
  assert.equal(gymMachines(gymState(null)), null);
  assert.equal(gymMachines(gymState([])), null);
  assert.equal(gymMachines({}), null);
  assert.equal(machineAllows(null, LEG_EXT), true);
  assert.equal(machineAllows(['leg-press'], LEG_EXT), false);
  assert.equal(machineAllows(['leg-press'], LEG_PRESS), true);
  assert.equal(machineAllows(['leg-press'], LIBRARY.find(e => e.eq === 'dumbbell').id), true);
});

test('the library slice and the swap slice leave other machines out', () => {
  const kit = ['leverage machine', 'sled machine', 'dumbbell'];
  const plain = payload.librarySlice(gymState(null), kit, { max: 400 });
  assert.ok(plain.some(e => mkOf(e.id) && mkOf(e.id) !== 'leg-press'), 'the plain slice has other machines');
  const narrowed = payload.librarySlice(gymState(['leg-press']), kit, { max: 400 });
  assert.ok(!narrowed.some(e => mkOf(e.id) && mkOf(e.id) !== 'leg-press'));
  assert.ok(narrowed.some(e => mkOf(e.id) === 'leg-press'));
  const swap = swapSlice(gymState(['leg-press']), kit, LEG_PRESS);
  assert.ok(!swap.some(e => mkOf(e.id) && mkOf(e.id) !== 'leg-press'));
});

test('the payload names the kinds, and a plan with a missing machine goes back for repair', () => {
  const S = { ...sampleState(), ...gymState(['leg-press']) };
  S.coach = { ...(S.coach || {}), profile: { goal: 'muscle', daysPerWeek: 3, equipment: [] } };
  const p = payload.build(S, { handle: handleFor('u1'), kind: 'create' });
  assert.deepEqual(p.machines, ['leg-press']);
  const plain = payload.build({ ...S, ...gymState(null) }, { handle: handleFor('u1'), kind: 'create' });
  assert.equal(plain.machines, undefined);
  const plan = { routines: [{ name: 'Legs', ex: [{ id: LEG_EXT, sets: 3, reps: 12 }] }] };
  const r = validatePlan(plan, { equipment: [], offered: new Set(), machines: ['leg-press'] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /needs equipment the user does not have/);
  assert.equal(validatePlan(plan, { equipment: [], offered: new Set() }).ok, true);
  assert.equal(validatePlan({ routines: [{ name: 'Legs', ex: [{ id: LEG_PRESS, sets: 3, reps: 12 }] }] }, { equipment: [], offered: new Set(), machines: ['leg-press'] }).ok, true);
});
