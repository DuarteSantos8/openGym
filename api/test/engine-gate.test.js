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
const OTHER = 'u_engine_2';   // a second profile the admin (uid) can delete
const V1 = { workouts: [], routines: [], _ts: 1 };
const V2 = { ...V1, engineSchemaVersion: 2, prescriptions: {}, progression: {}, oneRepMaxes: {} };
const ENGINE = { 'X-OpenGym-Engine-Schema': '2' };
// A client built for engine contract 1 (the unified programme model) says so on every request.
const CONTRACT = { ...ENGINE, 'X-OpenGym-Engine-Contract': '1' };
const MARKED = { ...V2, engineContractRevision: 1 };
const V1_PROFILE = {
  unit: 'kg', _rev: 4, _ts: 1,
  routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear', warmupSets: 2 }] }],
  workouts: [{ id: 'w1', d: '2026-01-05', start: 1, routineIds: ['r1'], name: 'Secret session name',
    entries: [{ id: '0025', rid: 'r1', target: { sets: 3, reps: 5, weight: 60 }, sets: [{ r: 5, w: 60, done: true }] }] }]
};
const primaryFile = dir => path.join(dir, `state-${uid}.json`);
const backupFile = dir => path.join(dir, `state-${uid}.pre-engine-v1.json`);
const contractBackup = (dir, who = uid) => path.join(dir, `state-${who}.pre-contract-1.json`);

const cookie = (who = uid) => {
  const payload = `${who}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};

async function harness(t, preload) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-engine-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'One', created: new Date().toISOString() }, { id: OTHER, name: 'Two', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), 'server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ADMIN_UIDS: uid }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const call = async (route, { method = 'GET', body, headers = {}, as = uid } = {}) => {
    const response = await fetch(api + route, {
      method,
      headers: { Cookie: cookie(as), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    dataDir, api,
    put: (state, headers = {}, as = uid) => call('/api/data', { method: 'PUT', body: { state }, headers, as }),
    get: (headers = {}) => call('/api/data', { headers }),
    getRev: (headers = {}) => call('/api/data/rev', { headers }),
    adminUsers: () => call('/api/admin/users'),
    adminDelete: id => call('/api/admin/user/delete', { method: 'POST', body: { id } }),
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
  assert.deepEqual((await status()).body, { required: true, schemaVersion: 1, contract: 0, contractRequired: false, revision: 4, summary: { routines: 1, workouts: 1, bytes: Buffer.byteLength(text) } });
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
  assert.equal(saved.engineContractRevision, 1, 'the migration chains the contract upgrade');
  assert.equal((await get(CONTRACT)).body.state.workouts[0].exposures.length, 1);
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

test('the device\'s timezone in the confirmation keeps a running programme\'s weeks; one Intl does not know is left out', async t => {
  const { plant, migrate, dataDir } = await harness(t);
  const text = JSON.stringify({ ...V1_PROFILE, programmes: { pg: { id: 'pg', name: 'Block', at: 1, days: { 1: ['r1'] }, weeks: [{}, {}] } },
    programme: { id: 'pg', startedOn: '2026-01-05', cycle: 1, bump: 0, saved: null } });
  const runTz = () => Object.values(unpackProfile(JSON.parse(fs.readFileSync(primaryFile(dataDir), 'utf8'))).programmeRuns)[0].tz;
  for (const [tz, frozen] of [['Australia/Sydney', 'Australia/Sydney'], ['Mars/Olympus', 'UTC'], [42, 'UTC']]) {
    plant(text);
    const r = await migrate({ confirmed: true, baseRev: 4, tz });
    assert.equal(r.status, 200, JSON.stringify(tz));
    assert.equal(runTz(), frozen, JSON.stringify(tz));
  }
  assert.equal((await migrate({ confirmed: true, baseRev: 5, tz: 'UTC', extra: 1 })).status, 400);
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
    assert.deepEqual([r.status, r.body.error], [503, 'state unreadable']);
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

// The failed attempt left its backup; the old app wrote once more before the retry. The first
// backup stays as it is, and the retry keeps its own source beside it, named by revision.
test('a retry after a v1 write keeps the first backup and writes a rev-suffixed one', async t => {
  const { plant, migrate, dataDir } = await harness(t);
  const earlier = JSON.stringify({ ...V1_PROFILE, _rev: 3, _ts: 0 });
  const text = JSON.stringify(V1_PROFILE);
  plant(text); fs.writeFileSync(backupFile(dataDir), earlier);
  assert.equal((await migrate({ confirmed: true, baseRev: 4 })).status, 200);
  assert.equal(fs.readFileSync(backupFile(dataDir), 'utf8'), earlier);
  assert.equal(fs.readFileSync(path.join(dataDir, `state-${uid}.pre-engine-v1.r4.json`), 'utf8'), text);
});

for (const fault of ['backup-write', 'primary-write', 'primary-rename']) test('A55: filesystem fault ' + fault + ' preserves source/revision and reports migration failure', async t => {
  const moduleFile = path.join(os.tmpdir(), `gym-fault-${crypto.randomUUID()}.mjs`);
  fs.writeFileSync(moduleFile, `import fs from 'node:fs';
const write = fs.writeFileSync, rename = fs.renameSync, open = fs.openSync;
const doomed = file => String(file).endsWith('${fault === 'backup-write' ? '.pre-engine-v1.json.tmp' : `state-${uid}.json.tmp`}') && '${fault}' !== 'primary-rename';
// The durable write opens the temporary file itself (api/durable.js) and writes to the descriptor.
fs.openSync = function(file, ...args) {
  if (doomed(file)) throw new Error('injected-write');
  return open.call(this, file, ...args);
};
fs.writeFileSync = function(file, ...args) {
  if (doomed(file)) throw new Error('injected-write');
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
  const response = await fetch(api + '/api/data', { method: 'PUT', headers: { Cookie: cookie(), ...CONTRACT, 'Content-Type': 'application/json' }, body });
  assert.equal(response.status, 200);
});

test('A31: oversized canonical conversion refuses success and preserves source', async t => {
  const { plant, migrate, dataDir } = await harness(t);
  const text = JSON.stringify({ ...V1_PROFILE, padding: 'x'.repeat(16 * 1024 * 1024) });
  plant(text);
  const result = await migrate({ confirmed: true, baseRev: 4 });
  assert.equal(result.body.reason, 'profile-too-large');
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), text);
  // Refused before anything is written: no backup left to block a retry once the profile is smaller.
  assert.equal(fs.existsSync(backupFile(dataDir)), false);
});

test('M5: the profile is stored and sent in its compact form, and read back canonical', async t => {
  const { put, get, dataDir } = await harness(t);
  const canonical = migrateProfileV1ToV2(JSON.parse(JSON.stringify(V1_PROFILE)), LIB_BY_ID).profile;
  assert.equal((await put(canonical, CONTRACT)).status, 200);                     // canonical push still works
  const onDisk = JSON.parse(fs.readFileSync(primaryFile(dataDir), 'utf8'));
  assert.equal(onDisk.packed, 1);
  const wire = (await get(CONTRACT)).body.state;
  assert.equal(wire.packed, 1);
  const bookkeeping = { _rev: undefined, _ts: undefined, _wid: undefined, _wids: undefined };
  assert.deepEqual({ ...unpackProfile(wire), ...bookkeeping }, { ...canonical, ...bookkeeping });
  assert.equal((await put(packProfile(canonical), CONTRACT)).status, 200);        // and so does a packed one
  assert.equal(JSON.parse(fs.readFileSync(primaryFile(dataDir), 'utf8')).packed, 1);
  assert.equal((await put({ packed: 1, engineSchemaVersion: 2, engineContractRevision: 1, workouts: [null], prescriptions: { a: { _t: 'x' } } }, CONTRACT)).status, 400);   // hostile packed doc: refused, not a 500
});

/* ---------- engine contract 1: programmes as engine definitions (spec 16) ---------- */

test('a contract-0 client reading a marked profile gets 409 upgrade-required with minEngineContract 1', async t => {
  const { put, get, getRev } = await harness(t);
  // An unmarked v2 profile stays open to a build from before the contract.
  assert.equal((await put(V2, ENGINE)).status, 200);
  assert.equal((await get(ENGINE)).status, 200);
  assert.equal((await put(MARKED, CONTRACT)).status, 200);
  for (const headers of [ENGINE, { ...ENGINE, 'X-OpenGym-Engine-Contract': '0' }, { ...ENGINE, 'X-OpenGym-Engine-Contract': 'nonsense' }]) {
    for (const call of [get, getRev]) {
      const r = await call(headers);
      assert.deepEqual([r.status, r.body], [409, { error: 'upgrade-required', minEngineContract: 1 }], JSON.stringify(headers));
    }
  }
  const r = await get(CONTRACT);
  assert.deepEqual([r.status, r.body.state.engineContractRevision], [200, 1]);
  assert.equal((await getRev(CONTRACT)).body.rev, 2);
  // The schema gate still answers first for a client that knows neither.
  assert.deepEqual((await get()).body, { error: 'upgrade-required', minEngineSchema: 2 });
});

// Review Focus 1: a phone still on the previous build edits a profile another device upgraded.
test('contract-0 PUT on a marked file is 409 and leaves the file byte-identical', async t => {
  const { put, get, dataDir } = await harness(t);
  assert.equal((await put(MARKED, CONTRACT)).status, 200);
  const before = fs.readFileSync(primaryFile(dataDir), 'utf8');
  for (const state of [{ ...V2, _ts: 2 }, { ...MARKED, _ts: 2 }]) {
    const r = await put(state, ENGINE);
    assert.deepEqual([r.status, r.body], [409, { error: 'upgrade-required', minEngineContract: 1 }]);
  }
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), before);
  assert.equal((await get(CONTRACT)).body.rev, 1);
});

test('a PUT that drops the marker is refused after the body is read', async t => {
  const { put, plant, dataDir, api } = await harness(t);
  // A current client whose body has lost the marker (or lowers it) cannot write it away.
  assert.equal((await put(MARKED, CONTRACT)).status, 200);
  const marked = fs.readFileSync(primaryFile(dataDir), 'utf8');
  for (const state of [{ ...V2, _ts: 3 }, { ...MARKED, engineContractRevision: 0, _ts: 3 }]) {
    const r = await put(state, CONTRACT);
    assert.deepEqual([r.status, r.body], [409, { error: 'upgrade-required', minEngineContract: 1 }]);
  }
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), marked);

  // An old client's PUT streams in over an unmarked file; a current device marks the file while
  // the body is still arriving. The check after the body sees the marker and refuses.
  plant(JSON.stringify({ ...V2, _rev: 4 }));
  const bytes = JSON.stringify({ state: { ...V2, _ts: 9 } });
  let finish;
  const pending = new Promise((resolve, reject) => {
    const req = http.request(api + '/api/data', { method: 'PUT', headers: { Cookie: cookie(), ...ENGINE, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } }, res => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.write(bytes.slice(0, 1)); finish = () => req.end(bytes.slice(1));
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal((await put(MARKED, CONTRACT)).status, 200);
  const after = fs.readFileSync(primaryFile(dataDir), 'utf8');
  finish();
  assert.deepEqual(await pending, { status: 409, body: { error: 'upgrade-required', minEngineContract: 1 } });
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), after);
});

test('the first marked PUT keeps a pre-contract-1 backup once; deleting the account removes it', async t => {
  const { put, adminDelete, dataDir } = await harness(t);
  const file = path.join(dataDir, `state-${OTHER}.json`);
  assert.equal((await put(V2, ENGINE, OTHER)).status, 200);
  assert.equal((await put({ ...V2, _ts: 2 }, ENGINE, OTHER)).status, 200);
  assert.equal(fs.existsSync(contractBackup(dataDir, OTHER)), false, 'an unmarked write keeps no copy');
  const unmarked = fs.readFileSync(file, 'utf8');
  assert.equal((await put(MARKED, CONTRACT, OTHER)).status, 200);
  assert.equal(fs.readFileSync(contractBackup(dataDir, OTHER), 'utf8'), unmarked, 'the file as it was before the marker');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).engineContractRevision, 1);
  assert.equal((await put({ ...MARKED, _ts: 5 }, CONTRACT, OTHER)).status, 200);
  assert.equal(fs.readFileSync(contractBackup(dataDir, OTHER), 'utf8'), unmarked, 'written once, never replaced');
  // The copy is training history too: it goes with the account, and nobody else's is touched.
  fs.writeFileSync(contractBackup(dataDir), '{}');
  assert.equal((await adminDelete(OTHER)).status, 200);
  assert.equal(fs.existsSync(contractBackup(dataDir, OTHER)), false);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(contractBackup(dataDir)), true);
});

test('GET /api/config advertises engineContract; the preflight allows X-OpenGym-Engine-Contract', async t => {
  const { api } = await harness(t);
  for (const headers of [{}, { Cookie: cookie() }]) {
    assert.equal((await (await fetch(api + '/api/config', { headers })).json()).engineContract, 1);
  }
  const pre = await fetch(api + '/api/data', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'x-opengym-engine-contract' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /(^|, )X-OpenGym-Engine-Contract(,|$)/);
});

test('a PUT announcing a newer contract than the server reads is refused, nothing written', async t => {
  const { put, get, dataDir } = await harness(t);
  // On a fresh profile nothing is created...
  const r0 = await put({ ...MARKED, engineContractRevision: 2 }, CONTRACT);
  assert.deepEqual([r0.status, r0.body], [409, { error: 'unsupported-contract' }]);
  assert.equal(fs.existsSync(primaryFile(dataDir)), false);
  // ...and a stored one stays byte-identical and readable by every current device.
  assert.equal((await put(MARKED, CONTRACT)).status, 200);
  const before = fs.readFileSync(primaryFile(dataDir), 'utf8');
  for (const state of [{ ...MARKED, engineContractRevision: 2, _ts: 5 }, { ...V1, engineContractRevision: 2, _ts: 5 }]) {
    const r = await put(state, CONTRACT);
    assert.deepEqual([r.status, r.body], [409, { error: 'unsupported-contract' }]);
  }
  assert.equal(fs.readFileSync(primaryFile(dataDir), 'utf8'), before);
  assert.equal((await get(CONTRACT)).status, 200);
});

// Same probe as server-state-read-cost.test.js: a rewrite the stat cache's key cannot see (same
// length, pinned mtime) that drops the marker. A gate parsing the file would let the old client in.
test('rev polling reads the cached status, not the file', async t => {
  const { plant, getRev, dataDir } = await harness(t);
  const PINNED = new Date(1700000000000);
  const writePinned = text => { plant(text); fs.utimesSync(primaryFile(dataDir), PINNED, PINNED); };
  const marked = JSON.stringify({ ...MARKED, _rev: 7 });
  writePinned(marked);
  assert.equal((await getRev(CONTRACT)).body.rev, 7);
  writePinned(marked.replace('"engineContractRevision":1', '"engineContractRevision":0'));
  assert.equal(fs.statSync(primaryFile(dataDir)).size, Buffer.byteLength(marked));
  const r = await getRev(ENGINE);
  assert.deepEqual([r.status, r.body], [409, { error: 'upgrade-required', minEngineContract: 1 }], 'the poll answered from the cached status');
});
