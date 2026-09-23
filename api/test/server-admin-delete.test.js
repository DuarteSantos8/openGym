/* Issue #107: disabling locks an account out but deliberately leaves state-<uid>.json and the
   credential record in place, so "no data remains" was not reachable from the dashboard. Delete
   removes the user, their credentials, their push subscriptions, their training history and any
   Coach credential — and refuses the two cases nothing in the UI could undo afterwards. Real
   server.js in a child, same harness as server-admin-state.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ADMIN = 'u_adm_1', ADMIN2 = 'u_adm_2', VICTIM = 'u_vic_1';
const as = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' });
const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t, { twoAdmins = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-del-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const users = [
    { id: ADMIN, name: 'Adminna', created: new Date().toISOString(), admin: true },
    { id: VICTIM, name: 'Mallory', created: new Date().toISOString(), invitedBy: 'CODE1' },
  ];
  if (twoAdmins) users.push({ id: ADMIN2, name: 'Second', created: new Date().toISOString(), admin: true });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users,
    creds: [{ id: 'c-victim', userId: VICTIM, publicKey: 'x' }, { id: 'c-admin', userId: ADMIN, publicKey: 'y' }],
    subs: [{ endpoint: 'https://push/victim', userId: VICTIM }, { endpoint: 'https://push/admin', userId: ADMIN }],
    invites: [{ code: 'CODE1', usedBy: VICTIM, usedAt: new Date().toISOString() }],
  }));
  fs.writeFileSync(path.join(dataDir, `state-${VICTIM}.json`), JSON.stringify({ unit: 'kg', workouts: [], _rev: 3 }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  });
  const h = { api: `http://127.0.0.1:${port}`, log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${h.api}/api/health`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(up, `server never came up:\n${h.log}`);
  h.del = async (id, uid = ADMIN) => {
    const r = await fetch(`${h.api}/api/admin/user/delete`, { method: 'POST', headers: { ...as(uid), Origin: 'http://localhost:8080' }, body: JSON.stringify({ id }) });
    return { status: r.status, body: await r.json() };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

test('removes the account and everything attached to it', async t => {
  const h = await startServer(t);
  assert.ok(fs.existsSync(path.join(h.dataDir, `state-${VICTIM}.json`)));
  const res = await h.del(VICTIM);
  assert.equal(res.status, 200);

  const db = h.db();
  assert.deepEqual(db.users.map(u => u.id), [ADMIN], 'the user is gone');
  assert.deepEqual(db.creds.map(c => c.userId), [ADMIN], 'their passkeys are gone');
  assert.deepEqual(db.subs.map(s => s.userId), [ADMIN], 'their push subscriptions are gone');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${VICTIM}.json`)), false, 'their history is gone');
  // The code they joined with stays burned: it was used, and freeing it would quietly widen
  // an invite-only instance.
  assert.equal(db.invites[0].usedBy, VICTIM);
  assert.equal(h.stackFrames(), 0, `no stack traces:\n${h.log}`);
});

test('their session stops working immediately', async t => {
  const h = await startServer(t);
  const before = await fetch(`${h.api}/api/me`, { headers: as(VICTIM) });
  assert.equal(before.status, 200);
  await h.del(VICTIM);
  const after = await fetch(`${h.api}/api/me`, { headers: as(VICTIM) });
  assert.equal(after.status, 401, 'a cookie for a deleted account is worthless');
});

test('refuses the two deletions that cannot be undone', async t => {
  const h = await startServer(t);
  const self = await h.del(ADMIN);
  assert.equal(self.status, 400);
  assert.match(self.body.error, /your own account/);

  const last = await h.del(ADMIN, ADMIN);   // ADMIN is also the only admin
  assert.equal(last.status, 400);
  assert.equal(h.db().users.length, 2, 'nothing was removed');
});

test('another admin can be deleted while one remains', async t => {
  const h = await startServer(t, { twoAdmins: true });
  const res = await h.del(ADMIN2);
  assert.equal(res.status, 200);
  assert.deepEqual(h.db().users.map(u => u.id).sort(), [ADMIN, VICTIM].sort());
});

test('says so plainly when the account is not there, and needs an admin', async t => {
  const h = await startServer(t);
  const missing = await h.del('nobody');
  assert.equal(missing.status, 404);
  const asVictim = await h.del(ADMIN, VICTIM);
  assert.equal(asVictim.status, 403, 'an ordinary user cannot delete anyone');
  assert.equal(h.db().users.length, 2);
});
