/* DATA SAFETY on the server for an exercise's own "No timer" (`restOff` on a routine entry): it
   survives PUT /api/data's stamping, also when an app from before it writes over it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPut } from '../sync-stamps.js';

const old = () => ({
  _ts: 100, unit: 'kg',
  routines: [{ id: 'r1', name: 'Upper', _ts: 7, ex: [{ id: '0025', sets: 3, reps: 8, weight: 60 }] }],
});
const withNew = () => {
  const S = old();
  S.routines[0].ex[0] = { ...S.routines[0].ex[0], restOff: true };
  return S;
};

test('a stamped write keeps restOff as sent', () => {
  const next = withNew();
  next._ts = 200;
  const out = stampPut(old(), next, { stamped: true, now: 300 });
  assert.equal(out.routines[0].ex[0].restOff, true);
});

test('an app from before it, writing its copy of the routine, does not take it away', () => {
  const cur = withNew();
  const next = old();                // it rebuilt the exercise from the fields it knows
  next._ts = 200;
  const out = stampPut(cur, next, { stamped: false, overRead: true, now: 300 });
  assert.equal(out.routines[0].ex[0].restOff, true);
});
