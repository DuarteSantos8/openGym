/* audit-aggregate.js: the repeats of one audit event, folded into one counted row per window. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAggregator } from '../audit-aggregate.js';

const HOUR = 3600000;
function harness(opts = {}) {
  const clock = { t: 1_000_000 };
  const rows = [];
  const agg = createAggregator({ windowMs: HOUR, now: () => clock.t, write: e => rows.push(e), ...opts });
  return { clock, rows, agg };
}

test('the first occurrence is written at once, the repeats become one counted row when the window ends', () => {
  const { clock, rows, agg } = harness();
  agg.record('kid', { reason: 'kid' });
  assert.deepEqual(rows, [{ reason: 'kid' }]);
  for (let i = 0; i < 999; i++) { clock.t += 1000; agg.record('kid', { reason: 'kid' }); }
  assert.equal(rows.length, 1, 'nothing more inside the window');
  clock.t = 1_000_000 + HOUR;
  agg.sweep();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].reason, 'kid');
  assert.equal(rows[1].repeats, 999);
  assert.equal(rows[1].since, 1_000_000);
});

test('a storm of one reason is at most two rows a window, whatever its rate', () => {
  const { clock, rows, agg } = harness();
  // 24 hours of one failure a second.
  for (let s = 0; s < 24 * 3600; s++) { agg.record('expired', { reason: 'expired' }); clock.t += 1000; }
  agg.sweep(true);
  assert.ok(rows.length <= 2 * 24 + 1, `${rows.length} rows`);
  const counted = rows.filter(r => !r.repeats).length + rows.reduce((n, r) => n + (r.repeats || 0), 0);
  assert.equal(counted, 24 * 3600, 'every failure is accounted for, once');
});

test('each reason has its own window', () => {
  const { rows, agg } = harness();
  agg.record('kid', { reason: 'kid' });
  agg.record('expired', { reason: 'expired' });
  agg.record('kid', { reason: 'kid' });
  assert.deepEqual(rows.map(r => r.reason), ['kid', 'expired']);
  agg.sweep(true);
  assert.deepEqual(rows.slice(2), [{ reason: 'kid', repeats: 1, since: 1_000_000 }]);
});

test('a window with no repeats closes without a row, and the next occurrence opens a new one', () => {
  const { clock, rows, agg } = harness();
  agg.record('iss', { reason: 'iss' });
  clock.t += HOUR;
  agg.record('iss', { reason: 'iss' });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => !r.repeats));
});

test('the number of open windows is capped', () => {
  const { rows, agg } = harness({ maxKeys: 3 });
  for (const k of ['a', 'b', 'c', 'a', 'd']) agg.record(k, { reason: k });
  assert.equal(agg.size(), 3);
  // 'a' was the oldest window: closing it wrote its repeat.
  assert.deepEqual(rows.find(r => r.repeats), { reason: 'a', repeats: 1, since: 1_000_000 });
});
