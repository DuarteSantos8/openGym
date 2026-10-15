/* The /api/sync/* routes (sync-routes.js): a hub token and nothing else gets in, the profile is
   checked on every call, and a hub token is no credential anywhere else. Real server.js in a
   child, the same harness as server-data-rev-endpoint.test.js. */
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
const session = (uid, sv = 0) => {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const user = (id, name, extra = {}) => ({ id, name, created: new Date().toISOString(), ...extra });
const USERS = [user('u1', 'Ana'), user('u2', 'Bea', { disabled: true }), user('adm', 'Root', { admin: true })];
const STATES = { u1: { unit: 'kg', workouts: [], _rev: 7, _wid: '0123456789abcdef' } };

async function startServer(t, { env = { HUB_JWKS: jwks(KEY), HUB_ISSUER: ISSUER }, users = USERS, states = STATES, gone = [] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-sync-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [], gone }));
  for (const [uid, S] of Object.entries(states)) fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify(S));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', ADMIN_UIDS: '', AUDIT_LOG: '1', HUB_JWKS: '', HUB_ISSUER: '', ...env }
  });
  const h = { log: '', dataDir, child };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  // `send` also hands back the ETag; `req` is the status and body alone, for deepEqual.
  h.send = async (method, p, { token, cookie, bearer, body, ifMatch } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    if (cookie) headers.Cookie = 'gymsid=' + cookie;
    if (ifMatch != null) headers['If-Match'] = ifMatch;
    const r = await fetch(h.api + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json(), etag: r.headers.get('etag') };
  };
  h.req = async (method, p, opts) => { const { status, body } = await h.send(method, p, opts); return { status, body }; };
  h.state = uid => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8'));
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.auditText = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'); } catch { return ''; } };
  return h;
}

test('a valid sync token reads ping and rev, and rev is what the profile’s own devices see', async t => {
  const h = await startServer(t);
  const ping = await h.req('GET', '/api/sync/ping', { token: mint(KEY, { sub: 'u1' }) });
  assert.equal(ping.status, 200);
  assert.deepEqual(ping.body, { ok: true, user: { id: 'u1', name: 'Ana' } });

  const rev = await h.req('GET', '/api/sync/rev', { token: mint(KEY, { sub: 'u1' }) });
  assert.equal(rev.status, 200);
  assert.deepEqual(rev.body, { rev: 7, wid: '0123456789abcdef' });
  assert.deepEqual((await h.req('GET', '/api/data/rev', { cookie: session('u1') })).body, rev.body);

  // A profile with no state yet is revision 0, as on /api/data/rev.
  assert.deepEqual((await h.req('GET', '/api/sync/rev', { token: mint(KEY, { sub: 'adm' }) })).body, { rev: 0 });
});

test('every way a token can be wrong is a 401, audited by reason and never with the token', async t => {
  const h = await startServer(t);
  const tokens = badTokens(KEY);
  for (const [name, token] of Object.entries(tokens)) {
    for (const p of ['/api/sync/ping', '/api/sync/rev']) {
      const r = await h.req('GET', p, { token });
      assert.equal(r.status, 401, `${name} on ${p}`);
      assert.deepEqual(r.body, { error: 'invalid sync token', code: 'token-invalid' }, name);
    }
  }
  const log = h.auditText();
  assert.match(log, /"ev":"sync\.token\.fail"/);
  for (const token of Object.values(tokens)) {
    for (const seg of token.split('.').filter(s => s.length > 20)) assert.ok(!log.includes(seg), 'no part of a token reaches the audit log');
    assert.ok(!h.log.includes(token), 'nor the container log');
  }
  assert.equal(h.log.split('\n').filter(l => /^\s+at /.test(l)).length, 0, `no stack traces:\n${h.log}`);
});

/* GET /api/sync/users: the one route about no single profile. Its token has its own audience,
   scope and `sub` (hub-token.js); docs/SYNC_USERS.md says why. */
const LIST = '/api/sync/users';
const listToken = (claims = {}, sub = 'hub') => mint(KEY, { sub, claims: { aud: 'opengym-sync-users', scope: 'sync-list', ...claims } });
const REFUSED = { status: 401, body: { error: 'invalid sync token', code: 'token-invalid' } };

test('a valid listing token lists every profile: id, state and revision, in id order, and nothing else', async t => {
  const goneAt = Date.now() - 86400000;
  const h = await startServer(t, { gone: [{ id: 'old1', at: goneAt }] });
  const r = await h.req('GET', LIST, { token: listToken() });
  assert.deepEqual(r, {
    status: 200,
    body: {
      users: [
        { id: 'adm', state: 'active', rev: 0 },
        { id: 'old1', state: 'gone', rev: 0, gone_at: goneAt },
        { id: 'u1', state: 'active', rev: 7, wid: '0123456789abcdef' },
        { id: 'u2', state: 'disabled', rev: 0 }
      ],
      next_after: null
    }
  });
  const text = JSON.stringify(r.body);
  for (const secret of ['Ana', 'Bea', 'Root', 'created', 'name']) assert.ok(!text.includes(secret), `${secret} never leaves`);
});

test('the listing is paged by key: limit and after walk every profile once', async t => {
  const h = await startServer(t);
  const ids = [];
  let after = null;
  for (let i = 0; i < 5; i++) {
    const r = await h.req('GET', `${LIST}?limit=1${after ? '&after=' + after : ''}`, { token: listToken() });
    assert.equal(r.status, 200);
    assert.equal(r.body.users.length, 1);
    ids.push(r.body.users[0].id);
    after = r.body.next_after;
    if (!after) break;
  }
  assert.deepEqual(ids, ['adm', 'u1', 'u2']);
  for (const q of ['limit=0', 'limit=65', 'limit=501', 'limit=x', 'limit=1.5', 'limit=-1']) {
    assert.deepEqual(await h.req('GET', `${LIST}?${q}`, { token: listToken() }), { status: 400, body: { error: 'limit must be 1 to 64', code: 'bad-limit' } }, q);
  }
  assert.equal((await h.req('GET', `${LIST}?limit=64`, { token: listToken() })).status, 200);
  for (const q of ['after=a%20b', 'after=..%2Fx', 'after=' + 'a'.repeat(65)]) {
    assert.equal((await h.req('GET', `${LIST}?${q}`, { token: listToken() })).body.code, 'bad-cursor', q);
  }
});

test('a profile deleted by an admin is listed as gone, with when, and the delete is the only thing recorded', async t => {
  const h = await startServer(t);
  const before = Date.now();
  const del = await fetch(`${h.api}/api/admin/user/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'gymsid=' + session('adm'), Origin: ORIGIN }, body: JSON.stringify({ id: 'u1' })
  });
  assert.equal(del.status, 200);
  const r = await h.req('GET', LIST, { token: listToken() });
  const gone = r.body.users.find(u => u.id === 'u1');
  assert.deepEqual({ ...gone, gone_at: typeof gone.gone_at }, { id: 'u1', state: 'gone', rev: 0, gone_at: 'number' });
  assert.ok(gone.gone_at >= before && gone.gone_at <= Date.now());
  assert.deepEqual(h.db().gone.map(g => Object.keys(g).sort()), [['at', 'id']]);
  assert.deepEqual(r.body.users.filter(u => u.id !== 'u1').map(u => u.state), ['active', 'disabled']);
});

test('the listing token is not a per-profile token and a per-profile token is not a listing token', async t => {
  const h = await startServer(t);
  // A listing token on a per-profile route, with the profile it would need to name or without.
  for (const sub of ['hub', 'u1']) {
    assert.deepEqual(await h.req('GET', '/api/sync/ping', { token: listToken({}, sub) }), REFUSED, `list token, sub ${sub}, on ping`);
    assert.deepEqual(await h.req('GET', '/api/sync/rev', { token: listToken({}, sub) }), REFUSED, `list token, sub ${sub}, on rev`);
  }
  // A per-profile token on the listing: its own audience and scope, and the one a profile's `sub`.
  assert.deepEqual(await h.req('GET', LIST, { token: mint(KEY, { sub: 'u1' }) }), REFUSED, 'per-profile token');
  assert.deepEqual(await h.req('GET', LIST, { token: mint(KEY, { sub: 'hub' }) }), REFUSED, 'per-profile token with sub hub');
  // One thing wrong at a time.
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({ aud: 'opengym-sync' }) }), REFUSED, 'wrong audience, right scope');
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({ scope: 'sync' }) }), REFUSED, 'right audience, wrong scope');
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({ aud: ['opengym-sync-users'] }) }), REFUSED, 'audience as an array');
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({}, 'u1') }), REFUSED, 'a profile id for sub');
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({}, 'someone-else') }), REFUSED, 'anyone else for sub');
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({ iss: 'https://evil.example.test/hub' }) }), REFUSED, 'wrong issuer');
  const t0 = Math.floor(Date.now() / 1000);
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({ iat: t0 - 120, exp: t0 - 60 }) }), REFUSED, 'expired');
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({ iat: t0, exp: t0 + 61 }) }), REFUSED, 'lives over 60 s');
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({ jti: 'short' }) }), REFUSED, 'short jti');
  // No credential at all, and a session or a paired token, which count as none.
  assert.deepEqual(await h.req('GET', LIST), { status: 401, body: { error: 'not signed in' } });
  assert.deepEqual(await h.req('GET', LIST, { cookie: session('adm') }), { status: 401, body: { error: 'not signed in' } });
  assert.equal((await h.req('GET', LIST, { bearer: session('adm') })).status, 401);
  assert.match(h.auditText(), /"ev":"sync\.token\.fail"/);
  assert.ok(!h.auditText().includes('opengym-sync-users'), 'the token itself is not logged');
});

test('a listing token is good for one call, and its jti is spent on every route', async t => {
  const h = await startServer(t);
  const once = listToken();
  assert.equal((await h.req('GET', LIST, { token: once })).status, 200);
  assert.deepEqual(await h.req('GET', LIST, { token: once }), { status: 401, body: { error: 'sync token already used', code: 'replay' } });
  assert.match(h.auditText(), /"msg":"replay"/);
  // One jti on two routes: the second, whichever it is, is a replay. A per-profile token that
  // reuses a spent listing token's jti is refused for its audience and scope first, so the cache
  // is shared only by tokens that could have passed.
  const jti = 'A'.repeat(22);
  assert.equal((await h.req('GET', '/api/sync/ping', { token: mint(KEY, { sub: 'u1', claims: { jti } }) })).status, 200);
  assert.equal((await h.req('GET', LIST, { token: listToken({ jti }) })).body.code, 'replay');
});

test('a bad listing token is a 401 and is audited through the aggregated sync failure row, never the token', async t => {
  const h = await startServer(t);
  // Three of one reason and one of another: the first of each is written at once and the repeats
  // are held to a counted row an hour later (audit-aggregate.js), so two rows, not four.
  for (let i = 0; i < 3; i++) assert.deepEqual(await h.req('GET', LIST, { token: 'not-a-token' }), REFUSED);
  assert.deepEqual(await h.req('GET', LIST, { token: listToken({}, 'u1') }), REFUSED);
  const rows = h.auditText().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.ev === 'sync.token.fail');
  assert.deepEqual(rows.map(r => r.msg).sort(), ['malformed', 'sub']);
  assert.ok(rows.every(r => r.ok === false && r.n === undefined));
  assert.ok(!h.log.includes('server error'), 'a refusal is never a 500');
  assert.ok(!h.auditText().includes('not-a-token'));
  // The replay of a spent listing token takes the same path.
  const once = listToken();
  assert.equal((await h.req('GET', LIST, { token: once })).status, 200);
  assert.equal((await h.req('GET', LIST, { token: once })).body.code, 'replay');
  assert.match(h.auditText(), /"msg":"replay"/);
});

test('the listing carries the write id, and a restored backup that reuses a revision shows as a different row', async t => {
  const h = await startServer(t);
  const rowOf = async () => (await h.req('GET', LIST, { token: listToken() })).body.users.find(u => u.id === 'u1');
  assert.deepEqual(await rowOf(), { id: 'u1', state: 'active', rev: 7, wid: '0123456789abcdef' });
  // Same revision, other contents and write id, as after a restore: the rows must differ.
  fs.writeFileSync(path.join(h.dataDir, 'state-u1.json'), JSON.stringify({ unit: 'lb', workouts: [], _rev: 7, _wid: 'fedcba9876543210' }));
  assert.deepEqual(await rowOf(), { id: 'u1', state: 'active', rev: 7, wid: 'fedcba9876543210' });
  // And it is what /api/sync/rev says for the profile.
  assert.deepEqual((await h.req('GET', '/api/sync/rev', { token: mint(KEY, { sub: 'u1' }) })).body, { rev: 7, wid: 'fedcba9876543210' });
});

test('records of deleted profiles older than 90 days are dropped when the listing is read, not listed and not kept', async t => {
  const day = 86400000;
  const h = await startServer(t, { gone: [{ id: 'old1', at: Date.now() - 91 * day }, { id: 'new1', at: Date.now() - 89 * day }] });
  const r = await h.req('GET', LIST, { token: listToken() });
  assert.deepEqual(r.body.users.filter(u => u.state === 'gone').map(u => u.id), ['new1']);
  assert.deepEqual(h.db().gone.map(g => g.id), ['new1']);
});

test('the listing is rate limited per minute, counting only calls that carry a valid token', async t => {
  const h = await startServer(t);
  // Junk spends nothing: a hundred and fifty refused calls leave the whole allowance.
  for (let i = 0; i < 150; i++) assert.equal((await h.req('GET', LIST, { token: 'not-a-token' })).status, 401);
  for (let i = 0; i < 120; i++) assert.equal((await h.req('GET', LIST, { token: listToken() })).status, 200, `call ${i + 1}`);
  const over = await h.send('GET', LIST, { token: listToken() });
  assert.equal(over.status, 429);
  assert.equal(over.body.code, 'rate-limited');
  assert.ok(over.body.retryAfter >= 1 && over.body.retryAfter <= 60);
  // The per-profile routes are not held by it.
  assert.equal((await h.req('GET', '/api/sync/ping', { token: mint(KEY, { sub: 'u1' }) })).status, 200);
});

test('a disabled profile and one with no state yet are listed, not errors', async t => {
  const h = await startServer(t, { users: [user('only', 'Solo', { disabled: true })], states: {} });
  assert.deepEqual((await h.req('GET', LIST, { token: listToken() })).body, { users: [{ id: 'only', state: 'disabled', rev: 0 }], next_after: null });
});

test('an instance with no hub answers the listing with the plain 404', async t => {
  const h = await startServer(t, { env: {} });
  assert.deepEqual(await h.req('GET', LIST, { token: listToken() }), { status: 404, body: { error: 'not found' } });
});

test('the profile is checked on every call: disabled is 401, deleted is 404 user-gone', async t => {
  const h = await startServer(t);
  assert.deepEqual(await h.req('GET', '/api/sync/ping', { token: mint(KEY, { sub: 'u2' }) }),
    { status: 401, body: { error: 'this account has been disabled', code: 'disabled' } });
  assert.deepEqual(await h.req('GET', '/api/sync/rev', { token: mint(KEY, { sub: 'nobody' }) }),
    { status: 404, body: { error: 'no such user', code: 'user-gone' } });

  // Disabled and then deleted while the hub is syncing: the next call says so.
  assert.equal((await h.req('GET', '/api/sync/ping', { token: mint(KEY, { sub: 'u1' }) })).status, 200);
  assert.equal((await h.req('POST', '/api/admin/user/disable', { cookie: session('adm'), body: { id: 'u1', disabled: true } })).status, 200);
  assert.equal((await h.req('GET', '/api/sync/rev', { token: mint(KEY, { sub: 'u1' }) })).body.code, 'disabled');
  assert.equal((await h.req('POST', '/api/admin/user/delete', { cookie: session('adm'), body: { id: 'u1' } })).status, 200);
  assert.equal((await h.req('GET', '/api/sync/rev', { token: mint(KEY, { sub: 'u1' }) })).body.code, 'user-gone');
});

test('a session cookie or a paired Bearer token cannot call /api/sync/*', async t => {
  const h = await startServer(t);
  for (const p of ['/api/sync/ping', '/api/sync/rev']) {
    assert.deepEqual(await h.req('GET', p), { status: 401, body: { error: 'not signed in' } });
    assert.deepEqual(await h.req('GET', p, { cookie: session('u1') }), { status: 401, body: { error: 'not signed in' } });
    assert.deepEqual(await h.req('GET', p, { cookie: session('adm') }), { status: 401, body: { error: 'not signed in' } });
    const paired = await h.req('GET', p, { bearer: session('u1') });
    assert.equal(paired.status, 401);
    assert.equal(paired.body.code, 'token-invalid');
  }
  // The same cookie is a working session everywhere else: it is refused here, not broken.
  assert.equal((await h.req('GET', '/api/me', { cookie: session('u1') })).status, 200);
  assert.equal((await h.req('GET', '/api/me', { bearer: session('u1') })).status, 200);
});

test('a sync token is no credential on any other route, not even for an admin', async t => {
  const h = await startServer(t);
  const before = h.db();
  const token = () => mint(KEY, { sub: 'adm' });
  const routes = [
    ['GET', '/api/me'], ['GET', '/api/data'], ['GET', '/api/data/rev'], ['PUT', '/api/data', { state: {}, baseRev: 0 }],
    ['POST', '/api/logout'], ['POST', '/api/logout/all'], ['POST', '/api/pair/create'],
    ['GET', '/api/account/passkeys'], ['POST', '/api/account/passkeys/options'], ['DELETE', '/api/account/passkeys'],
    ['POST', '/api/account/device-link'], ['GET', '/api/admin/users'], ['GET', '/api/admin/user?id=u1'],
    ['POST', '/api/admin/user/disable', { id: 'u1', disabled: true }], ['POST', '/api/admin/user/delete', { id: 'u1' }],
    ['POST', '/api/admin/invites/new'],
    ['GET', '/api/coach/status'], ['GET', '/api/admin/coach']
  ];
  for (const [method, p, body = {}] of routes) {
    const none = await h.req(method, p, { body: method === 'GET' ? undefined : body });
    const sync = await h.req(method, p, { token: token(), body: method === 'GET' ? undefined : body });
    assert.deepEqual(sync, none, `${method} ${p}: a sync token gets exactly what no credential gets`);
    if (p !== '/api/logout') assert.ok(sync.status >= 400, `${method} ${p} answered ${sync.status}`);
  }
  assert.deepEqual(h.db(), before, 'nothing about any account changed');
});

test('without HUB_JWKS the sync routes do not exist', async t => {
  const h = await startServer(t, { env: { HUB_ISSUER: ISSUER } });
  for (const [method, p] of [['GET', '/api/sync/ping'], ['GET', '/api/sync/rev'], ['GET', '/api/sync/workouts'], ['GET', '/api/sync/bodyweight'],
    ['PUT', '/api/sync/bodyweight/2026-10-10'], ['DELETE', '/api/sync/bodyweight/2026-10-10']]) {
    assert.deepEqual(await h.req(method, p, { token: mint(KEY, { sub: 'u1' }), ifMatch: '"7"', body: method === 'PUT' ? { kg: 80 } : undefined }),
      { status: 404, body: { error: 'not found' } }, `${method} ${p}`);
  }
  assert.equal(h.state('u1')._rev, 7);
});

test('HUB_ISSUER without HUB_JWKS boots with one line saying sync is off; neither, or both, says nothing', async t => {
  const line = /HUB_ISSUER is set but HUB_JWKS is empty/;
  // stderr and stdout are separate pipes: the boot line on one does not wait for the other.
  const settled = async h => { await h.req('GET', '/api/health'); return h.log; };
  const half = await settled(await startServer(t, { env: { HUB_ISSUER: ISSUER } }));
  assert.equal(half.split('\n').filter(l => line.test(l)).length, 1, half);
  assert.doesNotMatch(await settled(await startServer(t, { env: {} })), line);
  assert.doesNotMatch(await settled(await startServer(t)), line);
});

test('a HUB_JWKS that cannot be used stops the boot instead of switching sync off', async t => {
  for (const env of [{ HUB_JWKS: '{nope', HUB_ISSUER: ISSUER }, { HUB_JWKS: jwks(KEY), HUB_ISSUER: '' }]) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-sync-boot-'));
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const child = spawn(process.execPath, ['server.js'], {
      cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', ...env }
    });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => out += d);
    // 'close', not 'exit': the streams are drained by then, so the reason is in `out`.
    const code = await new Promise(resolve => child.once('close', resolve));
    assert.equal(code, 1, out);
    assert.match(out, /Refusing to start/);
    assert.doesNotMatch(out, /gym-api on :/);
  }
});

/* ------------------------------------------------------------------ the data routes */

const T0 = 1_760_000_000_000;
const lift = (id, over = {}) => ({
  id, d: '2026-10-10', start: T0, end: T0 + 50 * 60000, name: 'Push day', bw: 80, _ts: T0 + 60 * 60000,
  entries: [{ id: '0001', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }], ...over
});
const profile = (over = {}) => ({
  unit: 'kg', lang: 'en', _rev: 7, _wid: '0123456789abcdef', _ts: T0,
  workouts: [lift('w1'), lift('w2', { d: '2026-10-11' })],
  bodyweight: [{ d: '2026-10-09', w: 80.2, t: T0 - 86400000 }, { d: '2026-10-10', w: 80, t: T0 }],
  ...over
});
const tok = (sub = 'u1', claims) => mint(KEY, { sub, claims });
const put = (h, date, body, ifMatch, token = tok()) => h.send('PUT', `/api/sync/bodyweight/${date}`, { token, body, ifMatch });

test('every data route: the same auth as ping, a replayed jti refused, nothing written by a refused call', async t => {
  const h = await startServer(t, { states: { u1: profile() } });
  const calls = [
    ['GET', '/api/sync/workouts'], ['GET', '/api/sync/bodyweight?from=2026-10-01'],
    ['PUT', '/api/sync/bodyweight/2026-10-12', { kg: 79.5 }], ['DELETE', '/api/sync/bodyweight/2026-10-09'],
    ['GET', '/api/sync/ping'], ['GET', '/api/sync/rev']
  ];
  const before = h.state('u1');
  const go = (method, p, body, opts) => h.req(method, p, { body, ifMatch: '"7:0123456789abcdef"', ...opts });
  for (const [method, p, body] of calls) {
    const name = `${method} ${p}`;
    assert.deepEqual(await go(method, p, body, {}), { status: 401, body: { error: 'not signed in' } }, name);
    assert.deepEqual(await go(method, p, body, { cookie: session('u1') }), { status: 401, body: { error: 'not signed in' } }, name);
    assert.equal((await go(method, p, body, { bearer: session('u1') })).body.code, 'token-invalid', name);
    for (const claims of [{ aud: 'nutritrace' }, { scope: 'user' }]) {
      assert.deepEqual(await go(method, p, body, { token: tok('u1', claims) }),
        { status: 401, body: { error: 'invalid sync token', code: 'token-invalid' } }, `${name} ${JSON.stringify(claims)}`);
    }
    assert.deepEqual(await go(method, p, body, { token: tok('u2') }), { status: 401, body: { error: 'this account has been disabled', code: 'disabled' } }, name);
    assert.deepEqual(await go(method, p, body, { token: tok('nobody') }), { status: 404, body: { error: 'no such user', code: 'user-gone' } }, name);
    // A token used once is spent, whatever the first call made of it (here: a profile that is gone).
    const once = tok('nobody');
    assert.equal((await go(method, p, body, { token: once })).status, 404, name);
    assert.deepEqual(await go(method, p, body, { token: once }), { status: 401, body: { error: 'sync token already used', code: 'replay' } }, name);
  }
  assert.deepEqual(h.state('u1'), before, 'no refused call wrote anything');

  // A replayed write is refused before it reaches the profile, even with a precondition that holds.
  const w = tok();
  const first = await put(h, '2026-10-12', { kg: 79.5 }, '"7:0123456789abcdef"', w);
  assert.equal(first.status, 200);
  const again = await put(h, '2026-10-12', { kg: 70 }, first.etag, w);
  assert.deepEqual({ status: again.status, body: again.body }, { status: 401, body: { error: 'sync token already used', code: 'replay' } });
  assert.equal(h.state('u1').bodyweight.find(e => e.d === '2026-10-12').w, 79.5);
  assert.match(h.auditText(), /"msg":"replay"/);
});

test('workouts: everything first, then exactly what changed since the pass a token names, removals included', async t => {
  const h = await startServer(t, { states: { u1: profile() } });
  const all = await h.send('GET', '/api/sync/workouts', { token: tok() });
  assert.equal(all.status, 200);
  assert.equal(all.body.rev, 7);
  assert.equal(all.body.wid, '0123456789abcdef');
  assert.equal(all.etag, '"7:0123456789abcdef"');
  assert.equal(all.body.full, true);
  assert.equal(all.body.unit, 'kg');
  assert.equal(all.body.reset_at, null);
  assert.equal(all.body.next_cursor, null);
  assert.deepEqual(all.body.items.map(i => i.id), ['w1', 'w2']);
  const w1 = all.body.items[0];
  assert.deepEqual({ ...w1, content_hash: undefined }, {
    id: 'w1', date: '2026-10-10', start: T0, end: T0 + 50 * 60000, duration_min: 50, name: 'Push day', routine_id: null,
    sets_done: 2, strength_sets: 2, cardio: [], distance_km: null, bodyweight_kg: 80, edited_at: T0 + 60 * 60000, content_hash: undefined
  });
  assert.deepEqual(all.body.deleted, []);
  assert.match(all.body.next_since, /^[A-Za-z0-9_-]+$/);

  // Nothing since: nothing.
  const none = await h.req('GET', `/api/sync/workouts?since=${all.body.next_since}`, { token: tok() });
  assert.deepEqual([none.body.items, none.body.deleted, none.body.full], [[], [], false]);

  // A browser (an app that does not stamp) edits w1, removes w2 and logs w3.
  const S = profile();
  S.workouts = [lift('w1', { name: 'Push day, heavy' }), lift('w3', { d: '2026-10-12' })];
  const pushed = await h.req('PUT', '/api/data', { cookie: session('u1'), body: { state: S, baseRev: 7 } });
  assert.equal(pushed.status, 200);
  const since = await h.req('GET', `/api/sync/workouts?since=${none.body.next_since}`, { token: tok() });
  assert.equal(since.body.rev, pushed.body.rev);
  assert.equal(since.body.full, false);
  assert.deepEqual(since.body.items.map(i => [i.id, i.name]), [['w1', 'Push day, heavy'], ['w3', 'Push day']]);
  assert.deepEqual(since.body.deleted.map(d => d.id), ['w2']);
  assert.ok(since.body.deleted[0].deleted_at > 0, 'the removal on record');
  assert.notEqual(since.body.items[0].content_hash, w1.content_hash);
  // And from the token that answer gave, nothing again.
  const after = await h.req('GET', `/api/sync/workouts?since=${since.body.next_since}`, { token: tok() });
  assert.deepEqual([after.body.items, after.body.deleted, after.body.full], [[], [], false]);
  // A revision (what every other route hands out), or anything else: everything.
  for (const s of [String(since.body.rev), '7', 'abc', '-1']) {
    const r = await h.req('GET', `/api/sync/workouts?since=${s}`, { token: tok() });
    assert.deepEqual([r.status, r.body.full, r.body.items.length], [200, true, 2], s);
  }
});

test('workouts page by cursor, and every query is checked', async t => {
  const many = Array.from({ length: 12 }, (_, i) => lift(`w${String(i).padStart(2, '0')}`));
  const h = await startServer(t, { states: { u1: profile({ workouts: many }) } });
  const ids = [];
  let cursor = null, pages = 0;
  do {
    const r = await h.req('GET', `/api/sync/workouts?limit=5${cursor ? '&cursor=' + cursor : ''}`, { token: tok() });
    assert.equal(r.status, 200);
    assert.ok(r.body.items.length <= 5);
    ids.push(...r.body.items.map(i => i.id));
    cursor = r.body.next_cursor;
    pages++;
  } while (cursor);
  assert.equal(pages, 3);
  assert.deepEqual(ids, many.map(w => w.id));

  for (const [q, code] of [['limit=0', 'bad-limit'], ['limit=501', 'bad-limit'], ['cursor=nope', 'bad-cursor']]) {
    const r = await h.req('GET', `/api/sync/workouts?${q}`, { token: tok() });
    assert.equal(r.status, 400, q);
    assert.equal(r.body.code, code, q);
  }
});

test('a state file that cannot be read is a 503, never an empty profile', async t => {
  const h = await startServer(t, { states: { u1: profile() } });
  fs.writeFileSync(path.join(h.dataDir, 'state-u1.json'), '{not json');
  for (const [method, p] of [['GET', '/api/sync/workouts'], ['GET', '/api/sync/bodyweight'], ['PUT', '/api/sync/bodyweight/2026-10-12']]) {
    const r = await h.req(method, p, { token: tok(), ifMatch: '"7:0123456789abcdef"', body: method === 'PUT' ? { kg: 80 } : undefined });
    assert.deepEqual(r, { status: 503, body: { error: 'state unreadable', code: 'state-unreadable' } }, `${method} ${p}`);
  }
  assert.equal(fs.readFileSync(path.join(h.dataDir, 'state-u1.json'), 'utf8'), '{not json');
  // No file at all (a volume mounted empty, a profile no device has synced): never an empty list.
  for (const p of ['/api/sync/workouts', '/api/sync/workouts?since=3', '/api/sync/bodyweight']) {
    assert.deepEqual(await h.req('GET', p, { token: tok('adm') }),
      { status: 409, body: { error: 'this profile has no data on this server yet', code: 'no-state', rev: 0 } }, p);
  }
});

for (const lostInARow of [1, 2, 3]) {
  test(`${lostInARow} workouts answer(s) lost in a row, a weigh-in write after each: from the last token received, every edit comes`, async t => {
    const h = await startServer(t, { states: { u1: profile({ workouts: [lift('w1'), lift('w2'), lift('w3')] }) } });
    const read = async since => (await h.req('GET', `/api/sync/workouts${since ? `?since=${since}` : ''}`, { token: tok() })).body;
    const received = (await read()).next_since;
    for (let i = 0; i < lostInARow; i++) {
      // A phone edits one workout; a pass answers it, and the answer never reaches the hub.
      const S = h.state('u1');
      S.workouts = S.workouts.map(w => (w.id === `w${i + 1}` ? { ...w, name: `Edited ${i}` } : w));
      const phone = await h.req('PUT', '/api/data', { cookie: session('u1'), body: { state: S, baseRev: S._rev, stamped: true } });
      assert.equal(phone.status, 200);
      assert.ok((await read(received)).items.some(x => x.id === `w${i + 1}`), 'the lost answer had it');
      // The hub's weigh-in write moves the document on (its answer's `rev` is no `since`).
      const w = await put(h, `2026-10-${String(12 + i)}`, { kg: 79 + i }, `"${phone.body.rev}:${phone.body.wid}"`);
      assert.equal(w.status, 200);
    }
    const r = await read(received);
    assert.equal(r.full, false);
    assert.deepEqual(r.items.map(x => [x.id, x.name]).sort(), Array.from({ length: lostInARow }, (_, i) => [`w${i + 1}`, `Edited ${i}`]));
  });
}

test('body weight in kg both ways for a profile kept in lb, and the round trip comes home', async t => {
  const h = await startServer(t, {
    states: { u1: profile({ unit: 'lb', workouts: [lift('w1', { bw: 176.4 })], bodyweight: [{ d: '2026-10-09', w: 176.8, t: T0 }] }) }
  });
  const read = await h.send('GET', '/api/sync/bodyweight', { token: tok() });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { rev: 7, wid: '0123456789abcdef', unit: 'lb', items: [{ date: '2026-10-09', kg: 80.2, t: T0 }], deleted: [] });
  assert.equal((await h.req('GET', '/api/sync/workouts', { token: tok() })).body.items[0].bodyweight_kg, 80);

  const w = await put(h, '2026-10-10', { kg: 78.4, t: T0 }, read.etag);
  assert.equal(w.status, 200);
  assert.equal(w.body.changed, true);
  assert.deepEqual(w.body.entry.kg, 78.38);
  assert.equal(w.body.unit, 'lb');
  const stored = h.state('u1').bodyweight.find(e => e.d === '2026-10-10');
  assert.equal(stored.w, 172.8, 'stored in the profile’s unit, to 0.1');
  // What the hub reads back is within its 0.1 kg of what it wrote, and writing that back is no change.
  const back = (await h.req('GET', '/api/sync/bodyweight?from=2026-10-10&to=2026-10-10', { token: tok() })).body;
  assert.deepEqual(back.items.map(i => i.date), ['2026-10-10']);
  assert.ok(Math.abs(back.items[0].kg - 78.4) <= 0.05);
  const same = await put(h, '2026-10-10', { kg: back.items[0].kg }, `"${back.rev}:${back.wid}"`);
  assert.equal(same.status, 200);
  assert.equal(same.body.changed, false);
  assert.equal(same.body.rev, back.rev, 'no write, no new revision');
  assert.equal(h.state('u1').bodyweight.find(e => e.d === '2026-10-10').w, 172.8);
});

test('a weigh-in write moves the revision, is what the profile’s own devices read next, and deletes leave a removal on record', async t => {
  const h = await startServer(t, { states: { u1: profile() } });
  // A `t` from the hub's clock, far ahead: taken, and not used to order anything.
  const before = Date.now();
  const w = await put(h, '2026-10-12', { kg: 79.6, t: before + 86400000 }, '"7:0123456789abcdef"');
  assert.equal(w.status, 200);
  assert.equal(w.body.rev, 8);
  assert.notEqual(w.body.wid, '0123456789abcdef');
  assert.equal(w.etag, `"8:${w.body.wid}"`);
  // The devices' poll sees it move, and the document it then reads holds the weigh-in, the rest intact.
  assert.deepEqual((await h.req('GET', '/api/data/rev', { cookie: session('u1') })).body, { rev: 8, wid: w.body.wid });
  assert.deepEqual((await h.req('GET', '/api/sync/rev', { token: tok() })).body, { rev: 8, wid: w.body.wid });
  const doc = (await h.req('GET', '/api/data', { cookie: session('u1') })).body.state;
  assert.deepEqual(doc._wids, ['0123456789abcdef'], 'a device on the old write id knows the new one descends from it');
  const entry = doc.bodyweight.find(e => e.d === '2026-10-12');
  assert.equal(entry.w, 79.6);
  assert.ok(entry.t > T0, 'stamped as the newest change, so every device’s merge keeps it');
  assert.ok(entry.t >= before && entry.t <= Date.now(), 'by the server’s clock, never the caller’s time ahead of it');
  assert.equal(doc.workouts.length, 2);
  assert.equal(doc._ts, entry.t, 'the document’s _ts moves with it, as a device’s own push does');

  const del = await h.send('DELETE', '/api/sync/bodyweight/2026-10-09', { token: tok(), ifMatch: w.etag });
  assert.equal(del.status, 200);
  assert.deepEqual([del.body.changed, del.body.entry, del.body.rev], [true, null, 9]);
  const after = h.state('u1');
  assert.equal(after.bodyweight.some(e => e.d === '2026-10-09'), false);
  assert.ok(after.deleted.bodyweight['2026-10-09'] > T0 - 86400000);
  const view = (await h.req('GET', '/api/sync/bodyweight', { token: tok() })).body;
  assert.deepEqual(view.deleted.map(d => d.date), ['2026-10-09']);
  // Deleting it again is no change and no new revision.
  const again = await h.req('DELETE', '/api/sync/bodyweight/2026-10-09', { token: tok(), ifMatch: del.etag });
  assert.deepEqual([again.status, again.body.changed, again.body.rev], [200, false, 9]);
});

test('a write over a revision it was not decided on is a 409 with the current entry, and a browser save in between is kept', async t => {
  const h = await startServer(t, { states: { u1: profile() } });
  const seen = await h.send('GET', '/api/sync/bodyweight', { token: tok() });
  // A phone saves meanwhile: a weigh-in for the same day and a new workout.
  const S = profile();
  S.bodyweight = [...S.bodyweight, { d: '2026-10-12', w: 81, t: T0 + 1000 }];
  S.workouts = [...S.workouts, lift('w3', { d: '2026-10-12' })];
  const phone = await h.req('PUT', '/api/data', { cookie: session('u1'), body: { state: S, baseRev: 7, stamped: true } });
  assert.equal(phone.status, 200);

  const stale = await put(h, '2026-10-12', { kg: 79 }, seen.etag);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'rev-mismatch');
  assert.equal(stale.body.rev, phone.body.rev);
  assert.deepEqual(stale.body.entry, { date: '2026-10-12', kg: 81, t: T0 + 1000 });
  assert.equal(stale.etag, `"${phone.body.rev}:${phone.body.wid}"`);
  // The right number with another write id is refused too; and the revision alone, even the current
  // one, is not enough on a document that has a write id (a restored backup repeats the number).
  assert.equal((await put(h, '2026-10-12', { kg: 79 }, `"${phone.body.rev}:ffffffffffffffff"`)).status, 409);
  for (const ifMatch of ['"7"', `"${phone.body.rev}"`, String(phone.body.rev)]) {
    const r = await put(h, '2026-10-12', { kg: 79 }, ifMatch);
    assert.deepEqual([r.status, r.body.code, r.etag], [428, 'precondition-required', stale.etag], ifMatch);
  }
  const kept = h.state('u1');
  assert.equal(kept.bodyweight.find(e => e.d === '2026-10-12').w, 81, 'the phone’s weigh-in stands');
  assert.equal(kept.workouts.length, 3);

  // Decided again on what is there now: it goes through, over the phone's save, not instead of it.
  const ok = await put(h, '2026-10-12', { kg: 79 }, stale.etag);
  assert.equal(ok.status, 200);
  const now = h.state('u1');
  assert.equal(now.bodyweight.find(e => e.d === '2026-10-12').w, 79);
  assert.deepEqual(now.workouts.map(x => x.id), ['w1', 'w2', 'w3']);
  assert.equal(now.bodyweight.find(e => e.d === '2026-10-09').w, 80.2);
  // The phone, still on the revision before, cannot push over the hub's write: it gets the 409 to merge.
  const late = await h.req('PUT', '/api/data', { cookie: session('u1'), body: { state: S, baseRev: phone.body.rev, stamped: true } });
  assert.equal(late.status, 409);
  assert.equal(late.body.state.bodyweight.find(e => e.d === '2026-10-12').w, 79);
});

test('a browser save and a hub write at the same moment: one wins the revision, the other is told, nothing is lost', async t => {
  const h = await startServer(t, { states: { u1: profile() } });
  for (let round = 0; round < 10; round++) {
    const S = h.state('u1');
    const { _rev: rev, _wid: wid } = S;
    S.workouts = [...S.workouts, lift(`b${round}`)];
    const [phone, hub] = await Promise.all([
      h.req('PUT', '/api/data', { cookie: session('u1'), body: { state: S, baseRev: rev, stamped: true } }),
      put(h, `2026-09-${String(round + 1).padStart(2, '0')}`, { kg: 70 + round }, `"${rev}:${wid}"`)
    ]);
    const wins = [phone.status, hub.status].filter(s => s === 200).length;
    assert.equal(wins, 1, `round ${round}: exactly one write lands (${phone.status}, ${hub.status})`);
    assert.ok([phone.status, hub.status].includes(409), `round ${round}: ${phone.status}, ${hub.status}`);
    const after = h.state('u1');
    assert.equal(after._rev, rev + 1);
    if (phone.status === 200) assert.ok(after.workouts.some(w => w.id === `b${round}`));
    else assert.ok(after.bodyweight.some(e => e.d === `2026-09-${String(round + 1).padStart(2, '0')}`));
  }
});

test('a weigh-in write is checked before anything is read or written', async t => {
  const h = await startServer(t, { states: { u1: profile() } });
  const before = h.state('u1');
  const cases = [
    [() => put(h, '2026-10-12', { kg: 80 }), 428, 'precondition-required'],
    [() => put(h, '2026-10-12', { kg: 80 }, 'W/"7"'), 400, 'bad-if-match'],
    [() => put(h, '2026-10-12', { kg: 80 }, 'seven'), 400, 'bad-if-match'],
    [() => put(h, '2026-02-30', { kg: 80 }, '"7"'), 400, 'bad-date'],
    [() => put(h, 'today', { kg: 80 }, '"7"'), 400, 'bad-date'],
    [() => put(h, '1899-12-31', { kg: 80 }, '"7"'), 400, 'bad-date'],
    [() => put(h, new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), { kg: 80 }, '"7"'), 400, 'bad-date'],
    [() => put(h, '2026-10-12', { kg: 0 }, '"7"'), 400, 'bad-weight'],
    // Rounds to 0 in the stored unit: it used to replace the day with `w: 0`, gone without a removal.
    [() => put(h, '2026-10-12', { kg: 0.04 }, '"7"'), 400, 'bad-weight'],
    [() => put(h, '2026-10-12', { kg: 19.9 }, '"7"'), 400, 'bad-weight'],
    [() => put(h, '2026-10-12', { kg: 400.1 }, '"7"'), 400, 'bad-weight'],
    [() => put(h, '2026-10-12', { kg: 701 }, '"7"'), 400, 'bad-weight'],
    [() => put(h, '2026-10-12', { kg: 80, pad: 'x'.repeat(5000) }, '"7:0123456789abcdef"'), 413, undefined],
    [() => put(h, '2026-10-12', { kg: 80 }, '"7"'), 428, 'precondition-required'],
    [() => put(h, '2026-10-12', { kg: '80' }, '"7"'), 400, 'bad-weight'],
    [() => put(h, '2026-10-12', {}, '"7"'), 400, 'bad-weight'],
    [() => put(h, '2026-10-12', { kg: 80, t: -5 }, '"7"'), 400, 'bad-time'],
    [() => put(h, '2026-10-12', { kg: 80, t: 'now' }, '"7"'), 400, 'bad-time'],
    [() => h.send('DELETE', '/api/sync/bodyweight/2026-10-09', { token: tok() }), 428, 'precondition-required'],
    [() => put(h, '2026-10-12', { kg: 80 }, '"0"', tok('adm')), 409, 'no-state']
  ];
  for (const [call, status, code] of cases) {
    const r = await call();
    assert.equal(r.status, status, code);
    assert.equal(r.body.code, code);
  }
  assert.deepEqual(h.state('u1'), before);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'state-adm.json')), false, 'no state made up for a profile without one');
});

test('writing back what was read is no write: same revision, same file, in kg and in lb', async t => {
  const h = await startServer(t, {
    users: [...USERS, user('u3', 'Cy')],
    states: {
      u1: profile({ bodyweight: [{ d: '2026-10-10', w: 80.45, t: T0 }] }),
      u3: profile({ unit: 'lb', bodyweight: [{ d: '2026-10-10', w: 180.25, t: T0 }] })
    }
  });
  for (const uid of ['u1', 'u3']) {
    const before = fs.readFileSync(path.join(h.dataDir, `state-${uid}.json`), 'utf8');
    const read = await h.send('GET', '/api/sync/bodyweight', { token: tok(uid) });
    const kg = read.body.items[0].kg;
    const echo = await put(h, '2026-10-10', { kg }, read.etag, tok(uid));
    assert.deepEqual([echo.status, echo.body.changed, echo.body.rev], [200, false, 7], `${uid}: ${kg} kg`);
    assert.equal(fs.readFileSync(path.join(h.dataDir, `state-${uid}.json`), 'utf8'), before, `${uid}: untouched`);
  }
});

test('a sync write keeps the same books as PUT /api/data: revision, write ids, stamps, notes, cache', async t => {
  const ancestors = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(16, '0'));
  const seed = profile({
    _wids: ancestors, edited: { restSec: T0 }, restSec: 75,
    deleted: { workouts: { w0: T0 - 1 }, bodyweight: { '2026-10-01': T0 - 2 } },
    _prior: { restSec: ['2.ab'] }, _unstamped: { fp: 'x', ed: { restSec: T0 } }
  });
  const h = await startServer(t, { users: [...USERS, user('u3', 'Cy')], states: { u1: seed, u3: seed } });
  // The same change both ways: a weigh-in on 2026-10-12. A device sends its whole copy (as the
  // app does, without the server's own notes); the hub sends one value.
  const { _prior, _unstamped, ...copy } = structuredClone(seed);
  copy.bodyweight = [...copy.bodyweight, { d: '2026-10-12', w: 79.5, t: T0 + 1 }];
  const device = await h.req('PUT', '/api/data', { cookie: session('u1'), body: { state: copy, baseRev: 7, stamped: true } });
  const hub = await put(h, '2026-10-12', { kg: 79.5 }, '"7:0123456789abcdef"', tok('u3'));
  assert.equal(device.status, 200);
  assert.equal(hub.status, 200);
  const a = h.state('u1'), b = h.state('u3');
  // What each writer owns differs by design: the write id (random), the weigh-in's stamp and `_ts`
  // (the device's own; the server's clock for the hub).
  const books = S => {
    const { _wid, _ts, ...rest } = structuredClone(S);
    for (const e of rest.bodyweight) delete e.t;
    return rest;
  };
  assert.deepEqual(books(b), books(a));
  assert.equal(a._rev, 8);
  assert.equal(a._wids.length, 50);
  assert.deepEqual(b._wids, a._wids, 'the same ancestry, capped the same');
  assert.equal(b._wids.at(-1), '0123456789abcdef');
  assert.match(b._wid, /^[0-9a-f]{16}$/);
  assert.ok(b._ts > seed._ts, 'the hub write moves _ts');
  assert.ok(b._prior && b._unstamped, 'the server’s notes are kept, as PUT /api/data keeps them');
  // Both are what the devices' poll reads straight away (the stat cache told).
  for (const [uid, r] of [['u1', device.body], ['u3', hub.body]]) {
    const s = uid === 'u1' ? session('u1') : session('u3');
    assert.deepEqual((await h.req('GET', '/api/data/rev', { cookie: s })).body, { rev: r.rev, wid: r.wid }, uid);
  }
});
