// What Body measurements shows of RENPHO (providers/renpho/service.js summarize): per kind the
// latest value, and its change against the reading closest to a month before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, SUMMARY_KINDS } from '../providers/renpho/service.js';

const DAY = 86400;
const t0 = 1760000000;
const kept = (id, ts, values) => ({
  provider: 'renpho', external_id: id, external_timestamp: ts * 1000, synced_at: 1,
  raw_provider_data: { id, timeStamp: ts, weightUnit: 1, ...values },
});
const store = list => ({ provider: 'renpho', measurements: Object.fromEntries(list.map(m => [m.external_id, m])) });
const item = (s, type) => s.items.find(x => x.type === type);

test('the latest value of each kind, its change against about a month before, never the weight', () => {
  const s = summarize(store([
    kept('1', t0, { weight: 82, bodyfat: 24, muscle: 40 }),
    kept('2', t0 + 29 * DAY, { weight: 81, bodyfat: 23 }),
    kept('3', t0 + 35 * DAY, { weight: 80, bodyfat: 22, muscle: 41 }),
    // A week before the latest: too close to count as "a month ago".
    kept('4', t0 + 31 * DAY, { weight: 80.5, bodyfat: 19 }),
  ]), SUMMARY_KINDS);
  assert.equal(item(s, 'weight'), undefined);
  assert.equal(item(s, 'bodyFat').v, 22);
  // The one closest to 30 days before the latest (day 5), of those at least a week older: day 0.
  assert.equal(item(s, 'bodyFat').change, -2);
  assert.equal(item(s, 'muscleMass').v, 32.8);
  assert.equal(item(s, 'muscleMass').change, 32.8 - 32.8);
  assert.equal(s.t, (t0 + 35 * DAY) * 1000);
});

test('a friend\'s day, a reading RENPHO marked invalid, and a misread value', () => {
  const day = { day: '2026-11-01', ts: t0, weightUnit: 1, values: { weight: 80, bodyfat: 21, bone: 3.1 } };
  const s = summarize(store([
    { provider: 'renpho', external_id: 'day:77:2026-11-01', external_timestamp: t0 * 1000, synced_at: 1, raw_provider_data: day },
    kept('5', t0 + DAY, { weight: 80, bodyfat: 18, invalidFlag: 1 }),
    kept('6', t0 + 2 * DAY, { weight: 80, bodyfat: 0.2, bmr: 99999 }),
  ]), SUMMARY_KINDS);
  assert.equal(item(s, 'bodyFat').v, 21, 'neither the invalid reading nor the misread one');
  assert.equal(item(s, 'boneMass').v, 3.1);
  assert.equal(item(s, 'bmr'), undefined);
});

test('nothing kept yet', () => {
  assert.deepEqual(summarize(null, SUMMARY_KINDS), { items: [], t: null });
});
