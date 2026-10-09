import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import * as M from './media-samples.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8080';
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const U1 = 'u_media_1', U2 = 'u_media_2', ADMIN = 'u_media_adm';
const cookie = uid => ({ Cookie: `gymsid=${mint(uid)}`, Origin: ORIGIN });
const bearer = uid => ({ Authorization: `Bearer ${mint(uid)}` });
const refState = (...hashes) => ({
  unit: 'kg', routines: [], workouts: [],
  customEx: hashes.map((h, i) => ({ id: 'cx' + i, n: 'Sandbag ' + i, bp: 'back', custom: true, media: { kind: 'image', hash: h, mime: 'image/jpeg', size: 1, width: 1, height: 1, at: 1 } }))
});

async function start(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-shared-http-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: U1, name: 'Ana', created: new Date().toISOString() },
      { id: U2, name: 'Bo', created: new Date().toISOString() },
      { id: ADMIN, name: 'Admin', created: new Date().toISOString(), admin: true }
    ],
    creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', MEDIA_MIN_FREE_MB: '1', ...env }
  });
  const h = { log: '', dataDir, uploads: path.join(dataDir, 'uploads') };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.put = (bytes, { uid = U1, declare = 'image/jpeg', hash = M.sha(bytes), headers } = {}) =>
    fetch(`${h.api}/api/media/${hash}`, { method: 'PUT', headers: { ...(headers || cookie(uid)), 'Content-Type': declare }, body: bytes });
  h.get = (hash, uid = U1, headers) => fetch(`${h.api}/api/media/${hash}`, { headers: headers || cookie(uid) });
  h.post = (route, body, uid = U1) => fetch(`${h.api}${route}`, { method: 'POST', headers: { ...cookie(uid), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  h.pushState = (state, uid = U1) => fetch(`${h.api}/api/data`, { method: 'PUT', headers: { ...cookie(uid), 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) });
  h.files = uid => { try { return fs.readdirSync(path.join(h.uploads, uid)).filter(n => !n.startsWith('.')).sort(); } catch { return []; } };
  h.tmp = uid => { try { return fs.readdirSync(path.join(h.uploads, uid, '.tmp')); } catch { return []; } };
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}


const definition = (over = {}) => ({ id: 'cpublished', n: 'Published row', bp: 'back', eq: 'barbell', ...over });
async function request(h, method, route, body, uid = ADMIN, headers = cookie(uid)) {
  return fetch(h.api + route, { method, headers: { ...headers, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const publish = (h, exercise = definition(), baseRevision) => request(h, 'PUT', '/api/admin/shared-exercises', { exercise, baseRevision });

test('catalogue requires authentication and writes require an administrator', async t => {
  const h = await start(t);
  assert.equal((await fetch(h.api + '/api/shared-exercises')).status, 401);
  for (const method of ['PUT', 'DELETE']) {
    assert.equal((await request(h, method, '/api/admin/shared-exercises', {}, ADMIN, {})).status, 401);
    assert.equal((await request(h, method, '/api/admin/shared-exercises', {}, U1)).status, 403);
  }
  assert.equal((await request(h, 'GET', '/api/shared-exercises', undefined, U1)).status, 200);
  assert.equal((await (await fetch(h.api + '/api/config')).json()).shared_exercises, true);
});
test('ordinary profile uploads cannot publish, even with forged catalogue flags', async t => {
  const h = await start(t);
  const state = { unit: 'kg', routines: [], workouts: [], customEx: [definition({ custom: true, serverShared: true })] };
  assert.equal((await h.pushState(state, U1)).status, 200);
  assert.deepEqual((await (await request(h, 'GET', '/api/shared-exercises', undefined, U2)).json()).exercises, []);
});
test('cookie writes enforce CSRF; paired bearer clients can publish', async t => {
  const h = await start(t);
  const forbidden = await request(h, 'PUT', '/api/admin/shared-exercises', { exercise: definition() }, ADMIN,
    { ...cookie(ADMIN), Origin: 'https://other.example' });
  assert.equal(forbidden.status, 403);
  const accepted = await request(h, 'PUT', '/api/admin/shared-exercises', { exercise: definition() }, ADMIN, bearer(ADMIN));
  assert.equal(accepted.status, 200);
});
test('another account reads published metadata, stale edits and deletes are refused', async t => {
  const h = await start(t); const r = await publish(h); assert.equal(r.status, 200);
  const { exercise } = await r.json();
  const rows = (await (await request(h, 'GET', '/api/shared-exercises', undefined, U2)).json()).exercises;
  assert.equal(rows[0].id, exercise.id);
  assert.equal((await publish(h, definition({ n: 'Edit' }), 0)).status, 409);
  assert.equal((await request(h, 'DELETE', '/api/admin/shared-exercises', { id: exercise.id, baseRevision: 0 })).status, 409);
  assert.equal((await publish(h, definition({ n: 'Edit' }), exercise.serverRevision)).status, 200);
  const audit = await (await request(h, 'GET', '/api/admin/audit', undefined)).json();
  assert.ok(JSON.stringify(audit).includes('admin.exercise.share'));
});
test('malformed bodies are client errors rather than server errors', async t => {
  const h = await start(t);
  assert.equal((await request(h, 'PUT', '/api/admin/shared-exercises', null)).status, 400);
  assert.equal((await request(h, 'DELETE', '/api/admin/shared-exercises', null)).status, 400);
});
test('media stays private until explicitly shared, survives owner cleanup, and is revoked on withdrawal', async t => {
  const h = await start(t); const bytes = M.webp(5000), hash = M.sha(bytes);
  assert.equal((await h.put(bytes, { uid: ADMIN, declare: 'image/webp' })).status, 201);
  assert.equal((await h.get(hash, U2)).status, 404);
  const media = { hash, kind: 'image', mime: 'image/webp', width: 100, height: 100, size: bytes.length };
  const { exercise } = await (await publish(h, definition({ media }))).json();
  assert.equal((await h.get(hash, U2)).status, 200);
  assert.deepEqual((await (await h.post('/api/media/missing', { hashes: [hash] }, U2)).json()).missing, []);
  assert.deepEqual((await (await h.post('/api/media/missing', { hashes: [hash], privateOnly: true }, U2)).json()).missing, [hash]);
  const own = path.join(h.uploads, ADMIN);
  fs.rmSync(own, { recursive: true, force: true });
  assert.equal((await h.get(hash, U2)).status, 200);
  assert.equal((await fetch(h.api + '/api/media/' + hash)).status, 401);
  assert.equal((await request(h, 'DELETE', '/api/admin/shared-exercises', { id: exercise.id, baseRevision: exercise.serverRevision })).status, 200);
  assert.equal((await h.get(hash, U2)).status, 404);
  assert.deepEqual((await (await h.post('/api/media/missing', { hashes: [hash] }, U2)).json()).missing, [hash]);
});
test("publication cannot reveal another account's private media", async t => {
  const h = await start(t); const bytes = M.jpeg(), hash = M.sha(bytes);
  assert.equal((await h.put(bytes)).status, 201);
  const r = await publish(h, definition({ media: { hash, width: 100, height: 100 } }));
  assert.equal(r.status, 400);
  assert.equal((await h.get(hash, U2)).status, 404);
});
test('shared video posters are copied and returned as authenticated media', async t => {
  const h = await start(t);
  const video = M.mp4(), poster = M.webp(1000);
  const videoHash = M.sha(video), posterHash = M.sha(poster);
  assert.equal((await h.put(video, { uid: ADMIN, declare: 'video/mp4' })).status, 201);
  assert.equal((await h.put(poster, { uid: ADMIN, declare: 'image/webp' })).status, 201);
  const { exercise } = await (await publish(h, definition({ media: { hash: videoHash, width: 100, height: 100, poster: { hash: posterHash, width: 100, height: 100 } } }))).json();
  assert.equal(exercise.media.kind, 'video');
  assert.equal(exercise.media.poster.hash, posterHash);
  assert.equal((await h.get(videoHash, U1)).status, 200);
  assert.equal((await h.get(posterHash, U1)).status, 200);
});
test('metadata-only sharing works when uploads are disabled', async t => {
  const h = await start(t, { MEDIA_UPLOADS: '0' });
  assert.equal((await publish(h)).status, 200);
});
