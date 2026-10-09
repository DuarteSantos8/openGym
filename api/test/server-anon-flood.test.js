/* The routes anyone can call without a session (pairing, passkey sign-in and sign-up) used to
   answer a flood of junk with a 400 and an audit row each, never a 429: a few thousand requests
   pushed every other row out of the AUDIT_MAX-capped log in seconds. And a signed-in session could
   mint pairing codes without limit, each one kept for five minutes. Real server.js in a child. */
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

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-flood-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_test_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', AUDIT_LOG: '1' }
  });
  const h = { api: '', dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  h.post = (p, body, headers = {}) => fetch(`${h.api}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {})
  });
  h.audit = () => {
    let text = '';
    try { text = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'); } catch { /* none yet */ }
    return text.split('\n').filter(Boolean).map(l => JSON.parse(l));
  };
  return h;
}

test('wrong pairing codes are all answered, but only a few of them reach the audit log', async t => {
  const h = await startServer(t);
  // Not paused: behind a proxy every visitor shares an address, and a 40-bit code that lives five
  // minutes is not worth guessing (see the sign-in throttle in server.js).
  for (let i = 0; i < 30; i++) assert.equal((await h.post('/api/pair/redeem', { code: 'WRONG' + i })).status, 400);
  assert.equal(h.audit().filter(r => r.ev === 'auth.pair.fail').length, 10, 'ten a minute per address, not thirty');
});

test('junk passkey sign-ins and sign-ups are answered but not each written to the audit log', async t => {
  const h = await startServer(t);
  for (let i = 0; i < 25; i++) {
    assert.equal((await h.post('/api/login/verify', { cid: 'junk' + i, credential: { id: 'x' } })).status, 400);
    assert.equal((await h.post('/api/register/verify', { cid: 'junk' + i })).status, 400);
  }
  // A valid challenge with an unknown passkey is the other cheap miss.
  for (let i = 0; i < 15; i++) {
    const { cid } = await (await h.post('/api/login/options')).json();
    assert.equal((await h.post('/api/login/verify', { cid, credential: { id: 'nobody' + i } })).status, 404);
  }
  const rows = h.audit();
  assert.equal(rows.filter(r => r.ev === 'auth.login.fail').length, 10);
  assert.equal(rows.filter(r => r.ev === 'auth.register.fail').length, 10);
});

test('minting a pairing code retires the profile\'s previous one', async t => {
  const h = await startServer(t);
  const mint = async () => (await (await h.post('/api/pair/create', {}, { ...cookie, Origin: 'http://localhost:8080' })).json()).code;
  const first = await mint();
  const second = await mint();
  assert.notEqual(first, second);
  assert.equal((await h.post('/api/pair/redeem', { code: first })).status, 400, 'the older code is gone');
  assert.equal((await h.post('/api/pair/redeem', { code: second })).status, 200, 'the newest one works');
});
