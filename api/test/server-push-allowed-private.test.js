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
const keys = {
  p256dh: crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ type: 'spki', format: 'der' }).subarray(-65).toString('base64url'),
  auth: crypto.randomBytes(16).toString('base64url')
};

async function startServer(t, allowedPrivateIps) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-allowed-ips-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_test_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', ALLOWED_PRIVATE_IPS: allowedPrivateIps }
  });
  const h = { log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.subscribe = async endpoint => (await fetch(`${h.api}/api/push/subscribe`, {
    method: 'POST', headers: cookie, body: JSON.stringify({ subscription: { endpoint, keys } })
  })).status;
  return h;
}

test('no ALLOWED_PRIVATE_IPS keeps every private address blocked', async t => {
  const h = await startServer(t, '');
  for (const ip of ['10.1.2.3', '100.64.0.5', '192.168.1.1', '[fd12::1]']) {
    assert.equal(await h.subscribe(`https://${ip}/x`), 400, ip);
  }
});

test('allowed CIDR blocks, ranges and single addresses open only what they name', async t => {
  const h = await startServer(t, '10.0.0.0/8, 100.64.0.1-100.64.0.9 192.168.1.50,fd00::/8');
  const allowed = [
    '10.1.2.3', '10.255.255.255',
    '100.64.0.1', '100.64.0.5', '100.64.0.9',
    '192.168.1.50',
    '[fd12::1]', '[::ffff:10.1.2.3]'
  ];
  const blocked = [
    '100.64.0.10', '100.64.0.0',
    '192.168.1.51', '192.168.1.1',
    '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '[fc00::1]', '[fe80::1]', '[::1]', '[::ffff:127.0.0.1]'
  ];
  for (const ip of allowed) {
    assert.equal(await h.subscribe(`https://${ip}/x`), 200, ip);
  }
  for (const ip of blocked) assert.equal(await h.subscribe(`https://${ip}/x`), 400, ip);
});

test('an invalid entry is reported and ignored while valid ones still apply', async t => {
  const h = await startServer(t, 'bogus, 10.0.0.0/99, 172.16.0.0/12');
  assert.match(h.log, /ALLOWED_PRIVATE_IPS entry "bogus"/);
  assert.match(h.log, /ALLOWED_PRIVATE_IPS entry "10.0.0.0\/99"/);
  assert.equal(await h.subscribe('https://172.20.0.1/x'), 200);
  assert.equal(await h.subscribe('https://10.0.0.1/x'), 400);
});
