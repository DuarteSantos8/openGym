/* What this file exists to prevent: a sign-in attempt that can be replayed, that never expires,
 * or that leaks into a second attempt's state. Every one of those would turn a single-use
 * server-side entry into something a forged, replayed or cross-tab callback could ride on.
 *
 * The clock is injected throughout, so every expiry case below is a comparison against a number
 * this file chose, never a real sleep.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pkcePair, randomToken, createFlowStore, FLOW_TTL_MS, MAX_FLOWS,
  APP_CODE_TTL_MS, s256, isS256Challenge, verifierMatches, hashAppCode
} from '../oidc/flow.js';
import { hashLinkCode } from '../device-link.js';

test('pkcePair: verifier matches the RFC 7636 shape and the challenge is its SHA-256 digest', () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, expected);
});

test('pkcePair: two calls never return the same verifier', () => {
  const a = pkcePair();
  const b = pkcePair();
  assert.notEqual(a.verifier, b.verifier);
});

test('randomToken: a 43-character base64url string, different on every call', () => {
  const a = randomToken();
  const b = randomToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('store: put then take returns the value with reason null', () => {
  const store = createFlowStore();
  store.put('k1', { name: 'alice' }, FLOW_TTL_MS);
  const { value, reason } = store.take('k1');
  assert.deepEqual(value, { name: 'alice' });
  assert.equal(reason, null);
});

test('store: a second take on the same key reports the entry is gone', () => {
  const store = createFlowStore();
  store.put('k1', { name: 'alice' }, FLOW_TTL_MS);
  store.take('k1');
  const { value, reason } = store.take('k1');
  assert.equal(value, null);
  assert.equal(reason, 'state-unknown');
});

test('store: a key that was never put reports state-unknown, distinct from an expired one', () => {
  const store = createFlowStore();
  const { value, reason } = store.take('never-held');
  assert.equal(value, null);
  assert.equal(reason, 'state-unknown');
});

test('store: take after the clock passes the TTL reports state-expired, and the entry is gone afterwards', () => {
  let clock = 1000;
  const store = createFlowStore({ now: () => clock });
  store.put('k1', { name: 'alice' }, 5000);
  clock += 5001;
  const first = store.take('k1');
  assert.equal(first.value, null);
  assert.equal(first.reason, 'state-expired');
  const second = store.take('k1');
  assert.equal(second.reason, 'state-unknown', 'the expired entry was removed, not merely reported expired once');
});

test('store: peek returns the value and leaves the entry in place for a following take', () => {
  const store = createFlowStore();
  store.put('k1', { name: 'alice' }, FLOW_TTL_MS);
  const first = store.peek('k1');
  const second = store.peek('k1');
  assert.deepEqual(first.value, { name: 'alice' });
  assert.equal(first.reason, null);
  assert.deepEqual(second.value, { name: 'alice' });
  assert.equal(second.reason, null);
  const taken = store.take('k1');
  assert.deepEqual(taken.value, { name: 'alice' });
});

test('store: peek past the TTL reports state-expired', () => {
  let clock = 1000;
  const store = createFlowStore({ now: () => clock });
  store.put('k1', { name: 'alice' }, 5000);
  clock += 5001;
  const { value, reason } = store.peek('k1');
  assert.equal(value, null);
  assert.equal(reason, 'state-expired');
});

test('store: two keys held at once are independent - taking the first leaves the second untouched', () => {
  const store = createFlowStore();
  store.put('a', { who: 'first' }, FLOW_TTL_MS);
  store.put('b', { who: 'second' }, FLOW_TTL_MS);
  const takenA = store.take('a');
  assert.deepEqual(takenA.value, { who: 'first' });
  const peekB = store.peek('b');
  assert.deepEqual(peekB.value, { who: 'second' });
  const takenB = store.take('b');
  assert.deepEqual(takenB.value, { who: 'second' });
});

test('store: sweep removes only entries past the TTL, and size reflects the removal', () => {
  let clock = 1000;
  const store = createFlowStore({ now: () => clock });
  store.put('short', { who: 'short' }, 1000);
  store.put('long', { who: 'long' }, 10000);
  assert.equal(store.size(), 2);
  clock += 1500;
  store.sweep();
  assert.equal(store.size(), 1, 'only the expired entry was removed');
  const remaining = store.peek('long');
  assert.equal(remaining.reason, null, 'the unexpired entry survives a sweep');
});

test('store: put uses FLOW_TTL_MS by default, matching the module-level constant', () => {
  let clock = 1000;
  const store = createFlowStore({ now: () => clock });
  store.put('k1', { who: 'default-ttl' });
  clock += FLOW_TTL_MS - 1;
  assert.equal(store.peek('k1').reason, null, 'still alive one millisecond before the default TTL elapses');
  clock += 2;
  assert.equal(store.peek('k1').reason, 'state-expired', 'expired one millisecond after the default TTL elapses');
});

/* ---------- the capacity ceiling ---------- */

test('store: an expired entry is what makes room at the cap, before anything live is dropped', () => {
  let clock = 1000;
  const store = createFlowStore({ now: () => clock, maxEntries: 3 });
  store.put('stale', { who: 'abandoned' }, 10);
  clock += 100; // 'stale' is now expired, the two below are not
  store.put('live1', { who: 'one' });
  store.put('live2', { who: 'two' });
  store.put('live3', { who: 'three' }); // at the cap -> the expired entry is reclaimed
  assert.equal(store.peek('stale').value, null, 'the expired entry is gone');
  for (const k of ['live1', 'live2', 'live3']) {
    assert.equal(store.peek(k).reason, null, `${k} survived, because an expired entry made room`);
  }
});

test('store: past the cap with nothing expired, the oldest live entry is dropped and the newest kept', () => {
  const store = createFlowStore({ now: () => 1000, maxEntries: 3 });
  store.put('a', { who: 'a' });
  store.put('b', { who: 'b' });
  store.put('c', { who: 'c' });
  store.put('d', { who: 'd' });
  assert.equal(store.peek('a').value, null, 'the oldest attempt was evicted');
  assert.equal(store.peek('a').reason, 'state-unknown',
    'and reads as unknown, the same as an address that was never issued');
  for (const k of ['b', 'c', 'd']) {
    assert.equal(store.peek(k).reason, null, `${k} is still held`);
  }
});

test('store: a flood cannot grow the store without bound', () => {
  const store = createFlowStore({ now: () => 1000, maxEntries: 50 });
  for (let i = 0; i < 5000; i++) store.put('flood-' + i, { i });
  assert.equal(store.size(), 50, 'the ceiling holds regardless of how many arrive');
  assert.equal(store.peek('flood-4999').reason, null, 'and the most recent arrival is the one kept');
});

test('store: overwriting a key already held does not evict anything at the cap', () => {
  const store = createFlowStore({ now: () => 1000, maxEntries: 2 });
  store.put('x', { v: 1 });
  store.put('y', { v: 1 });
  store.put('x', { v: 2 }); // replaces rather than adds, so nothing needs to be made room for
  assert.equal(store.size(), 2);
  assert.equal(store.peek('y').reason, null, 'the other entry was not sacrificed to a replacement');
  assert.deepEqual(store.peek('x').value, { v: 2 });
});

test('store: MAX_FLOWS is the default ceiling', () => {
  assert.equal(typeof MAX_FLOWS, 'number');
  assert.ok(MAX_FLOWS > 0, 'a ceiling of zero would refuse every sign-in');
});

/* ---------- the app's own PKCE verifier check ---------- */

// RFC 7636 Appendix B's own worked example, so s256/verifierMatches are proven against a fixed
// vector and not merely against whatever pkcePair() itself would have produced.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

test('s256: matches the RFC 7636 Appendix B worked example', () => {
  assert.equal(s256(RFC_VERIFIER), RFC_CHALLENGE);
});

test('verifierMatches: true for the RFC 7636 verifier and its own challenge', () => {
  assert.equal(verifierMatches(RFC_VERIFIER, RFC_CHALLENGE), true);
});

test('verifierMatches: false for a different verifier under the same challenge', () => {
  const { verifier } = pkcePair();
  assert.notEqual(verifier, RFC_VERIFIER);
  assert.equal(verifierMatches(verifier, RFC_CHALLENGE), false);
});

test('verifierMatches: false for a verifier one character short of the RFC minimum', () => {
  assert.equal(verifierMatches(RFC_VERIFIER.slice(0, 42), RFC_CHALLENGE), false);
});

test('verifierMatches: false for a non-string verifier', () => {
  assert.equal(verifierMatches(12345, RFC_CHALLENGE), false);
  assert.equal(verifierMatches(null, RFC_CHALLENGE), false);
  assert.equal(verifierMatches(undefined, RFC_CHALLENGE), false);
});

test('verifierMatches: false for a verifier carrying a character outside the RFC 7636 unreserved set', () => {
  const withPlus = RFC_VERIFIER.slice(0, -1) + '+';
  assert.equal(verifierMatches(withPlus, RFC_CHALLENGE), false);
});

test('verifierMatches: false for a challenge one character short, one character long, or padded', () => {
  assert.equal(verifierMatches(RFC_VERIFIER, RFC_CHALLENGE.slice(0, 42)), false);
  assert.equal(verifierMatches(RFC_VERIFIER, RFC_CHALLENGE + 'x'), false);
  assert.equal(verifierMatches(RFC_VERIFIER, RFC_CHALLENGE.slice(0, 42) + '='), false);
});

test('isS256Challenge: accepts only a 43-character base64url string', () => {
  assert.equal(isS256Challenge(RFC_CHALLENGE), true);
  assert.equal(isS256Challenge(RFC_CHALLENGE.slice(0, 42)), false);
  assert.equal(isS256Challenge(RFC_CHALLENGE + 'x'), false);
  assert.equal(isS256Challenge(RFC_CHALLENGE.slice(0, 42) + '='), false);
  assert.equal(isS256Challenge(null), false);
});

test('hashAppCode: 64 hex characters, deterministic, and distinct from hashLinkCode of the same input', () => {
  const code = randomToken();
  const first = hashAppCode(code);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(hashAppCode(code), first, 'the same input always hashes the same way');
  assert.notEqual(first, hashLinkCode(code), 'the two code spaces must never collide on the same input');
});

test('store: an app-code entry lives for APP_CODE_TTL_MS, one millisecond short of a minute', () => {
  let clock = 1000;
  const store = createFlowStore({ now: () => clock });
  store.put('h1', { mode: 'signIn', uid: 'u1' }, APP_CODE_TTL_MS);
  clock += APP_CODE_TTL_MS - 1;
  assert.equal(store.peek('h1').reason, null, 'still alive one millisecond before APP_CODE_TTL_MS elapses');
  clock += 2;
  assert.equal(store.peek('h1').reason, 'state-expired', 'expired one millisecond after APP_CODE_TTL_MS elapses');
});
