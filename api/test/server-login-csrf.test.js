/* Login CSRF: another site signing the victim's browser into an account the attacker controls.

   The challenge from /api/login/options is bound to nothing but the `cid` that comes back in the
   response body — a server-side map, no cookie, no tie to the browser that asked. So the attacker
   asks for one from their own machine, has their own passkey sign it, and needs the victim's
   browser only for the last step: a form on their page that POSTs the finished assertion to
   /api/login/verify. A form cannot send application/json, but `enctype="text/plain"` with the
   JSON as a field name gets a body JSON.parse accepts, and it needs no CORS preflight. The
   response to a top-level form navigation may set a SameSite=Lax cookie, so the victim's session
   is replaced with the attacker's.

   Two things stop it now: the passkey routes are origin-checked like every other write, and a
   body that is not declared application/json is refused before anything reads it.

   The passkey here is a real P-256 key, the assertion is signed the way an authenticator signs
   one, and @simplewebauthn/server verifies it. Real server.js in a child. */
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
const ORIGIN = 'https://gym.test';
const RP_ID = 'gym.test';
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();

function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/* The attacker's own passkey: stored the way register/verify stores one (COSE, base64url). */
const KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const CRED_ID = b64u(crypto.randomBytes(16));
function coseKey() {
  const { x, y } = KEY.publicKey.export({ format: 'jwk' });
  // {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]), Buffer.from(y, 'base64url')
  ]);
}
function assertion(challenge) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), Buffer.alloc(4)]);   // UP|UV, counter 0
  const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), KEY.privateKey);
  return {
    id: CRED_ID, rawId: CRED_ID, type: 'public-key', clientExtensionResults: {},
    response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: b64u('u_attacker') }
  };
}

async function startServer(t, extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-logincsrf-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [
      { id: 'u_victim', name: 'Victim', created: new Date().toISOString() },
      { id: 'u_attacker', name: 'Attacker', created: new Date().toISOString() }
    ],
    creds: [{ id: CRED_ID, userId: 'u_attacker', publicKey: b64u(coseKey()), counter: 0, transports: ['internal'] }],
    subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID, ...extraEnv }
  });
  const h = { api: '', log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  return h;
}

// Step one happens on the attacker's own machine: no browser, so no Origin and no Sec-Fetch-Site.
async function attackerChallenge(h) {
  const r = await fetch(`${h.api}/api/login/options`, { method: 'POST' });
  assert.equal(r.status, 200);
  const { cid, options } = await r.json();
  return { cid, credential: assertion(options.challenge) };
}

// What <form enctype="text/plain"> builds out of one field whose name is most of a JSON document:
// `name=value` and a CRLF. The value closes the string the name left open.
const textPlainForm = obj => JSON.stringify({ ...obj, pad: '' }).slice(0, -2) + '=' + '"}' + '\r\n';
const sessionUid = r => /__Host-gymsid=([^.;]+)/.exec(r.headers.get('set-cookie') || '')?.[1]?.split(':')[0] || null;

test('a cross-site form cannot sign the victim into the attacker\'s account', async t => {
  const h = await startServer(t);
  const r = await fetch(`${h.api}/api/login/verify`, {
    method: 'POST',
    // The victim's browser: a top-level cross-site form POST. Their Lax session cookie is not
    // sent, and does not need to be; the response is what would replace it.
    headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site' },
    body: textPlainForm(await attackerChallenge(h))
  });
  assert.equal(sessionUid(r), null, 'no session cookie for the attacker\'s account');
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'cross-origin request refused', code: 'origin-mismatch', expected: 'https://gym.test' });
});

test('the passkey routes are origin-checked, even with a JSON body', async t => {
  const h = await startServer(t);
  const cross = { 'Content-Type': 'application/json', Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site' };
  for (const p of ['/api/login/options', '/api/login/verify', '/api/register/options', '/api/register/verify']) {
    const r = await fetch(`${h.api}${p}`, { method: 'POST', headers: cross, body: JSON.stringify(p === '/api/login/verify' ? await attackerChallenge(h) : { name: 'x' }) });
    assert.equal(r.status, 403, p);
    assert.equal(sessionUid(r), null, p);
  }
  // A sibling subdomain is the same site, which is exactly what SameSite=Lax lets through.
  const r = await fetch(`${h.api}/api/login/verify`, {
    method: 'POST', headers: { ...cross, Origin: 'https://other.test', 'Sec-Fetch-Site': 'same-site' },
    body: JSON.stringify(await attackerChallenge(h))
  });
  assert.equal(r.status, 403);
  // A browser that does not send Sec-Fetch-Site still sends Origin, and that is compared.
  const noFetchSite = await fetch(`${h.api}/api/login/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
    body: JSON.stringify(await attackerChallenge(h))
  });
  assert.equal(noFetchSite.status, 403);
});

test('a body not declared as JSON is refused before anything reads it', async t => {
  const h = await startServer(t);
  // No Origin, no Sec-Fetch-Site: past the origin check, so this is the body rule on its own.
  // `text/plain; application/json` is still text/plain to a browser (no preflight), so the match
  // has to be on the media type itself, not anywhere in the header.
  for (const type of ['text/plain', 'text/plain;charset=UTF-8', 'text/plain; application/json', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null]) {
    const r = await fetch(`${h.api}/api/login/verify`, {
      method: 'POST', headers: type ? { 'Content-Type': type } : {}, body: Buffer.from(textPlainForm(await attackerChallenge(h)))
    });
    assert.equal(r.status, 415, String(type));
    assert.deepEqual(await r.json(), { error: 'content-type must be application/json' });
    assert.equal(sessionUid(r), null, String(type));
  }
  // pair/redeem stays exempt from the origin check (the phone's WebView is never ORIGIN), so on
  // that route this rule is the one that keeps a form out.
  const pair = await fetch(`${h.api}/api/pair/redeem`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site' },
    body: '{"code":"ABCDEFGH","x":"="}'
  });
  assert.equal(pair.status, 415);
});

test('the app\'s own sign-in still works, charset and all, and body-less posts are untouched', async t => {
  const h = await startServer(t);
  const same = { 'Content-Type': 'application/json; charset=utf-8', Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };
  const opts = await fetch(`${h.api}/api/login/options`, { method: 'POST', headers: same, body: '{}' });
  assert.equal(opts.status, 200);
  const { cid, options } = await opts.json();
  const r = await fetch(`${h.api}/api/login/verify`, { method: 'POST', headers: same, body: JSON.stringify({ cid, credential: assertion(options.challenge) }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(sessionUid(r), 'u_attacker', 'the passkey\'s owner, signed in on their own device');

  // Older Safari: no Sec-Fetch-Site, an Origin that is ORIGIN.
  assert.equal((await fetch(`${h.api}/api/login/options`, { method: 'POST', headers: { Origin: ORIGIN } })).status, 200);
  // Routes that read no body never needed a Content-Type, and a POST with no body has nothing to declare.
  const victim = { Cookie: `__Host-gymsid=${mintSession('u_victim')}`, 'Sec-Fetch-Site': 'same-origin' };
  assert.equal((await fetch(`${h.api}/api/push/rest-timer/cancel`, { method: 'POST', headers: victim })).status, 200);
  assert.equal((await fetch(`${h.api}/api/logout`, { method: 'POST', headers: victim })).status, 200);
});

// The Bearer shortcut in csrfOk skips the origin check for a request a Bearer authenticates by
// itself. On the passkey routes no Bearer is the credential that acts (the assertion in the body
// is), so any valid token bought the skip there, the attacker's own included, and only the CORS
// preflight never allowing credentials kept a browser from storing the Set-Cookie that came back.
test('a valid Bearer, even the attacker\'s own, does not switch the origin check off on the passkey routes', async t => {
  const h = await startServer(t);
  const own = { Authorization: `Bearer ${mintSession('u_attacker')}`, 'Content-Type': 'application/json', Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site' };
  const r = await fetch(`${h.api}/api/login/verify`, { method: 'POST', headers: own, body: JSON.stringify(await attackerChallenge(h)) });
  assert.equal(sessionUid(r), null, 'no session cookie for the attacker\'s account');
  assert.notEqual(r.status, 200);
  for (const p of ['/api/login/options', '/api/register/options', '/api/register/verify']) {
    const x = await fetch(`${h.api}${p}`, { method: 'POST', headers: own, body: JSON.stringify({ name: 'x', cid: 'nope' }) });
    assert.equal(x.status, 403, p);
  }
  assert.equal(r.status, 403);
  // The same token still carries the paired app everywhere it is the credential.
  const act = await fetch(`${h.api}/api/activity`, { method: 'POST', headers: own, body: JSON.stringify({ active: false }) });
  assert.equal(act.status, 200);
});

// The same holds for the password, reset-code and device-code routes: the credential is in the
// body, so a Bearer, any valid one, buys no skip of the origin check there.
test('a valid Bearer does not switch the origin check off on the password and device-code routes', async t => {
  const h = await startServer(t, { PASSWORD_LOGIN: '1' });
  const own = { Authorization: `Bearer ${mintSession('u_attacker')}`, 'Content-Type': 'application/json', Origin: 'https://evil.test', 'Sec-Fetch-Site': 'cross-site' };
  for (const p of ['/api/login/password', '/api/register/password', '/api/login/password-reset', '/api/device-link/options', '/api/device-link/verify']) {
    const r = await fetch(`${h.api}${p}`, { method: 'POST', headers: own, body: JSON.stringify({ name: 'Attacker', password: 'correct horse battery', code: 'x' }) });
    assert.equal(r.status, 403, p);
    assert.equal(sessionUid(r), null, p);
  }
  // The same token still carries the paired app everywhere it is the credential.
  const act = await fetch(`${h.api}/api/activity`, { method: 'POST', headers: own, body: JSON.stringify({ active: false }) });
  assert.equal(act.status, 200);
});
