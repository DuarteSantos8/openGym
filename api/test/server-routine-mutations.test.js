// Exercise the real authenticated API boundary used by both MCP transports and sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SECRET = 'routine-mutations-test';
const token = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function server(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-routine-mutations-'));
  fs.writeFileSync(path.join(dir, 'secret'), SECRET);
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  let log = '';
  child.stdout.on('data', data => log += data);
  child.stderr.on('data', data => log += data);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => log);
  const request = async (endpoint, body, uid = 'one', method = 'POST') => {
    const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method, headers: { Authorization: `Bearer ${token(uid)}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  };
  return { dir, request, file: path.join(dir, 'state-one.json'), api: `http://127.0.0.1:${port}` };
}
const initial = () => ({ _rev: 4, _ts: 100, resetAt: 50, resetIds: { routines: ['gone'] }, routines: [{ id: 'old', name: 'Existing', ex: [{ id: '0001', sets: 3, reps: 8 }] }], workouts: [{ id: 'w1' }], week: { 1: ['old'] } });

test('paired routine operations and browser sync share revisions, reset rules, cache eviction and profile isolation', async t => {
  const h = await server(t);
  fs.writeFileSync(h.file, JSON.stringify(initial()));
  // Populate the revision cache before the mutation.
  assert.equal((await h.request('/api/data/rev', undefined, 'one', 'GET')).body.rev, 4);
  const edit = { operation: 'edit', baseRev: 4, input: { routine_id: 'old', name: 'Renamed' } };
  assert.equal((await fetch(h.api + '/api/routines/mutate', { method: 'POST' })).status, 401);
  assert.equal((await h.request('/api/routines/mutate', { ...edit, baseRev: undefined })).status, 400);
  assert.equal((await h.request('/api/routines/mutate', { ...edit, baseRev: '4' })).status, 400);
  // A different profile cannot select 'one' through arguments; it has no such routine.
  assert.equal((await h.request('/api/routines/mutate', { ...edit, baseRev: 0, uid: 'one' }, 'two')).status, 404);
  const saved = await h.request('/api/routines/mutate', edit);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rev, 5);
  const current = JSON.parse(fs.readFileSync(h.file));
  assert.equal(current.routines[0].name, 'Renamed');
  assert.deepEqual(current.workouts, initial().workouts);
  assert.equal(current.resetAt, 50);
  assert.ok(current._ts > 100);
  assert.equal((await h.request('/api/data/rev', undefined, 'one', 'GET')).body.rev, 5);
  const conflict = await h.request('/api/data', { state: initial(), baseRev: 4 }, 'one', 'PUT');
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.body.state, current);
  assert.equal((await h.request('/api/data', { state: { ...current, resetAt: 1, resetIds: {}, active: { id: 'local' } }, baseRev: 5 }, 'one', 'PUT')).status, 200);
  const stale = await h.request('/api/routines/mutate', { operation: 'delete', baseRev: 5, input: { routine_id: 'old', confirm: true } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.rev, 6);
  assert.equal(stale.body.state.resetAt, 50);
  assert.equal('active' in stale.body.state, false);
  assert.equal((await h.request('/api/routines/mutate', { operation: 'delete', baseRev: 6, input: { routine_id: 'old', confirm: true } })).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file)).week, {});
});

test('invalid operations and a lock held by another writer never partially commit', async t => {
  const h = await server(t);
  fs.writeFileSync(h.file, JSON.stringify(initial()));
  const before = fs.readFileSync(h.file, 'utf8');
  for (const body of [
    { operation: 'delete', input: { routine_id: 'old' } },
    { operation: 'edit', input: { routine_id: 'old', name: 'Bad', exercises: [{ id: 'unknown', sets: 3, reps: 8 }] } },
    { operation: 'create', input: { routines: [{ name: 'Bad', exercises: [{ id: '0001', sets: 3, reps: '8' }] }] } },
    { operation: 'other', input: {} }
  ]) assert.equal((await h.request('/api/routines/mutate', { ...body, baseRev: 4 })).status, 400);
  assert.equal(fs.readFileSync(h.file, 'utf8'), before);
  fs.writeFileSync(h.file + '.lock', 'another process');
  assert.equal((await h.request('/api/routines/mutate', { operation: 'delete', baseRev: 4, input: { routine_id: 'old', confirm: true } })).status, 503);
  assert.equal((await h.request('/api/data', { state: initial(), baseRev: 4 }, 'one', 'PUT')).status, 503);
  assert.equal(fs.readFileSync(h.file, 'utf8'), before);
  fs.unlinkSync(h.file + '.lock');
});
