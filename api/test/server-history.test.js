/* Real-server coverage for authenticated history preview, merge and safe undo. */
import { test } from 'node:test';
import { once } from 'node:events';
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

// Same construction as server.js makeSession(): payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = (uid, sv) => ({ Cookie: `gymsid=${mintSession(uid, sv)}` });

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

const USERS = [
  { id: 'u_test_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_test_2', name: 'Two', created: new Date().toISOString() }
];

async function startServer(t, existingDir) {
  const dataDir = existingDir || fs.mkdtempSync(path.join(os.tmpdir(), 'gym-history-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: `http://127.0.0.1:${port}`, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${h.api}/api/health`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(up, `server never came up:\n${h.log}`);
  h.dataDir = dataDir; h.child = child; return h;
}

const pair = { source_exercise_id: '0001', target_exercise_id: '0027', update_routines: true };
const initial = { _rev: 4, _ts: 100, workouts: [{ id: 'w', d: '2026-09-01', entries: [{ id: '0001', sets: [{ w: 20, r: 8, done: true }], note: 'keep' }], prs: ['0001'] }], routines: [{ id: 'r', ex: [{ id: '0001', sets: 1, reps: 8 }] }] };

test('authenticated preview, revision-checked merge, isolated backup and undo', async t => {
  const h = await startServer(t);
  const file = path.join(h.dataDir, 'state-u_test_1.json');
  fs.writeFileSync(file, JSON.stringify(initial));
  const post = (p, body, uid = 'u_test_1') => fetch(h.api + p, { method: 'POST', headers: { ...cookie(uid), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(h.api + '/api/history/merge', { method: 'POST' })).status, 401);
  const preview = await post('/api/history/merge', { ...pair, dry_run: true });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).sets_moved, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), initial);
  assert.equal(fs.readdirSync(h.dataDir).some(f => f.startsWith('history-undo-')), false);
  assert.equal((await post('/api/history/merge', { ...pair, dry_run: true, scope: 'recent' })).status, 400);
  assert.equal((await post('/api/history/merge', pair)).status, 409);
  assert.equal((await post('/api/history/merge', { ...pair, baseRev: 3 })).status, 409);
  const response = await post('/api/history/merge', { ...pair, baseRev: 4 });
  assert.equal(response.status, 200);
  const merge = await response.json();
  assert.equal(merge.rev, 5);
  assert.ok(merge.undo_id);
  const migrated = JSON.parse(fs.readFileSync(file));
  assert.equal(migrated.workouts[0].entries[0].id, '0027');
  assert.equal(migrated.workouts[0].entries[0].note, 'keep');
  assert.equal(migrated.routines[0].ex[0].id, '0027');
  const backup = fs.readdirSync(h.dataDir).find(f => f.startsWith('history-undo-'));
  assert.equal(fs.statSync(path.join(h.dataDir, backup)).mode & 0o777, 0o600);
  assert.equal((await post('/api/history/undo', { undo_id: merge.undo_id, baseRev: 5 }, 'u_test_2')).status, 404);
  assert.equal((await post('/api/history/undo', { undo_id: '../bad', baseRev: 5 })).status, 400);
  assert.equal((await post('/api/history/undo', { undo_id: merge.undo_id, baseRev: 4 })).status, 409);
  const undo = await post('/api/history/undo', { undo_id: merge.undo_id, baseRev: 5 });
  assert.equal(undo.status, 200);
  const restored = JSON.parse(fs.readFileSync(file));
  assert.deepEqual({ ...restored, _rev: 4, _ts: 100 }, initial);
  assert.equal(restored._rev, 6);
  assert.equal((await post('/api/history/undo', { undo_id: merge.undo_id, baseRev: 6 })).status, 409);
  const audit = fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8');
  assert.match(audit, /history.merge/);
  assert.match(audit, /history.undo/);
});

test('undo refuses to erase a later sync', async t => {
  const h = await startServer(t);
  const file = path.join(h.dataDir, 'state-u_test_1.json');
  fs.writeFileSync(file, JSON.stringify(initial));
  const post = (p, body) => fetch(h.api + p, { method: 'POST', headers: { ...cookie('u_test_1'), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('/api/history/merge', { ...pair, baseRev: 4 });
  const merge = await response.json();
  const changed = JSON.parse(fs.readFileSync(file)); changed.bodyweight = [{ d: '2026-09-02', w: 80 }];
  const sync = await fetch(h.api + '/api/data', { method: 'PUT', headers: { ...cookie('u_test_1'), 'Content-Type': 'application/json' }, body: JSON.stringify({ state: changed, baseRev: 5 }) });
  assert.equal(sync.status, 200);
  changed._rev = 6;
  assert.equal((await post('/api/history/undo', { undo_id: merge.undo_id, baseRev: 6 })).status, 409);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), changed);
});

test('undo backup remains usable after API restart', async t => {
  const h = await startServer(t);
  const file = path.join(h.dataDir, 'state-u_test_1.json');
  fs.writeFileSync(file, JSON.stringify(initial));
  const mergeResponse = await fetch(h.api + '/api/history/merge', { method: 'POST', headers: { Authorization: 'Bearer ' + mintSession('u_test_1'), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...pair, baseRev: 4 }) });
  assert.equal(mergeResponse.status, 200);
  const merge = await mergeResponse.json();
  const exited = once(h.child, 'exit'); h.child.kill('SIGKILL'); await exited;
  const restarted = await startServer(t, h.dataDir);
  const undo = await fetch(restarted.api + '/api/history/undo', { method: 'POST', headers: { ...cookie('u_test_1'), 'Content-Type': 'application/json' }, body: JSON.stringify({ undo_id: merge.undo_id, baseRev: 5 }) });
  assert.equal(undo.status, 200);
  const restored = JSON.parse(fs.readFileSync(file));
  assert.deepEqual({ ...restored, _rev: 4, _ts: 100 }, initial);
});

test('unused backup cannot restore over a different state at the same revision', async t => {
  const h = await startServer(t);
  const file = path.join(h.dataDir, 'state-u_test_1.json');
  fs.writeFileSync(file, JSON.stringify(initial));
  const undoId = crypto.randomUUID();
  fs.writeFileSync(path.join(h.dataDir, 'history-undo-u_test_1-' + undoId + '.json'), JSON.stringify({ before: { ...initial, workouts: [] }, afterRev: 4, afterHash: 'different-commit' }));
  const response = await fetch(h.api + '/api/history/undo', { method: 'POST', headers: { ...cookie('u_test_1'), 'Content-Type': 'application/json' }, body: JSON.stringify({ undo_id: undoId, baseRev: 4 }) });
  assert.equal(response.status, 409);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), initial);
});
