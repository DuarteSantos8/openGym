/* Recovery codes (#584): for someone who lost every way in, on any instance. An admin makes one in
   the dashboard (any admin for a profile that is not an admin, the owner for an admin, nobody for
   the owner), or the server's own command does (recover.js, through the local admin socket, for
   anyone, the owner included). The person redeems it like a device link: the device gets a new
   passkey and is signed in. One-time, a day, hashed at rest, counted like a reset code. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashLinkCode } from '../device-link.js';
import { MAX_PASSKEYS } from '../passkeys-store.js';
import { boundPort } from './helpers.mjs';
import { softPasskey, ORIGIN } from './soft-passkey.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mintSession = (uid, sv = 0) => {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

async function startServer(t, { env = {}, users = [], creds = [] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-rec-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds, subs: [], invites: [] }));
  // Password sign-in OFF: recovery has to work without it.
  const childEnv = { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', PASSWORD_LOGIN: '', TRUST_PROXY: '1', INVITE_ONLY: '', ADMIN_UIDS: '', AUDIT_LOG: '1', ...env };
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
  const h = { api: '', log: '', dataDir, env: childEnv, child };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.req = async (method, p, { body, cookie, ip = '198.51.100.1' } = {}) => {
    const r = await fetch(`${h.api}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setCookie = r.headers.getSetCookie().find(c => c.startsWith('gymsid=') && !c.startsWith('gymsid=;'));
    return { status: r.status, body: await r.json(), cookie: setCookie ? setCookie.split(';')[0] : null };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.audit = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } };
  // The server's own command, run the way `docker compose exec api node recover.js` runs it.
  h.cli = (...args) => new Promise(resolve => execFile(process.execPath, ['recover.js', ...args], { cwd: API, env: childEnv }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout, err: stderr })));
  return h;
}
const user = (id, name, extra = {}) => ({ id, name, created: new Date().toISOString(), ...extra });
const OWNER = user('o1', 'Olga', { admin: true, owner: true });
const ADMIN = user('a1', 'Arne', { admin: true });
const ANA = user('u1', 'Ana');
const BEA = user('u2', 'Bea');

async function redeem(h, code, fresh, ip = '198.51.100.9', name = 'New phone') {
  const opt = await h.req('POST', '/api/device-link/options', { body: { code }, ip });
  if (opt.status !== 200) return { opt };
  const done = await h.req('POST', '/api/device-link/verify', { body: { code, cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge), name }, ip });
  return { opt, done };
}

test('an admin makes a recovery code on an instance without password sign-in; it adds a passkey once and signs the device in', async t => {
  const lost = softPasskey(), fresh = softPasskey();
  const h = await startServer(t, { users: [OWNER, ADMIN, ANA], creds: [lost.row('u1')] });
  const made = await h.req('POST', '/api/admin/user/recovery', { body: { id: 'u1' }, cookie: mintSession('a1') });
  assert.equal(made.status, 200);
  assert.match(made.body.code, CODE);
  assert.equal(made.body.name, 'Ana');
  assert.ok(made.body.expires > Date.now() + 23 * 3600000 && made.body.expires <= Date.now() + 24 * 3600000);
  // Kept only as a hash, marked as a recovery code and by whom.
  const raw = fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');
  assert.doesNotMatch(raw, new RegExp(made.body.code.replace(/-/g, '')));
  assert.deepEqual(h.db().deviceLinks.map(l => [l.userId, l.h, l.kind, l.by]), [['u1', hashLinkCode(made.body.code), 'recovery', 'a1']]);
  // Every session of the profile ends.
  assert.equal((await h.req('GET', '/api/me', { cookie: mintSession('u1') })).status, 401);
  assert.ok(h.audit().some(e => e.ev === 'admin.recovery.create' && e.uid === 'a1' && e.tgt === 'u1'));
  // The dashboard says until when it is good.
  const drill = await h.req('GET', '/api/admin/user?id=u1', { cookie: mintSession('a1') });
  assert.equal(drill.body.user.recoveryUntil, made.body.expires);

  const { opt, done } = await redeem(h, made.body.code.toLowerCase().replace(/-/g, ' '), fresh);
  assert.equal(opt.body.recovery, true);
  assert.equal(opt.body.name, 'Ana');
  assert.equal(done.status, 200);
  assert.equal(done.body.user.id, 'u1');
  assert.ok(done.cookie, 'signed in');
  assert.deepEqual(h.db().creds.filter(c => c.userId === 'u1').map(c => c.id).sort(), [lost.id, fresh.id].sort());
  assert.ok(h.audit().some(e => e.ev === 'auth.recovery.ok' && e.uid === 'u1'));
  assert.equal(h.db().deviceLinks.length, 0, 'burned');
  assert.equal((await redeem(h, made.body.code, softPasskey())).opt.body.code, 'link-invalid', 'once only');
  assert.equal((await h.req('GET', '/api/admin/user?id=u1', { cookie: mintSession('a1') })).body.user.recoveryUntil, null);
});

test('who may make one for whom', async t => {
  const h = await startServer(t, { users: [OWNER, ADMIN, user('a2', 'Ada', { admin: true }), ANA, user('u3', 'Cy', { disabled: true })] });
  const ask = (by, id) => h.req('POST', '/api/admin/user/recovery', { body: { id }, cookie: mintSession(by) });
  assert.equal((await ask('u1', 'u3')).status, 403, 'not an admin');
  assert.equal((await ask('a1', 'a2')).status, 403, 'an admin for another admin');
  assert.ok(h.audit().some(e => e.ev === 'admin.denied' && e.uid === 'a1' && e.tgt === 'a2'));
  assert.equal((await ask('a1', 'o1')).body.code, 'owner', 'nobody for the owner here');
  assert.equal((await ask('o1', 'o1')).body.code, 'self');
  assert.equal((await ask('a1', 'a1')).body.code, 'self');
  assert.equal((await ask('a1', 'u3')).body.code, 'disabled');
  assert.equal((await ask('a1', 'nope')).status, 404);
  assert.equal((await ask('o1', 'a2')).status, 200, 'the owner for an admin');
  assert.equal((await ask('a1', 'u1')).status, 200, 'any admin for a plain profile');
});

test('a wrong code says nothing about anyone, and is counted like a reset code', async t => {
  const h = await startServer(t, { users: [OWNER, ANA] });
  await h.req('POST', '/api/admin/user/recovery', { body: { id: 'u1' }, cookie: mintSession('o1') });
  const ip = '198.51.100.77';
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await h.req('POST', '/api/device-link/options', { body: { code: 'AAAA-AAAA-AAA' + (i % 9 + 2) }, ip })).status);
  assert.deepEqual([...new Set(statuses.slice(0, 20))], [400]);
  assert.equal(statuses.at(-1), 429, 'the address is paused');
  const one = await h.req('POST', '/api/device-link/options', { body: { code: 'BBBB-BBBB-BBBB' }, ip: '198.51.100.78' });
  assert.deepEqual(one.body, { error: 'that code is wrong, used or expired', code: 'link-invalid' });
});

test('a profile full of passkeys still gets back in: the one used longest ago makes room', async t => {
  const keys = Array.from({ length: MAX_PASSKEYS }, () => softPasskey());
  const rows = keys.map((k, i) => k.row('u1', { name: 'Key ' + i, lastUsed: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));
  const h = await startServer(t, { users: [OWNER, ANA], creds: rows });
  const { body } = await h.req('POST', '/api/admin/user/recovery', { body: { id: 'u1' }, cookie: mintSession('o1') });
  const fresh = softPasskey();
  const { opt, done } = await redeem(h, body.code, fresh);
  assert.equal(opt.status, 200);
  assert.equal(done.status, 200);
  const ids = h.db().creds.filter(c => c.userId === 'u1').map(c => c.id);
  assert.equal(ids.length, MAX_PASSKEYS);
  assert.ok(ids.includes(fresh.id));
  assert.ok(!ids.includes(keys[0].id), 'Key 0 was the oldest');
  assert.ok(h.audit().some(e => e.ev === 'auth.recovery.ok' && /replaced Key 0/.test(e.msg || '')));
});

test('recover.js asks the running server for the owner’s code, by name or by id', async t => {
  const fresh = softPasskey();
  const h = await startServer(t, { users: [OWNER, ADMIN, ANA, user('u9', 'Ana')] });
  const r = await h.cli('Olga');
  assert.equal(r.code, 0, r.err);
  const code = r.out.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/)?.[0];
  assert.ok(code, r.out);
  assert.match(r.out, /owner/);
  assert.deepEqual(h.db().deviceLinks.map(l => [l.userId, l.kind, l.by]), [['o1', 'recovery', 'server']]);
  assert.ok(h.audit().some(e => e.ev === 'server.recovery.create' && e.tgt === 'o1'));
  assert.equal((await redeem(h, code, fresh)).done.body.user.id, 'o1');

  const two = await h.cli('ana');
  assert.equal(two.code, 1);
  assert.match(two.err, /--id u1/);
  assert.match(two.err, /--id u9/);
  const byId = await h.cli('--id', 'u9');
  assert.equal(byId.code, 0, byId.err);
  assert.equal(h.db().deviceLinks.find(l => l.userId === 'u9')?.kind, 'recovery');

  assert.equal((await h.cli('Nobody')).code, 1);
  assert.equal((await h.cli()).code, 2);
});

test('the admin socket is private, and recover.js says so when no server runs', async t => {
  const h = await startServer(t, { users: [OWNER] });
  const { socketDir, socketPath } = await import('../admin-socket.js');
  const dir = socketDir(h.env);
  const st = fs.statSync(dir);
  assert.equal(st.mode & 0o777, 0o700);
  assert.equal(fs.statSync(socketPath(h.env)).mode & 0o777, 0o600);
  h.child.kill('SIGKILL');
  await new Promise(r => h.child.once('exit', r));
  const r = await h.cli('Olga');
  assert.equal(r.code, 1);
  assert.match(r.err, /not running|Could not ask/);
});
