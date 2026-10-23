/* OAuth for the MCP endpoint (api/oauth.js), end to end against the real server.js in a child:
   discovery, registration, the consent hand-off to the app, the code with PKCE, refresh rotation,
   and the ways a grant ends. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { tokenHash } from '../oauth.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const ORIGIN = 'https://gym.example.com';

function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}:c`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
// The consent screen is the app itself: same origin, with the session cookie.
const asApp = (uid, sv) => ({ Cookie: `__Host-gymsid=${mintSession(uid, sv)}`, 'Sec-Fetch-Site': 'same-origin' });

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oauth-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'gym.example.com' }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  return h;
}

const REDIRECT = 'http://127.0.0.1:33418/callback';
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

test('a client connects through the consent screen and reads with a rotating token', async t => {
  const h = await startServer(t);
  const get = (p, headers) => fetch(h.api + p, { headers, redirect: 'manual' });
  const post = (p, body, headers = {}) => fetch(h.api + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const form = (p, fields) => fetch(h.api + p, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

  // Discovery, on the public ORIGIN.
  const meta = await (await get('/.well-known/oauth-authorization-server')).json();
  assert.equal(meta.issuer, ORIGIN);
  assert.equal(meta.token_endpoint, ORIGIN + '/api/oauth/token');
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  const prm = await (await get('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(prm.resource, ORIGIN + '/mcp');
  assert.deepEqual(prm.authorization_servers, [ORIGIN]);

  // Registration: plain http only to loopback.
  assert.equal((await post('/api/oauth/register', { redirect_uris: ['http://evil.example/cb'] })).status, 400);
  const reg = await post('/api/oauth/register', { redirect_uris: [REDIRECT], client_name: 'Claude Code' }, { Origin: 'https://claude.ai' });
  assert.equal(reg.status, 201);
  const { client_id } = await reg.json();

  const q = { client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };

  // authorize hands off to the app's consent screen; a redirect URI the client never registered
  // is refused on the spot, never redirected to.
  const auth = await get('/api/oauth/authorize?' + new URLSearchParams(q));
  assert.equal(auth.status, 302);
  assert.match(auth.headers.get('location'), /^\.\.\/\.\.\/#\/connect\?client_id=/);
  assert.equal((await get('/api/oauth/authorize?' + new URLSearchParams({ ...q, redirect_uri: 'https://evil.example/cb' }))).status, 400);
  assert.deepEqual(await (await get('/api/oauth/client?' + new URLSearchParams(q))).json(), { name: 'Claude Code', redirect_host: '127.0.0.1:33418' });

  // Approving takes a session, and a same-origin one.
  assert.equal((await post('/api/oauth/approve', q)).status, 401);
  assert.equal((await post('/api/oauth/approve', q, { Cookie: asApp('u1').Cookie, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const ok = await post('/api/oauth/approve', q, asApp('u1'));
  assert.equal(ok.status, 200);
  const back = new URL((await ok.json()).redirect);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get('state'), 'xyz');
  const code = back.searchParams.get('code');

  // The code needs the verifier, and is good once.
  const exchange = { grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: verifier };
  const wrongVerifier = await form('/api/oauth/token', { ...exchange, code_verifier: 'x'.repeat(43) });
  assert.equal(wrongVerifier.status, 400);
  assert.equal((await wrongVerifier.json()).error, 'invalid_grant');
  // …and the failed try spent it: a code is one attempt, not one success.
  assert.equal((await form('/api/oauth/token', exchange)).status, 400);

  // Again, properly this time.
  const ok2 = await post('/api/oauth/approve', q, asApp('u1'));
  const code2 = new URL((await ok2.json()).redirect).searchParams.get('code');
  const tok = await form('/api/oauth/token', { ...exchange, code: code2 });
  assert.equal(tok.status, 200);
  const t1 = await tok.json();
  assert.equal(t1.token_type, 'Bearer');
  assert.equal((await form('/api/oauth/token', { ...exchange, code: code2 })).status, 400);

  // db.json holds the hashes, never the tokens, and the grant names the profile.
  const db = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  assert.equal(db.oauthGrants.length, 1);
  assert.equal(db.oauthGrants[0].uid, 'u1');
  assert.equal(db.oauthGrants[0].ah, tokenHash(t1.access_token));
  assert.ok(!JSON.stringify(db).includes(t1.access_token) && !JSON.stringify(db).includes(t1.refresh_token));

  // Refresh rotates: the new pair works, the old refresh token is spent.
  const r2 = await form('/api/oauth/token', { grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id });
  assert.equal(r2.status, 200);
  const t2 = await r2.json();
  assert.notEqual(t2.access_token, t1.access_token);
  assert.equal((await form('/api/oauth/token', { grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id })).status, 400);

  // "Sign out everywhere" ends the grant like any session.
  assert.equal((await post('/api/logout/all', {}, asApp('u1'))).status, 200);
  const after = await form('/api/oauth/token', { grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id });
  assert.equal(after.status, 400);
  assert.equal((await after.json()).error, 'invalid_grant');
});

test('a code approved before "sign out everywhere" is refused after it', async t => {
  const h = await startServer(t);
  const post = (p, body, headers = {}) => fetch(h.api + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const { client_id } = await (await post('/api/oauth/register', { redirect_uris: [REDIRECT] })).json();
  const q = { client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' };
  const code = new URL((await (await post('/api/oauth/approve', q, asApp('u1'))).json()).redirect).searchParams.get('code');
  assert.equal((await post('/api/logout/all', {}, asApp('u1'))).status, 200);
  const r = await post('/api/oauth/token', { grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_grant');
});
