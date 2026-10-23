/* The account's own delete (App Store rule 5.1.1(v)): a signed-in profile removes itself with
   the same clean-up the admin's delete runs (removeAccount in server.js), typing its name back
   and proving it is the owner the way the other changes to a way in do (proveOwner): here with
   the current password, the passkey half is in server-passkeys.test.js. A paired phone, which
   can hold no passkey for the server, proves a profile without a password by its pairing. The last admin cannot
   leave an instance others still use. Real server.js in a child, same harness as
   server-admin-delete.test.js. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../password.js';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const GOOD = 'correct horse battery staple';
let pwHash;
before(async () => { pwHash ??= await hashPassword(GOOD); });
const ADMIN = 'u_adm_1', ADMIN2 = 'u_adm_2', USER = 'u_usr_1';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' });
async function startServer(t, { users: which = ['admin', 'user'], env = {} } = {}) {
  pwHash ??= await hashPassword(GOOD);
  const pw = { h: pwHash, set: new Date().toISOString() };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-selfdel-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const all = {
    admin: { id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true, pw },
    admin2: { id: ADMIN2, name: 'Second', created: new Date().toISOString(), admin: true, pw },
    user: { id: USER, name: 'Mallory', created: new Date().toISOString(), invitedBy: 'CODE1', pw },
    // Passkey-only: no password that could prove anything.
    nopw: { id: 'u_nopw', name: 'Keyonly', created: new Date().toISOString() },
  };
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: which.map(k => all[k]),
    creds: [{ id: 'c-user', userId: USER, publicKey: 'x' }, { id: 'c-admin', userId: ADMIN, publicKey: 'y' }],
    subs: [{ endpoint: 'https://push/user', userId: USER }, { endpoint: 'https://push/admin', userId: ADMIN }],
    invites: [{ code: 'CODE1', usedBy: USER, usedAt: new Date().toISOString() }],
  }));
  for (const uid of [USER, ADMIN]) fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify({ unit: 'kg', workouts: [], _rev: 3 }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', PASSWORD_LOGIN: '1', AUDIT_LOG: '1', ...env },
  });
  const h = { api: '', log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.del = async (uid, body) => {
    const r = await fetch(`${h.api}/api/account/delete`, { method: 'POST', headers: as(uid), body: JSON.stringify(body) });
    return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') || '' };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  h.audit = () => fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

test('removes the account and everything attached to it, and ends the session', async t => {
  const h = await startServer(t);
  const res = await h.del(USER, { name: 'Mallory', current: GOOD });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.match(res.cookie, /gymsid=;.*Max-Age=0/, 'the session cookie is cleared');

  const db = h.db();
  assert.deepEqual(db.users.map(u => u.id), [ADMIN], 'the user is gone');
  assert.deepEqual(db.creds.map(c => c.userId), [ADMIN], 'their passkeys are gone');
  assert.deepEqual(db.subs.map(s => s.userId), [ADMIN], 'their push subscriptions are gone');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${USER}.json`)), false, 'their history is gone');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${ADMIN}.json`)), true, 'nobody else’s is touched');
  assert.equal(db.invites[0].usedBy, USER, 'the code they joined with stays burned');

  const me = await fetch(`${h.api}/api/me`, { headers: as(USER) });
  assert.equal(me.status, 401, 'a cookie for a deleted account is worthless');
  const ev = h.audit().find(r => r.ev === 'auth.account.delete');
  assert.ok(ev, 'audited');
  assert.equal(ev.uid, USER);
  assert.equal(ev.name, 'Mallory', 'by name, since the id stops meaning anything');
  assert.equal(h.stackFrames(), 0, `no stack traces:\n${h.log}`);
});

test('needs the account name typed back', async t => {
  const h = await startServer(t);
  // Checked before the proof: a wrong name costs no password check, even with the right one.
  for (const body of [{}, { name: '' }, { name: 'mallory', current: GOOD }, { name: 'Adminna', current: GOOD }, { name: 42 }]) {
    const res = await h.del(USER, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'confirm-name');
  }
  assert.equal(h.db().users.length, 2, 'nothing was removed');
  // Spaces around it are a keyboard's, not a different name.
  assert.equal((await h.del(USER, { name: ' Mallory ', current: GOOD })).status, 200);
});

test('needs a session, and a request from another origin is refused', async t => {
  const h = await startServer(t);
  const anon = await fetch(`${h.api}/api/account/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8080' }, body: JSON.stringify({ name: 'Mallory' }) });
  assert.equal(anon.status, 401);
  const cross = await fetch(`${h.api}/api/account/delete`, { method: 'POST', headers: { ...as(USER), Origin: 'https://evil.example' }, body: JSON.stringify({ name: 'Mallory' }) });
  assert.equal(cross.status, 403);
  assert.equal(h.db().users.length, 2);
});

test('the last admin cannot leave while other profiles remain, proof or not', async t => {
  const h = await startServer(t);
  assert.equal((await h.del(ADMIN, { name: 'Adminna' })).body.code, 'last-admin', 'refused before any proof is asked');
  const res = await h.del(ADMIN, { name: 'Adminna', current: GOOD });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'last-admin');
  assert.equal(h.db().users.length, 2, 'nothing was removed');
});

test('the delete sheet learns of the last-admin refusal before it asks for any proof', async t => {
  const h = await startServer(t, { users: ['admin', 'user', 'admin2'] });
  const info = async uid => (await fetch(`${h.api}/api/account/passkeys`, { headers: as(uid) })).json();
  assert.equal((await info(ADMIN)).deleteBlocked, undefined, 'another admin remains: nothing blocks');
  assert.equal((await info(USER)).deleteBlocked, undefined, 'a plain profile is never blocked');
  assert.equal((await h.del(ADMIN2, { name: h.db().users.find(u => u.id === ADMIN2).name, current: GOOD })).status, 200);
  assert.equal((await info(ADMIN)).deleteBlocked, 'last-admin', 'now the only admin, with a profile left');
  assert.equal((await info(USER)).deleteBlocked, undefined);
});

test('alone on the instance the last admin is not blocked', async t => {
  const h = await startServer(t, { users: ['admin'] });
  const r = await (await fetch(`${h.api}/api/account/passkeys`, { headers: as(ADMIN) })).json();
  assert.equal(r.deleteBlocked, undefined);
});

test('an admin can leave while another admin remains', async t => {
  const h = await startServer(t, { users: ['admin', 'admin2', 'user'] });
  assert.equal((await h.del(ADMIN, { name: 'Adminna', current: GOOD })).status, 200);
  assert.deepEqual(h.db().users.map(u => u.id).sort(), [ADMIN2, USER].sort());
});

test('the only profile on the instance can delete itself, admin or not', async t => {
  const h = await startServer(t, { users: ['admin'] });
  assert.equal((await h.del(ADMIN, { name: 'Adminna', current: GOOD })).status, 200);
  assert.deepEqual(h.db().users, []);
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${ADMIN}.json`)), false);
});

test('a paired phone: the pairing is the proof without a password, the password with one', async t => {
  const h = await startServer(t, { users: ['admin', 'user', 'nopw'] });
  const phone = (uid, body) => fetch(`${h.api}/api/account/delete`, {
    method: 'POST', headers: { Authorization: `Bearer ${mintSession(uid)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(async r => ({ status: r.status, body: await r.json() }));

  // A profile with a password sends it from the phone like from anywhere else.
  const without = await phone(USER, { name: 'Mallory' });
  assert.equal(without.status, 403);
  assert.equal(without.body.code, 'current-required');
  assert.equal((await phone(USER, { name: 'Mallory', current: 'not the password at all' })).body.code, 'current-wrong');
  assert.equal(h.db().users.length, 3, 'nothing was removed');
  // The name and the last admin still come first.
  assert.equal((await phone('u_nopw', { name: 'keyonly' })).body.code, 'confirm-name');

  // Passkey-only: the phone cannot hold a passkey for the server, so the pairing proves it.
  const keyOnly = await phone('u_nopw', { name: 'Keyonly' });
  assert.equal(keyOnly.status, 200);
  assert.deepEqual(h.db().users.map(u => u.id).sort(), [ADMIN, USER].sort());
  assert.equal(h.audit().find(r => r.ev === 'auth.account.delete')?.msg, 'device');

  assert.equal((await phone(USER, { name: 'Mallory', current: GOOD })).status, 200);
  assert.deepEqual(h.db().users.map(u => u.id), [ADMIN]);
});

test('a browser never gets the phone’s pass: no proof, no delete', async t => {
  const h = await startServer(t, { users: ['admin', 'nopw'] });
  const res = await h.del('u_nopw', { name: 'Keyonly' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'passkey-required');
  assert.equal(h.db().users.length, 2);
});

test('a browser cookie replayed as a Bearer is still a cookie: no device pass', async t => {
  const h = await startServer(t, { users: ['admin', 'nopw'] });
  // A cookie as the server mints it for a browser: the fourth field says `c`.
  const payload = `u_nopw:${Date.now() + 86400000}:0:c`;
  const cookie = payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const r = await fetch(`${h.api}/api/account/delete`, {
    method: 'POST', headers: { Authorization: `Bearer ${cookie}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Keyonly' })
  });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'passkey-required');
  assert.equal(h.db().users.length, 2, 'nothing was removed');
  // A token the pairing made (`b`) still carries the device pass.
  const pb = `u_nopw:${Date.now() + 86400000}:0:b`;
  const paired = pb + '.' + crypto.createHmac('sha256', SECRET).update(pb).digest('base64url');
  const ok = await fetch(`${h.api}/api/account/delete`, {
    method: 'POST', headers: { Authorization: `Bearer ${paired}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Keyonly' })
  });
  assert.equal(ok.status, 200);
});

test('needs proof that the owner is here: missing or wrong, nothing is removed', async t => {
  const h = await startServer(t, { users: ['admin', 'user', 'nopw'] });
  const none = await h.del(USER, { name: 'Mallory' });
  assert.equal(none.status, 403);
  assert.equal(none.body.code, 'current-required');
  const wrong = await h.del(USER, { name: 'Mallory', current: 'not the password at all' });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'current-wrong');
  // No password, so only a passkey can say it is them; an assertion that does not verify is no proof.
  const keyOnly = await h.del('u_nopw', { name: 'Keyonly', current: GOOD });
  assert.equal(keyOnly.status, 403);
  assert.equal(keyOnly.body.code, 'passkey-required');
  const bogus = await h.del('u_nopw', { name: 'Keyonly', cid: 'nope', credential: { id: 'x', response: {} } });
  assert.equal(bogus.status, 403);
  assert.equal(bogus.body.code, 'passkey');

  assert.equal(h.db().users.length, 3, 'nothing was removed');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${USER}.json`)), true);
  const fails = h.audit().filter(r => r.ev === 'auth.proof.fail');
  assert.ok(fails.length >= 2 && fails.every(r => r.act === 'account-delete'), 'logged as a refused proof for the delete');
  assert.ok(!h.audit().some(r => r.ev === 'auth.account.delete'));
});

test('with password sign-in off, a password proves nothing', async t => {
  const h = await startServer(t, { env: { PASSWORD_LOGIN: '' } });
  const res = await h.del(USER, { name: 'Mallory', current: GOOD });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'passkey-required');
  assert.equal(h.db().users.length, 2);
});
