// GET /api/data/rev hands out the revision alone — what a signed-in client polls.
//
// The child picks its own port (PORT=0) and announces it, rather than the test picking a free
// one and handing it over: between `listen(0)`, the close that frees it and the child's own bind
// there is a window of one process start, and the kernel hands the same ephemeral port back out
// inside it (measured: 8 repeats in 400 open/close rounds on this box). Eight test files spawn
// servers this way at once, so the loser of that race got EADDRINUSE and this test then talked to
// another file's server — a db.json without its user, and `{"error":"not signed in"}` where the
// revision should have been. Once at baseline, never again on a re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SECRET = 'test-secret-rev-endpoint';
const uid = 'u_rev_1';
const cookie = () => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };

test('GET /api/data/rev tracks PUT /api/data', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-rev-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'R', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });

  // The boot line carries the port the listener actually bound, so there is no window in which
  // anything else could be holding it — the server is listening by the time it is printed.
  let log = '';
  const port = await new Promise((resolve, reject) => {
    const give = setTimeout(() => reject(new Error(`server never announced a port:\n${log}`)), 20000);
    const look = d => {
      log += d;
      const m = /gym-api on :(\d+)/.exec(log);
      if (m) { clearTimeout(give); resolve(+m[1]); }
    };
    child.stdout.on('data', look);
    child.stderr.on('data', d => { log += d; });
    child.on('exit', c => { clearTimeout(give); reject(new Error(`server exited (${c}):\n${log}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/api/health`)).status, 200);

  const h = { cookie: cookie(), origin: 'http://localhost:8080', 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/data/rev`)).status, 401);
  assert.deepEqual(await (await fetch(`${base}/api/data/rev`, { headers: h })).json(), { rev: 0 });
  const put = await fetch(`${base}/api/data`, { method: 'PUT', headers: h, body: JSON.stringify({ state: { workouts: [], routines: [] }, baseRev: 0 }) });
  assert.equal(put.status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/data/rev`, { headers: h })).json(), { rev: 1 });
});
