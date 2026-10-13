/* Plan-only API credentials and imports must never gain access to a full profile. Real server in
   a child with an isolated DATA_DIR, following the other server-* integration tests. */
import { test } from 'node:test';
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
const GOOD = 'correct horse battery staple';
const UID = 'u_plan_1';
const ORIGIN = 'http://localhost:8080';

function mintSession(uid = UID, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = (uid = UID, sv = 0) => `gymsid=${mintSession(uid, sv)}`;

const bundle = (patch = {}) => ({
  opengym_plan: 1,
  unit: 'kg',
  name: 'Three day plan',
  week: { '1': 'new-a', '3': 'new-b' },
  routines: [
    { id: 'new-a', name: 'Day A', emoji: '💪', prog: 'linear', ex: [
      { id: '0001', sets: 3, mode: 'reps', reps: 8, inc: 5 },
      { id: '0002', sets: 3, mode: 'reps', reps: 10 },
      { id: '0003', sets: 2, mode: 'reps', reps: 12 }
    ] },
    { id: 'new-b', name: 'Day B', emoji: '🏋️', prog: 'linear', ex: [
      { id: '1512', sets: 3, mode: 'reps', reps: 8 },
      { id: '0006', sets: 3, mode: 'reps', reps: 10 },
      { id: '0007', sets: 2, mode: 'reps', reps: 12 }
    ] }
  ],
  customEx: [],
  ...patch
});

async function startServer(t, { state, planKeys = [], disabled = false } = {}) {
  const pw = await hashPassword(GOOD);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-plan-import-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'Plan user', created: new Date().toISOString(), disabled, pw: { h: pw, set: new Date().toISOString() }, ...(planKeys.length ? { planKeys } : {}) }],
    creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', PASSWORD_LOGIN: '1', TRUST_PROXY: '1' }
  });
  const h = { api: '', log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (method, p, { body, token, session = cookie(), headers = {} } = {}) => {
    const r = await fetch(`${h.api}${p}`, {
      method,
      headers: {
        'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin',
        ...(session ? { Cookie: session } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload;
    try { payload = await r.json(); } catch { payload = null; }
    return { status: r.status, body: payload };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.stateFile = path.join(dataDir, `state-${UID}.json`);
  if (state) fs.writeFileSync(h.stateFile, JSON.stringify(state));
  return h;
}

async function createKey(h, extra = {}) {
  return h.call('POST', '/api/account/plan-keys', { body: { name: 'Importer', current: GOOD, ...extra } });
}

test('plan key imports only routines and keeps profile history and settings intact', async t => {
  const initial = {
    _rev: 7, _wid: 'wid-old', _wids: ['ancestor'], unit: 'kg',
    workouts: [{ id: 'workout-kept', d: '2026-10-01' }], bodyweight: [{ d: '2026-10-02', w: 80 }],
    routines: [{ id: 'old-routine', name: 'Keep me', ex: [] }], customEx: [{ id: 'old-custom', n: 'Keep custom' }],
    week: { '0': ['old-routine'] }, settings: { theme: 'dark' }
  };
  const h = await startServer(t, { state: initial });
  const noProof = await h.call('POST', '/api/account/plan-keys', { body: { name: 'Unconfirmed' } });
  assert.equal(noProof.status, 403);
  const created = await createKey(h);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.scope, 'plans:write');
  assert.match(created.body.token, /^opg_plan_/);
  const listed = await h.call('GET', '/api/account/plan-keys');
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.body).includes(created.body.token), false, 'listing never reveals bearer token');
  assert.equal(JSON.stringify(h.db()).includes(created.body.token), false, 'db stores only the token digest');

  const imported = await h.call('POST', '/api/plans/import', {
    session: null, token: created.body.token,
    body: { plan: bundle(), baseRev: 7, baseWid: 'wid-old' }
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.ok, true);
  assert.equal(imported.body.rev, 8);
  assert.ok(imported.body.wid);
  assert.equal(imported.body.routines, 2);
  const saved = JSON.parse(fs.readFileSync(h.stateFile, 'utf8'));
  assert.deepEqual(saved.workouts, initial.workouts);
  assert.deepEqual(saved.bodyweight, initial.bodyweight);
  assert.deepEqual(saved.settings, initial.settings);
  assert.deepEqual(saved.week, initial.week, 'schedule defaults to false');
  assert.deepEqual(saved.routines.map(r => r.name), ['Keep me', 'Day A', 'Day B']);
  assert.deepEqual(saved.customEx.map(x => x.id), ['old-custom']);

  const planRead = await h.call('GET', '/api/plans', { session: null, token: created.body.token });
  assert.equal(planRead.status, 200);
  assert.deepEqual(Object.keys(planRead.body).sort(), ['plan', 'rev', 'wid']);
  assert.deepEqual(Object.keys(planRead.body.plan).sort(), ['customEx', 'opengym_plan', 'routines', 'unit', 'week']);
  assert.deepEqual(planRead.body.plan.routines.map(r => r.name), ['Keep me', 'Day A', 'Day B']);
});

test('plan import rejects stale revisions and write-id ABA without returning state', async t => {
  const h = await startServer(t, { state: { _rev: 4, _wid: 'current-wid', _wids: [], workouts: [{ id: 'secret-history' }], routines: [], bodyweight: [] } });
  const { body: key } = await createKey(h);
  for (const body of [
    { plan: bundle(), baseRev: 3, baseWid: 'old-wid' },
    { plan: bundle(), baseRev: 4, baseWid: 'aba-wid' }
  ]) {
    const r = await h.call('POST', '/api/plans/import', { session: null, token: key.token, body });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'conflict');
    assert.equal('state' in r.body, false);
    assert.equal('workouts' in r.body, false);
    assert.equal(JSON.stringify(r.body).includes('secret-history'), false);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(h.stateFile, 'utf8')).routines, []);
});

test('plan-only bearer cannot read or write profile data, manage keys, or access admin history', async t => {
  const h = await startServer(t, { state: { _rev: 2, workouts: [{ id: 'private-workout' }], routines: [], bodyweight: [] } });
  const { body: key } = await createKey(h);
  for (const [method, p, body] of [
    ['GET', '/api/data'], ['GET', '/api/data/rev'], ['GET', '/api/admin/user?id=' + UID],
    ['GET', '/api/account/plan-keys'], ['POST', '/api/account/plan-keys/revoke', { id: key.id }],
    ['POST', '/api/account/plan-keys', { name: 'Escalate', current: GOOD }],
    ['PUT', '/api/data', { state: { workouts: [], routines: [] } }]
  ]) {
    const r = await h.call(method, p, { session: null, token: key.token, body });
    assert.ok(r.status === 401 || r.status === 403, `${method} ${p}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(JSON.stringify(r.body).includes('private-workout'), false);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(h.stateFile, 'utf8')).workouts, [{ id: 'private-workout' }]);
});

test('import validation rejects extra fields, unknown exercises, and invalid schedules without writes', async t => {
  const h = await startServer(t, { state: { _rev: 1, _wid: 'start', workouts: [], routines: [{ id: 'keep', name: 'Keep', ex: [] }], customEx: [], dayPlan: { '0': 'keep' } } });
  const { body: key } = await createKey(h);
  const cases = [
    { plan: bundle({ extra: true }), baseRev: 1, baseWid: 'start' },
    { plan: bundle({ routines: [{ ...bundle().routines[0], ex: [{ id: 'not-real', sets: 3, reps: 8, mode: 'reps' }, ...bundle().routines[0].ex.slice(1)] }, bundle().routines[1]] }), baseRev: 1, baseWid: 'start' },
    { plan: bundle({ week: { '8': 'new-a' } }), baseRev: 1, baseWid: 'start', schedule: true },
    { plan: bundle(), baseRev: 1, baseWid: 'start', schedule: 'yes' }
  ];
  for (const body of cases) {
    const r = await h.call('POST', '/api/plans/import', { session: null, token: key.token, body });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(h.stateFile, 'utf8')), { _rev: 1, _wid: 'start', workouts: [], routines: [{ id: 'keep', name: 'Keep', ex: [] }], customEx: [], dayPlan: { '0': 'keep' } });
});

test('revocation and session-version change invalidate plan keys', async t => {
  const h = await startServer(t);
  const issued = await createKey(h, { days: 1 });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  const token = issued.body.token;
  const valid = body => h.call('POST', '/api/plans/import', { session: null, token, body: { plan: bundle(), baseRev: 0, ...body } });
  const initial = await valid({});
  assert.equal(initial.status, 200, JSON.stringify(initial.body));

  const revoked = await h.call('POST', '/api/account/plan-keys/revoke', { body: { id: issued.body.id } });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal((await valid({ baseRev: initial.body.rev, baseWid: initial.body.wid })).status, 401);

  const database = h.db();
  assert.ok(Array.isArray(database.users[0].planKeys));
  assert.equal(database.users[0].planKeys.some(k => k.id === issued.body.id), false, 'revocation removes the row');
});

test('expired and disabled-account plan keys cannot access the plan surface', async t => {
  const expiredToken = `opg_plan_${'1'.repeat(24)}_${'A'.repeat(43)}`;
  const expiredKey = { id: 'expired', name: 'Old key', hash: crypto.createHash('sha256').update(expiredToken).digest('hex'), expires: Date.now() - 1000, sv: 0 };
  const h = await startServer(t, { planKeys: [expiredKey] });
  for (const [method, p, body] of [
    ['GET', '/api/plans'], ['POST', '/api/plans/import', { plan: bundle(), baseRev: 0 }]
  ]) {
    const r = await h.call(method, p, { session: null, token: expiredToken, body });
    assert.equal(r.status, 401);
  }

  const activeToken = `opg_plan_${'2'.repeat(24)}_${'B'.repeat(43)}`;
  const activeKey = { id: 'active', name: 'Current key', hash: crypto.createHash('sha256').update(activeToken).digest('hex'), expires: Date.now() + 86400000, sv: 0 };
  const locked = await startServer(t, { disabled: true, planKeys: [activeKey] });
  assert.equal((await locked.call('GET', '/api/plans', { session: null, token: activeToken })).status, 401);
});

test('plan bearer is rejected after account session version changes or user is disabled', async t => {
  const h = await startServer(t);
  const issued = await createKey(h);
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  const attempt = () => h.call('POST', '/api/plans/import', { session: null, token: issued.body.token, body: { plan: bundle(), baseRev: 0 } });
  assert.equal((await attempt()).status, 200);
  const logoutAll = await h.call('POST', '/api/logout/all', { body: {} });
  assert.equal(logoutAll.status, 200, JSON.stringify(logoutAll.body));
  assert.equal((await attempt()).status, 401, 'stored session version no longer matches');
});

test('schedule replacement and lb bundle normalization are limited to imported plan data', async t => {
  const initial = { _rev: 3, _wid: 'wid-3', unit: 'kg', workouts: [{ id: 'stay' }], routines: [], customEx: [], week: { '0': ['old'] } };
  const h = await startServer(t, { state: initial });
  const { body: key } = await createKey(h);
  const source = bundle();
  const plan = bundle({ unit: 'lb', routines: [
    { ...source.routines[0], ex: [{ ...source.routines[0].ex[0], weight: 110 }, ...source.routines[0].ex.slice(1)] },
    source.routines[1]
  ] });
  const r = await h.call('POST', '/api/plans/import', { session: null, token: key.token, body: { plan, baseRev: 3, baseWid: 'wid-3', schedule: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const saved = JSON.parse(fs.readFileSync(h.stateFile, 'utf8'));
  assert.deepEqual(saved.workouts, initial.workouts);
  assert.equal(saved.routines[0].ex[0].weight, 50, '110 lb normalized to kg');
  assert.equal(saved.routines[0].ex[0].inc, 2.25, '5 lb increment normalized to kg');
  assert.equal(saved.unit, 'kg');
  assert.deepEqual(Object.keys(saved.week).sort(), ['1', '3']);
  assert.notEqual(saved.week['1'][0], 'new-a');
  assert.notEqual(saved.week['3'][0], 'new-b');
  assert.deepEqual(saved.week['1'], [saved.routines.find(x => x.name === 'Day A').id]);
  assert.deepEqual(saved.week['3'], [saved.routines.find(x => x.name === 'Day B').id]);
});

test('strict import rejects history injection, prototype ids, invalid units and missing revisions', async t => {
  const initial = { _rev: 2, _wid: 'w2', routines: [], workouts: [{ id: 'protected' }], bodyweight: [{ d: '2026-10-01', w: 75 }], dayPlan: { '2026-10-09': ['old'] }, unit: 'kg' };
  const h = await startServer(t, { state: initial });
  const { body: key } = await createKey(h);
  for (const plan of [
    bundle({ workouts: [] }), bundle({ bodyweight: [] }), bundle({ unit: 'stone' }),
    bundle({ routines: [{ id: '__proto__', name: 'Bad', ex: [{ id: '0001', sets: 3 }] }] }),
    bundle({ routines: [{ id: 'r', name: 'Bad', ex: [{ id: 'constructor', sets: 3 }] }] }),
    bundle({ routines: [{ id: 'r', name: 'Bad', ex: [{ id: '0001', sets: 3, done: true }] }] }),
    bundle({ customEx: [{ id: '0001', n: 'Override catalogue', bp: 'chest' }] })
  ]) {
    const r = await h.call('POST', '/api/plans/import', { session: null, token: key.token, body: { plan, baseRev: 2, baseWid: 'w2' } });
    assert.equal(r.status, 400);
  }
  assert.equal((await h.call('POST', '/api/plans/import', { session: null, token: key.token, body: { plan: bundle() } })).status, 400);
  assert.equal((await h.call('POST', '/api/plans/import', { session: null, token: key.token, body: { plan: bundle(), baseRev: 2 } })).status, 409);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.stateFile, 'utf8')), initial);
});

test('new profile imports once; unreadable profile is never overwritten', async t => {
  const h = await startServer(t);
  const { body: key } = await createKey(h);
  const call = body => h.call('POST', '/api/plans/import', { session: null, token: key.token, body });
  const body = { plan: bundle(), baseRev: 0 };
  assert.equal((await call(body)).status, 200);
  const saved = fs.readFileSync(h.stateFile, 'utf8');
  assert.equal((await call(body)).status, 409);
  assert.equal(fs.readFileSync(h.stateFile, 'utf8'), saved);
  fs.writeFileSync(h.stateFile, '{not readable');
  assert.equal((await call({ ...body, baseRev: 1 })).status, 503);
  assert.equal(fs.readFileSync(h.stateFile, 'utf8'), '{not readable');
});

test('plan reads project prescriptions and referenced custom exercises without private media', async t => {
  const h = await startServer(t, { state: {
    _rev: 1, routines: [{ id: 'r', name: 'Routine', privateField: 'hidden-routine-data', ex: [{ id: 'c', sets: 3, reps: 8, done: true }] }],
    customEx: [{ id: 'c', n: 'Used', bp: 'chest', media: { hash: 'private-media' } }, { id: 'unused', n: 'Hidden custom', bp: 'back' }],
    workouts: [{ id: 'hidden-workout' }], unit: 'kg', week: { '1': ['r'] }
  } });
  const { body: key } = await createKey(h);
  const r = await h.call('GET', '/api/plans', { session: null, token: key.token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.plan.customEx.map(c => c.id), ['c']);
  const raw = JSON.stringify(r.body);
  for (const marker of ['private-media', 'hidden-routine-data', 'hidden-workout', 'Hidden custom', '"done"']) assert.equal(raw.includes(marker), false, marker);
});

test('missing or corrupt credential expiry fails closed', async t => {
  const token = `opg_plan_${'1'.repeat(24)}_${'A'.repeat(43)}`;
  const key = { id: '1'.repeat(24), name: 'Broken expiry', hash: crypto.createHash('sha256').update(token).digest('hex'), sv: 0 };
  const h = await startServer(t, { planKeys: [key] });
  assert.equal((await h.call('GET', '/api/plans', { session: null, token })).status, 401);
});
