/* GHSA-g65f-rj2m-6wj9: a push subscription lands in db.json, which every save rewrites whole, so
   its endpoint and keys are capped and checked before anything is kept, and an oversized row left
   by an older version is dropped at boot. Harness copied from server-push-status.test.js.
   (Original note there:) The subscription's server side. The browser keeps its PushSubscription through anything that
   happens here — a row pruned after a dead send, a rebuilt db.json — so the client re-sends it on
   every boot (an upsert that keeps `created`), asks /api/push/status before Settings shows "on",
   and tags it with a device id so a rest-timer alert goes to the device that started the rest.
   Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = { Cookie: `gymsid=${mintSession('u_test_1')}` };
const other = { Cookie: `gymsid=${mintSession('u_test_2')}` };
const keys = { p256dh: 'p', auth: 'a' };

async function startServer(t, subs = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-pushsize-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_test_1', name: 'One', created: new Date().toISOString() }, { id: 'u_test_2', name: 'Two', created: new Date().toISOString() }],
    creds: [], subs, invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}
const readDb = h => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
const post = (h, p, body, hdr = cookie) => fetch(`${h.api}${p}`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const status = (h, endpoint, hdr = cookie) => fetch(`${h.api}/api/push/status?endpoint=${encodeURIComponent(endpoint)}`, { headers: hdr }).then(r => r.json());


test('an oversized endpoint or key is refused and nothing is stored', async t => {
  const h = await startServer(t);
  const long = 'https://push.example/' + 'a'.repeat(5000);
  let r = await post(h, '/api/push/subscribe', { subscription: { endpoint: long, keys } });
  assert.equal(r.status, 400);
  r = await post(h, '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/k', keys: { p256dh: 'A'.repeat(300), auth: 'a' } } });
  assert.equal(r.status, 400);
  r = await post(h, '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/k', keys: { p256dh: 'p', auth: 'x y <script>' } } });
  assert.equal(r.status, 400);
  r = await post(h, '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/k', keys: { p256dh: { a: 1 }, auth: 'a' } } });
  assert.equal(r.status, 400);
  assert.equal(readDb(h).subs.length, 0);
});

test('a real-sized subscription still works', async t => {
  const h = await startServer(t);
  const real = { p256dh: 'B' + 'x'.repeat(86), auth: 'y'.repeat(22) };
  const endpoint = 'https://fcm.googleapis.com/fcm/send/' + 'z'.repeat(150);
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: real } })).status, 200);
  assert.equal(readDb(h).subs.length, 1);
});

test('an oversized row from an older db.json is dropped at boot', async t => {
  const ok = { userId: 'u_test_1', endpoint: 'https://push.example/ok', keys, created: new Date().toISOString() };
  const big = { userId: 'u_test_1', endpoint: 'https://push.example/' + 'b'.repeat(10000), keys, created: new Date().toISOString() };
  const h = await startServer(t, [ok, big]);
  const subs = readDb(h).subs;
  assert.deepEqual(subs.map(s => s.endpoint), ['https://push.example/ok']);
});
