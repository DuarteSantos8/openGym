/* A paired phone's bearer token used to live exactly SESSION_DAYS from the pairing and then be
   refused, however often the phone had been used. GET /api/me — which the phone asks on every
   start — now hands a bearer session past half its lifetime a fresh token. Revocation must
   survive that: the renewed token carries the account's session version, so "sign out
   everywhere" ends it, and a token already revoked is never renewed. Real server.js in a child. */
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
const DAY = 86400000;
const SESSION_DAYS = 10;

// Same construction as server.js makeSession(): payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mint(uid, { daysLeft, sv = 0 }) {
  const payload = `${uid}:${Date.now() + daysLeft * DAY}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const verifies = token => {
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  return token.slice(i + 1) === crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const bearer = token => ({ Authorization: 'Bearer ' + token });

const USERS = [
  { id: 'u_phone', name: 'Phone', created: new Date().toISOString() },
  { id: 'u_bumped', name: 'Bumped', created: new Date().toISOString(), sv: 1 }
];

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-renew-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', SESSION_DAYS: String(SESSION_DAYS) }
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

test('a bearer token past half its lifetime gets a fresh one from /api/me; a younger one and a cookie do not', async t => {
  const h = await startServer(t);
  const me = headers => fetch(`${h.api}/api/me`, { headers });

  // Four of ten days left: past half. The new token verifies, lasts the full SESSION_DAYS
  // from now, keeps the account's session version, and is itself accepted.
  const old = await me(bearer(mint('u_phone', { daysLeft: 4 })));
  assert.equal(old.status, 200);
  const body = await old.json();
  assert.equal(body.user.id, 'u_phone');
  assert.equal(typeof body.token, 'string');
  assert.ok(verifies(body.token));
  const [uid, exp, sv] = body.token.split('.')[0].split(':');
  assert.equal(uid, 'u_phone');
  assert.equal(sv, '0');
  assert.ok(Math.abs(+exp - (Date.now() + SESSION_DAYS * DAY)) < 60000);
  const again = await me(bearer(body.token));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).token, undefined);   // brand new — nothing to renew

  // Eight of ten days left: not yet.
  const young = await me(bearer(mint('u_phone', { daysLeft: 8 })));
  assert.deepEqual(Object.keys(await young.json()), ['user']);

  // A browser's cookie is renewed by signing in, not here.
  const cookie = await me({ Cookie: `gymsid=${mint('u_phone', { daysLeft: 1 })}` });
  assert.equal(cookie.status, 200);
  assert.equal((await cookie.json()).token, undefined);
});

test('revocation still works: an old session version is refused, and "sign out everywhere" ends a renewed token', async t => {
  const h = await startServer(t);
  const me = headers => fetch(`${h.api}/api/me`, { headers });

  // Revoked before it was ever renewed: refused, and no new token handed out.
  const revoked = await me(bearer(mint('u_bumped', { daysLeft: 2, sv: 0 })));
  assert.equal(revoked.status, 401);
  assert.equal((await revoked.json()).token, undefined);

  // Renewed first, then the account signs out everywhere: the renewed token dies with it.
  const r = await me(bearer(mint('u_phone', { daysLeft: 1 })));
  const { token } = await r.json();
  assert.equal((await me(bearer(token))).status, 200);
  const out = await fetch(`${h.api}/api/logout/all`, { method: 'POST', headers: { Cookie: `gymsid=${mint('u_phone', { daysLeft: 9 })}` } });
  assert.equal(out.status, 200);
  assert.equal((await me(bearer(token))).status, 401);
});
