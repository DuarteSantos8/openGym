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
async function startScoped(t, states = {}) {
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
  for (const [uid, st] of Object.entries(states)) fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify(st));
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

/* Deleting and archiving a student's workouts. */
const wk = (id, d) => ({ id, d, name: id, start: Date.parse(d + 'T10:00:00Z'), end: Date.parse(d + 'T11:00:00Z'), entries: [{ id: '0001', sets: [{ w: 50, r: 8, done: true }] }] });
const states = () => ({
  sA: { _rev: 3, _ts: 1000, workouts: [wk('w1', '2026-10-01'), wk('w2', '2026-10-02')], routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }, { id: 'r2', name: 'B', ex: [] }], week: { 1: ['r1', 'r2'], 3: ['r1'] }, dayPlan: { '2026-11-10': 'r1', '2026-11-11': 'r2' } },
  sB: { _rev: 1, workouts: [wk('x1', '2026-10-01')], routines: [] },
  owner: { _rev: 1, workouts: [wk('o1', '2026-10-01')], routines: [] }
});

test('a teacher deletes a student\'s workout the way a device would: removal on record, revision moved', async t => {
  const call = await startScoped(t, states());
  const r = await call('tA', 'POST', '/api/admin/user/workouts/delete', { id: 'sA', workouts: ['w1'] });
  assert.deepEqual([r.status, r.body.removed], [200, 1]);
  const d = (await call('tA', 'GET', '/api/admin/user?id=sA')).body;
  assert.deepEqual(d.workouts.map(w => w.id), ['w2']);
  const mine = await call('sA', 'GET', '/api/data');
  assert.equal(mine.body.rev, 4);
  assert.ok(mine.body.state.deleted.workouts.w1 > 0);
  assert.equal(mine.body.state._ts, 1000, 'the student\'s last sync is not touched');
  assert.equal((await call('tA', 'POST', '/api/admin/user/workouts/delete', { id: 'sA', workouts: ['nope'] })).body.removed, 0);
});

test('delete is scoped: not another teacher\'s student, not an admin\'s record unless the owner asks', async t => {
  const call = await startScoped(t, states());
  assert.equal((await call('tA', 'POST', '/api/admin/user/workouts/delete', { id: 'sB', workouts: ['x1'] })).status, 404);
  assert.equal((await call('sB', 'POST', '/api/admin/user/workouts/delete', { id: 'sA', workouts: ['w1'] })).status, 403);
  assert.equal((await call('owner', 'POST', '/api/admin/user/teacher', { id: 'owner', teacher: 'tA' })).status, 200);
  assert.equal((await call('tA', 'POST', '/api/admin/user/workouts/delete', { id: 'owner', workouts: ['o1'] })).status, 403);
  assert.equal((await call('owner', 'POST', '/api/admin/user/workouts/delete', { id: 'sB', workouts: ['x1'] })).body.removed, 1);
  assert.equal((await call('owner', 'POST', '/api/admin/user/workouts/delete', { id: 'owner', workouts: ['o1'] })).body.removed, 1);
  for (const bad of [[], 'w1', Array(201).fill('a'), [1]]) {
    assert.equal((await call('owner', 'POST', '/api/admin/user/workouts/delete', { id: 'sA', workouts: bad })).status, 400);
  }
});

test('archiving flags a workout for the teacher and leaves the student\'s record alone', async t => {
  const call = await startScoped(t, states());
  const a = await call('tA', 'POST', '/api/admin/user/workouts/archive', { id: 'sA', workouts: ['w1', 'ghost'], archived: true });
  assert.deepEqual([a.status, a.body.changed], [200, 1]);
  const d = (await call('tA', 'GET', '/api/admin/user?id=sA')).body;
  assert.deepEqual(d.workouts.map(w => [w.id, !!w.archived]).sort(), [['w1', true], ['w2', false]]);
  const mine = await call('sA', 'GET', '/api/data');
  assert.equal(mine.body.rev, 3);
  assert.equal(mine.body.state.workouts.length, 2);
  assert.equal((await call('tA', 'POST', '/api/admin/user/workouts/archive', { id: 'sA', workouts: ['w1'], archived: false })).body.changed, 1);
  assert.ok(!(await call('tA', 'GET', '/api/admin/user?id=sA')).body.workouts.some(w => w.archived));
  assert.equal((await call('tA', 'POST', '/api/admin/user/workouts/archive', { id: 'sB', workouts: ['x1'], archived: true })).status, 404);
  assert.equal((await call('tA', 'POST', '/api/admin/user/workouts/archive', { id: 'sA', workouts: ['w1'] })).status, 400);
});

test('a teacher deletes or archives a student\'s plan (ficha), and the weekdays that held it let go', async t => {
  const call = await startScoped(t, states());
  const gone = await call('tA', 'POST', '/api/admin/user/routines/delete', { id: 'sA', routines: ['r1'] });
  assert.deepEqual([gone.status, gone.body.removed], [200, 1]);
  const mine = (await call('sA', 'GET', '/api/data')).body;
  assert.equal(mine.rev, 4);
  assert.deepEqual(mine.state.routines.map(r => r.id), ['r2']);
  assert.deepEqual(mine.state.week, { 1: ['r2'] });
  assert.deepEqual(mine.state.dayPlan, { '2026-11-11': 'r2' });
  assert.ok(mine.state.deleted.routines.r1 > 0);

  const arch = await call('tA', 'POST', '/api/admin/user/routines/archive', { id: 'sA', routines: ['r2', 'ghost'], archived: true });
  assert.equal(arch.body.changed, 1);
  const d = (await call('tA', 'GET', '/api/admin/user?id=sA')).body;
  assert.deepEqual(d.routines.map(r => [r.id, !!r.archived]), [['r2', true]]);
  assert.equal((await call('sA', 'GET', '/api/data')).body.rev, 4, 'archiving leaves the student\'s record alone');
  assert.equal((await call('tA', 'POST', '/api/admin/user/routines/delete', { id: 'sB', routines: ['x'] })).status, 404);
  assert.equal((await call('tA', 'POST', '/api/admin/user/routines/delete', { id: 'sA', routines: [] })).status, 400);
});
