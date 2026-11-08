/* The MCP connector's OAuth (oauth.js): registration, authorize, consent, the one-time code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as oauth from '../oauth.js';

const pkce = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };
const q = o => new URLSearchParams(o);
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

test('metadata names the endpoints, S256 and public clients; the resource is the mcp address', () => {
  const m = oauth.authServerMetadata('https://gym.example');
  assert.equal(m.token_endpoint, 'https://gym.example/api/oauth/token');
  assert.deepEqual(m.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(m.token_endpoint_auth_methods_supported, ['none']);
  assert.deepEqual(oauth.protectedResourceMetadata('https://gym.example').authorization_servers, ['https://gym.example']);
  assert.equal(oauth.protectedResourceMetadata('https://gym.example').resource, 'https://gym.example/mcp');
});

test('registration takes https and loopback redirects only, and caps the number of clients', () => {
  const db = {};
  assert.equal(oauth.registerClient(db, { redirect_uris: ['http://evil.example/cb'] }).status, 400);
  assert.equal(oauth.registerClient(db, { redirect_uris: ['https://x.example/cb#frag'] }).status, 400);
  assert.equal(oauth.registerClient(db, { redirect_uris: [] }).status, 400);
  const ok = oauth.registerClient(db, { client_name: 'Claude', redirect_uris: [CLAUDE, 'http://localhost/callback'] });
  assert.equal(ok.status, 201);
  assert.match(ok.body.client_id, /^ogc_/);
  for (let i = 0; i < oauth.CLIENTS_MAX + 5; i++) oauth.registerClient(db, { redirect_uris: [CLAUDE] }, Date.now() + i);
  assert.equal(db.oauthClients.length, oauth.CLIENTS_MAX);
});

test('authorize: unknown client or redirect is answered here, a missing S256 challenge goes back with an error', () => {
  const db = {};
  const id = oauth.registerClient(db, { client_name: 'Claude', redirect_uris: [CLAUDE] }).body.client_id;
  const pending = new Map();
  assert.equal(oauth.startAuthorize(db, q({ client_id: 'nope', redirect_uri: CLAUDE }), pending).redirect, undefined);
  assert.equal(oauth.startAuthorize(db, q({ client_id: id, redirect_uri: 'https://elsewhere.example/cb' }), pending).redirect, undefined);
  const plain = oauth.startAuthorize(db, q({ client_id: id, redirect_uri: CLAUDE, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'plain', state: 's' }), pending);
  assert.equal(plain.ok, false);
  assert.match(plain.redirect, /error=invalid_request/);
  assert.match(plain.redirect, /state=s/);
  assert.equal(pending.size, 0);
});

test('the whole flow: authorize, consent, a single-use code bound to the verifier, the token back', () => {
  const db = {};
  const id = oauth.registerClient(db, { client_name: 'Claude', redirect_uris: [CLAUDE] }).body.client_id;
  const pending = new Map(), codes = new Map();
  const { v, c } = pkce();
  const a = oauth.startAuthorize(db, q({ client_id: id, redirect_uri: CLAUDE, response_type: 'code', code_challenge: c, code_challenge_method: 'S256', state: 'st8', scope: 'workouts:view plans:apply junk' }), pending);
  assert.equal(a.ok, true);
  const shown = oauth.describeRequest(pending, a.request.id);
  assert.equal(shown.client, 'Claude');
  assert.equal(shown.redirectHost, 'claude.ai');
  assert.deepEqual(shown.scopes, { workouts: 'view', plans: 'apply', bodyweight: 'off', measurements: 'off', notes: 'off' });
  let made = null;
  const ok = oauth.approve(pending, codes, a.request.id, { scopes: { workouts: 'view' }, days: 90 }, (name, scopes, days) => { made = { name, scopes, days }; return { value: 'ogt_' + 'a'.repeat(43), scopes: { workouts: 'view' }, expiresIn: 7776000 }; });
  assert.equal(made.name, 'Claude (connector)');
  const back = new URL(ok.redirect);
  assert.equal(back.origin + back.pathname, CLAUDE);
  assert.equal(back.searchParams.get('state'), 'st8');
  const code = back.searchParams.get('code');
  assert.equal(oauth.approve(pending, codes, a.request.id, {}, () => { throw new Error('twice'); }).ok, false, 'a request is approved once');
  const wrong = oauth.exchange(codes, q({ grant_type: 'authorization_code', code, code_verifier: pkce().v, client_id: id, redirect_uri: CLAUDE }), db);
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'invalid_grant');
  const again = oauth.exchange(codes, q({ grant_type: 'authorization_code', code, code_verifier: v, client_id: id, redirect_uri: CLAUDE }), db);
  assert.equal(again.status, 400, 'a code that was tried is gone, even after a wrong verifier');
});

test('a good exchange gives the ogt_ token as a Bearer, with its scope and lifetime', () => {
  const db = {};
  const id = oauth.registerClient(db, { redirect_uris: ['http://127.0.0.1/callback'] }).body.client_id;
  const pending = new Map(), codes = new Map();
  const { v, c } = pkce();
  const a = oauth.startAuthorize(db, q({ client_id: id, redirect_uri: 'http://127.0.0.1:54321/callback', response_type: 'code', code_challenge: c, code_challenge_method: 'S256' }), pending);
  assert.equal(a.ok, true, 'a loopback redirect matches on any port');
  const r = oauth.approve(pending, codes, a.request.id, {}, () => ({ value: 'ogt_tok', scopes: { workouts: 'view', plans: 'apply' }, expiresIn: null }));
  const code = new URL(r.redirect).searchParams.get('code');
  const t = oauth.exchange(codes, q({ grant_type: 'authorization_code', code, code_verifier: v, redirect_uri: 'http://127.0.0.1:54321/callback' }), db);
  assert.deepEqual(t, { status: 200, body: { access_token: 'ogt_tok', token_type: 'Bearer', scope: 'workouts:view plans:apply' } });
  assert.ok(db.oauthClients[0].used);
  assert.equal(oauth.exchange(codes, q({ grant_type: 'client_credentials' }), db).body.error, 'unsupported_grant_type');
});

test('deny sends access_denied back; an expired request cannot be approved', () => {
  const db = {};
  const id = oauth.registerClient(db, { redirect_uris: [CLAUDE] }).body.client_id;
  const pending = new Map();
  const { c } = pkce();
  const a = oauth.startAuthorize(db, q({ client_id: id, redirect_uri: CLAUDE, response_type: 'code', code_challenge: c, code_challenge_method: 'S256', state: 'z' }), pending, 1000);
  assert.match(oauth.deny(pending, a.request.id).redirect, /error=access_denied&state=z/);
  const b = oauth.startAuthorize(db, q({ client_id: id, redirect_uri: CLAUDE, response_type: 'code', code_challenge: c, code_challenge_method: 'S256' }), pending, 1000);
  assert.equal(oauth.approve(pending, new Map(), b.request.id, {}, () => ({}), 1000 + oauth.REQUEST_TTL_MS + 1).ok, false);
});
