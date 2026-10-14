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

async function startServer(t, { env = { HUB_JWKS: jwks(KEY), HUB_ISSUER: ISSUER }, users = USERS } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-sync-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dataDir, 'state-u1.json'), JSON.stringify({ unit: 'kg', workouts: [], _rev: 7, _wid: '0123456789abcdef' }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', ADMIN_UIDS: '', AUDIT_LOG: '1', HUB_JWKS: '', HUB_ISSUER: '', ...env }
  });
  const h = { log: '', dataDir, child };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.req = async (method, p, { token, cookie, bearer, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    if (cookie) headers.Cookie = 'gymsid=' + cookie;
    const r = await fetch(h.api + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
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
  for (const p of ['/api/sync/ping', '/api/sync/rev']) {
    assert.deepEqual(await h.req('GET', p, { token: mint(KEY, { sub: 'u1' }) }), { status: 404, body: { error: 'not found' } });
  }
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
