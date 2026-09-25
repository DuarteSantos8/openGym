import test from 'node:test';
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
const uid = 'u_engine_1';
const V1 = { workouts: [], routines: [], _ts: 1 };
const V2 = { ...V1, engineSchemaVersion: 2 };
const ENGINE = { 'X-OpenGym-Engine-Schema': '2' };
const V1_PROFILE = {
  unit: 'kg', _rev: 4, _ts: 1,
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear', warmupSets: 2 }] }],
  workouts: [{ id: 'w1', d: '2026-01-05', start: 1, routineIds: ['r1'], name: 'Secret session name',
    entries: [{ id: '0025', rid: 'r1', target: { sets: 3, reps: 5, weight: 60 }, sets: [{ r: 5, w: 60, done: true }] }] }]
};
const primaryFile = dir => path.join(dir, `state-${uid}.json`);
const backupFile = dir => path.join(dir, `state-${uid}.pre-engine-v1.json`);
const freePort = () => new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

const cookie = () => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};

async function harness(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-engine-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: uid }
  });
  const api = `http://127.0.0.1:${port}`;
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${api}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const call = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(api + route, {
      method,
      headers: { Cookie: cookie(), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    dataDir,
    put: (state, headers = {}) => call('/api/data', { method: 'PUT', body: { state }, headers }),
    get: (headers = {}) => call('/api/data', { headers }),
    getRev: (headers = {}) => call('/api/data/rev', { headers }),
    adminUsers: () => call('/api/admin/users'),
    coachStatus: () => call('/api/coach/status'),
    plant: text => fs.writeFileSync(primaryFile(dataDir), text),
    status: () => call('/api/data/migration-status', { headers: ENGINE }),
    migrate: body => call('/api/data/migrate-engine-v2', { method: 'POST', body, headers: ENGINE })
  };
}

test('v2 data is readable and writable only by engine-aware clients (A47)', async t => {
  const { put, get, getRev } = await harness(t);
  assert.equal((await put(V2, { 'X-OpenGym-Engine-Schema': '2' })).status, 200);
  for (const call of [get, getRev]) {
    const response = await call();
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'upgrade-required');
    assert.equal(response.body.minEngineSchema, 2);
  }
  assert.equal((await put(V1)).status, 409);
  assert.equal((await get({ 'X-OpenGym-Engine-Schema': '1' })).status, 409);
  assert.equal((await get({ 'X-OpenGym-Engine-Schema': '2' })).status, 200);
  assert.equal((await get({ 'X-OpenGym-Engine-Schema': '3' })).status, 200);
  assert.equal((await get({ 'X-OpenGym-Engine-Schema': 'nonsense' })).status, 409);
});

test('a v1 profile stays with old clients and sends engine-aware clients to the migration', async t => {
  const { plant, get, put, getRev, status, dataDir } = await harness(t);
  const text = JSON.stringify(V1_PROFILE);
  plant(text);
  assert.equal((await get()).status, 200);
  for (const call of [() => get(ENGINE), () => getRev(ENGINE), () => put({ ...V2, _ts: 2 }, ENGINE)]) {
    const r = await call();
    assert.deepEqual([r.status, r.body.error], [409, 'migration-required']);
  }
  assert.deepEqual((await status()).body, { required: true, schemaVersion: 1, revision: 4, summary: { routines: 1, workouts: 1, bytes: Buffer.byteLength(text) } });
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), text);
  assert.equal(fs.existsSync(backupFile(dataDir)), false);
});

test('confirming migrates once: byte-identical backup, validated v2, _rev + 1, old clients locked out', async t => {
  const { plant, get, migrate, status, dataDir } = await harness(t);
  const text = JSON.stringify(V1_PROFILE);
  plant(text);
  const r = await migrate({ confirmed: true, baseRev: 4 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.migrated, r.body.revision, r.body.summary.workouts, r.body.summary.needsReview], [true, 5, 1, 0]);
  assert.equal(fs.readFileSync(backupFile(dataDir), 'utf8'), text);
  const saved = JSON.parse(fs.readFileSync(primaryFile(dataDir), 'utf8'));
  assert.deepEqual([saved.engineSchemaVersion, saved._rev], [2, 5]);
  assert.deepEqual(saved.routines[0].ex[0].warmup, { mode: 'smart', count: 2 });
  assert.equal((await get(ENGINE)).body.state.workouts[0].exposures.length, 1);
  assert.equal((await get()).body.error, 'upgrade-required');
  const again = await migrate({ confirmed: true, baseRev: 5 });
  assert.deepEqual(again.body, { migrated: false, revision: 5 });
  assert.equal(fs.readFileSync(backupFile(dataDir), 'utf8'), text);
  assert.equal(JSON.parse(fs.readFileSync(primaryFile(dataDir), 'utf8'))._rev, 5);
  assert.equal((await status()).body.required, false);
  const log = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8');
  assert.match(log, /data\.migrate\.ok/);
  assert.doesNotMatch(log, /Secret session name/);
});

test('a stale or malformed confirmation writes nothing', async t => {
  const { plant, migrate, dataDir } = await harness(t);
  const text = JSON.stringify(V1_PROFILE);
  plant(text);
  for (const body of [{}, { confirmed: true }, { confirmed: 'yes', baseRev: 4 }, { confirmed: true, baseRev: 4, extra: 1 }]) {
    assert.equal((await migrate(body)).status, 400, JSON.stringify(body));
  }
  const stale = await migrate({ confirmed: true, baseRev: 3 });
  assert.deepEqual([stale.status, stale.body.error, stale.body.revision], [409, 'migration-state-changed', 4]);
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), text);
  assert.equal(fs.existsSync(backupFile(dataDir)), false);
});

test('a crash-left v1 backup is reused; a backup that is not v1 fails closed', async t => {
  const { plant, migrate, get, dataDir } = await harness(t);
  const text = JSON.stringify(V1_PROFILE);
  plant(text);
  const earlier = JSON.stringify({ ...V1_PROFILE, _ts: 0 });   // left by an attempt that died before replacing the primary
  fs.writeFileSync(backupFile(dataDir), earlier);
  assert.equal((await migrate({ confirmed: true, baseRev: 4 })).status, 200);
  assert.equal(fs.readFileSync(backupFile(dataDir), 'utf8'), earlier);

  plant(text);
  fs.writeFileSync(backupFile(dataDir), JSON.stringify({ engineSchemaVersion: 2 }));
  const r = await migrate({ confirmed: true, baseRev: 4 });
  assert.deepEqual([r.status, r.body.error], [500, 'migration-failed']);
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), text);
  assert.equal((await get(ENGINE)).body.error, 'migration-required');
  assert.match(fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'), /data\.migrate\.fail/);
});

test('a future schema or an unreadable file is closed to every data route', async t => {
  const { plant, get, put, status, migrate } = await harness(t);
  plant(JSON.stringify({ engineSchemaVersion: 3, _rev: 1 }));
  for (const r of [await get(), await get(ENGINE), await status(), await migrate({ confirmed: true, baseRev: 1 })]) {
    assert.deepEqual([r.status, r.body.error], [409, 'unsupported-schema']);
  }
  plant('{not json');
  for (const r of [await get(ENGINE), await put(V2, ENGINE), await put(V1)]) {
    assert.deepEqual([r.status, r.body.error], [409, 'profile-unreadable']);
  }
});

test('admin and Coach routes bypass the data gate (A48)', async t => {
  const { put, adminUsers, coachStatus } = await harness(t);
  await put(V2, { 'X-OpenGym-Engine-Schema': '2' });
  assert.equal((await adminUsers()).status, 200);
  assert.notEqual((await coachStatus()).status, 409);
});
