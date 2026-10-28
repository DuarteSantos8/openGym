/* Equipment per gym (#808): each equipment profile carries its gym's plates, dumbbells, bars and
   machine stacks, and a workout the gym it was done at. Older apps know none of it; the server must
   not let one of them drop those fields when it writes back what it read (sync-stamps.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPut } from '../sync-stamps.js';

const clone = v => JSON.parse(JSON.stringify(v));
const NOW = 1_800_000_000_000;
const INV = { plates: { kg: { 20: 1, _ts: 5 } }, dumbbells: { kg: { weights: [5, 10], _ts: 5 } }, barDefaults: { kg: { barbell: 15 } }, stackWeights: {} };
const stored = () => ({
  _ts: NOW - 5000, _rev: 7, unit: 'kg',
  plates: INV.plates, dumbbells: INV.dumbbells, barDefaults: INV.barDefaults, stackWeights: {},
  invGym: 'home', activeEquipId: 'home',
  equipProfiles: [
    { id: 'home', name: 'Home', equipment: ['barbell'], ...clone(INV), _ts: NOW - 9000 },
    { id: 'big', name: 'Big gym', equipment: ['barbell'], plates: { kg: { _ts: 6 } }, dumbbells: { kg: { weights: [2, 4, 6], _ts: 6 } }, barDefaults: {}, stackWeights: {}, _ts: NOW - 9000 },
  ],
  workouts: [{ id: 'w1', d: '2026-10-01', start: 1, end: 2, gym: { id: 'big', name: 'Big gym' }, entries: [] }],
  edited: {}, deleted: {},
});

test('an app that never heard of gyms rebuilds a profile without their lists: the server puts them back', () => {
  const cur = stored();
  const next = clone(cur);
  delete next.deleted; delete next.edited; delete next._rev; delete next.invGym;
  // a v1.3.9 profile sheet saves name and equipment only, and it keeps no workout's `gym`
  next.equipProfiles = next.equipProfiles.map(({ id, name, equipment, _ts }) => ({ id, name: id === 'big' ? 'Fitness park' : name, equipment, _ts }));
  next.workouts = next.workouts.map(({ gym, ...w }) => w);
  stampPut(cur, next, { overRead: true, stamped: false, now: NOW });
  const big = next.equipProfiles.find(p => p.id === 'big');
  assert.equal(big.name, 'Fitness park');
  assert.deepEqual(big.dumbbells, { kg: { weights: [2, 4, 6], _ts: 6 } });
  assert.deepEqual(next.equipProfiles.find(p => p.id === 'home').barDefaults, { kg: { barbell: 15 } });
  assert.deepEqual(next.workouts[0].gym, { id: 'big', name: 'Big gym' });
  assert.equal(next.invGym, 'home');
});

test('an older app that edits the plates writes the top-level list only, and every gym keeps its own', () => {
  const cur = stored();
  const next = clone(cur);
  next.plates = { kg: { 20: 2, 10: 1, _ts: NOW - 100 } };
  stampPut(cur, next, { overRead: true, stamped: true, now: NOW });
  assert.deepEqual(next.plates.kg, { 20: 2, 10: 1, _ts: NOW - 100 });
  // the app's own merge moves it into the active gym (frontend lib/gym-inventory.js); here nothing is lost
  assert.deepEqual(next.equipProfiles.find(p => p.id === 'big').plates, { kg: { _ts: 6 } });
  assert.deepEqual(next.equipProfiles.find(p => p.id === 'home').plates, INV.plates);
});
