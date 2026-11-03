// The review window starts at the last review (stored as epoch ms by lib/coach.js), but always
// keeps enough sessions to judge a trend. Before, the ms timestamp was sliced into "1761…" and
// never matched a date, so every review read the whole 12 weeks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewWindow, sinceDay, MIN_REVIEW_SESSIONS } from '../coach/core/payload.js';

const dayAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const S = { workouts: Array.from({ length: 40 }, (_, i) => ({ d: dayAgo(80 - i * 2) })) };

test('sinceDay reads epoch ms, digit strings and ISO strings', () => {
  const t = Date.UTC(2026, 9, 20, 12);
  assert.equal(sinceDay(t), '2026-10-20');
  assert.equal(sinceDay(String(t)), '2026-10-20');
  assert.equal(sinceDay('2026-10-20T08:00:00Z'), '2026-10-20');
  assert.equal(sinceDay(null), null);
  assert.equal(sinceDay('nonsense'), null);
});

test('a review long after the last one reads from it on', () => {
  const at = Date.now() - 40 * 864e5;
  const w = reviewWindow(S, at);
  assert.ok(w.length >= MIN_REVIEW_SESSIONS);
  assert.ok(w.every(x => x.d >= dayAgo(40)));
});

test('a review right after the last one still gets enough sessions', () => {
  const w = reviewWindow(S, Date.now() - 864e5);
  assert.equal(w.length, MIN_REVIEW_SESSIONS);
});

test('no last review: the whole window, as before', () => {
  assert.equal(reviewWindow(S, null).length, S.workouts.length);
});
