/* "Sign out everywhere" (POST /api/logout/all) has to take the account's outstanding pairing
   codes with it: a code is a session-in-waiting, and one minted before the sign-out could
   otherwise be redeemed for a fresh token carrying the new session version. And minting a code
   asks the owner proof (proveOwner): a session alone, which may be a stolen cookie, gets no code.
   Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort, softPasskey } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');

// Same construction as server.js makeSession(): payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = (uid, sv) => ({ Cookie: `gymsid=${mintSession(uid, sv)}` });

const KEYS = { u_test_1: softPasskey(), u_test_2: softPasskey() };
const USERS = [
  { id: 'u_test_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_test_2', name: 'Two', created: new Date().toISOString() }
];

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-pair-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: Object.entries(KEYS).map(([uid, k]) => k.row(uid)), subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: '', log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  // The boot line carries the port the listener bound, so it is both the address and the
  // readiness signal — see boundPort in helpers.mjs for why the test does not pick one.
  h.port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${h.port}`;
  return h;
}

test('logout/all invalidates the account\'s outstanding pairing codes and nobody else\'s', async t => {
  const h = await startServer(t);
  const post = (p, headers, body) => fetch(`${h.api}${p}`, { method: 'POST', headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body && JSON.stringify(body) });
  // A passkey assertion made for this request, the way Settings confirms before showing a code.
  const proof = async uid => {
    const { cid, options } = await (await post('/api/login/options', {}, {})).json();
    return { cid, credential: KEYS[uid].assertion(options.challenge) };
  };
  const create = async (uid, sv) => {
    const r = await post('/api/pair/create', cookie(uid, sv), await proof(uid));
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
  assert.deepEqual(await r.json(), { error: 'invalid or expired code', code: 'pair-invalid' });

  // the other account's code is untouched
  assert.equal((await redeem(other)).status, 200);

  // and a code minted after the sign-out (session version 1 now) redeems for a token of that version
  const fresh = await redeem(await create('u_test_1', 1));
  assert.equal(fresh.status, 200);
  const { token } = await fresh.json();
  assert.match(token.split('.')[0], /^u_test_1:\d+:1:b$/);
});

test('minting a pairing code asks the owner proof: a session alone gets none', async t => {
  const h = await startServer(t);
  const post = (p, headers, body) => fetch(`${h.api}${p}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const options = async () => (await post('/api/login/options', {}, {}).then(r => r.json()));

  // No proof: refused, and nothing a phone could redeem was made.
  const none = await post('/api/pair/create', cookie('u_test_1', 0), {});
  assert.equal(none.status, 403);
  assert.equal((await none.json()).code, 'passkey-required');

  // Another profile's passkey proves nothing about this one.
  const o1 = await options();
  const foreign = await post('/api/pair/create', cookie('u_test_1', 0), { cid: o1.cid, credential: KEYS.u_test_2.assertion(o1.options.challenge) });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).code, 'passkey');

  // A cookie replayed as a Bearer is no shortcut either.
  const asBearer = { Authorization: 'Bearer ' + cookie('u_test_1', 0).Cookie.slice('gymsid='.length) };
  assert.equal((await post('/api/pair/create', asBearer, {})).status, 403);

  // The account's own passkey: a code, which redeems once.
  const o2 = await options();
  const ok = await post('/api/pair/create', cookie('u_test_1', 0), { cid: o2.cid, credential: KEYS.u_test_1.assertion(o2.options.challenge) });
  assert.equal(ok.status, 200);
  const { code } = await ok.json();
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal((await post('/api/pair/redeem', {}, { code })).status, 200);
  // The challenge was spent on the proof.
  assert.equal((await post('/api/pair/create', cookie('u_test_1', 0), { cid: o2.cid, credential: KEYS.u_test_1.assertion(o2.options.challenge) })).status, 403);
});
