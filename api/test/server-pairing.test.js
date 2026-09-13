/* "Sign out everywhere" (POST /api/logout/all) has to take the account's outstanding pairing
   codes with it: a code is a session-in-waiting, and one minted before the sign-out could
   otherwise be redeemed for a fresh token carrying the new session version. Real server.js in a
   child. */
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
function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = (uid, sv) => ({ Cookie: `gymsid=${mintSession(uid, sv)}` });

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

const USERS = [
  { id: 'u_test_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_test_2', name: 'Two', created: new Date().toISOString() }
];

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-pair-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: `http://127.0.0.1:${port}`, log: '' };
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

test('logout/all invalidates the account\'s outstanding pairing codes and nobody else\'s', async t => {
  const h = await startServer(t);
  const post = (p, headers, body) => fetch(`${h.api}${p}`, { method: 'POST', headers, body: body && JSON.stringify(body) });
  const create = async (uid, sv) => {
    const r = await post('/api/pair/create', cookie(uid, sv));
    assert.equal(r.status, 200);
    return (await r.json()).code;
  };
  const redeem = code => post('/api/pair/redeem', {}, { code });

  // control: mint and redeem with nothing in between
  assert.equal((await redeem(await create('u_test_1', 0))).status, 200);

  // a code minted before "sign out everywhere" is refused after it
  const stale = await create('u_test_1', 0);
  const other = await create('u_test_2', 0);
  assert.equal((await post('/api/logout/all', cookie('u_test_1', 0))).status, 200);
  const r = await redeem(stale);
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'invalid or expired code' });

  // the other account's code is untouched
  assert.equal((await redeem(other)).status, 200);

  // and a code minted after the sign-out (session version 1 now) redeems for a token of that version
  const fresh = await redeem(await create('u_test_1', 1));
  assert.equal(fresh.status, 200);
  const { token } = await fresh.json();
  assert.match(token.split('.')[0], /^u_test_1:\d+:1$/);
});
