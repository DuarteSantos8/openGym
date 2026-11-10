/* /api/integrations through a real server: off by default, the webhook routes, and a workout
 * pushed with PUT /api/data arriving signed at a receiver. The receiver is on 127.0.0.1, which
 * only INTEGRATIONS_ALLOW_LAN plus ALLOWED_PRIVATE_IPS=127.0.0.1 open (the same door a self-hoster
 * opens for Home Assistant on their own network). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { verifySignature } from '../integrations/crypto.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };
const asUser = uid => ({ Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json' });

async function startServer(t, env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-int-srv-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_a', name: 'A', created: new Date().toISOString() }, { id: 'u_b', name: 'B', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.call = async (method, p, body, uid = 'u_a') => {
    const r = await fetch(h.api + p, { method, headers: uid ? asUser(uid) : { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return h;
}

async function receiver(t) {
  const got = [];
  const waiters = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.writeHead(200).end('ok');
      for (const w of waiters.splice(0)) w();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return {
    url: `http://127.0.0.1:${srv.address().port}/hook`, got,
    next: (n, ms = 5000) => new Promise((resolve, reject) => {
      const give = setTimeout(() => reject(new Error(`only ${got.length} deliveries`)), ms);
      const check = () => { if (got.length >= n) { clearTimeout(give); resolve(); } else waiters.push(check); };
      check();
    }),
  };
}

test('with INTEGRATIONS unset the routes are there but off, and /api/config says nothing', async t => {
  const h = await startServer(t, {});
  const cfg = await h.call('GET', '/api/config');
  assert.equal('integrations' in cfg.body, false);
  assert.deepEqual((await h.call('GET', '/api/integrations')).body, { providers: [], connections: [] });
  const r = await h.call('POST', '/api/integrations/connect', { provider: 'webhook', url: 'https://hooks.example.com/x' });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'off');
  assert.equal(fs.existsSync(path.join(h.dataDir, 'integrations')), false);
});

test('a webhook: refused targets, connect, a workout delivered signed, test, log and disconnect', async t => {
  const rx = await receiver(t);
  const h = await startServer(t, { INTEGRATIONS: 'webhook', INTEGRATIONS_ALLOW_LAN: '1', ALLOWED_PRIVATE_IPS: '127.0.0.1' });
  assert.equal((await h.call('GET', '/api/integrations', null, null)).status, 401);
  assert.deepEqual((await h.call('GET', '/api/config')).body.integrations, { providers: ['webhook'], lan: true });
  assert.equal((await h.call('GET', '/api/config', null, null)).body.integrations, undefined, 'not before sign-in');

  for (const url of ['https://169.254.169.254/latest/meta-data', 'http://[::1]/x', 'http://8.8.8.8/x', 'file:///etc/passwd']) {
    const r = await h.call('POST', '/api/integrations/connect', { provider: 'webhook', url });
    assert.equal(r.status, 400, url);
  }

  const made = await h.call('POST', '/api/integrations/connect', { provider: 'webhook', url: rx.url, label: 'Home Assistant', events: ['workout.finished', 'workout.pr'] });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const { id } = made.body.connection;
  const secret = made.body.reveal.secret;
  const list = await h.call('GET', '/api/integrations');
  assert.equal(list.body.connections.length, 1);
  assert.ok(!JSON.stringify(list.body).includes(secret), 'the secret is shown once, at connect');
  assert.equal((await h.call('GET', '/api/integrations', null, 'u_b')).body.connections.length, 0, 'per profile');

  // A workout finished just now, synced: delivered without the app doing anything more.
  const now = Date.now() + 1000;
  const state = { unit: 'kg', routines: [], workouts: [{ id: 'w-new', d: new Date(now).toISOString().slice(0, 10), name: 'Legs', start: now - 3000_000, end: now, prs: ['0025'], entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }] }] }] };
  const put = await h.call('PUT', '/api/data', { state });
  assert.equal(put.status, 200);
  await rx.next(2);
  const types = rx.got.map(g => g.headers['x-opengym-event']).sort();
  assert.deepEqual(types, ['workout.finished', 'workout.pr']);
  for (const g of rx.got) {
    assert.equal(verifySignature(secret, g.body, g.headers['x-opengym-signature']), true);
    assert.match(g.headers['user-agent'], /^openGym-Webhook\//);
  }
  const fin = JSON.parse(rx.got.find(g => g.headers['x-opengym-event'] === 'workout.finished').body);
  assert.equal(fin.data.workout.exercises[0].name, 'barbell bench press');

  // Pushed again (another device, a retry): no second delivery.
  await h.call('PUT', '/api/data', { state: { ...state, routines: [{ id: 'r', name: 'x' }] } });
  await new Promise(r => setTimeout(r, 300));
  assert.equal(rx.got.length, 2);

  const tst = await h.call('POST', '/api/integrations/test', { id });
  assert.equal(tst.status, 200);
  assert.equal(tst.body.ok, true);
  assert.equal(JSON.parse(rx.got.at(-1).body).test, true);

  const upd = await h.call('POST', '/api/integrations/update', { id, events: ['weighin.logged'], label: 'HA' });
  assert.deepEqual(upd.body.connection.events, ['weighin.logged']);
  assert.equal(upd.body.connection.label, 'HA');

  const log = await h.call('GET', '/api/integrations/log?id=' + encodeURIComponent(id));
  assert.equal(log.status, 200);
  assert.equal(log.body.log[0].ev, 'test');
  assert.ok(log.body.log.some(e => e.ev === 'workout.finished' && e.ok));

  assert.equal((await h.call('POST', '/api/integrations/disconnect', { id }, 'u_b')).status, 404, 'not theirs');
  assert.equal((await h.call('POST', '/api/integrations/disconnect', { id })).status, 200);
  assert.deepEqual((await h.call('GET', '/api/integrations')).body.connections, []);
});

test('without the home network opened, a LAN receiver is refused', async t => {
  const h = await startServer(t, { INTEGRATIONS: 'webhook' });
  const r = await h.call('POST', '/api/integrations/connect', { provider: 'webhook', url: 'http://192.168.1.20:8123/api/webhook/x' });
  assert.equal(r.status, 400);
  assert.equal((await h.call('POST', '/api/integrations/connect', { provider: 'webhook', url: 'https://192.168.1.20/x' })).status, 400);
  assert.equal((await h.call('POST', '/api/integrations/connect', { provider: 'webhook', url: 'https://hooks.example.com/x' })).status, 200);
});
