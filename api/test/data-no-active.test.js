/* The server has always stripped the in-progress session on write (`delete body.state.active`).
   The client no longer sends one at all — this pins both halves, so a regression on either side
   is caught rather than silently re-coupling device-local state to the synced document. */
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

function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const headers = uid => ({ Cookie: `gymsid=${mintSession(uid)}`, 'Content-Type': 'application/json' });

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-no-active-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_no_active_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
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
  return h;
}

test('PUT /api/data stores no active session, whatever the client sends', async t => {
  const h = await startServer(t);
  const uid = 'u_no_active_1';
  const put = async body => { const r = await fetch(`${h.api}/api/data`, { method: 'PUT', headers: headers(uid), body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${uid}.json`), 'utf8'));

  // a write with active should succeed but active should be stripped on disk
  const r = await put({ state: { workouts: [], routines: [], active: { id: 'a1' }, _ts: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  // verify on disk: active is not stored
  const stored = onDisk();
  assert.equal(stored.active, undefined, 'active field must not be stored on disk');
  assert.equal(JSON.stringify(stored).includes('"a1"'), false, 'active session ID must not appear anywhere in stored state');
});

test('GET /api/data returns no active session', async t => {
  const h = await startServer(t);
  const uid = 'u_no_active_1';
  const put = async body => { const r = await fetch(`${h.api}/api/data`, { method: 'PUT', headers: headers(uid), body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const get = async () => { const r = await fetch(`${h.api}/api/data`, { headers: headers(uid) }); return { status: r.status, body: await r.json() }; };

  // first write with active
  await put({ state: { workouts: [], routines: [], active: { id: 'a1' }, _ts: 1 } });

  // verify GET does not return active
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.body.state.active, undefined, 'active field must not be in GET response');
  assert.equal(JSON.stringify(r.body.state).includes('"a1"'), false, 'active session ID must not appear in GET response');
});
