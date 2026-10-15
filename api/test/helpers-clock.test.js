/* The test helpers read the clock once (helpers.mjs NOW): a run that crosses 00:00 UTC still
   dates every fixture from the same "today". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOW, daysAgo } from './helpers.mjs';

test('daysAgo keeps the day it started with when the clock passes midnight', t => {
  const before = [daysAgo(0), daysAgo(7), daysAgo(26)];
  // The wall clock moves on to the next UTC day mid-run.
  const tomorrow = new Date(NOW);
  tomorrow.setUTCHours(24, 0, 5, 0);
  t.mock.timers.enable({ apis: ['Date'], now: tomorrow.getTime() });
  try {
    assert.notEqual(new Date().toISOString().slice(0, 10), before[0], 'the clock really is on the next day');
    assert.deepEqual([daysAgo(0), daysAgo(7), daysAgo(26)], before);
  } finally { t.mock.timers.reset(); }
});

test('daysAgo counts whole UTC days back from that reading', () => {
  assert.equal(daysAgo(0), new Date(NOW).toISOString().slice(0, 10));
  const sevenBack = new Date(NOW);
  sevenBack.setUTCDate(sevenBack.getUTCDate() - 7);
  assert.equal(daysAgo(7), sevenBack.toISOString().slice(0, 10));
});
