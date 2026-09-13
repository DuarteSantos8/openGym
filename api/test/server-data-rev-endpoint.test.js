// GET /api/data/rev hands out the revision alone — what a signed-in client polls.
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
const freePort = () => new Promise(r => { const s = require_net().createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
import net from 'node:net';
function require_net() { return net; }

test('GET /api/data/rev tracks PUT /api/data', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-rev-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'R', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' } });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch {} if (!up) await new Promise(r => setTimeout(r, 100)); }
  assert.ok(up);
  const h = { cookie: cookie(), origin: 'http://localhost:8080', 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/data/rev`)).status, 401);
  assert.deepEqual(await (await fetch(`${base}/api/data/rev`, { headers: h })).json(), { rev: 0 });
  const put = await fetch(`${base}/api/data`, { method: 'PUT', headers: h, body: JSON.stringify({ state: { workouts: [], routines: [] }, baseRev: 0 }) });
  assert.equal(put.status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/data/rev`, { headers: h })).json(), { rev: 1 });
});
