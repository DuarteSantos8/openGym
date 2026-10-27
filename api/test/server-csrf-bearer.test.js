/* The Bearer shortcut in csrfOk: a request a Bearer token authenticates has no origin to check,
   because a browser never attaches one on its own. It used to be keyed on the header's shape —
   anything starting with "Bearer " skipped the check — and then readSession authenticated the
   request with the session COOKIE whenever one was present, so the header that bought the
   exemption was not the credential that acted. Only the CORS preflight (no
   Access-Control-Allow-Credentials) kept a hostile page from sending both. Now the exemption
   needs a Bearer that authenticates on its own: a valid session token, and no session cookie
   beside it. A Bearer that does not verify, with no cookie, is a caller who is not
   signed in and gets the 401 before any handler runs. Real server.js in a child. */
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

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-csrfbearer-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: 'u_victim', name: 'Victim', created: new Date().toISOString() },
      { id: 'u_phone', name: 'Phone', created: new Date().toISOString() }
    ], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'https://gym.test', RP_ID: 'gym.test' }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return `http://127.0.0.1:${await boundPort(child, () => log)}`;
}
const evil = { Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' };
const victimCookie = { Cookie: `__Host-gymsid=${mintSession('u_victim')}` };
const activity = (api, headers) => fetch(`${api}/api/activity`, { method: 'POST', headers, body: JSON.stringify({ active: false }) });

test('a Bearer header that authenticates nothing does not switch the origin check off', async t => {
  const api = await startServer(t);
  const bogus = { Authorization: 'Bearer not-a-token' };
  // With the victim's cookie beside it, this used to be a 200 acting as the victim.
  const r = await activity(api, { ...evil, ...victimCookie, ...bogus });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'cross-origin request refused', code: 'origin-mismatch', expected: 'https://gym.test' });
  // With no cookie, nothing ambient is in play: that caller is not signed in, and is told so
  // with the 401 the paired app acts on, before any handler runs. login/options answers anybody
  // with a 200, so the 401 there is the proof the handler was never reached.
  assert.equal((await activity(api, { ...evil, ...bogus })).status, 401);
  const opts = await fetch(`${api}/api/login/options`, { method: 'POST', headers: { ...evil, ...bogus } });
  assert.equal(opts.status, 401);
  assert.deepEqual(await opts.json(), { error: 'not signed in' });
  // An empty "Bearer " arrives trimmed to "Bearer", which is no Bearer at all: the origin check.
  assert.equal((await activity(api, { ...evil, Authorization: 'Bearer ' })).status, 403);
  // A valid token is still not the credential that acts when a cookie is there: readSession
  // takes the cookie first, so the request would run as the victim.
  assert.equal((await activity(api, { ...evil, ...victimCookie, Authorization: `Bearer ${mintSession('u_phone')}` })).status, 403);
});

test('the paired app still gets through from its own origin', async t => {
  const api = await startServer(t);
  // The WebView: its own origin, cross-site by definition, a session token and no cookie.
  for (const Origin of ['capacitor://localhost', 'https://localhost']) {
    const phone = { ...evil, Origin, Authorization: `Bearer ${mintSession('u_phone')}` };
    assert.equal((await activity(api, phone)).status, 200, Origin);
    const put = await fetch(`${api}/api/data`, { method: 'PUT', headers: phone, body: JSON.stringify({ state: { unit: 'kg', workouts: [], routines: [] } }) });
    assert.equal(put.status, 200, Origin);
  }
  // and the web app on its own origin needs no Bearer at all
  assert.equal((await activity(api, { ...victimCookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' })).status, 200);
});

test('a paired phone whose token is dead is told it is signed out, not that its origin is wrong', async t => {
  const api = await startServer(t);
  const expired = (() => {
    const payload = `u_phone:${Date.now() - 1000}:0`;
    return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  })();
  const r = await fetch(`${api}/api/data`, {
    method: 'PUT', headers: { ...evil, Origin: 'capacitor://localhost', Authorization: `Bearer ${expired}` },
    body: JSON.stringify({ state: { unit: 'kg', workouts: [], routines: [] } })
  });
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'not signed in' });
});
