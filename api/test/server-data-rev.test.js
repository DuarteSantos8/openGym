/* /api/data carries a numeric revision and a strong ETag: every write must present the exact
   ETag it read, while `baseRev` remains only a compatibility hint. Real server.js in a child. */
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
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const etag = text => `"${digest(text)}"`;

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t, { prepare, env = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-rev-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_rev_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  if (prepare) prepare(dataDir);
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env }
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

test('GET/PUT /api/data: revisions and strict conditional writes', async t => {
  const h = await startServer(t);
  const uid = 'u_rev_1';
  const get = async () => { const r = await fetch(`${h.api}/api/data`, { headers: headers(uid) }); return { status: r.status, body: await r.json() }; };
  let revision = '"0"';
  let key = 0;
  const put = async (body, match = revision) => {
    const r = await fetch(`${h.api}/api/data`, {
      method: 'PUT',
      headers: { ...headers(uid), 'If-Match': match, 'Idempotency-Key': `rev-test-${++key}` },
      body: JSON.stringify(body)
    });
    const result = { status: r.status, body: await r.json() };
    if (r.status === 200) revision = result.body.revision;
    return result;
  };
  const putWithoutPrecondition = async body => {
    const r = await fetch(`${h.api}/api/data`, { method: 'PUT', headers: headers(uid), body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${uid}.json`), 'utf8'));

  // nothing synced yet
  let r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { state: null, revision: '"0"', rev: 0 });

  // first write against rev 0
  r = await put({ state: { _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01' }], routines: [], active: { id: 'running' } }, baseRev: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.rev, 1);
  assert.equal(r.body.ts, 100);
  assert.equal(r.body.revision, revision);
  assert.equal(onDisk()._rev, 1);
  assert.equal('active' in onDisk(), false, 'active is stripped');

  r = await get();
  assert.equal(r.body.rev, 1);
  assert.equal(r.body.state._rev, 1);
  assert.deepEqual(r.body.state.workouts.map(w => w.id), ['w1']);

  // A stale ETag is a conflict, even if a caller supplies a matching numeric baseRev hint.
  r = await put({ state: { _ts: 200, workouts: [], routines: [] }, baseRev: 0 }, '"0"');
  assert.equal(r.status, 412);
  assert.equal(r.body.error, 'stale revision');
  assert.equal(r.body.revision, revision);
  assert.deepEqual(onDisk().workouts.map(w => w.id), ['w1'], 'a refused write changes nothing');

  // A client from before conditional writes cannot overwrite the profile silently.
  r = await putWithoutPrecondition({ state: { _ts: 250, workouts: [], routines: [] } });
  assert.equal(r.status, 428);

  // A matching ETag advances the server revision.
  r = await put({ state: { _ts: 300, workouts: [{ id: 'w2', d: '2026-09-02' }], routines: [] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 2);
  assert.deepEqual(onDisk().workouts.map(w => w.id), ['w2']);

  // a matching baseRev goes through; a client-supplied _rev is ignored
  r = await put({ state: { _ts: 400, _rev: 99, workouts: [{ id: 'w3', d: '2026-09-03' }], routines: [] }, baseRev: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 3);
  assert.equal(onDisk()._rev, 3);

  // `baseRev` does not replace the strong ETag, including when it is null.
  r = await put({ state: { _ts: 500, workouts: [], routines: [] }, baseRev: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 4);

  // A stale ETag cannot be bypassed by a string (or any other) baseRev.
  r = await put({ state: { _ts: 600, workouts: [], routines: [] }, baseRev: '4' }, '"0"');
  assert.equal(r.status, 412);
  assert.equal(r.body.revision, revision);

  // The state shape is still checked after the precondition.
  r = await put({ state: { workouts: 'nope' }, baseRev: 4 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid state');
  assert.equal(onDisk()._rev, 4);
});

test('PUT idempotent retry keeps the original ETag and revision after another write', async t => {
  const h = await startServer(t);
  const uid = 'u_rev_1';
  const cookie = headers(uid);
  const put = async (state, match, key) => {
    const response = await fetch(`${h.api}/api/data`, {
      method: 'PUT',
      headers: { ...cookie, 'If-Match': match, 'Idempotency-Key': key },
      body: JSON.stringify({ state })
    });
    return { response, body: await response.json() };
  };

  const first = await put({ _ts: 100, workouts: [], routines: [] }, '"0"', 'retry-original');
  assert.equal(first.response.status, 200);
  const intervening = await put({ _ts: 200, workouts: [], routines: [], restSec: 45 }, first.body.revision, 'retry-intervening');
  assert.equal(intervening.response.status, 200);

  const retry = await put({ _ts: 100, workouts: [], routines: [] }, intervening.body.revision, 'retry-original');
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.revision, first.body.revision);
  assert.equal(retry.response.headers.get('etag'), first.response.headers.get('etag'));
  assert.equal(retry.body.rev, first.body.rev);
});

test('profile writes fail closed when the stored revision cannot advance safely', async t => {
  const h = await startServer(t);
  const uid = 'u_rev_1';
  const statePath = path.join(h.dataDir, `state-${uid}.json`);
  const state = { _rev: Number.MAX_SAFE_INTEGER, _ts: 100, workouts: [], routines: [] };
  fs.writeFileSync(statePath, JSON.stringify(state));

  const current = await fetch(`${h.api}/api/data`, { headers: headers(uid) });
  const currentBody = await current.json();
  assert.equal(currentBody.rev, Number.MAX_SAFE_INTEGER);
  const response = await fetch(`${h.api}/api/data`, {
    method: 'PUT',
    headers: { ...headers(uid), 'If-Match': current.headers.get('etag'), 'Idempotency-Key': 'unsafe-revision' },
    body: JSON.stringify({ state: { _ts: 200, workouts: [], routines: [] } })
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'storage_corrupt');
  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, 'utf8')), state);
});

test('legacy data receipt omits unknown numeric rev on retry after an intervening write', async t => {
  const uid = 'u_rev_1';
  const state = { _rev: 1, _ts: 100, workouts: [], routines: [] };
  const stateText = JSON.stringify(state);
  const legacyKey = 'legacy-data-receipt';
  const h = await startServer(t, {
    prepare: dataDir => {
      fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), stateText);
      fs.writeFileSync(path.join(dataDir, 'idempotency.json'), JSON.stringify({ entries: [{
        uid, key: legacyKey, hash: digest(JSON.stringify(state)), revision: etag(stateText),
        tsValue: state._ts, ts: Date.now()
      }] }));
    }
  });
  const cookie = headers(uid);
  const current = await fetch(`${h.api}/api/data`, { headers: cookie });
  const currentBody = await current.json();
  assert.equal(currentBody.rev, 1);

  const intervening = await fetch(`${h.api}/api/data`, {
    method: 'PUT',
    headers: { ...cookie, 'If-Match': current.headers.get('etag'), 'Idempotency-Key': 'legacy-data-intervening' },
    body: JSON.stringify({ state: { ...state, _ts: 200, restSec: 45 } })
  });
  const interveningBody = await intervening.json();
  assert.equal(intervening.status, 200);
  assert.equal(interveningBody.rev, 2);

  const retry = await fetch(`${h.api}/api/data`, {
    method: 'PUT',
    headers: { ...cookie, 'If-Match': intervening.headers.get('etag'), 'Idempotency-Key': legacyKey },
    body: JSON.stringify({ state })
  });
  const retryBody = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(retryBody.revision, etag(stateText));
  assert.equal(retry.headers.get('etag'), etag(stateText));
  assert.equal(Object.prototype.hasOwnProperty.call(retryBody, 'rev'), false);
  const after = await fetch(`${h.api}/api/data`, { headers: cookie });
  assert.equal((await after.json()).rev, 2);
});

test('legacy MCP workout receipt omits unknown numeric rev on retry after an intervening write', async t => {
  const uid = 'u_rev_1';
  const token = 'legacy-mcp-token';
  const workout = { id: 'legacy-mcp-workout' };
  const state = { _rev: 1, _ts: 100, workouts: [workout], routines: [] };
  const stateText = JSON.stringify(state);
  const key = 'legacy-mcp-receipt';
  const h = await startServer(t, {
    env: { MCP_ENABLED: '1' },
    prepare: dataDir => {
      fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), stateText);
      fs.writeFileSync(path.join(dataDir, 'idempotency.json'), JSON.stringify({ entries: [{
        uid, key: `mcp-workout:${key}`, hash: digest(JSON.stringify(workout)), revision: etag(stateText),
        tsValue: state._ts, ts: Date.now(), resultId: workout.id
      }] }));
      fs.writeFileSync(path.join(dataDir, 'mcp-grants.json'), JSON.stringify({ grants: [{
        id: 'legacy-mcp-grant', uid, scopes: ['workout:write'], tokenHash: digest(token),
        created: new Date().toISOString(), expires: Date.now() + 86400000
      }] }));
    }
  });
  const cookie = headers(uid);
  const current = await fetch(`${h.api}/api/data`, { headers: cookie });
  const currentBody = await current.json();
  const intervening = await fetch(`${h.api}/api/data`, {
    method: 'PUT',
    headers: { ...cookie, 'If-Match': current.headers.get('etag'), 'Idempotency-Key': 'legacy-mcp-intervening' },
    body: JSON.stringify({ state: { ...state, _ts: 200, restSec: 45 } })
  });
  const interveningBody = await intervening.json();
  assert.equal(intervening.status, 200);
  assert.equal(interveningBody.rev, 2);

  const retry = await fetch(`${h.api}/api/mcp/workouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': intervening.headers.get('etag'), 'Idempotency-Key': key },
    body: JSON.stringify({ workout, request_id: key })
  });
  const retryBody = await retry.json();
  assert.equal(retry.status, 200);
  assert.equal(retryBody.workout.id, workout.id);
  assert.equal(retryBody.revision, etag(stateText));
  assert.equal(retry.headers.get('etag'), etag(stateText));
  assert.equal(Object.prototype.hasOwnProperty.call(retryBody, 'rev'), false);
  assert.equal(currentBody.rev, 1);
  const after = await fetch(`${h.api}/api/data`, { headers: cookie });
  assert.equal((await after.json()).rev, 2);
});
