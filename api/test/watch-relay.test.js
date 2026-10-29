/* The watch relay's bookkeeping (watch-relay.js): codes, links and the mailbox. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWatchCode, takeWatchCode, dropWatchCodes, createWatchLink, findWatchLink, touchWatchLink, listWatchLinks,
  dropWatchLinks, boxOf, putSnapshot, pushEvents, queuedEvents, ackEvents,
  WATCH_CODE_TTL_MS, WATCH_IDLE_MS, WATCH_LINKS_MAX, SNAPSHOT_MAX_BYTES, QUEUE_MAX, EVENT_MAX_AGE_MS
} from '../watch-relay.js';

test('a code is one-shot, ten minutes long, one per profile, and typed any which way', () => {
  const codes = new Map();
  const { code } = createWatchCode(codes, 'u1', 1000);
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(takeWatchCode(codes, code.toLowerCase().replace(/-/g, ' '), 2000), 'u1');
  assert.equal(takeWatchCode(codes, code, 2000), null, 'used up');

  const late = createWatchCode(codes, 'u1', 0).code;
  assert.equal(takeWatchCode(codes, late, WATCH_CODE_TTL_MS + 1), null, 'expired');

  const first = createWatchCode(codes, 'u1', 0).code;
  const second = createWatchCode(codes, 'u1', 0).code;
  assert.equal(takeWatchCode(codes, first, 1), null, 'replaced by the newer one');
  const other = createWatchCode(codes, 'u2', 0).code;
  dropWatchCodes(codes, 'u1');
  assert.equal(takeWatchCode(codes, second, 1), null);
  assert.equal(takeWatchCode(codes, other, 1), 'u2', 'another profile keeps its code');
  assert.equal(takeWatchCode(codes, 'short', 1), null);
  assert.equal(takeWatchCode(codes, { toString: 1 }, 1), null);
  // only a hash is kept
  for (const k of codes.keys()) assert.match(k, /^[0-9a-f]{64}$/);
});

test('a link is a hashed token that ends with the sessions, the account, or 90 idle days', () => {
  const db = { watchLinks: [] };
  const { token, link } = createWatchLink(db, 'u1', 3, 'Amazfit Balance', 1000);
  assert.match(token, /^ogw_[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(db).includes(token), 'the token is never stored');
  const sv = { u1: 3 };
  const svOf = uid => (uid in sv ? sv[uid] : null);
  assert.equal(findWatchLink(db, token, svOf, 2000), link);
  assert.equal(findWatchLink(db, token + 'x', svOf, 2000), null);
  assert.equal(findWatchLink(db, 'Bearer ' + token, svOf, 2000), null);
  assert.equal(findWatchLink(db, null, svOf, 2000), null);
  // "sign out everywhere" moves the session version on
  sv.u1 = 4;
  assert.equal(findWatchLink(db, token, svOf, 2000), null);
  sv.u1 = 3;
  // a disabled or deleted account
  delete sv.u1;
  assert.equal(findWatchLink(db, token, svOf, 2000), null);
  sv.u1 = 3;
  // idle
  assert.equal(findWatchLink(db, token, svOf, 1000 + WATCH_IDLE_MS), null);
  assert.equal(touchWatchLink(link, 1000 + 60e3), false, 'not saved for every request');
  assert.equal(touchWatchLink(link, 1000 + 3600e3), true);
  assert.equal(findWatchLink(db, token, svOf, 1000 + WATCH_IDLE_MS), link, 'used since');

  assert.deepEqual(listWatchLinks(db, 'u1'), [{ id: link.id, name: 'Amazfit Balance', created: 1000, seen: 1000 + 3600e3 }]);
  assert.equal(dropWatchLinks(db, 'u1', 'nope'), false);
  assert.equal(dropWatchLinks(db, 'u1', link.id), true);
  assert.equal(findWatchLink(db, token, svOf, 2000), null);
});

test('a profile keeps its newest few links, names are tidied', () => {
  const db = {};
  const made = [];
  for (let i = 0; i < WATCH_LINKS_MAX + 2; i++) made.push(createWatchLink(db, 'u1', 0, i === 0 ? '\u0000 x'.repeat(30) : '', 1000 + i).link);
  createWatchLink(db, 'u2', 0, 'other', 1000);
  const mine = listWatchLinks(db, 'u1');
  assert.equal(mine.length, WATCH_LINKS_MAX);
  assert.deepEqual(mine.map(l => l.id), made.slice(2).map(l => l.id), 'the least recently used went');
  assert.equal(mine[0].name, 'Zepp OS watch');
  assert.ok(made[0].name.length <= 40 && !/\u0000/.test(made[0].name));
  assert.equal(dropWatchLinks(db, 'u1'), true);
  assert.equal(listWatchLinks(db, 'u1').length, 0);
  assert.equal(listWatchLinks(db, 'u2').length, 1);
});

test('the mailbox keeps the page\'s snapshot as it was sent, if it is one', () => {
  const box = boxOf(null);
  assert.deepEqual(box, { snapshot: null, snapAt: 0, events: [] });
  const snap = JSON.stringify({ v: 1, unit: 'kg', active: null, ready: null })
  assert.equal(putSnapshot(box, snap, 5), true);
  assert.equal(box.snapshot, snap);
  assert.equal(box.snapAt, 5);
  for (const bad of [null, '', '{', '[]', '"x"', JSON.stringify({ unit: 'kg' }), JSON.stringify({ v: 1, pad: 'x'.repeat(SNAPSHOT_MAX_BYTES) })]) {
    assert.equal(putSnapshot(box, bad, 6), false, String(bad).slice(0, 20));
  }
  assert.equal(box.snapshot, snap, 'a bad one changes nothing');
  assert.deepEqual(boxOf({ snapshot: 3, events: [null, { id: 'a' }, { id: 'b', ev: { id: 'b' } }] }).events, [{ id: 'b', ev: { id: 'b' } }]);
});

test('events queue in order, once each; the page acknowledges them out', () => {
  const box = boxOf(null);
  const ev = (id, type = 'setDone', extra = {}) => ({ id, type, wid: 'w-1', ...extra });
  assert.deepEqual(pushEvents(box, [ev('a'), ev('b', 'finish'), ev('a')], 100), ['a', 'b', 'a']);
  assert.deepEqual(pushEvents(box, [ev('b', 'finish'), ev('c', 'start', { routineIds: ['r1'] })], 200), ['b', 'c'], 'sent again: still fine');
  assert.deepEqual(queuedEvents(box, 300).map(e => e.id), ['a', 'b', 'c']);
  assert.deepEqual(queuedEvents(box, 300)[2], ev('c', 'start', { routineIds: ['r1'] }), 'exactly as the watch sent it');
  // malformed: forgotten by the watch, never queued
  assert.deepEqual(pushEvents(box, [ev('d', 'rm -rf'), { id: 'e', type: 'setDone', big: 'x'.repeat(5000) }, null, 'x', { type: 'finish' }], 300), ['d', 'e']);
  assert.equal(box.events.length, 3);
  assert.equal(ackEvents(box, ['a', 'c', 7]), true);
  assert.equal(ackEvents(box, ['zzz']), false);
  assert.equal(ackEvents(box, 'a'), false);
  assert.deepEqual(queuedEvents(box, 300).map(e => e.id), ['b']);
  // too old to matter
  assert.deepEqual(queuedEvents(box, 100 + EVENT_MAX_AGE_MS), []);
});

test('a full queue takes no more, and says which it did not take', () => {
  const box = boxOf(null);
  for (let i = 0; i < QUEUE_MAX; i += 50) pushEvents(box, Array.from({ length: 50 }, (_, k) => ({ id: 'e' + (i + k), type: 'setHr' })), 1);
  assert.equal(box.events.length, QUEUE_MAX);
  assert.deepEqual(pushEvents(box, [{ id: 'e0', type: 'setHr' }, { id: 'new', type: 'finish' }], 2), ['e0']);
  assert.deepEqual(pushEvents(box, Array.from({ length: 80 }, (_, k) => ({ id: 'e' + k, type: 'setHr' })), 2).length, 50, '50 a request');
});
