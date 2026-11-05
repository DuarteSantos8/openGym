/* The trainer routes end to end against the real server.js in a child process: an admin makes a
   gym and a trainer, the trainer makes a code, a member reads it, says yes, the trainer confirms,
   the member changes and ends it, reads the log, exports it and deletes the account. Plus the
   switch being off, the budgets, code guessing, and ADMIN_DATA_VIEW off and on. */
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
const USERS = [
  { id: 'u_admin', name: 'Adam', admin: true, owner: true },
  { id: 'u_marco', name: 'Marco' },
  { id: 'u_lena', name: 'Lena' },
  { id: 'u_lea', name: 'Lea' },
  { id: 'u_tim', name: 'Tim' },
];

async function start(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-trainers-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS.map(u => ({ ...u, created: new Date().toISOString() })), creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dataDir, 'state-u_lea.json'), JSON.stringify({
    unit: 'kg', _rev: 3, workouts: [{ id: 'w1', name: 'Push A', d: '2026-11-01', start: 1, end: 2, entries: [] }],
    bodyweight: [{ d: '2026-11-01', w: 68.4 }], routines: [{ id: 'r1', name: 'Push A', ex: [] }]
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', TRAINERS: 'on', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => h.log);
  h.call = async (who, method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: `gymsid=${mint(who)}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  return h;
}

test('the whole road: gym, trainer, code, consent, confirm, change, disconnect, log, export, delete', async t => {
  const h = await start(t);
  const { call } = h;
  // Config tells a session the feature is on.
  assert.equal((await call('u_lea', 'GET', '/api/config')).body.trainers.on, true);
  assert.deepEqual((await call('u_lea', 'GET', '/api/config')).body.trainers.roles, { trainer: false, lead: false });
  assert.equal((await call(null, 'GET', '/api/config')).body.trainers, undefined);

  // The admin makes a gym and gives Marco the trainer role, Lena the lead role.
  assert.equal((await call('u_marco', 'POST', '/api/admin/gyms/new', { name: 'FitBox' })).status, 403);
  const gym = (await call('u_admin', 'POST', '/api/admin/gyms/new', { name: '  FitBox Bülach  ', contact: 'privacy@fitbox.test' })).body.gym;
  assert.equal(gym.name, 'FitBox Bülach');
  assert.equal((await call('u_admin', 'POST', '/api/admin/gyms/staff', { gymId: gym.id, userId: 'u_marco', role: 'trainer' })).status, 200);
  assert.equal((await call('u_admin', 'POST', '/api/admin/gyms/staff', { gymId: gym.id, userId: 'u_lena', role: 'lead' })).status, 200);
  assert.equal((await call('u_admin', 'POST', '/api/admin/gyms/staff', { gymId: gym.id, userId: 'u_lena', role: 'boss' })).status, 400);
  const list = (await call('u_admin', 'GET', '/api/admin/gyms')).body;
  assert.equal(list.gyms[0].counts.trainers, 1);
  assert.deepEqual(list.gyms[0].staff.map(s => s.name).sort(), ['Lena', 'Marco']);

  // Tim is no trainer: no code for him.
  assert.equal((await call('u_tim', 'POST', '/api/trainer/codes', {})).status, 403);
  assert.deepEqual((await call('u_marco', 'GET', '/api/config')).body.trainers.roles, { trainer: true, lead: false });
  assert.deepEqual((await call('u_lena', 'GET', '/api/config')).body.trainers.roles, { trainer: false, lead: true });
  const made = (await call('u_marco', 'POST', '/api/trainer/codes', { gymId: gym.id, maxUses: 5 })).body;
  assert.match(made.code, /^TR-/);
  assert.match(made.link, /#\/settings\/trainer\?code=TR-/);

  // Lea reads the code: who, which gym, what the screen starts with, the consent text.
  const preview = (await call('u_lea', 'POST', '/api/sharing/code', { code: made.code.toLowerCase() })).body;
  assert.equal(preview.trainer.name, 'Marco');
  assert.equal(preview.gym.name, 'FitBox Bülach');
  assert.deepEqual(preview.gym.leads, ['Lena']);
  assert.equal(preview.gym.contact, 'privacy@fitbox.test');
  assert.equal(preview.leadDefaults.plans, 'view');
  const consent = { v: preview.consent.v, hash: preview.consent.hash };

  // An outdated consent is refused with the current one.
  const stale = await call('u_lea', 'POST', '/api/sharing/connect', { code: made.code, scopes: preview.defaults, consent: { v: 0, hash: 'x' } });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'consent-outdated'); assert.equal(stale.body.consent.hash, consent.hash);
  const conn = (await call('u_lea', 'POST', '/api/sharing/connect', { code: made.code, scopes: { ...preview.defaults, bodyweight: 'apply' }, leadScopes: { ...preview.leadDefaults, bodyweight: 'off' }, consent, lang: 'de' })).body;
  assert.equal(conn.status, 'pending');

  // Marco sees the request, not her data; he confirms.
  let tr = (await call('u_marco', 'GET', '/api/trainer')).body;
  assert.equal(tr.requests.length, 1); assert.equal(tr.requests[0].member.name, 'Lea');
  assert.equal(tr.members.length, 0);
  assert.equal(JSON.stringify(tr).includes('68.4'), false);
  assert.equal((await call('u_tim', 'POST', '/api/trainer/requests/answer', { id: conn.id, accept: true })).status, 404);
  assert.equal((await call('u_marco', 'POST', '/api/trainer/requests/answer', { id: conn.id, accept: true })).body.status, 'active');
  tr = (await call('u_marco', 'GET', '/api/trainer')).body;
  assert.equal(tr.members.length, 1);
  assert.equal(tr.members[0].levels.bodyweight, 'apply');
  assert.equal(tr.members[0].levels.photos, 'off');

  // Lea's page: one connection, the lead row narrowed as she picked.
  let mine = (await call('u_lea', 'GET', '/api/sharing')).body;
  assert.equal(mine.connections.length, 1);
  assert.equal(mine.connections[0].lead.scopes.bodyweight, 'off');
  assert.equal(mine.connections[0].lead.scopes.workouts, 'view');
  assert.equal(mine.gyms[0].name, 'FitBox Bülach');

  // She turns workouts off; the lead row follows.
  const upd = (await call('u_lea', 'POST', '/api/sharing/update', { id: conn.id, scopes: { metrics: 'view', workouts: 'off', plans: 'suggest' }, consent })).body;
  assert.equal(upd.scopes.workouts, 'off'); assert.equal(upd.pairScopes.workouts, 'off');
  // Tim cannot touch her grant.
  assert.equal((await call('u_tim', 'POST', '/api/sharing/update', { id: conn.id, scopes: {}, consent })).status, 404);
  assert.equal((await call('u_tim', 'POST', '/api/sharing/disconnect', { id: conn.id })).status, 404);

  // Marco removed from the gym: Lea's connection shows as paused, Marco's member list too.
  await call('u_admin', 'POST', '/api/admin/gyms/staff', { gymId: gym.id, userId: 'u_marco', role: 'trainer', on: false });
  mine = (await call('u_lea', 'GET', '/api/sharing')).body;
  assert.equal(mine.connections[0].paused, 'left-gym');
  assert.equal((await call('u_marco', 'GET', '/api/trainer')).body.members[0].levels.metrics, 'off');
  await call('u_admin', 'POST', '/api/admin/gyms/staff', { gymId: gym.id, userId: 'u_marco', role: 'trainer', on: true });

  // She disconnects. Gone for Marco on the next request.
  assert.equal((await call('u_lea', 'POST', '/api/sharing/disconnect', { id: conn.id })).status, 200);
  assert.equal((await call('u_marco', 'GET', '/api/trainer')).body.members.length, 0);
  assert.equal((await call('u_lea', 'GET', '/api/sharing')).body.connections.length, 0);

  // Her log says what happened, in order; only she reads it.
  const lg = (await call('u_lea', 'GET', '/api/sharing/log')).body.log.map(e => e.ev);
  // Marco leaving the gym is in it too (her offer to keep him privately lapsed when he came back).
  assert.deepEqual(lg, ['grant.end', 'trainer.left-gym', 'grant.update', 'grant.accept', 'gym.lead', 'grant.create']);
  assert.equal((await call('u_marco', 'GET', '/api/sharing/log')).body.log.length, 0);

  // The export has the grants, the consents with version and hash, and the log.
  const ex = await call('u_lea', 'GET', '/api/sharing/export');
  assert.match(ex.headers.get('content-disposition'), /attachment/);
  assert.equal(ex.body.consents.every(c => c.hash && c.v), true);
  assert.equal(ex.body.consents[0].lang, 'de');
  assert.equal(ex.body.log.length, 6);
  // Her inbox travels with it: the "Marco is now your trainer" and "sharing changed" notices.
  assert.deepEqual(ex.body.inbox.filter(i => i.kind === 'notice').map(i => i.notice).sort(), ['connected', 'scopes']);
  assert.equal(ex.body.grants.length, 2);

  // She leaves the gym, then deletes her account: nothing of her is left in org.json or share/.
  assert.equal((await call('u_lea', 'POST', '/api/sharing/leave', { gymId: gym.id })).status, 200);
  assert.equal((await call('u_lea', 'POST', '/api/sharing/leave', { gymId: gym.id })).status, 404);
  const del = await call('u_admin', 'POST', '/api/admin/user/delete', { id: 'u_lea' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  const orgFile = fs.readFileSync(path.join(h.dataDir, 'org.json'), 'utf8');
  assert.equal(orgFile.includes('u_lea'), false);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'share', 'u_lea.json')), false);
});

test('a trainer deleting their account leaves the members their log, without the name', async t => {
  const { call, dataDir } = await start(t);
  await call('u_admin', 'POST', '/api/admin/user/trainer', { id: 'u_marco', free: true });
  const { code } = (await call('u_marco', 'POST', '/api/trainer/codes', {})).body;
  const p = (await call('u_tim', 'POST', '/api/sharing/code', { code })).body;
  assert.equal(p.gym, null); assert.equal(p.leadDefaults, null);
  const c = (await call('u_tim', 'POST', '/api/sharing/connect', { code, scopes: p.defaults, consent: { v: p.consent.v, hash: p.consent.hash } })).body;
  await call('u_marco', 'POST', '/api/trainer/requests/answer', { id: c.id, accept: true });
  // The admin removes Marco's account (he is not an admin).
  assert.equal((await call('u_admin', 'POST', '/api/admin/user/delete', { id: 'u_marco' })).status, 200);
  const log = JSON.parse(fs.readFileSync(path.join(dataDir, 'share', 'u_tim.json'), 'utf8')).log;
  assert.equal(JSON.stringify(log).includes('Marco'), false);
  assert.ok(log.some(e => e.ev === 'grant.accept'));
  assert.equal((await call('u_tim', 'GET', '/api/sharing')).body.connections.length, 0);
});

test('TRAINERS off: every new route is a 404 the app can read, config says nothing', async t => {
  const { call } = await start(t, { TRAINERS: '' });
  assert.equal((await call('u_lea', 'GET', '/api/config')).body.trainers, undefined);
  for (const [m, p] of [['GET', '/api/sharing'], ['POST', '/api/sharing/code'], ['GET', '/api/trainer'], ['POST', '/api/trainer/codes'], ['GET', '/api/admin/gyms'], ['POST', '/api/admin/gyms/new']]) {
    const r = await call(m === 'GET' ? 'u_lea' : 'u_admin', m, p, m === 'POST' ? {} : undefined);
    assert.equal(r.status, 404, p); assert.equal(r.body.code, 'trainers-off', p);
  }
  assert.equal((await call(null, 'GET', '/api/sharing')).status, 404);
});

test('budgets and code guessing: 20 codes a day, wrong codes pause the account', async t => {
  const { call } = await start(t);
  await call('u_admin', 'POST', '/api/admin/user/trainer', { id: 'u_marco', free: true });
  for (let i = 0; i < 20; i++) assert.equal((await call('u_marco', 'POST', '/api/trainer/codes', {})).status, 200);
  const over = await call('u_marco', 'POST', '/api/trainer/codes', {});
  assert.equal(over.status, 429); assert.equal(over.body.code, 'rate-limited'); assert.ok(+over.headers.get('retry-after') > 0);
  const good = (await call('u_admin', 'POST', '/api/admin/user/trainer', { id: 'u_lena', free: true }), await call('u_lena', 'POST', '/api/trainer/codes', {})).body.code;
  // A code whose trainer lost the role is as dead as an expired one, and comes back with the role.
  await call('u_admin', 'POST', '/api/admin/user/trainer', { id: 'u_lena', free: false });
  assert.equal((await call('u_lea', 'POST', '/api/sharing/code', { code: good })).body.code, 'code-invalid');
  await call('u_admin', 'POST', '/api/admin/user/trainer', { id: 'u_lena', free: true });
  assert.equal((await call('u_lea', 'POST', '/api/sharing/code', { code: good })).status, 200);
  // Ten wrong codes are free, then the caller waits, even for a right one.
  // The address already has one wrong code (the dead one above): ten more and it is paused.
  for (let i = 0; i < 10; i++) {
    const r = await call('u_tim', 'POST', '/api/sharing/code', { code: 'TR-AAAAA-AAAA' + 'BCDEFGHJKLM'[i] });
    assert.equal(r.status, 404); assert.equal(r.body.code, 'code-invalid');
  }
  const paused = await call('u_tim', 'POST', '/api/sharing/code', { code: good });
  assert.equal(paused.status, 429); assert.equal(paused.body.code, 'code-paused');
  // The address is paused too (both test accounts call from 127.0.0.1), so a second account is no way around it.
  assert.equal((await call('u_lea', 'POST', '/api/sharing/code', { code: good })).body.code, 'code-paused');
});

test('ADMIN_DATA_VIEW off: the drill-down and the list are numbers only', async t => {
  const { call } = await start(t);
  const d = (await call('u_admin', 'GET', '/api/admin/user?id=u_lea')).body;
  assert.equal(d.data_view, false);
  assert.deepEqual(d.counts, { workouts: 1, bodyweight: 1, measurements: 0, routines: 1 });
  assert.ok(d.bytes > 0);
  for (const k of ['workouts', 'bodyweight', 'routines']) assert.equal(d[k], undefined, k);
  assert.equal(JSON.stringify(d).includes('68.4'), false);
  assert.equal(JSON.stringify(d).includes('Push A'), false);
  const list = (await call('u_admin', 'GET', '/api/admin/users')).body;
  assert.equal(list.data_view, false);
  const lea = list.users.find(u => u.id === 'u_lea');
  assert.equal(lea.workouts, 1); assert.equal('lastWorkout' in lea, false);
});

test('ADMIN_DATA_VIEW on: the old drill-down, and every look is logged for the admin and the member', async t => {
  const { call, dataDir } = await start(t, { ADMIN_DATA_VIEW: 'on' });
  const d = (await call('u_admin', 'GET', '/api/admin/user?id=u_lea')).body;
  assert.equal(d.data_view, true);
  assert.equal(d.workouts[0].name, 'Push A');
  assert.equal(d.bodyweight[0].w, 68.4);
  assert.equal((await call('u_admin', 'GET', '/api/admin/users')).body.users.find(u => u.id === 'u_lea').lastWorkout, '2026-11-01');
  const audit = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(audit.filter(e => e.ev === 'admin.data-view').length, 2);
  assert.equal(audit.find(e => e.ev === 'admin.data-view' && e.tgt).tgt, 'u_lea');
  const mine = (await call('u_lea', 'GET', '/api/sharing/log')).body.log;
  assert.equal(mine[0].ev, 'data.admin-view'); assert.equal(mine[0].actor.name, 'Adam');
  // Not an admin: still 403.
  assert.equal((await call('u_tim', 'GET', '/api/admin/user?id=u_lea')).status, 403);
});
