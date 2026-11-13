/* The MCP connector sign-in end to end against the real server.js: discovery, registration, the
   authorize redirect to the consent page, approval with a session, the code for a working token. */
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
const session = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

async function start(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oauth-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'https://gym.example', RP_ID: 'gym.example', ...env } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => log);
  return `http://127.0.0.1:${port}`;
}

test('without MCP=on there is no authorization server at all', async t => {
  const api = await start(t);
  assert.equal((await fetch(api + '/.well-known/oauth-authorization-server')).status, 404);
  assert.equal((await fetch(api + '/api/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
});

test('register, authorize, approve with a session, exchange: the token reads the profile', async t => {
  const api = await start(t, { MCP: 'on' });
  const meta = await (await fetch(api + '/.well-known/oauth-authorization-server')).json();
  assert.equal(meta.issuer, 'https://gym.example');
  const reg = await (await fetch(api + '/api/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const az = await fetch(api + '/api/oauth/authorize?' + new URLSearchParams({ client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'abc', scope: 'workouts:view plans:view' }), { redirect: 'manual' });
  assert.equal(az.status, 302);
  const id = az.headers.get('location').split('/#/connect/')[1];
  assert.ok(id);
  // The consent page needs a session; nobody else can read or approve the request.
  assert.equal((await fetch(api + '/api/oauth/request?id=' + id)).status, 401);
  const cookie = { Cookie: `gymsid=${session('u1')}`, 'Sec-Fetch-Site': 'same-origin' };
  const shown = await (await fetch(api + '/api/oauth/request?id=' + id, { headers: cookie })).json();
  assert.equal(shown.client, 'Claude');
  // A cross-site approve is refused like any other state change.
  const forged = await fetch(api + '/api/oauth/approve', { method: 'POST', headers: { ...cookie, 'Sec-Fetch-Site': 'cross-site', 'content-type': 'application/json' }, body: JSON.stringify({ id, scopes: shown.scopes, days: 30 }) });
  assert.equal(forged.status, 403);
  const ok = await (await fetch(api + '/api/oauth/approve', { method: 'POST', headers: { ...cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id, scopes: shown.scopes, days: 30 }) })).json();
  const back = new URL(ok.redirect);
  assert.equal(back.searchParams.get('state'), 'abc');
  const tok = await fetch(api + '/api/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code'), code_verifier: verifier, client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' }) });
  assert.equal(tok.status, 200);
  const body = await tok.json();
  assert.match(body.access_token, /^ogt_/);
  assert.equal(body.scope, 'workouts:view plans:view');
  // It is an ordinary scoped token: listed with the others, and it reads only its categories.
  const list = await (await fetch(api + '/api/tokens', { headers: cookie })).json();
  assert.ok(list.tokens.some(x => x.name === 'Claude (connector)'));
  const me = await fetch(api + '/api/token/me', { headers: { Authorization: 'Bearer ' + body.access_token } });
  assert.equal(me.status, 200);
});

// sub-connect-146: the whole connector life against server.js, the way Claude runs it.
async function signIn(api, { scope = 'workouts:view plans:view offline_access', redirect = 'https://claude.ai/api/mcp/auth_callback', resource } = {}) {
  const reg = await (await fetch(api + '/api/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'] }) })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const az = await fetch(api + '/api/oauth/authorize?' + new URLSearchParams({ client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'abc', scope, ...(resource ? { resource } : {}) }), { redirect: 'manual' });
  const id = az.headers.get('location').split('/#/connect/')[1];
  const cookie = { Cookie: `gymsid=${session('u1')}`, 'Sec-Fetch-Site': 'same-origin' };
  const ok = await (await fetch(api + '/api/oauth/approve', { method: 'POST', headers: { ...cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id, scopes: { workouts: 'view', plans: 'view' }, days: 0 }) })).json();
  const back = new URL(ok.redirect);
  // Basic client authentication instead of client_id in the form: what some OAuth libraries send.
  const tok = await (await fetch(api + '/api/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(reg.client_id + ':').toString('base64') }, body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect }) })).json();
  return { reg, back, tok, cookie };
}

test('refresh, revoke and the connector in the token list (assistant, last used)', async t => {
  const api = await start(t, { MCP: 'on' });
  const { reg, back, tok, cookie } = await signIn(api);
  assert.equal(back.searchParams.get('iss'), 'https://gym.example');
  assert.match(tok.refresh_token, /^ogr_/);
  assert.equal(tok.expires_in, 86400);
  const me = t2 => fetch(api + '/api/token/me', { headers: { Authorization: 'Bearer ' + t2 } });
  assert.equal((await me(tok.access_token)).status, 200);
  const list = await (await fetch(api + '/api/tokens', { headers: cookie })).json();
  const row = list.tokens.find(x => x.connector);
  assert.deepEqual(row.connector, { assistant: 'claude', client: 'Claude' });
  assert.ok(row.used, 'the first call marks it used: the app shows "Connected"');
  const ref = await fetch(api + '/api/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }) });
  assert.equal(ref.status, 200);
  const fresh = await ref.json();
  assert.equal((await me(tok.access_token)).status, 401, 'the old access token is dead');
  assert.equal((await me(fresh.access_token)).status, 200);
  const rv = await fetch(api + '/api/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: fresh.refresh_token }) });
  assert.equal(rv.status, 200);
  assert.equal((await me(fresh.access_token)).status, 401, 'revoked with its refresh token');
  const after = await (await fetch(api + '/api/tokens', { headers: cookie })).json();
  assert.equal(after.tokens.filter(x => x.connector).length, 0);
});

test('a resource naming another server is sent back as invalid_target', async t => {
  const api = await start(t, { MCP: 'on' });
  const reg = await (await fetch(api + '/api/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] }) })).json();
  const az = await fetch(api + '/api/oauth/authorize?' + new URLSearchParams({ client_id: reg.client_id, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: 'https://elsewhere.example/mcp' }), { redirect: 'manual' });
  assert.equal(az.status, 302);
  assert.match(az.headers.get('location'), /error=invalid_target/);
  const ok = await fetch(api + '/api/oauth/authorize?' + new URLSearchParams({ client_id: reg.client_id, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: 'https://gym.example/mcp' }), { redirect: 'manual' });
  assert.match(ok.headers.get('location'), /\/#\/connect\//);
});

test('under BASE_PATH: issuer, resource and every discovery address carry the prefix', async t => {
  const api = await start(t, { MCP: 'on', BASE_PATH: '/gym' });
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/gym', '/.well-known/openid-configuration', '/.well-known/openid-configuration/gym']) {
    const m = await (await fetch(api + p)).json();
    assert.equal(m.issuer, 'https://gym.example/gym', p);
    assert.equal(m.token_endpoint, 'https://gym.example/gym/api/oauth/token', p);
  }
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource/gym/mcp']) {
    const r = await (await fetch(api + p)).json();
    assert.equal(r.resource, 'https://gym.example/gym/mcp', p);
    assert.deepEqual(r.authorization_servers, ['https://gym.example/gym'], p);
  }
  const { back } = await signIn(api, { resource: 'https://gym.example/gym/mcp' });
  assert.ok(back.searchParams.get('code'));
  assert.equal(back.searchParams.get('iss'), 'https://gym.example/gym');
});

test('registering clients and starting sign-ins without a session have a budget per address', async t => {
  const api = await start(t, { MCP: 'on', OAUTH_ANON_PER_MIN: '5' });
  const reg = () => fetch(api + '/api/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }) });
  for (let i = 0; i < 5; i++) assert.equal((await reg()).status, 201);
  const over = await reg();
  assert.equal(over.status, 429);
  assert.ok(+over.headers.get('retry-after') > 0);
  const az = await fetch(api + '/api/oauth/authorize?client_id=ogc_x', { redirect: 'manual' });
  assert.equal(az.status, 429, 'the same budget');
});
