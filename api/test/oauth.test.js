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

/* ---------- sub-connect-146: what Claude's and ChatGPT's connector clients need ---------- */
const ROW = (over = {}) => ({ id: 't_1', userId: 'u1', sv: 0, h: 'x'.repeat(64), hint: 'abc', name: 'Claude (connector)', scopes: { workouts: 'view', plans: 'apply', bodyweight: 'off', measurements: 'off', notes: 'off' }, created: 1, exp: null, used: null, ...over });
const owner = () => ({ id: 'u1', sv: 0 });

function connected({ scope = 'workouts:view offline_access', now = 1_000_000, days = 0, grants } = {}) {
  const db = { apiTokens: [] };
  const id = oauth.registerClient(db, { client_name: 'Claude', redirect_uris: [CLAUDE], ...(grants ? { grant_types: grants } : {}) }).body.client_id;
  const pending = new Map(), codes = new Map();
  const { v, c } = pkce();
  const a = oauth.startAuthorize(db, q({ client_id: id, redirect_uri: CLAUDE, response_type: 'code', code_challenge: c, code_challenge_method: 'S256', state: 's', scope }), pending, now, { issuer: 'https://gym.example', resource: 'https://gym.example/mcp' });
  const ok = oauth.approve(pending, codes, a.request.id, {}, (name, scopes, d, connector) => {
    const row = ROW({ exp: days ? now + days * 86400000 : null });
    db.apiTokens.push(row);
    return { value: 'ogt_' + 'a'.repeat(43), scopes: row.scopes, expiresIn: days ? days * 86400 : null, row, connector };
  }, now);
  const back = new URL(ok.redirect);
  const t = oauth.exchange(codes, q({ grant_type: 'authorization_code', code: back.searchParams.get('code'), code_verifier: v, client_id: id, redirect_uri: CLAUDE }), db, now);
  return { db, id, back, t, row: db.apiTokens[0], request: a.request };
}

test('metadata: refresh tokens, offline_access, CIMD, iss and revocation are advertised', () => {
  const m = oauth.authServerMetadata('https://gym.example/gym');
  assert.deepEqual(m.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.ok(m.scopes_supported.includes('offline_access'));
  assert.equal(m.client_id_metadata_document_supported, true);
  assert.equal(m.authorization_response_iss_parameter_supported, true);
  assert.equal(m.revocation_endpoint, 'https://gym.example/gym/api/oauth/revoke');
  assert.equal(oauth.protectedResourceMetadata('https://gym.example/gym').resource, 'https://gym.example/gym/mcp');
});

test('the code comes back with iss (RFC 9207), and the connector knows which assistant it is', () => {
  const { back, row, request } = connected();
  assert.equal(back.searchParams.get('iss'), 'https://gym.example');
  assert.equal(request.assistant, 'claude');
  assert.equal(row.connector.assistant, 'claude');
  assert.equal(row.connector.name, 'Claude');
});

test('offline_access gets a refresh token and a day-long access token; without it the old shape stays', () => {
  const now = 1_000_000;
  const a = connected({ now });
  assert.match(a.t.body.refresh_token, /^ogr_/);
  assert.equal(a.t.body.expires_in, oauth.ACCESS_TTL_MS / 1000);
  assert.equal(a.row.aexp, now + oauth.ACCESS_TTL_MS);
  const b = connected({ scope: 'workouts:view', now });
  assert.equal(b.t.body.refresh_token, undefined);
  assert.equal(b.row.aexp, undefined);
  const c = connected({ scope: 'workouts:view', grants: ['authorization_code', 'refresh_token'], now });
  assert.match(c.t.body.refresh_token, /^ogr_/, 'a client that registered the refresh grant gets one too');
  // A connection that ends in a week never gets an access token past that week.
  const d = connected({ now, days: 7 });
  assert.equal(d.row.aexp, now + oauth.ACCESS_TTL_MS);
});

test('refresh rotates the access and the refresh token; a replayed refresh token ends the connection', () => {
  const now = 1_000_000;
  const { db, id, t, row } = connected({ now });
  const oldHash = row.h;
  const r1 = oauth.refresh(db, q({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: id }), owner, now + 1000);
  assert.equal(r1.status, 200);
  assert.match(r1.body.access_token, /^ogt_/);
  assert.notEqual(row.h, oldHash, 'the old access token stops working');
  assert.notEqual(r1.body.refresh_token, t.body.refresh_token);
  assert.equal(r1.body.scope, 'workouts:view plans:apply');
  // Another client cannot use it.
  assert.equal(oauth.refresh(db, q({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: 'ogc_other' }), owner, now + 2000).body.error, 'invalid_grant');
  // The old one again within the grace minute (a lost answer): a fresh pair, still one row.
  const retry = oauth.refresh(db, q({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token }), owner, now + 5000);
  assert.equal(retry.status, 200);
  assert.equal(db.apiTokens.length, 1);
  // The old one long after: somebody holds a copy, the connection ends.
  const replay = oauth.refresh(db, q({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token }), owner, now + oauth.REFRESH_GRACE_MS + 10000);
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, 'invalid_grant');
  assert.equal(replay.changed, true);
  assert.equal(db.apiTokens.length, 0);
});

test('refresh is refused once the connection ended or the account signed out everywhere', () => {
  const now = 1_000_000;
  const a = connected({ now, days: 7 });
  assert.equal(oauth.refresh(a.db, q({ grant_type: 'refresh_token', refresh_token: a.t.body.refresh_token }), owner, now + 8 * 86400000).body.error, 'invalid_grant');
  const b = connected({ now });
  assert.equal(oauth.refresh(b.db, q({ grant_type: 'refresh_token', refresh_token: b.t.body.refresh_token }), () => ({ id: 'u1', sv: 1 }), now + 1).status, 400);
  assert.equal(oauth.refresh(b.db, q({ grant_type: 'refresh_token', refresh_token: 'ogr_nope' }), owner, now).status, 400);
});

test('a resource that is not this MCP address goes back as invalid_target', () => {
  const db = {};
  const id = oauth.registerClient(db, { redirect_uris: [CLAUDE] }).body.client_id;
  const { c } = pkce();
  const base = { client_id: id, redirect_uri: CLAUDE, response_type: 'code', code_challenge: c, code_challenge_method: 'S256' };
  const opts = { resource: 'https://gym.example/mcp', issuer: 'https://gym.example' };
  assert.equal(oauth.startAuthorize(db, q({ ...base, resource: 'https://gym.example/mcp/' }), new Map(), Date.now(), opts).ok, true);
  const bad = oauth.startAuthorize(db, q({ ...base, resource: 'https://evil.example/mcp' }), new Map(), Date.now(), opts);
  assert.match(bad.redirect, /error=invalid_target/);
  assert.match(bad.redirect, /iss=https/);
});

test('CIMD: the document must name itself, list usable redirects and be a public client', async () => {
  oauth._clearCimdCache();
  const URLID = 'https://claude.ai/oauth/claude-code-client-metadata';
  assert.equal(oauth.isCimdId(URLID), true);
  assert.equal(oauth.isCimdId('https://127.0.0.1/x'), false);
  assert.equal(oauth.isCimdId('https://example.com'), false, 'needs a path');
  assert.equal(oauth.isCimdId('ogc_abc'), false);
  const docs = {
    [URLID]: { client_id: URLID, client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' },
    'https://bad.example/meta': { client_id: 'https://other.example/meta', redirect_uris: [CLAUDE] },
    'https://secret.example/meta': { client_id: 'https://secret.example/meta', redirect_uris: [CLAUDE], token_endpoint_auth_method: 'client_secret_basic' },
  };
  const fetchDoc = async u => { if (!docs[u]) throw new Error('HTTP 404'); return docs[u]; };
  const r = await oauth.resolveCimd(URLID, { fetchDoc });
  assert.equal(r.ok, true);
  assert.equal((await oauth.resolveCimd('https://bad.example/meta', { fetchDoc })).ok, false);
  assert.equal((await oauth.resolveCimd('https://secret.example/meta', { fetchDoc })).ok, false);
  assert.equal((await oauth.resolveCimd('https://gone.example/meta', { fetchDoc })).ok, false);
  // Authorize with it: a loopback redirect on any port, the refresh grant from the document.
  const { c } = pkce();
  const a = oauth.startAuthorize({}, q({ client_id: URLID, redirect_uri: 'http://localhost:4567/callback', response_type: 'code', code_challenge: c, code_challenge_method: 'S256' }), new Map(), Date.now(), { client: r.client });
  assert.equal(a.ok, true);
  assert.equal(a.request.refresh, true);
  assert.equal(a.request.assistant, 'claude');
  assert.equal(oauth.describeRequest(new Map([[a.request.id, a.request]]), a.request.id).loopback, true);
});

test('which assistant: Claude, ChatGPT, Gemini by where they send you back', () => {
  assert.equal(oauth.assistantOf('https://claude.com/api/mcp/auth_callback'), 'claude');
  assert.equal(oauth.assistantOf('https://chatgpt.com/connector_platform_oauth_redirect'), 'chatgpt');
  assert.equal(oauth.assistantOf('https://gemini.google.com/oauth/cb'), 'gemini');
  assert.equal(oauth.assistantOf('http://127.0.0.1:3000/cb', 'Claude Code'), 'claude');
  assert.equal(oauth.assistantOf('https://notclaude.ai/cb'), 'other');
});

test('Basic client authentication is read for its client_id; registration remembers the refresh grant', () => {
  assert.equal(oauth.basicClientId('Basic ' + Buffer.from('ogc_abc:').toString('base64')), 'ogc_abc');
  assert.equal(oauth.basicClientId('Bearer x'), null);
  const r = oauth.registerClient({}, { redirect_uris: [CLAUDE], grant_types: ['refresh_token', 'implicit'], token_endpoint_auth_method: 'client_secret_post' });
  assert.deepEqual(r.body.grant_types, ['authorization_code', 'refresh_token']);
  assert.equal(r.body.token_endpoint_auth_method, 'none');
});

test('revocable finds a connector row by its refresh token, and never a plain API token', () => {
  const { db, t, row } = connected();
  assert.equal(oauth.revocable(db, t.body.refresh_token, () => null), row);
  assert.equal(oauth.revocable(db, 'ogt_x', () => ({ id: 'plain' })), null);
  assert.equal(oauth.revocable(db, 'ogt_x', () => row), row);
});
