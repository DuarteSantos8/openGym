/* Health readings from an iPhone Shortcut: a key of its own, shown once and kept as a hash, and
   POST /api/health/samples folding what the Shortcut read into the profile as a new revision —
   without duplicates on a second send, without touching what the user typed or deleted, and with
   a key that is good for nothing else. Real server.js in a child. */
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
const UID = 'u_health_1';

function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const session = () => ({ Cookie: `gymsid=${mintSession(UID)}`, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' });

async function startServer(t, state, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-health-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  if (state) fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify(state));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.disk = () => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${UID}.json`), 'utf8'));
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  return h;
}
const call = async (h, method, p, { headers = {}, body } = {}) => {
  const r = await fetch(h.api + p, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const send = (h, key, body) => call(h, 'POST', '/api/health/samples', { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body });

const SHORTCUT = {
  metrics: {
    weight: { values: '80,4\n80.1', dates: '2026-10-11T07:30:00+02:00\n2026-10-12T07:31:00+02:00', unit: 'kg' },
    bodyFat: { values: ['18.4'], dates: ['2026-10-12T07:31:00+02:00'] },
    steps: { values: '8123\n9500', dates: '2026-10-11\n2026-10-12' },
    heartRate: { values: '60\n140', dates: '2026-10-12T09:00:00+02:00\n2026-10-12T10:00:00+02:00' },
    sleep: { starts: '2026-10-11T23:00:00+02:00\n2026-10-11T22:30:00+02:00', ends: '2026-10-12T06:00:00+02:00\n2026-10-12T06:30:00+02:00', values: 'Core\nIn Bed' },
    nonsense: { values: '1', dates: '2026-10-12' },
  }
};

test('a key is made once, kept only as its hash, and revoked', async t => {
  const h = await startServer(t, { _rev: 3, unit: 'kg', workouts: [], routines: [] });
  assert.deepEqual((await call(h, 'GET', '/api/health/key', { headers: session() })).body, { exists: false, created: null, used: null, shortcut: null });
  const made = await call(h, 'POST', '/api/health/key', { headers: session() });
  assert.equal(made.status, 200);
  assert.match(made.body.key, /^ogh_[A-Za-z0-9_-]{30,}$/);
  const stored = h.db().users[0].healthKey;
  assert.equal(stored.hash, crypto.createHash('sha256').update(made.body.key).digest('hex'));
  assert.ok(!JSON.stringify(h.db()).includes(made.body.key), 'the key itself is never stored');
  assert.equal((await call(h, 'GET', '/api/health/key', { headers: session() })).body.exists, true);
  // a new key replaces the old one
  const again = await call(h, 'POST', '/api/health/key', { headers: session() });
  assert.equal((await send(h, made.body.key, SHORTCUT)).status, 401);
  assert.equal((await send(h, again.body.key, SHORTCUT)).status, 200);
  assert.equal((await call(h, 'DELETE', '/api/health/key', { headers: session() })).status, 200);
  assert.equal((await send(h, again.body.key, SHORTCUT)).status, 401);
  // without a session there is no key to make
  assert.equal((await call(h, 'POST', '/api/health/key', { headers: { 'Content-Type': 'application/json' } })).status, 401);
});

test('samples are folded into the profile as a new revision, once', async t => {
  const h = await startServer(t, {
    _rev: 3, _ts: 1000, _wid: 'abc', unit: 'kg', workouts: [], routines: [],
    bodyweight: [{ d: '2026-10-11', w: 81, t: 900 }],
    health: [{ id: 'm1', type: 'bodyFat', v: 20, u: '%', t: 5, d: '2026-10-01', src: 'manual', c: 5, _ts: 5 }],
  });
  const key = (await call(h, 'POST', '/api/health/key', { headers: session() })).body.key;
  const r = await send(h, key, SHORTCUT);
  assert.equal(r.status, 200);
  assert.deepEqual({ added: r.body.added, updated: r.body.updated }, { added: 7, updated: 0 });
  assert.ok(r.body.skipped >= 1, 'the unknown metric is skipped, not an error');
  const S = h.disk();
  assert.equal(S._rev, 4);
  assert.ok(S._ts > 1000 && S._wid !== 'abc' && S._wids.includes('abc'));
  const by = Object.fromEntries(S.health.map(x => [`${x.type}@${x.d}`, x]));
  assert.equal(by['weight@2026-10-11'].v, 80.4, 'a comma decimal reads as a decimal');
  assert.equal(by['bodyFat@2026-10-12'].v, 18.4);
  assert.deepEqual([by['steps@2026-10-12'].v, by['steps@2026-10-12'].sid], [9500, 'steps:2026-10-12']);
  assert.deepEqual([by['heartRate@2026-10-12'].v, by['heartRate@2026-10-12'].lo, by['heartRate@2026-10-12'].hi], [100, 60, 140]);
  assert.equal(by['sleep@2026-10-12'].v, 420, 'in bed is not sleep');
  assert.equal(by['bodyFat@2026-10-01'].src, 'manual', 'what the user typed stays');
  assert.ok(S.health.every(x => x._ts >= S._ts || x.src === 'manual'));
  // the weigh-ins: a typed one stays, an empty day is filled from the reading
  assert.deepEqual(S.bodyweight.map(b => [b.d, b.w, b.src || 'manual']), [['2026-10-11', 81, 'manual'], ['2026-10-12', 80.1, 'apple-health']]);

  // the same send again changes nothing and writes nothing
  const twice = await send(h, key, SHORTCUT);
  assert.deepEqual({ added: twice.body.added, updated: twice.body.updated }, { added: 0, updated: 0 });
  assert.equal(h.disk()._rev, 4);

  // a day that went on is updated in place
  const more = await send(h, key, { metrics: { steps: { values: '12000', dates: '2026-10-12' } } });
  assert.deepEqual({ added: more.body.added, updated: more.body.updated }, { added: 0, updated: 1 });
  assert.equal(h.disk().health.filter(x => x.type === 'steps' && x.d === '2026-10-12').length, 1);
});

test('a reading the user deleted is not brought back, and bad requests are refused', async t => {
  const h = await startServer(t, {
    _rev: 1, unit: 'kg', workouts: [], routines: [],
    deleted: { health: { 'apple-health:steps:2026-10-12': Date.now() } },
  });
  const key = (await call(h, 'POST', '/api/health/key', { headers: session() })).body.key;
  const r = await send(h, key, { metrics: { steps: { values: '9500', dates: '2026-10-12' } } });
  assert.deepEqual({ status: r.status, added: r.body.added }, { status: 200, added: 0 });
  assert.equal((await send(h, key, { nope: 1 })).status, 400);
  assert.equal((await send(h, 'ogh_' + 'x'.repeat(30), SHORTCUT)).status, 401);
  // the key opens nothing else
  assert.equal((await call(h, 'GET', '/api/data', { headers: { Authorization: `Bearer ${key}` } })).status, 401);
});

test('no profile yet: the Shortcut is told to open the app first', async t => {
  const h = await startServer(t, null);
  const key = (await call(h, 'POST', '/api/health/key', { headers: session() })).body.key;
  const r = await send(h, key, SHORTCUT);
  assert.equal(r.status, 409);
});

test('Health Auto Export posts to the same address with the same key, and lands on the same days', async t => {
  const h = await startServer(t, { _rev: 1, unit: 'kg', workouts: [], routines: [] });
  const key = (await call(h, 'POST', '/api/health/key', { headers: session() })).body.key;
  const AUTO = { data: { metrics: [
    { name: 'step_count', units: 'count', data: [{ qty: 9500, date: '2026-10-12 00:00:00 +0200', source: 'iPhone' }] },
    { name: 'weight_&_body_mass', units: 'kg', data: [{ qty: 80.1, date: '2026-10-12 07:31:00 +0200' }] },
    { name: 'sleep_analysis', units: 'hr', data: [{ date: '2026-10-12', totalSleep: 7, sleepEnd: '2026-10-12 06:30:00 +0200' }] },
  ], workouts: [] } };
  const r = await send(h, key, AUTO);
  assert.deepEqual({ status: r.status, added: r.body.added }, { status: 200, added: 3 });
  // the Shortcut sending the same day afterwards adds nothing beside it
  const sc = await send(h, key, { metrics: { steps: { values: '9500', dates: '2026-10-12' }, weight: { values: '80.1', dates: '2026-10-12T07:31:00+02:00', unit: 'kg' } } });
  assert.deepEqual({ added: sc.body.added, updated: sc.body.updated }, { added: 0, updated: 0 });
  const S = h.disk();
  assert.equal(S.health.length, 3);
  assert.equal(S.health.find(x => x.type === 'sleep').v, 420);
  assert.deepEqual(S.bodyweight.map(b => [b.d, b.w]), [['2026-10-12', 80.1]]);
});

test('a ready-made Shortcut is offered only as an iCloud Shortcuts link', async t => {
  const link = 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
  const ok = await startServer(t, null, { HEALTH_SHORTCUT_URL: link });
  assert.equal((await call(ok, 'GET', '/api/health/key', { headers: session() })).body.shortcut, link);
  const bad = await startServer(t, null, { HEALTH_SHORTCUT_URL: 'https://example.com/shortcuts/0123456789abcdef0123456789abcdef' });
  assert.equal((await call(bad, 'GET', '/api/health/key', { headers: session() })).body.shortcut, null);
  assert.match(bad.log, /HEALTH_SHORTCUT_URL ignored/);
});
