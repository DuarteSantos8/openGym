/* The push endpoint private-address rule, judged on every textual form of an IP literal. new URL
   canonicalizes `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, and Node never consults an Agent's
   custom lookup for a literal host, so a literal that slips the subscribe-time check is one the
   send path will actually connect to. Both ends are covered here: subscribe refuses, and a
   private literal already sitting in db.json is refused at send time without a socket being
   opened. Real server.js in a child. */
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

// Same construction as server.js makeSession(): payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = { Cookie: `gymsid=${mintSession('u_test_1')}` };
// Real-shaped keys (65-byte P-256 point, 16-byte auth secret): web-push validates them before it
// opens a socket, and the send-time test below is only meaningful if the socket would have opened.
const keys = {
  p256dh: crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).subarray(-65).toString('base64url'),
  auth: crypto.randomBytes(16).toString('base64url')
};

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t, subs = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-push-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_test_1', name: 'One', created: new Date().toISOString() }], creds: [], subs, invites: []
  }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: `http://127.0.0.1:${port}`, dataDir, log: '' };
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

test('subscribe refuses every spelling of a private IP literal and accepts public ones', async t => {
  const h = await startServer(t);
  const subscribe = endpoint => fetch(`${h.api}/api/push/subscribe`, {
    method: 'POST', headers: cookie, body: JSON.stringify({ subscription: { endpoint, keys } })
  });
  const privateForms = [
    'https://[::ffff:127.0.0.1]/x',          // mapped loopback, dotted
    'https://[::ffff:7f00:1]/x',             // mapped loopback, hex (what new URL makes of the above)
    'https://[0:0:0:0:0:ffff:7f00:1]/x',     // mapped loopback, fully expanded
    'https://[::ffff:169.254.169.254]/x',    // mapped link-local (cloud metadata)
    'https://[::FFFF:C0A8:0101]/x',          // mapped 192.168.1.1, upper-case, zero-padded
    'https://[::ffff:10.0.0.1]/x',           // mapped private
    'https://[0:0:0:0:0:0:0:1]/x',           // loopback, expanded
    'https://[::1]/x',                       // loopback, compressed
    'https://[fe80::1]/x',                   // link-local
    'https://[fd00::1]/x',                   // unique local
    'https://127.0.0.1/x'                    // plain IPv4 (the case that always worked)
  ];
  for (const ep of privateForms) {
    const r = await subscribe(ep);
    assert.equal(r.status, 400, ep);
    assert.deepEqual(await r.json(), { error: 'endpoint must not point at a private address' }, ep);
  }
  for (const ep of ['https://[::ffff:8.8.8.8]/x', 'https://[::ffff:808:808]/x', 'https://[2606:4700::1111]/x', 'https://8.8.8.8/x', 'https://push.example/x']) {
    assert.equal((await subscribe(ep)).status, 200, ep);
  }
});

test('a private literal already stored as an endpoint is refused at send time, never connected to, and dropped', async t => {
  // stands in for whatever else lives on the api container's network
  const hits = [];
  const target = net.createServer(s => { hits.push(s.remoteAddress); s.destroy(); });
  await new Promise(r => target.listen(0, '127.0.0.1', r));
  t.after(() => target.close());
  const endpoint = `https://[::ffff:7f00:1]:${target.address().port}/x`;
  const h = await startServer(t, [{ userId: 'u_test_1', endpoint, keys, created: new Date().toISOString() }]);

  const r = await fetch(`${h.api}/api/push/test`, { method: 'POST', headers: cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(hits, [], 'no socket reached the private address');
  assert.match(h.log, /push endpoint refused u_test_1/);
  const db = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  assert.equal(db.subs.length, 0, 'the unusable subscription is gone from db.json');
});
