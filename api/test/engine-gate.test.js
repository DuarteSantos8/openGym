import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { migrateProfileV1ToV2 } from '../migration/profile-migration.js';
import { packProfile, unpackProfile } from '../migration/profile-pack.js';
import { LIB_BY_ID } from '../coach/core/library.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const uid = 'u_engine_1';
const V1 = { workouts: [], routines: [], _ts: 1 };
const V2 = { ...V1, engineSchemaVersion: 2, prescriptions: {}, progression: {}, oneRepMaxes: {} };
const ENGINE = { 'X-OpenGym-Engine-Schema': '2' };
const V1_PROFILE = {
  unit: 'kg', _rev: 4, _ts: 1,
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear', warmupSets: 2 }] }],
  workouts: [{ id: 'w1', d: '2026-01-05', start: 1, routineIds: ['r1'], name: 'Secret session name',
    entries: [{ id: '0025', rid: 'r1', target: { sets: 3, reps: 5, weight: 60 }, sets: [{ r: 5, w: 60, done: true }] }] }]
};
const primaryFile = dir => path.join(dir, `state-${uid}.json`);
const backupFile = dir => path.join(dir, `state-${uid}.pre-engine-v1.json`);

const cookie = () => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};

async function harness(t, preload) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-engine-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: uid }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const call = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(api + route, {
      method,
      headers: { Cookie: cookie(), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    dataDir, api,
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

test('A17: invalid canonical writes leave the stored profile and revision untouched', async t => {
  const { put, get, dataDir } = await harness(t);
  const good = { ...V2, prescriptions: {}, progression: {}, oneRepMaxes: {} };
  assert.equal((await put(good, ENGINE)).status, 200);
  const before = fs.readFileSync(primaryFile(dataDir), 'utf8');
  const bad = { ...good, routines: [{ id: 'r', ex: [{ id: '0025', sets: 3 }] }] };
  assert.equal((await put(bad, ENGINE)).status, 400);
  assert.equal((await put({ ...good, prescriptions: [] }, ENGINE)).status, 400);
  assert.equal((await put({ ...V1 }, ENGINE)).status, 400);
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), before);
  assert.equal((await get(ENGINE)).body.rev, 1);
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
  const earlier = text;   // left by an attempt that died before replacing the primary
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


test('A26: a streamed old-client PUT cannot undo a completed migration', async t => {
  const { plant, migrate, dataDir, api } = await harness(t);
  const text = JSON.stringify(V1_PROFILE);
  plant(text);
  const bytes = JSON.stringify({ state: V1_PROFILE });
  let finish;
  const pending = new Promise((resolve, reject) => {
    const req = http.request(api + '/api/data', { method: 'PUT', headers: { Cookie: cookie(), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } }, res => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.write(bytes.slice(0, 1)); finish = () => req.end(bytes.slice(1));
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal((await migrate({ confirmed: true, baseRev: 4 })).status, 200);
  const after = fs.readFileSync(primaryFile(dataDir), 'utf8');
  finish();
  assert.equal((await pending).body.error, 'upgrade-required');
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), after);
});

test('A30: a stale backup is immutable and cannot protect a different source', async t => {
  const { plant, migrate, dataDir } = await harness(t);
  const text = JSON.stringify(V1_PROFILE);
  const earlier = JSON.stringify({ ...V1_PROFILE, _ts: 0 });
  plant(text); fs.writeFileSync(backupFile(dataDir), earlier);
  const result = await migrate({ confirmed: true, baseRev: 4 });
  assert.equal(result.body.reason, 'backup-source-mismatch');
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), text);
  assert.equal(fs.readFileSync(backupFile(dataDir), 'utf8'), earlier);
});

for (const fault of ['backup-write', 'primary-write', 'primary-rename']) test('A55: filesystem fault ' + fault + ' preserves source/revision and reports migration failure', async t => {
  const moduleFile = path.join(os.tmpdir(), `gym-fault-${crypto.randomUUID()}.mjs`);
  fs.writeFileSync(moduleFile, `import fs from 'node:fs';
const write = fs.writeFileSync, rename = fs.renameSync;
fs.writeFileSync = function(file, ...args) {
  if (String(file).endsWith('${fault === 'backup-write' ? '.pre-engine-v1.json.tmp' : `state-${uid}.json.tmp`}') && '${fault}' !== 'primary-rename') throw new Error('injected-write');
  return write.call(this, file, ...args);
};
fs.renameSync = function(from, to) {
  if (String(to).endsWith('state-${uid}.json') && '${fault}' === 'primary-rename') throw new Error('injected-rename');
  return rename.call(this, from, to);
};`);
  t.after(() => fs.rmSync(moduleFile, { force: true }));
  const { plant, migrate, dataDir } = await harness(t, moduleFile);
  const text = JSON.stringify(V1_PROFILE); plant(text);
  const result = await migrate({ confirmed: true, baseRev: 4 });
  assert.deepEqual([result.status, result.body.error], [500, 'migration-failed']);
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), text);
  assert.equal(JSON.parse(fs.readFileSync(primaryFile(dataDir)))._rev, 4);
  if (fault !== 'backup-write') assert.equal(fs.readFileSync(backupFile(dataDir), 'utf8'), text);
  else assert.equal(fs.existsSync(backupFile(dataDir)), false);
  const audit = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8');
  assert.match(audit, /data\.migrate\.fail/);
  assert.doesNotMatch(audit, /data\.migrate\.ok/);
});


test('A31: a 3000-workout migration remains writable through ordinary sync', async t => {
  const { plant, migrate, dataDir, api } = await harness(t);
  const workout = { ...V1_PROFILE.workouts[0], entries: [{ ...V1_PROFILE.workouts[0].entries[0], sets: Array.from({ length: 3 }, () => ({ r: 5, w: 60, done: true })) }] };
  const profile = { ...V1_PROFILE, workouts: Array.from({ length: 3000 }, (_, i) => ({ ...workout, id: 'w' + i, start: i + 1 })) };
  plant(JSON.stringify(profile));
  assert.equal((await migrate({ confirmed: true, baseRev: 4 })).status, 200);
  const state = unpackProfile(JSON.parse(fs.readFileSync(primaryFile(dataDir), 'utf8')));   // the canonical form: the largest body a client can still send
  const body = JSON.stringify({ state, baseRev: 5 });
  assert.ok(Buffer.byteLength(body) > 5 * 1024 * 1024);
  const response = await fetch(api + '/api/data', { method: 'PUT', headers: { Cookie: cookie(), ...ENGINE, 'Content-Type': 'application/json' }, body });
  assert.equal(response.status, 200);
});

test('A31: oversized canonical conversion refuses success and preserves source', async t => {
  const { plant, migrate, dataDir } = await harness(t);
  const text = JSON.stringify({ ...V1_PROFILE, padding: 'x'.repeat(16 * 1024 * 1024) });
  plant(text);
  const result = await migrate({ confirmed: true, baseRev: 4 });
  assert.equal(result.body.reason, 'profile-too-large');
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), text);
  assert.equal(fs.readFileSync(backupFile(dataDir), 'utf8'), text);
});

test('M5: the profile is stored and sent in its compact form, and read back canonical', async t => {
  const { put, get, dataDir } = await harness(t);
  const canonical = migrateProfileV1ToV2(JSON.parse(JSON.stringify(V1_PROFILE)), LIB_BY_ID).profile;
  assert.equal((await put(canonical, ENGINE)).status, 200);                       // canonical push still works
  const onDisk = JSON.parse(fs.readFileSync(primaryFile(dataDir), 'utf8'));
  assert.equal(onDisk.packed, 1);
  const wire = (await get(ENGINE)).body.state;
  assert.equal(wire.packed, 1);
  assert.deepEqual({ ...unpackProfile(wire), _rev: undefined, _ts: undefined }, { ...canonical, _rev: undefined, _ts: undefined });
  assert.equal((await put(packProfile(canonical), ENGINE)).status, 200);          // and so does a packed one
  assert.equal(JSON.parse(fs.readFileSync(primaryFile(dataDir), 'utf8')).packed, 1);
  assert.equal((await put({ packed: 1, engineSchemaVersion: 2, workouts: [null], prescriptions: { a: { _t: 'x' } } }, ENGINE)).status, 400);   // hostile packed doc: refused, not a 500
});
