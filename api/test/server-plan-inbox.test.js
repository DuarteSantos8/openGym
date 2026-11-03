/* A teacher (admin) sends a plan to a student; it waits in the student's inbox until accepted.
   Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const hdr = uid => ({ Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json' });
const plan = { opengym_plan: 1, name: 'Plan from Coach', routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }] };

async function start(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-inbox-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'coach', name: 'Coach', admin: true }, { id: 'stu', name: 'Student' }, { id: 'other', name: 'Other' }],
    creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return async (as, method, p, body) => {
    const r = await fetch(base + p, { method, headers: { ...hdr(as), Origin: 'http://localhost:8080' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
}

test('a teacher sends a plan, the student sees only their own and clears it', async t => {
  const call = await start(t);
  const sent = await call('coach', 'POST', '/api/admin/user/plan', { id: 'stu', bundle: plan });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.pending, 1);

  const mine = await call('stu', 'GET', '/api/plan-inbox');
  assert.equal(mine.body.plans.length, 1);
  assert.equal(mine.body.plans[0].from, 'Coach');
  assert.equal(mine.body.plans[0].bundle.routines[0].name, 'A');
  assert.deepEqual((await call('other', 'GET', '/api/plan-inbox')).body.plans, []);

  await call('stu', 'POST', '/api/plan-inbox/done', { id: mine.body.plans[0].id });
  assert.deepEqual((await call('stu', 'GET', '/api/plan-inbox')).body.plans, []);
});

test('only an admin sends, and only a real plan, to a real user, within the limit', async t => {
  const call = await start(t);
  assert.equal((await call('stu', 'POST', '/api/admin/user/plan', { id: 'other', bundle: plan })).status, 403);
  assert.equal((await call('coach', 'POST', '/api/admin/user/plan', { id: 'nobody', bundle: plan })).status, 404);
  assert.equal((await call('coach', 'POST', '/api/admin/user/plan', { id: 'stu', bundle: { routines: [] } })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await call('coach', 'POST', '/api/admin/user/plan', { id: 'stu', bundle: plan })).status, 200);
  const full = await call('coach', 'POST', '/api/admin/user/plan', { id: 'stu', bundle: plan });
  assert.equal(full.status, 400);
  assert.equal(full.body.code, 'inbox-full');
});

/* Teachers see only their own students; the owner sees everyone. */
async function startScoped(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-scope-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: 'owner', name: 'Owner', admin: true, owner: true },
      { id: 'tA', name: 'TeacherA', admin: true }, { id: 'tB', name: 'TeacherB', admin: true },
      { id: 'sA', name: 'StudentA', invitedBy: 'CODEA' }, { id: 'sB', name: 'StudentB', invitedBy: 'CODEB' },
      { id: 'sO', name: 'StudentO', invitedBy: 'CODEO' }
    ],
    creds: [], subs: [],
    invites: [{ code: 'CODEA', createdBy: 'tA', usedBy: 'sA' }, { code: 'CODEB', createdBy: 'tB', usedBy: 'sB' }, { code: 'CODEO', createdBy: 'owner', usedBy: 'sO' }]
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return async (as, method, p, body) => {
    const r = await fetch(base + p, { method, headers: { ...hdr(as), Origin: 'http://localhost:8080' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json() };
  };
}

test('a teacher sees and acts on their own students only', async t => {
  const call = await startScoped(t);
  const names = async as => (await call(as, 'GET', '/api/admin/users')).body.users.map(u => u.name).sort();
  assert.deepEqual(await names('tA'), ['StudentA', 'TeacherA']);
  assert.deepEqual(await names('tB'), ['StudentB', 'TeacherB']);
  assert.equal((await names('owner')).length, 6);

  assert.equal((await call('tA', 'GET', '/api/admin/user?id=sA')).status, 200);
  for (const id of ['sB', 'sO', 'owner']) assert.equal((await call('tA', 'GET', `/api/admin/user?id=${id}`)).status, 404);
  assert.equal((await call('tA', 'POST', '/api/admin/user/plan', { id: 'sB', bundle: plan })).status, 404);
  assert.equal((await call('tA', 'POST', '/api/admin/user/disable', { id: 'sB', disabled: true })).status, 404);
  assert.equal((await call('tA', 'POST', '/api/admin/user/plan', { id: 'sA', bundle: plan })).status, 200);
  assert.equal((await call('tA', 'GET', '/api/admin/audit')).status, 403);
  assert.equal((await call('tA', 'POST', '/api/admin/user/teacher', { id: 'sB', teacher: 'tA' })).status, 403);
});

test('the owner reassigns a student and that teacher gets access', async t => {
  const call = await startScoped(t);
  assert.equal((await call('tA', 'GET', '/api/admin/user?id=sB')).status, 404);
  assert.equal((await call('owner', 'POST', '/api/admin/user/teacher', { id: 'sB', teacher: 'tA' })).status, 200);
  assert.equal((await call('tA', 'GET', '/api/admin/user?id=sB')).body.user.teacherName, 'TeacherA');
  assert.equal((await call('tB', 'GET', '/api/admin/user?id=sB')).status, 404);
  assert.equal((await call('owner', 'POST', '/api/admin/user/teacher', { id: 'sB', teacher: 'sA' })).status, 400);
});

test('the owner can be a teacher\'s student, and only that teacher sees them', async t => {
  const call = await startScoped(t);
  assert.equal((await call('tA', 'GET', '/api/admin/user?id=owner')).status, 404);
  assert.equal((await call('owner', 'POST', '/api/admin/user/teacher', { id: 'owner', teacher: 'tA' })).status, 200);

  const names = async as => (await call(as, 'GET', '/api/admin/users')).body.users.map(u => u.name).sort();
  assert.deepEqual(await names('tA'), ['Owner', 'StudentA', 'TeacherA']);
  assert.deepEqual(await names('tB'), ['StudentB', 'TeacherB']);
  const row = (await call('owner', 'GET', '/api/admin/users')).body.users.find(u => u.id === 'owner');
  assert.equal(row.teacherName, 'TeacherA');
  assert.equal((await call('tA', 'GET', '/api/admin/user?id=owner')).status, 200);
  assert.equal((await call('tB', 'GET', '/api/admin/user?id=owner')).status, 404);
  assert.equal((await call('tA', 'POST', '/api/admin/user/plan', { id: 'owner', bundle: plan })).status, 200);

  // The teacher still cannot act on the owner's account.
  assert.equal((await call('tA', 'POST', '/api/admin/user/disable', { id: 'owner', disabled: true })).status, 400);
  assert.equal((await call('tA', 'POST', '/api/admin/user/delete', { id: 'owner' })).status, 400);
  assert.equal((await call('tA', 'POST', '/api/admin/user/recovery', { id: 'owner' })).status, 403);
  assert.equal((await call('tA', 'POST', '/api/admin/user/teacher', { id: 'owner', teacher: 'tA' })).status, 403);

  // Taking it back hides the owner again.
  assert.equal((await call('owner', 'POST', '/api/admin/user/teacher', { id: 'owner', teacher: null })).status, 200);
  assert.equal((await call('tA', 'GET', '/api/admin/user?id=owner')).status, 404);
});

test('a teacher cannot be their own student, and no other admin can be anyone\'s', async t => {
  const call = await startScoped(t);
  assert.equal((await call('owner', 'POST', '/api/admin/user/teacher', { id: 'owner', teacher: 'owner' })).status, 400);
  assert.equal((await call('owner', 'POST', '/api/admin/user/teacher', { id: 'tB', teacher: 'tA' })).status, 404);
  assert.equal((await call('owner', 'POST', '/api/admin/user/teacher', { id: 'owner', teacher: 'sA' })).status, 400);
});
