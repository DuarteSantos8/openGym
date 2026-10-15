/* GET and POST /api/sync/onboarding (sync-routes.js, sync-seed.js): the hub's first-run onboarding
   reading what a profile has answered and writing its answers in. The same credential rules as
   every other sync route, a first document only for a new profile, and a write that changes nothing
   when it is sent again. Real server.js in a child, the harness of server-sync.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { ISSUER, hubKey, jwks, mint, badTokens } from './hub-fixtures.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const ORIGIN = 'http://localhost:8080';
const KEY = hubKey('hub-1');
const DAY = 86400000;
const P = '/api/sync/onboarding';
const session = uid => {
  const payload = `${uid}:${Date.now() + DAY}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const user = (id, name, extra = {}) => ({ id, name, created: new Date().toISOString(), ...extra });
const today = () => new Date().toISOString().slice(0, 10);
const SEED = () => ({
  unit: 'kg',
  bodyweight: { date: today(), kg: 72.5 },
  coachProfile: { goal: 'fatloss', experience: 'returning', daysPerWeek: 3, preferredDays: [1, 3, 5] },
  plan: {
    routines: [{ name: 'Full Body A', emoji: 'figureStrength', ex: [{ id: '0043', sets: 3, reps: 8 }] }],
    schedule: [{ day: 1, routine: 0 }, { day: 3, routine: 0 }, { day: 5, routine: 0 }]
  },
  checkIn: false
});

async function startServer(t, { users, states = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-onb-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
  for (const [uid, S] of Object.entries(states)) {
    fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), typeof S === 'string' ? S : JSON.stringify(S));
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', ADMIN_UIDS: '', AUDIT_LOG: '1', HUB_JWKS: jwks(KEY), HUB_ISSUER: ISSUER }
  });
  const h = { log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.req = async (method, p, { token, cookie, bearer, body, raw } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    if (cookie) headers.Cookie = 'gymsid=' + cookie;
    const r = await fetch(h.api + p, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    return { status: r.status, body: await r.json(), etag: r.headers.get('etag') };
  };
  h.state = uid => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8'));
  h.hasState = uid => fs.existsSync(path.join(dataDir, `state-${uid}.json`));
  h.rawState = uid => fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8');
  return h;
}

test('a new profile with no document gets its first one, and the same write again changes nothing', async t => {
  const h = await startServer(t, { users: [user('u1', 'Ana')] });
  const before = await h.req('GET', P, { token: mint(KEY, { sub: 'u1' }) });
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, {
    rev: 0, unit: 'kg', unitChosen: false, latestWeight: null, routines: 0, plannedDays: 0, coachProfile: null, checkIn: true
  });

  const first = await h.req('POST', P, { token: mint(KEY, { sub: 'u1' }), body: SEED() });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.changed, true);
  assert.deepEqual(first.body.applied, ['bodyweight', 'coachProfile', 'plan', 'checkIn']);
  assert.deepEqual(first.body.skipped, [{ field: 'unit', reason: 'same' }]);
  assert.equal(first.body.rev, 1);
  assert.equal(first.etag, `"1:${first.body.wid}"`);

  const S = h.state('u1');
  assert.equal(S.checkIn, false);
  assert.deepEqual(S.coach.profile, { goal: 'fatloss', experience: 'returning', daysPerWeek: 3, preferredDays: [1, 3, 5] });
  assert.equal(S.routines.length, 1);
  assert.deepEqual(S.week, { 1: [S.routines[0].id], 3: [S.routines[0].id], 5: [S.routines[0].id] });
  assert.deepEqual(S.bodyweight.map(e => [e.d, e.w]), [[today(), 72.5]]);

  // The outbox's retry: a new token, the same body.
  const again = await h.req('POST', P, { token: mint(KEY, { sub: 'u1' }), body: SEED() });
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  assert.deepEqual(again.body.applied, []);
  assert.equal(again.body.rev, 1);
  assert.deepEqual(h.state('u1'), S, 'the document is untouched');

  const view = await h.req('GET', P, { token: mint(KEY, { sub: 'u1' }) });
  assert.deepEqual(view.body.latestWeight, { date: today(), kg: 72.5 });
  assert.equal(view.body.routines, 1);
  assert.equal(view.body.plannedDays, 3);
  assert.equal(view.body.checkIn, false);
  assert.deepEqual(view.body.coachProfile, { goal: 'fatloss', experience: 'returning', daysPerWeek: 3, preferredDays: [1, 3, 5] });

  // The profile's own device sees it as a new revision, and its next push over the old one is a
  // conflict to merge, never an overwrite.
  const pulled = await h.req('GET', '/api/data', { cookie: session('u1') });
  assert.equal(pulled.body.rev, 1);
  assert.equal(pulled.body.state.checkIn, false);
  const stale = await h.req('PUT', '/api/data', { cookie: session('u1'), body: { state: { unit: 'kg', checkIn: true, routines: [] }, baseRev: 0, stamped: true } });
  assert.equal(stale.status, 409);
});

test('an older profile that never set check-in keeps it on', async t => {
  const old = new Date(Date.now() - 90 * DAY).toISOString();
  const h = await startServer(t, { users: [user('u1', 'Ana', { created: old })], states: { u1: { unit: 'kg', _rev: 3, _wid: 'bbbbbbbbbbbbbbbb' } } });
  const r = await h.req('POST', P, { token: mint(KEY, { sub: 'u1' }), body: { checkIn: false } });
  assert.deepEqual([r.status, r.body.changed, r.body.skipped], [200, false, [{ field: 'checkIn', reason: 'existing-profile' }]]);
  assert.equal(h.state('u1').checkIn, undefined);
});

test('a profile with data gets only what it is missing', async t => {
  const S = {
    unit: 'lb', unitSet: { at: 1, convert: true }, bodyweight: [{ d: '2026-01-01', w: 180, t: 5 }],
    routines: [{ id: 'mine', name: 'Push', ex: [] }], week: { 2: ['mine'] }, gymCards: [{ id: 'g', value: '1' }],
    _rev: 12, _wid: 'aaaaaaaaaaaaaaaa', _ts: 10
  };
  const h = await startServer(t, { users: [user('u1', 'Ana', { created: new Date(Date.now() - 400 * DAY).toISOString() })], states: { u1: S } });
  const r = await h.req('POST', P, { token: mint(KEY, { sub: 'u1' }), body: SEED() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.applied, ['bodyweight', 'coachProfile']);
  assert.deepEqual(r.body.skipped.map(s => s.field + ':' + s.reason), ['unit:chosen', 'plan:has-plan', 'checkIn:existing-profile']);
  assert.equal(r.body.rev, 13);
  const after = h.state('u1');
  assert.deepEqual(after.routines, S.routines);
  assert.equal(after.unit, 'lb');
  assert.deepEqual(after.bodyweight.map(e => [e.d, e.w]), [['2026-01-01', 180], [today(), 159.8]], '72.5 kg in lb, to 0.1');
  assert.deepEqual(after._wids, ['aaaaaaaaaaaaaaaa']);
});

test('an older profile with no document is the empty volume no-state exists for, and gets nothing', async t => {
  const h = await startServer(t, { users: [user('old', 'Ana', { created: new Date(Date.now() - 60 * DAY).toISOString() }), user('nodate', 'Bea', { created: undefined })] });
  for (const sub of ['old', 'nodate']) {
    const r = await h.req('POST', P, { token: mint(KEY, { sub }), body: SEED() });
    assert.equal(r.status, 409, sub);
    assert.deepEqual(r.body, { error: 'this profile has no data on this server yet', code: 'no-state', rev: 0 });
    assert.equal(h.hasState(sub), false);
  }
});

test('the credential rules of every sync route: a fresh hub token for this profile, and nothing else', async t => {
  const h = await startServer(t, { users: [user('u1', 'Ana'), user('u2', 'Bea', { disabled: true })] });
  for (const [name, token] of Object.entries(badTokens(KEY))) {
    for (const method of ['GET', 'POST']) {
      const r = await h.req(method, P, { token, body: method === 'POST' ? SEED() : undefined });
      assert.equal(r.status, 401, `${name} ${method}`);
      assert.equal(r.body.code, 'token-invalid', name);
    }
  }
  assert.equal(h.hasState('u1'), false, 'no refused write reached the profile');

  const once = mint(KEY, { sub: 'u1' });
  assert.equal((await h.req('POST', P, { token: once, body: { checkIn: false } })).status, 200);
  const replay = await h.req('POST', P, { token: once, body: { checkIn: false } });
  assert.deepEqual([replay.status, replay.body.code], [401, 'replay']);

  // A session is no hub token: the cookie and a paired device's bearer token are refused alike.
  assert.equal((await h.req('GET', P, { cookie: session('u1') })).status, 401);
  assert.equal((await h.req('POST', P, { bearer: session('u1'), body: { checkIn: false } })).status, 401);
  assert.equal((await h.req('GET', P)).status, 401);

  assert.deepEqual((await h.req('POST', P, { token: mint(KEY, { sub: 'u2' }), body: SEED() })).body.code, 'disabled');
  assert.deepEqual((await h.req('POST', P, { token: mint(KEY, { sub: 'nobody' }), body: SEED() })).body.code, 'user-gone');
});

test('a malformed or oversized body is refused before anything is read or written', async t => {
  const h = await startServer(t, { users: [user('u1', 'Ana')] });
  const tok = () => mint(KEY, { sub: 'u1' });
  assert.deepEqual((await h.req('POST', P, { token: tok(), body: { unit: 'stone' } })).body.code, 'bad-unit');
  assert.deepEqual((await h.req('POST', P, { token: tok(), body: { userId: 'u2' } })).body.code, 'bad-field');
  assert.deepEqual((await h.req('POST', P, { token: tok(), body: { plan: { routines: [], schedule: [] } } })).body.code, 'bad-plan');
  assert.equal((await h.req('POST', P, { token: tok(), raw: '{"checkIn":' })).status, 400);
  const big = await h.req('POST', P, { token: tok(), raw: JSON.stringify({ plan: { routines: [{ name: 'x'.repeat(40000), ex: [] }], schedule: [] } }) });
  assert.equal(big.status, 413);
  assert.equal(h.hasState('u1'), false);
});

test('an unreadable document is a 503, never a first document over it', async t => {
  const h = await startServer(t, { users: [user('u1', 'Ana')], states: { u1: '{"unit":' } });
  assert.equal((await h.req('GET', P, { token: mint(KEY, { sub: 'u1' }) })).status, 503);
  assert.equal((await h.req('POST', P, { token: mint(KEY, { sub: 'u1' }), body: SEED() })).status, 503);
  assert.equal(h.rawState('u1'), '{"unit":', 'the file is left for a restore');
});
