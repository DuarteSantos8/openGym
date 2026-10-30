import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usageOf, sumUsage, averageUsage, USAGE_WINDOW } from '../coach/core/usage.js';

test('usageOf keeps real counts and rejects a provider that reported nothing', () => {
  assert.deepEqual(usageOf(1200, 340), { input: 1200, output: 340, calls: 1 });
  assert.equal(usageOf(undefined, undefined), null);
  assert.equal(usageOf('x', null), null);
});

test('sumUsage adds the repair round and ignores calls that reported nothing', () => {
  assert.deepEqual(sumUsage([usageOf(100, 10), null, usageOf(50, 5, 1)]), { input: 150, output: 15, calls: 2 });
  assert.equal(sumUsage([null, null]), null);
  assert.equal(sumUsage([]), null);
});

test('averageUsage is per review, over the last window of entries that reported usage', () => {
  const entries = [
    { usage: { input: 9000, output: 900, calls: 1 } },   // oldest, outside a window of 2
    { outcome: 'nochange' },                             // no usage: skipped, not counted as zero
    { usage: { input: 1000, output: 100, calls: 1 } },
    { usage: { input: 2000, output: 300, calls: 2 } }
  ];
  assert.deepEqual(averageUsage(entries, 2), { reviews: 2, input: 1500, output: 200, calls: 1.5 });
});

test('averageUsage is null until a review has reported usage', () => {
  assert.equal(averageUsage([]), null);
  assert.equal(averageUsage(undefined), null);
  assert.equal(averageUsage([{ outcome: 'failed' }]), null);
});

test('the default window is the last ten reviews', () => {
  assert.equal(USAGE_WINDOW, 10);
  const many = Array.from({ length: 15 }, (_, i) => ({ usage: { input: i < 5 ? 10000 : 100, output: 0, calls: 1 } }));
  assert.equal(averageUsage(many).input, 100);
  assert.equal(averageUsage(many).reviews, 10);
});
