/* The two counters behind the sign-in throttle (#118), on a clock the test walks by hand. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackoff, createWindow } from '../rate-limit.js';

const clock = () => { const c = { t: 1e12 }; c.now = () => c.t; return c; };

test('backoff: the free failures cost nothing, then each one doubles the pause up to the cap', () => {
  const c = clock();
  const b = createBackoff({ free: 3, baseMs: 1000, maxMs: 5000, forgetMs: 60000, now: c.now });
  assert.deepEqual([b.fail('k'), b.fail('k'), b.fail('k')], [0, 0, 0]);
  assert.equal(b.retryAfter('k'), 0);
  assert.equal(b.fail('k'), 1);
  assert.equal(b.retryAfter('k'), 1);
  c.t += 1000;
  assert.equal(b.retryAfter('k'), 0);
  assert.equal(b.fail('k'), 2);
  c.t += 2000;
  assert.equal(b.fail('k'), 4);
  c.t += 4000;
  assert.equal(b.fail('k'), 5, 'capped');
  assert.equal(b.retryAfter('other'), 0, 'keys are independent');
});

test('backoff: a success or a quiet spell after the pause starts the count over', () => {
  const c = clock();
  const b = createBackoff({ free: 1, baseMs: 1000, maxMs: 60000, forgetMs: 10000, now: c.now });
  b.fail('k'); assert.equal(b.fail('k'), 1);
  b.clear('k');
  assert.equal(b.fail('k'), 0);
  assert.equal(b.fail('k'), 1);
  c.t += 1000 + 10001;          // the pause, then longer than forgetMs without a failure
  assert.equal(b.fail('k'), 0);
});

test('backoff: the map stays bounded, and a locked key is the last to be evicted', () => {
  const c = clock();
  const b = createBackoff({ free: 1, baseMs: 60000, maxMs: 60000, forgetMs: 60000, maxKeys: 3, now: c.now });
  b.fail('locked'); b.fail('locked');
  assert.ok(b.retryAfter('locked') > 0);
  for (const k of ['a', 'b', 'c', 'd']) b.fail(k);   // a flood of fresh keys
  assert.equal(b.size, 3);
  assert.ok(b.retryAfter('locked') > 0, 'the lock survived the flood');
});

test('backoff: sweep drops keys that are neither locked nor recent', () => {
  const c = clock();
  const b = createBackoff({ free: 5, forgetMs: 1000, now: c.now });
  b.fail('old'); c.t += 2000; b.fail('new');
  b.sweep();
  assert.equal(b.size, 1);
});

test('window: a fixed budget per key, and how long until it refills', () => {
  const c = clock();
  const w = createWindow({ max: 2, windowMs: 10000, now: c.now });
  assert.deepEqual([w.take('k'), w.take('k')], [0, 0]);
  assert.equal(w.take('k'), 10);
  c.t += 4000;
  assert.equal(w.take('k'), 6);
  c.t += 6000;
  assert.equal(w.take('k'), 0);
  c.t += 10000; w.sweep();
  assert.equal(w.size, 0);
});

test('backoff: attempts counted before their answer — a burst started at once is refused after the allowance', () => {
  const c = clock();
  const b = createBackoff({ free: 5, baseMs: 60000, maxMs: 3600000, now: c.now });
  // Twenty checks started side by side, none answered yet: the way a caller uses it is to ask
  // retryAfter() and, if free, start an attempt — with no await in between.
  const started = [];
  let refused = 0;
  for (let i = 0; i < 20; i++) {
    if (b.retryAfter('ana')) { refused++; continue; }
    started.push(b.attempt('ana'));
  }
  assert.equal(started.length, 6, 'five free and the one that starts the pause');
  assert.equal(refused, 14);
  assert.equal(started[5].lock, 60);
  assert.deepEqual(started.slice(0, 5).map(a => a.lock), [0, 0, 0, 0, 0]);
});

test('backoff: undo takes an attempt back, and the pause it started with it — once', () => {
  const c = clock();
  const b = createBackoff({ free: 2, baseMs: 60000, maxMs: 3600000, now: c.now });
  b.fail('k'); b.fail('k');
  const a = b.attempt('k');
  assert.equal(a.lock, 60);
  assert.ok(b.retryAfter('k') > 0);
  a.undo();
  assert.equal(b.retryAfter('k'), 0, 'the pause went with the attempt');
  a.undo();                          // a second undo takes nothing more back
  assert.equal(b.fail('k'), 60, 'still two failures on record: the next one pauses');

  // An attempt on a key that was cleared meanwhile has nothing left to take back.
  const x = b.attempt('x');
  b.clear('x');
  b.fail('x');
  x.undo();
  assert.equal(b.fail('x'), 0);
  assert.equal(b.fail('x'), 60, 'the two failures after the clear both still count');

  // An attempt that turned out right leaves no trace of itself.
  const y = b.attempt('y');
  y.undo();
  assert.equal(b.size, 2);
});

test('backoff: undo never lifts a pause the failures left still earn, or one it did not start', () => {
  const c = clock();
  const b = createBackoff({ free: 1, baseMs: 60000, maxMs: 3600000, now: c.now });
  b.fail('k');
  const a = b.attempt('k');          // the second failure: pauses
  assert.equal(a.lock, 60);
  assert.equal(b.fail('k'), 120);    // a third, counted meanwhile
  a.undo();                          // two left: still more than the one free
  assert.equal(b.retryAfter('k'), 120);

  const d = createBackoff({ free: 1, baseMs: 60000, maxMs: 3600000, now: c.now });
  const first = d.attempt('k');      // free, started no pause
  assert.equal(d.fail('k'), 60);
  first.undo();
  assert.equal(d.retryAfter('k'), 60, 'only the attempt that started a pause takes it back');
});

test('backoff: a flood of fresh keys pushes out its own kind, not a count halfway to its pause', () => {
  const c = clock();
  const b = createBackoff({ free: 5, baseMs: 60000, maxMs: 3600000, maxKeys: 100, now: c.now });
  for (let i = 0; i < 5; i++) b.fail('ana');                // one short of the pause
  for (let i = 0; i < 10000; i++) b.fail('junk' + i);       // one failure each
  assert.equal(b.size, 100);
  assert.equal(b.fail('ana'), 60, 'the five earlier failures are still on record');
});

test('backoff: a key marked keep is never evicted, even when everything else has more to lose', () => {
  const c = clock();
  const b = createBackoff({ free: 5, maxKeys: 3, keep: k => k === 'ana', now: c.now });
  b.fail('ana');
  for (let i = 0; i < 50; i++) { b.fail('junk' + i); b.fail('junk' + i); b.fail('junk' + i); }
  assert.equal(b.size, 3);
  for (let i = 0; i < 4; i++) assert.equal(b.fail('ana'), 0);
  assert.equal(b.fail('ana'), 60, 'the first failure was kept through the flood');
  // Only kept keys left: the Map grows by those instead of dropping one.
  const k = createBackoff({ maxKeys: 2, keep: () => true, now: c.now });
  for (const key of ['a', 'b', 'c']) k.fail(key);
  assert.equal(k.size, 3);
});
