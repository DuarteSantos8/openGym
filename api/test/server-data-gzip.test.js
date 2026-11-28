/* PUT /api/data takes a gzipped body (#1489, the idea of PR #1490): the phone pushes the whole
   profile on every set, and gzipped that is about a tenth of the bytes. What has to hold:
   - a plain body still works exactly as before (every older app, every script);
   - the 5 MiB cap is on the UNZIPPED size, so a small gzip bomb is a 413 and nothing is written;
   - a body that says gzip and is not gzip (or is cut short) is a 400, not a 500;
   - an encoding we do not speak is a 415, never parsed as if it were JSON;
   - only this route unzips, and only after its session check;
   - GET /api/config tells a session it may send gzip, and the CORS preflight allows the header.
   Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const UID = 'u_gzip_1';

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const plain = { Cookie: `gymsid=${mintSession(UID)}`, 'Content-Type': 'application/json' };
const gzipped = { ...plain, 'Content-Encoding': 'gzip' };

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-gzip-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.disk = () => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${UID}.json`), 'utf8'));
  return h;
}

const put = async (h, headers, body) => {
  const r = await fetch(`${h.api}/api/data`, { method: 'PUT', headers, body });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const doc = (rev, ids, ts = Date.now()) => ({ state: { _ts: ts, workouts: ids.map(id => ({ id, d: '2026-11-01' })), routines: [] }, baseRev: rev });
const gz = v => zlib.gzipSync(JSON.stringify(v));

test('an old client: a plain body syncs exactly as before', async t => {
  const h = await startServer(t);
  let r = await put(h, plain, JSON.stringify(doc(0, ['w1'])));
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 1);
  // `Content-Encoding: identity` is the same as no header at all.
  r = await put(h, { ...plain, 'Content-Encoding': 'identity' }, JSON.stringify(doc(1, ['w1', 'w2'])));
  assert.equal(r.status, 200);
  assert.deepEqual(h.disk().workouts.map(w => w.id), ['w1', 'w2']);
});

test('a gzipped push lands, and the 409 merge path works the same gzipped', async t => {
  const h = await startServer(t);
  let r = await put(h, gzipped, gz(doc(0, ['w1'])));
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 1);
  assert.deepEqual(h.disk().workouts.map(w => w.id), ['w1']);

  r = await put(h, gzipped, gz(doc(0, ['stale'])));
  assert.equal(r.status, 409);
  assert.equal(r.body.rev, 1);
  assert.deepEqual(r.body.state.workouts.map(w => w.id), ['w1']);
  r = await put(h, gzipped, gz(doc(1, ['w1', 'w2'])));
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 2);
  assert.deepEqual(h.disk().workouts.map(w => w.id), ['w1', 'w2']);
  assert.doesNotMatch(h.log, /\n\s+at /, `stack traces in the log:\n${h.log}`);
});

test('cap exceeded: a gzip bomb that unzips past 5 MiB is a 413 and nothing is written', async t => {
  const h = await startServer(t);
  assert.equal((await put(h, plain, JSON.stringify(doc(0, ['w1'])))).status, 200);
  const bomb = gz({ ...doc(1, ['w1']), pad: 'x'.repeat(6 * 1024 * 1024) });
  assert.ok(bomb.length < 64 * 1024, `the wire size is tiny (${bomb.length} bytes)`);
  const r = await put(h, gzipped, bomb);
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'body too large');
  assert.equal(h.disk()._rev, 1, 'nothing was written');
  // Just under the cap still unzips: the limit is the same one a plain body has.
  const big = gz({ ...doc(1, ['w1', 'w2']), pad: 'y'.repeat(4 * 1024 * 1024) });
  assert.equal((await put(h, gzipped, big)).status, 200);
  assert.doesNotMatch(h.log, /\n\s+at /, `stack traces in the log:\n${h.log}`);
});

test('bad gzip: a body that says gzip and is not, or is cut short, is a 400', async t => {
  const h = await startServer(t);
  assert.equal((await put(h, plain, JSON.stringify(doc(0, ['w1'])))).status, 200);
  let r = await put(h, gzipped, JSON.stringify(doc(1, ['w1', 'x'])));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid gzip');
  r = await put(h, gzipped, gz(doc(1, ['w1', 'x'])).subarray(0, 20));
  assert.equal(r.status, 400);
  // Valid gzip around something that is not JSON is the ordinary JSON refusal.
  r = await put(h, gzipped, zlib.gzipSync('not json'));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid json');
  // An encoding this server does not speak is refused, not parsed as if it were JSON.
  r = await put(h, { ...plain, 'Content-Encoding': 'br' }, JSON.stringify(doc(1, ['w1', 'x'])));
  assert.equal(r.status, 415);
  assert.equal(h.disk()._rev, 1, 'none of them was written');
  assert.doesNotMatch(h.log, /\n\s+at /, `stack traces in the log:\n${h.log}`);
});

test('only PUT /api/data unzips, and only for a session', async t => {
  const h = await startServer(t);
  const small = gz({ cid: 'nope' });
  const other = await fetch(`${h.api}/api/login/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: small });
  assert.equal(other.status, 400);
  assert.equal((await other.json()).error, 'invalid json', 'read as the bytes it is, never unzipped');
  const anon = await fetch(`${h.api}/api/data`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: small });
  assert.equal(anon.status, 401);
});

test('GET /api/config says gzip_body to a session only, and the preflight allows the header', async t => {
  const h = await startServer(t);
  assert.equal('gzip_body' in await (await fetch(`${h.api}/api/config`)).json(), false, 'a stranger gets the answer it always did');
  assert.equal((await (await fetch(`${h.api}/api/config`, { headers: plain })).json()).gzip_body, true);
  const pre = await fetch(`${h.api}/api/data`, { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type,content-encoding' } });
  assert.match(pre.headers.get('access-control-allow-headers') || '', /Content-Encoding/);
});
