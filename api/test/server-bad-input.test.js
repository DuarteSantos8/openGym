/* A client's mistake is a 400 (or a 413), never a 500 with a stack trace in the log: unparseable
   or non-object JSON bodies, a state document that is an array, null entries inside it, and a
   rest-timer request without a usable `seconds` (QA C17, C19, C20). Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
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
const UID = 'u_bad_1';
const authed = { Cookie: `gymsid=${mintSession(UID)}`, 'Content-Type': 'application/json' };
const anon = { 'Content-Type': 'application/json' };

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-bad-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
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
  // The boot line is fine; anything that looks like a stack frame after this is a defect.
  h.stackFrames = () => h.log.split('\n').filter(l => /^\s+at /.test(l)).length;
  return h;
}

const send = (h, method, p, headers, body) => fetch(`${h.api}${p}`, { method, headers, body });
const status = async (h, method, p, headers, body) => {
  const r = await send(h, method, p, headers, body);
  return { status: r.status, body: await r.json() };
};

test('malformed and non-object JSON bodies are a 400 with no stack trace, on every route', async t => {
  const h = await startServer(t);
  const bad = ['not json', '{bad', 'null', '"str"', '42', '[]'];
  const routes = [
    ['POST', '/api/register/options', anon],
    ['POST', '/api/register/verify', anon],
    ['POST', '/api/pair/redeem', anon],
    ['PUT', '/api/data', authed],
    ['POST', '/api/push/rest-timer', authed]
  ];
  for (const [method, p, headers] of routes) {
    for (const b of bad) {
      const r = await status(h, method, p, headers, b);
      assert.equal(r.status, 400, `${method} ${p} with body ${b}`);
      assert.equal(r.body.error, 'invalid json', `${method} ${p} with body ${b}`);
    }
  }
  // A field whose toString is not callable is valid JSON; String() on it used to throw.
  let r = await status(h, 'POST', '/api/register/options', anon, JSON.stringify({ name: 'x', code: { toString: 1 } }));
  assert.notEqual(r.status, 500);
  r = await status(h, 'POST', '/api/pair/redeem', anon, JSON.stringify({ code: { toString: 1 } }));
  assert.equal(r.status, 400);
  r = await status(h, 'POST', '/api/register/options', anon, JSON.stringify({ name: { toString: 1 } }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'name required');
  // An empty body is still "no fields", as the routes that send none rely on.
  r = await status(h, 'POST', '/api/logout', { Cookie: authed.Cookie });
  assert.equal(r.status, 200);
  // Well-formed controls keep their own answers.
  r = await status(h, 'POST', '/api/register/options', anon, '{}');
  assert.deepEqual(r, { status: 400, body: { error: 'name required' } });
  r = await status(h, 'PUT', '/api/data', authed, JSON.stringify({ state: { workouts: [], routines: [] }, baseRev: 0 }));
  assert.equal(r.status, 200);
  assert.equal(h.stackFrames(), 0, `stack traces in the log:\n${h.log}`);
  assert.doesNotMatch(h.log, /bad json|TypeError/);
});

// node's own http client, writing the whole body in one go on a keep-alive socket: the client
// the QA proxy (and any node-side caller) is, and the one that used to report a reset instead
// of the 413 when the server closed the socket under the still-running upload.
const rawPut = (h, agent, body) => new Promise((resolve, reject) => {
  const rq = http.request(`${h.api}/api/data`, { method: 'PUT', headers: authed, agent }, res => {
    let data = ''; res.on('data', d => data += d); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
  });
  rq.on('error', reject);
  rq.end(body);
});

test('a body over the 5 MiB cap is a 413 that every client gets to read, and nothing is written', async t => {
  const h = await startServer(t);
  const big = JSON.stringify({ state: { workouts: [], routines: [], pad: 'x'.repeat(6 * 1024 * 1024) }, baseRev: 0 });
  let r = await status(h, 'PUT', '/api/data', authed, big);
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'body too large');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${UID}.json`)), false, 'nothing was written');
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  for (let i = 0; i < 3; i++) {
    r = await rawPut(h, agent, big);
    assert.equal(r.status, 413, `node client, attempt ${i + 1}`);
  }
  // The same keep-alive socket, and the server as a whole, are still fine afterwards.
  r = await rawPut(h, agent, JSON.stringify({ state: { workouts: [], routines: [] }, baseRev: 0 }));
  assert.equal(r.status, 200);
  // Past twice the cap the upload is cut off rather than drained: the 413 may or may not
  // arrive, but the process must not be left reading, and must still serve.
  const huge = 'x'.repeat(11 * 1024 * 1024);
  await rawPut(h, new http.Agent(), huge).catch(() => {});
  r = await status(h, 'GET', '/api/health', {});
  assert.equal(r.status, 200);
  assert.equal(h.stackFrames(), 0, `stack traces in the log:\n${h.log}`);
});

test('PUT /api/data: an array is not a document, and null entries never reach the disk', async t => {
  const h = await startServer(t);
  const put = body => status(h, 'PUT', '/api/data', authed, JSON.stringify(body));
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${UID}.json`), 'utf8'));

  let r = await put({ state: { _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01' }], routines: [], unit: 'kg' }, baseRev: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 1);

  // An array passes `typeof === 'object'`; it used to be written as `[]`, losing the document
  // and, since `_rev` cannot live on an array, resetting the revision to 0 while the response
  // claimed rev 2.
  r = await put({ state: [], baseRev: 1 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid state');
  assert.equal(onDisk()._rev, 1);
  assert.deepEqual(onDisk().workouts.map(w => w.id), ['w1']);
  r = await status(h, 'GET', '/api/data/rev', authed);
  assert.deepEqual(r.body, { rev: 1 });

  // Null and other non-object entries are dropped: every server-side reader of the document
  // (reminder tick, admin drill-down) dereferences the entries, and a 400 would strand a client
  // whose own copy is already malformed.
  r = await put({ state: { workouts: [null, { id: 'w2', d: '2026-09-02' }, 7, 'x', [], { id: 'w3', d: '2026-09-03' }], routines: [null, { id: 'r1', name: 'A', ex: [] }] }, baseRev: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 2);
  assert.deepEqual(onDisk().workouts.map(w => w.id), ['w2', 'w3']);
  assert.deepEqual(onDisk().routines.map(x => x.id), ['r1']);
  // Absent lists stay absent — every client fills its own defaults.
  r = await put({ state: { unit: 'kg' }, baseRev: 2 });
  assert.equal(r.status, 200);
  assert.equal('workouts' in onDisk(), false);
  assert.equal(h.stackFrames(), 0, `stack traces in the log:\n${h.log}`);
});

test('POST /api/push/rest-timer: a missing or invalid `seconds` is a 400, never a 1-second timer', async t => {
  const h = await startServer(t);
  const post = b => status(h, 'POST', '/api/push/rest-timer', authed, b);
  for (const b of ['{}', '{"seconds":"abc"}', '{"seconds":0}', '{"seconds":-5}', '{"seconds":null}', '{"seconds":0.4}', '{"seconds":{"valueOf":1}}', '{"seconds":[90]}']) {
    const r = await post(b);
    assert.deepEqual(r, { status: 400, body: { error: 'seconds required' } }, `body ${b}`);
  }
  for (const b of ['{"seconds":90}', '{"seconds":"90"}', '{"seconds":1}', '{"seconds":99999}']) {
    const r = await post(b);
    assert.deepEqual(r, { status: 200, body: { ok: true } }, `body ${b}`);
  }
  assert.equal(h.stackFrames(), 0, `stack traces in the log:\n${h.log}`);
});
