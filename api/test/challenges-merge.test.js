/* The monthly challenges (frontend/src/lib/challenges.js) on PUT /api/data: a badge earned on one
   device is never lost to a push of a copy from before it, whoever writes, and whatever a device
   sends is cleaned to the last 24 months. A reset starts over. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPut, mergeChallenges, cleanChallenges } from '../sync-stamps.js';

const picked = [{ id: 'workouts', n: 12 }, { id: 'newex', n: 3 }, { id: 'muscles', n: 6 }];
const clone = v => JSON.parse(JSON.stringify(v));

test('a push from before a badge keeps the badge, for the app and for an older writer', () => {
  const cur = { _ts: 1, challenges: { '2026-11': { picked, done: ['workouts', 'muscles'], at: 10 } } };
  const next = { _ts: 2, challenges: { '2026-11': { picked, done: ['newex'], at: 10 } } };
  for (const stamped of [true, false]) {
    const out = stampPut(clone(cur), clone(next), { stamped, overRead: true, now: 100 });
    assert.deepEqual(out.challenges['2026-11'].done, ['muscles', 'newex', 'workouts']);
  }
});

test('an older app that never knew challenges keeps them', () => {
  const cur = { _ts: 1, challenges: { '2026-11': { picked, done: ['workouts'], at: 10 } } };
  const out = stampPut(clone(cur), { _ts: 2, unit: 'kg' }, { stamped: false, overRead: true, now: 100 });
  assert.deepEqual(out.challenges, cur.challenges);
});

test('a reset starts over', () => {
  const cur = { _ts: 1, challenges: { '2026-11': { picked, done: ['workouts'], at: 10 } } };
  const out = stampPut(clone(cur), { _ts: 2, resetAt: 50 }, { stamped: true, now: 100 });
  assert.equal(out.challenges, undefined);
});

test('the first picks of a month win, and the value stays small', () => {
  const a = { '2026-11': { picked, done: [], at: 5 } };
  const b = { '2026-11': { picked: [{ id: 'weeks', n: 4 }], done: ['weeks'], at: 9 } };
  assert.deepEqual(mergeChallenges(a, b)['2026-11'].picked, picked);
  const big = {};
  for (let i = 0; i < 40; i++) big[`${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`] = { picked, done: ['workouts'], at: 1 };
  big.junk = { picked };
  assert.equal(Object.keys(cleanChallenges(big)).length, 24);
});
