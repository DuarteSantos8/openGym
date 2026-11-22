/* PUT /api/data takes a gzipped body (Content-Encoding: gzip), so a phone's per-set sync sends
   about a tenth of the profile's bytes. The cap still holds on the unzipped size (a small upload
   that expands past it is a 413), a body that is not gzip is a 400, the 409 merge path is the
   same, and GET /api/config says the server takes it. Real server.js in a child. */
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
const UID = 'u_gz_1';

function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const authed = { Cookie: `gymsid=${mintSession(UID)}`, 'Content-Type': 'application/json' };
const gz = { ...authed, 'Content-Encoding': 'gzip' };

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-gz-'));
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
  return h;
}

const put = async (h, headers, body) => {
  const r = await fetch(`${h.api}/api/data`, { method: 'PUT', headers, body });
  return { status: r.status, body: await r.json() };
};

test('GET /api/config says the server takes a gzipped body', async t => {
  const h = await startServer(t);
  const c = await (await fetch(`${h.api}/api/config`)).json();
  assert.equal(c.gzip_body, true);
  // A paired phone calls from its own WebView origin: the preflight has to allow the header.
  const pre = await fetch(`${h.api}/api/data`, { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-encoding' } });
  assert.match(pre.headers.get('access-control-allow-headers'), /Content-Encoding/);
});

test('PUT /api/data: plain and gzipped bodies, the cap on the unzipped size, bad gzip, and the 409', async t => {
  const h = await startServer(t);
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${UID}.json`), 'utf8'));

  // plain, as every client sent until now
  let r = await put(h, authed, JSON.stringify({ state: { _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01' }], routines: [] }, baseRev: 0 }));
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 1);

  // gzipped
  const doc = { state: { _ts: 200, workouts: [{ id: 'w1', d: '2026-09-01' }, { id: 'w2', d: '2026-09-02' }], routines: [] }, baseRev: 1 };
  r = await put(h, gz, zlib.gzipSync(JSON.stringify(doc)));
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 2);
  assert.deepEqual(onDisk().workouts.map(w => w.id), ['w1', 'w2']);

  // A gzip bomb: 6 MiB of JSON squeezed into a few KB. The wire size is tiny; the unzipped size
  // is over the 5 MiB cap, and that is the one that counts.
  const bomb = zlib.gzipSync(JSON.stringify({ state: { workouts: [], routines: [], pad: 'x'.repeat(6 * 1024 * 1024) }, baseRev: 2 }));
  assert.ok(bomb.length < 64 * 1024);
  r = await put(h, gz, bomb);
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'body too large');
  assert.equal(onDisk()._rev, 2, 'nothing was written');

  // Not gzip at all, and a gzip stream cut short: both the caller's mistake.
  r = await put(h, gz, JSON.stringify(doc));
  assert.equal(r.status, 400);
  r = await put(h, gz, zlib.gzipSync(JSON.stringify(doc)).subarray(0, 20));
  assert.equal(r.status, 400);
  assert.equal(onDisk()._rev, 2);

  // A stale gzipped push gets the 409 with the current document, and the merged retry, gzipped
  // again, lands.
  r = await put(h, gz, zlib.gzipSync(JSON.stringify({ state: { _ts: 300, workouts: [], routines: [] }, baseRev: 1 })));
  assert.equal(r.status, 409);
  assert.equal(r.body.rev, 2);
  assert.deepEqual(r.body.state.workouts.map(w => w.id), ['w1', 'w2']);
  r = await put(h, gz, zlib.gzipSync(JSON.stringify({ state: { _ts: 400, workouts: [...r.body.state.workouts, { id: 'w3', d: '2026-09-03' }], routines: [] }, baseRev: r.body.rev })));
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 3);
  assert.deepEqual(onDisk().workouts.map(w => w.id), ['w1', 'w2', 'w3']);
  assert.doesNotMatch(h.log, /\n\s+at /, `stack traces in the log:\n${h.log}`);
});
