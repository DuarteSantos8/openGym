/* The profile fields behind strength levels (`sex`, `birthYear`) through PUT /api/data's stamping
   (sync-stamps.js). An older app that does not know them must not erase them, and an updated app's
   clear must stay cleared over a stored copy that still holds the value. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPut } from '../sync-stamps.js';

const clone = v => JSON.parse(JSON.stringify(v));
const NOW = 1_800_000_000_000;
const stored = () => ({
  _ts: NOW - 5000, _rev: 3, restSec: 90, workouts: [], routines: [], favEx: [],
  sex: 'male', birthYear: 1990,
  edited: { sex: NOW - 4000, birthYear: NOW - 4000 },
});

test('an older app that does not know sex or birth year does not erase them', () => {
  const cur = stored();
  const next = clone(cur);
  delete next.sex; delete next.birthYear; delete next.edited; delete next._rev;
  stampPut(cur, next, { overRead: true, stamped: false, now: NOW });
  assert.equal(next.sex, 'male');
  assert.equal(next.birthYear, 1990);
});

test('an updated app clearing sex and birth year keeps them cleared over the stored copy', () => {
  const cur = stored();
  const next = clone(cur);
  delete next.sex; delete next.birthYear;
  next.edited = { sex: NOW - 1000, birthYear: NOW - 1000 };
  stampPut(cur, next, { overRead: true, stamped: true, now: NOW });
  assert.equal(next.sex, undefined);
  assert.equal(next.birthYear, undefined);
  assert.equal(next.edited.sex, NOW - 1000);
});
