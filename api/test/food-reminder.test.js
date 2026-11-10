import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodPushOwed, anyFoodWindow, foodPush } from '../food-reminder.js';

const S = { foodPush: true, foodLog: { a: { d: '2026-11-10', m: 'breakfast', n: 'Kwark', per: [60], _ts: 1 }, gone: { _ts: 2 } } };
const at = hhmm => ({ date: '2026-11-10', hhmm });

test('owes a meal inside its hour with nothing logged under it', () => {
  assert.equal(foodPushOwed(S, at('10:15')), null);           // breakfast is logged
  assert.equal(foodPushOwed(S, at('14:05')), 'lunch');
  assert.equal(foodPushOwed(S, at('15:00')), null);           // the hour is over
  assert.equal(foodPushOwed(S, at('13:59')), null);
  assert.equal(foodPushOwed(S, at('20:30')), 'dinner');
});

test('once a day per meal, and only when switched on', () => {
  assert.equal(foodPushOwed(S, at('14:10'), { lunch: '2026-11-10' }), null);
  assert.equal(foodPushOwed(S, at('14:10'), { lunch: '2026-11-09' }), 'lunch');
  assert.equal(foodPushOwed({ ...S, foodPush: false }, at('14:10')), null);
  assert.equal(foodPushOwed({ ...S, foodNudge: false }, at('14:10')), null);
  assert.equal(foodPushOwed({ ...S, modules: { food: false } }, at('14:10')), null);
});

test('windows and copy', () => {
  assert.equal(anyFoodWindow('14:30'), true);
  assert.equal(anyFoodWindow('16:00'), false);
  assert.match(foodPush('lunch').body, /lunch/);
});
