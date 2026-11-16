/* tokens.js on its own: making, finding (constant time, every rule that ends a token), what a
   scope reads and what it may write. The routes are in server-tokens.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createToken, findToken, listTokens, revokeTokens, touchToken, scopedState, mergeScoped, cleanTokenScopes,
  sameHash, ScopeError, TOKENS_MAX, readCategories,
} from '../tokens.js';

const user = (over = {}) => ({ id: 'u1', name: 'Ana', sv: 0, ...over });
const ownerOf = users => uid => users.find(u => u.id === uid) || null;

test('a token is shown once and stored only as its SHA-256', () => {
  const db = {};
  const { token, row } = createToken(db, user(), { name: 'Claude', scopes: { workouts: 'view' } });
  assert.match(token, /^ogt_[A-Za-z0-9_-]{43}$/);
  assert.equal(db.apiTokens.length, 1);
  assert.ok(!JSON.stringify(db).includes(token.slice(4)), 'db.json never holds the token');
  assert.match(row.h, /^[0-9a-f]{64}$/);
  assert.equal(row.hint, token.slice(4, 10));
  assert.deepEqual(row.scopes, { workouts: 'view', plans: 'off', bodyweight: 'off', measurements: 'off', notes: 'off' });
  const listed = listTokens(db, user());
  assert.equal(listed.length, 1);
  assert.equal(listed[0].h, undefined, 'the list carries no hash');
});

test('scopes are capped and a token that sees nothing is refused', () => {
  assert.deepEqual(cleanTokenScopes({ notes: 'apply', workouts: 'suggest', plans: 'apply', admin: 'apply' }),
    { workouts: 'off', plans: 'apply', bodyweight: 'off', measurements: 'off', notes: 'view' });
  assert.throws(() => createToken({}, user(), { scopes: {} }), e => e instanceof ScopeError && e.code === 'nothing-granted');
  assert.throws(() => createToken({}, user(), { scopes: { workouts: 'view' }, days: 5 }), e => e.code === 'bad-days');
  const db = {};
  for (let i = 0; i < TOKENS_MAX; i++) createToken(db, user(), { scopes: { workouts: 'view' } });
  assert.throws(() => createToken(db, user(), { scopes: { workouts: 'view' } }), e => e.code === 'too-many');
});

test('findToken: right token only, and every way a token ends', () => {
  const users = [user(), user({ id: 'u2', name: 'Bo' })];
  const db = {};
  const a = createToken(db, users[0], { scopes: { workouts: 'view' }, days: 7 }, 1000);
  const b = createToken(db, users[1], { scopes: { plans: 'apply' } }, 1000);
  assert.equal(findToken(db, a.token, ownerOf(users), 2000).userId, 'u1');
  assert.equal(findToken(db, b.token, ownerOf(users), 2000).userId, 'u2');
  // One character off, a session-shaped value, junk.
  const off = a.token.slice(0, -1) + (a.token.endsWith('A') ? 'B' : 'A');
  for (const bad of [off, a.token + 'x', 'ogt_', '', null, 42, 'u1:9999:0.mac', a.token.slice(4)]) {
    assert.equal(findToken(db, bad, ownerOf(users), 2000), null, String(bad));
  }
  // Expired (7 days).
  assert.equal(findToken(db, a.token, ownerOf(users), 1000 + 7 * 86400000), null);
  // Signed out everywhere: the session version moved.
  assert.equal(findToken(db, a.token, ownerOf([user({ sv: 1 }), users[1]]), 2000), null);
  assert.equal(listTokens(db, user({ sv: 1 }), 2000).length, 0, 'an ended token is not listed either');
  // Disabled, or deleted.
  assert.equal(findToken(db, a.token, ownerOf([user({ disabled: true }), users[1]]), 2000), null);
  assert.equal(findToken(db, a.token, ownerOf([users[1]]), 2000), null);
  // Revoked: one, then the rest of a profile's, never another profile's.
  assert.equal(revokeTokens(db, 'u1', a.row.id).length, 1);
  assert.equal(findToken(db, a.token, ownerOf(users), 2000), null);
  assert.equal(revokeTokens(db, 'u1').length, 0);
  assert.equal(findToken(db, b.token, ownerOf(users), 2000).userId, 'u2', "u1's revoke left u2's token alone");
});

test('the compare is constant time: crypto.timingSafeEqual over digests, never ===', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tokens.js'), 'utf8');
  assert.match(src, /timingSafeEqual/);
  const body = src.slice(src.indexOf('export function findToken'), src.indexOf('export function touchToken'));
  assert.ok(!/\.h\s*===|===\s*h\b/.test(body), 'findToken never compares hashes with ===');
  assert.ok(/for \(const r of db\.apiTokens/.test(body) && !/\.find\(/.test(body), 'every row is compared, no early exit');
  const h = crypto.createHash('sha256').update('x').digest('hex');
  assert.equal(sameHash(h, h), true);
  assert.equal(sameHash(h, h.slice(0, 62) + '00'), false);
  assert.equal(sameHash(h, 'zz'), false);
  assert.equal(sameHash(undefined, h), false);
});

test('touchToken saves at most once a minute', () => {
  const row = { used: null };
  assert.equal(touchToken(row, 1000), true);
  assert.equal(touchToken(row, 30000), false);
  assert.equal(touchToken(row, 70000), true);
});

const doc = () => ({
  _rev: 4, _wid: 'w4', unit: 'kg', weekStart: 1,
  workouts: [{ id: 'w1', d: '2026-11-01', entries: [] }], exWeights: { '0001': { w: 20 } },
  routines: [{ id: 'r1', name: 'A', ex: [] }], week: { 1: 'r1' }, queue: null,
  bodyweight: [{ d: '2026-11-01', w: 80 }], targetW: 78,
  measurements: [{ d: '2026-11-01', waist: 80 }], dayNotes: { '2026-11-02': { text: 'sick' } },
  customEx: [{ id: 'c1', n: 'Mine' }],
  dayPhotos: { abc: {} }, avatar: { hash: 'x' }, coach: { chat: [] }, active: { started: 1 },
  deleted: { workouts: { w0: 1 } }, edited: { unit: 1 }, _unstamped: {}, integrationsSeen: 1,
});

test('scopedState: a category reads its keys, settings ride along, the never list never does', () => {
  const S = doc();
  const w = scopedState(S, { workouts: 'view' });
  assert.ok(w.workouts && w.exWeights && w.customEx && w.unit === 'kg' && w._rev === 4);
  for (const k of ['routines', 'week', 'bodyweight', 'targetW', 'measurements', 'dayNotes']) assert.equal(k in w, false, k);
  for (const k of ['dayPhotos', 'avatar', 'coach', 'active', 'deleted', 'edited', '_unstamped', 'integrationsSeen']) assert.equal(k in w, false, k);
  const p = scopedState(S, { plans: 'apply' });
  assert.ok(p.routines && p.week && p.customEx && !p.workouts);
  const all = scopedState(S, { workouts: 'apply', plans: 'apply', bodyweight: 'apply', measurements: 'apply', notes: 'view' });
  for (const k of ['dayPhotos', 'avatar', 'coach', 'active']) assert.equal(k in all, false, k);
  assert.deepEqual(scopedState(S, {}), {}, 'a token that holds nothing reads nothing, settings included');
  assert.deepEqual(readCategories({ workouts: 'view', plans: 'apply', notes: 'off' }), ['workouts', 'plans']);
});

test('scopedState: own sounds never, body facts only with body weight or measurements (v1.4.5)', () => {
  const S = { ...doc(), sounds: [{ id: 's1', name: 'mine', m: { hash: 'a'.repeat(64) } }], heightCm: 181, birthYear: 1990, sex: 'female' };
  const plans = scopedState(S, { plans: 'view' });
  for (const k of ['sounds', 'heightCm', 'birthYear', 'sex']) assert.equal(k in plans, false, k);
  const bw = scopedState(S, { bodyweight: 'view' });
  assert.equal(bw.heightCm, 181); assert.equal(bw.sex, 'female'); assert.equal('sounds' in bw, false);
  assert.equal(scopedState(S, { measurements: 'view' }).birthYear, 1990);
  assert.throws(() => mergeScoped(S, { sounds: [] }, { workouts: 'apply' }), e => e.code === 'scope');
});

// A gym card's value is the code that opens the turnstile. It has no category, and it must not
// ride along as a setting either: no program needs it to read the training.
test('scopedState: gym check-in cards never, whatever the token holds', () => {
  const S = { ...doc(), gymCards: [{ id: 'g1', label: 'My gym', value: 'MEMBER-0001234', fmt: 'code128' }], lastGymCardId: 'g1', checkIn: true };
  const all = { workouts: 'apply', plans: 'apply', bodyweight: 'apply', measurements: 'apply', notes: 'view' };
  for (const scopes of [{ notes: 'view' }, { workouts: 'view' }, all]) {
    const got = scopedState(S, scopes);
    for (const k of ['gymCards', 'lastGymCardId']) assert.equal(k in got, false, k);
    assert.equal(got.checkIn, true, 'the switch is a setting like any other');
    assert.equal(JSON.stringify(got).includes('MEMBER-0001234'), false);
  }
  assert.throws(() => mergeScoped(S, { gymCards: [] }, all), e => e.code === 'scope');
});

test('mergeScoped: writes what it may, ignores what it read back unchanged, refuses the rest', () => {
  const S = doc();
  const scopes = { workouts: 'apply', plans: 'view' };
  const sent = scopedState(S, scopes);
  sent.workouts = [...sent.workouts, { id: 'w2', d: '2026-11-03', entries: [] }];
  const { next, touched } = mergeScoped(S, sent, scopes);
  assert.equal(next.workouts.length, 2);
  assert.deepEqual(touched, ['workouts']);
  assert.deepEqual(next.dayPhotos, S.dayPhotos, 'what the token never saw stays as stored');
  assert.deepEqual(next.coach, S.coach);
  assert.equal(S.workouts.length, 1, 'the stored copy is not touched');
  // A key it may only see, changed: refused.
  assert.throws(() => mergeScoped(S, { ...sent, routines: [] }, scopes), e => e.status === 403 && e.code === 'scope');
  // A setting: read only.
  assert.throws(() => mergeScoped(S, { unit: 'lb' }, scopes), e => e.code === 'scope');
  // A key it could never read, even sent "unchanged".
  assert.throws(() => mergeScoped(S, { dayPhotos: S.dayPhotos }, scopes), e => e.code === 'scope');
  assert.throws(() => mergeScoped(S, { bodyweight: S.bodyweight }, scopes), e => e.code === 'scope');
  // Bookkeeping is the server's.
  assert.deepEqual(mergeScoped(S, { _rev: 99, _wid: 'x' }, scopes).touched, []);
  // A view-only token writes nothing at all.
  assert.throws(() => mergeScoped(S, { workouts: [] }, { workouts: 'view' }), e => e.code === 'scope');
  // customEx with plans at apply but workouts only at view.
  const r = mergeScoped(S, { customEx: [] }, { plans: 'apply', workouts: 'view' });
  assert.deepEqual(r.touched, ['plans']);
  assert.throws(() => mergeScoped(S, [], scopes), e => e.code === 'bad-state');
  // Keys every object inherits name no category: refused like any other, never a crash.
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => mergeScoped(S, JSON.parse(`{"${k}": {"polluted": 1}}`), scopes), e => e.code === 'scope', k);
  }
  assert.equal({}.polluted, undefined);
  assert.equal('constructor' in scopedState({ constructor: 1, workouts: [] }, scopes), true, 'an own key named constructor is a setting');
});

test('at the limit an evictable token makes room (the least recently used), others never', async () => {
  const { createToken, TOKENS_MAX } = await import('../tokens.js');
  const db = { apiTokens: [] };
  const user = { id: 'u1', sv: 0 };
  for (let i = 0; i < TOKENS_MAX; i++) {
    const { row } = createToken(db, user, { name: 'n' + i, scopes: { workouts: 'view' } }, 1000 + i);
    if (i < 3) { row.connector = { assistant: 'claude' }; row.used = 5000 - i; }
  }
  assert.throws(() => createToken(db, user, { name: 'x', scopes: { workouts: 'view' } }, 9000), /at most/);
  createToken(db, user, { name: 'x', scopes: { workouts: 'view' }, evict: r => !!r.connector }, 9000);
  assert.equal(db.apiTokens.length, TOKENS_MAX);
  assert.ok(!db.apiTokens.some(r => r.name === 'n2'), 'the connector used longest ago went');
});

test('a connector access token past aexp is not found; rotateToken changes the value on the same row', async () => {
  const { createToken, findToken, rotateToken } = await import('../tokens.js');
  const db = { apiTokens: [] };
  const user = { id: 'u1', sv: 0 };
  const { token, row } = createToken(db, user, { name: 'c', scopes: { workouts: 'view' } }, 1000);
  row.aexp = 5000;
  assert.equal(findToken(db, token, () => user, 4000), row);
  assert.equal(findToken(db, token, () => user, 6000), null);
  row.aexp = null;
  const next = rotateToken(row);
  assert.equal(findToken(db, token, () => user, 6000), null);
  assert.equal(findToken(db, next, () => user, 6000), row);
});
