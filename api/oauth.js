/* OAuth 2.1 for the MCP connector (coach-146, made to the letter of Claude's and ChatGPT's connector
 * requirements in sub-connect-146).
 *
 * Claude and ChatGPT add a custom connector by URL and then sign in with OAuth; neither lets a
 * person paste a header on most plans. So openGym is its own small authorization server, and what
 * it issues is nothing new: the same scoped `ogt_` token Settings → API tokens makes, created only
 * when the signed-in person approves it on a consent screen, listed and revocable with the others.
 *
 *   discovery   /.well-known/oauth-authorization-server (RFC 8414, also under the OpenID name and
 *               BASE_PATH's path-inserted address) and the protected resource document the mcp
 *               container's 401 points at (RFC 9728)
 *   register    Dynamic Client Registration (RFC 7591): a public client, redirect URIs https or
 *               loopback only, a few hundred at most
 *   CIMD        or no registration at all: a client_id that is an https URL is the client's own
 *               metadata document (MCP 2025-11-25, Claude and ChatGPT prefer it), fetched once an
 *               hour from the public internet only
 *   authorize   checks the client, the redirect URI (exact match, loopback on any port), the PKCE
 *               S256 challenge and the resource, parks the request for ten minutes, and sends the
 *               browser to the app's consent page
 *   approve     the session route the consent page calls: makes the token, returns the redirect
 *               (with `iss`, RFC 9207, which ChatGPT checks)
 *   token       a one-time code, ten minutes, bound to client, redirect URI and challenge, for the
 *               token. A client that asked for `offline_access` (Claude does when it is listed) or
 *               registered the refresh_token grant gets a refresh token: then the access token
 *               lives a day, and each refresh rotates both (OAuth 2.1 for public clients). A
 *               refresh token used twice ends the connection. The connection itself still ends
 *               when the person chose on the consent screen.
 *   revoke      RFC 7009: an assistant that disconnects can end its token.
 *
 * Pure functions over a `db` and two in-memory maps; server.js mounts the routes. */
import crypto from 'node:crypto';
import https from 'node:https';
import { TOKEN_CATEGORIES, TOKEN_LEVELS, TOKEN_DAYS, cleanTokenScopes, rotateToken, sameHash } from './tokens.js';

export const CLIENTS_MAX = 300;
export const REQUEST_TTL_MS = 10 * 60000;
export const CODE_TTL_MS = 10 * 60000;
/** How long a connector's access token lives when it has a refresh token. */
export const ACCESS_TTL_MS = 24 * 3600000;
/** A refresh answer that got lost on the way may be retried with the old refresh token this long. */
export const REFRESH_GRACE_MS = 60000;
const CLIENT_IDLE_MS = 90 * 86400000;
const REFRESH_PREFIX = 'ogr_';
const rnd = n => crypto.randomBytes(n).toString('base64url');
const b64sha = v => crypto.createHash('sha256').update(v).digest('base64url');
const rsha = v => crypto.createHash('sha256').update('opengym-refresh:' + v).digest('hex');

/** Scope words for the connector, one per category and level: "workouts:view", "plans:apply". */
export const SCOPES = TOKEN_CATEGORIES.flatMap(c => (c.max === 'apply' ? [`${c.id}:view`, `${c.id}:apply`] : [`${c.id}:view`]));
/** What the 401 asks for when the assistant asks for nothing: enough to read the training and plan it. */
export const DEFAULT_SCOPE = 'workouts:view plans:apply bodyweight:view';
/** A scope string as a token scope map (unknown words ignored, the highest level per category). */
export function scopesFrom(str) {
  const out = {};
  for (const w of String(str || '').split(/\s+/)) {
    const [cat, lv] = w.split(':');
    if (!TOKEN_CATEGORIES.some(c => c.id === cat) || !TOKEN_LEVELS.includes(lv)) continue;
    if (TOKEN_LEVELS.indexOf(lv) > TOKEN_LEVELS.indexOf(out[cat] || 'off')) out[cat] = lv;
  }
  return cleanTokenScopes(out);
}
export const scopeString = scopes => Object.entries(scopes || {}).filter(([, v]) => v && v !== 'off').map(([k, v]) => `${k}:${v}`).join(' ');

export function authServerMetadata(issuer) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    // Listed so Claude adds it and gets a refresh token (its connector docs).
    scopes_supported: [...SCOPES, 'offline_access'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: 'https://github.com/DuarteSantos8/openGym/blob/main/docs/MCP_REMOTE.md'
  };
}
/** `issuer` is ORIGIN plus BASE_PATH; the resource is the address the person pastes. */
export function protectedResourceMetadata(issuer, mcpPath = '/mcp') {
  return { resource: issuer + mcpPath, authorization_servers: [issuer], scopes_supported: SCOPES, bearer_methods_supported: ['header'], resource_name: 'openGym', resource_documentation: 'https://github.com/DuarteSantos8/openGym/blob/main/docs/MCP_REMOTE.md' };
}

/* A redirect URI a client may register: https anywhere, or http on the loopback (Claude Code,
   RFC 8252), never with a fragment or credentials. */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];
export function redirectOk(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.hash || u.username || u.password || String(raw).length > 500) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && LOOPBACK.includes(u.hostname);
}
// A loopback redirect matches whatever port it comes back on (RFC 8252 7.3), localhost too since
// Claude Code declares both; everything else exactly.
function sameRedirect(registered, asked) {
  if (registered === asked) return true;
  try {
    const a = new URL(registered), b = new URL(asked);
    return a.protocol === 'http:' && LOOPBACK.includes(a.hostname)
      && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search && b.protocol === 'http:';
  } catch { return false; }
}

/** Which assistant a client is, from where it sends people back (or its CIMD address): the
 *  Settings screen says "Connected via Claude". */
export function assistantOf(redirect, name = '') {
  let host = '';
  try { host = new URL(redirect).hostname.toLowerCase(); } catch { /* none */ }
  const under = d => host === d || host.endsWith('.' + d);
  if (under('claude.ai') || under('claude.com') || under('anthropic.com')) return 'claude';
  if (under('chatgpt.com') || under('openai.com')) return 'chatgpt';
  if (under('gemini.google.com') || under('google.com') || under('googleusercontent.com')) return 'gemini';
  // A loopback client says who it is only by name: Claude Code, Codex, Gemini CLI.
  if (LOOPBACK.includes(host) || LOOPBACK.includes('[' + host + ']')) {
    if (/claude/i.test(name)) return 'claude';
    if (/chatgpt|codex|openai/i.test(name)) return 'chatgpt';
    if (/gemini/i.test(name)) return 'gemini';
  }
  return 'other';
}

const GRANTS = ['authorization_code', 'refresh_token'];
const cleanName = (v, fallback) => String(v || '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, 60) || fallback;

/** RFC 7591 registration. { status, body } */
export function registerClient(db, body, now = Date.now()) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter(u => typeof u === 'string') : [];
  if (!uris.length || uris.length > 5 || !uris.every(redirectOk)) return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'redirect_uris: 1-5 https addresses (or http on localhost)' } };
  const name = cleanName(body?.client_name, 'MCP client');
  const grants = Array.isArray(body?.grant_types) ? GRANTS.filter(g => body.grant_types.includes(g)) : ['authorization_code'];
  if (!grants.includes('authorization_code')) grants.unshift('authorization_code');
  db.oauthClients = (db.oauthClients || []).filter(c => c && now - (c.used || c.created) < CLIENT_IDLE_MS);
  if (db.oauthClients.length >= CLIENTS_MAX) db.oauthClients.sort((a, b) => (a.used || a.created) - (b.used || b.created)).shift();
  const client = { id: 'ogc_' + rnd(18), name, redirects: uris, grants, created: now, used: null };
  db.oauthClients.push(client);
  // A client that asked for a secret gets told it is public (RFC 7591 3.2.1: the server's answer
  // is what counts). Claude and ChatGPT register as public clients anyway.
  return {
    status: 201,
    body: { client_id: client.id, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: grants, response_types: ['code'] }
  };
}
export const clientOf = (db, id) => (db.oauthClients || []).find(c => c && c.id === id) || null;

/* ---------- Client ID Metadata Documents ---------- */

/** Whether a client_id is a metadata document address: https, a path, a host name (no literal address). */
export function isCimdId(id) {
  if (typeof id !== 'string' || id.length > 500 || !id.startsWith('https://')) return false;
  try {
    const u = new URL(id);
    return u.protocol === 'https:' && u.pathname.length > 1 && !u.hash && !u.username && !u.password
      && !u.hostname.startsWith('[') && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) && !/(^|\.)localhost$/i.test(u.hostname);
  } catch { return false; }
}
/** A fetched document, checked: { ok, client } or { ok:false, error }. */
export function cimdClient(id, doc) {
  if (!doc || typeof doc !== 'object' || doc.client_id !== id) return { ok: false, error: 'the client metadata document does not name itself as its client_id' };
  const uris = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.filter(u => typeof u === 'string') : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectOk)) return { ok: false, error: 'the client metadata document lists no usable redirect_uris' };
  const method = doc.token_endpoint_auth_method || 'none';
  if (method !== 'none') return { ok: false, error: 'only public clients (token_endpoint_auth_method none) are supported' };
  const grants = Array.isArray(doc.grant_types) ? GRANTS.filter(g => doc.grant_types.includes(g)) : ['authorization_code'];
  let name = cleanName(doc.client_name, '');
  if (!name) { try { name = new URL(id).hostname; } catch { name = 'MCP client'; } }
  return { ok: true, client: { id, name, redirects: uris, grants, cimd: true } };
}

const cimdCache = new Map();
const CIMD_TTL_MS = 3600000;
/**
 * The client a CIMD client_id stands for. `fetchDoc(url)` resolves to the parsed JSON (tests pass
 * their own); the default goes out over https with `lookup` (server.js passes the outbound guard,
 * so a document address on a private network is never fetched), five seconds, 5 KB, no redirects.
 */
export async function resolveCimd(id, { fetchDoc, lookup, now = Date.now() } = {}) {
  if (!isCimdId(id)) return { ok: false, error: 'not a client metadata document address' };
  const hit = cimdCache.get(id);
  if (hit && now - hit.at < CIMD_TTL_MS) return hit.r;
  let doc;
  try { doc = await (fetchDoc || (u => getJson(u, lookup)))(id); }
  catch (e) { return { ok: false, error: 'the client metadata document could not be fetched: ' + (e?.message || e) }; }
  const r = cimdClient(id, doc);
  if (cimdCache.size > 200) cimdCache.delete(cimdCache.keys().next().value);
  cimdCache.set(id, { r, at: now });
  return r;
}
export const _clearCimdCache = () => cimdCache.clear();

function getJson(url, lookup) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', 'User-Agent': 'openGym' }, timeout: 5000, ...(lookup ? { lookup } : {}) }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let size = 0; const chunks = [];
      res.on('data', d => { size += d.length; if (size > 5120) { req.destroy(new Error('larger than 5 KB')); return; } chunks.push(d); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('not JSON')); } });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

/* ---------- authorize, consent ---------- */

/** Whether a `resource` names this server's MCP endpoint (RFC 8707). Absent is fine. */
export function resourceOk(asked, expected) {
  if (!asked || !expected) return true;
  const norm = s => String(s).replace(/\/+$/, '').toLowerCase();
  return norm(asked) === norm(expected);
}

/**
 * The authorize request, checked. { ok, request } with the parked request, or { ok:false, error, redirect? }.
 * `opts.client` is a CIMD client already resolved; `opts.issuer` goes back as `iss`; `opts.resource`
 * is the MCP address a `resource` parameter has to name.
 */
export function startAuthorize(db, q, pending, now = Date.now(), opts = {}) {
  const client = opts.client || clientOf(db, q.get('client_id'));
  const redirect = q.get('redirect_uri') || (client && client.redirects.length === 1 ? client.redirects[0] : '');
  // Without a known client and a matching redirect nothing may be sent anywhere: the error is shown here.
  if (!client) return { ok: false, error: 'unknown client_id: register the client first' };
  if (!client.redirects.some(r => sameRedirect(r, redirect))) return { ok: false, error: 'redirect_uri is not one this client registered' };
  const back = (error, description) => ({ ok: false, error: description, redirect: withQuery(redirect, { error, error_description: description, state: q.get('state') || undefined, iss: opts.issuer || undefined }) });
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'response_type must be code');
  const challenge = q.get('code_challenge') || '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back('invalid_request', 'PKCE with code_challenge_method S256 is required');
  if (!resourceOk(q.get('resource'), opts.resource)) return back('invalid_target', 'resource is not this openGym\'s MCP address');
  for (const [k, v] of pending) if (now - v.at > REQUEST_TTL_MS) pending.delete(k);
  if (pending.size > 1000) pending.delete(pending.keys().next().value);
  const id = rnd(18);
  const words = String(q.get('scope') || '').split(/\s+/);
  const refresh = words.includes('offline_access') || (client.grants || []).includes('refresh_token');
  const request = {
    id, clientId: client.id, clientName: client.name, redirect, challenge, state: q.get('state') || null,
    scopes: scopesFrom(q.get('scope')), resource: q.get('resource') || null, refresh, issuer: opts.issuer || null,
    assistant: assistantOf(client.cimd ? client.id : redirect, client.name), at: now
  };
  pending.set(id, request);
  return { ok: true, request };
}

/** What the consent page shows for a parked request, or null. */
export function describeRequest(pending, id, now = Date.now()) {
  const r = pending.get(id);
  if (!r || now - r.at > REQUEST_TTL_MS) return null;
  let host = '', loopback = false;
  try { const u = new URL(r.redirect); host = u.host; loopback = LOOPBACK.includes(u.hostname); } catch { /* checked at authorize */ }
  return { id, client: r.clientName, assistant: r.assistant, redirectHost: host, loopback, scopes: r.scopes, categories: TOKEN_CATEGORIES, days: TOKEN_DAYS };
}

/**
 * The person said yes: the code goes back on the redirect. `makeToken(name, scopes, days, connector)`
 * makes the ogt_ token and returns { value, scopes, expiresIn, row }.
 */
export function approve(pending, codes, id, { scopes, days }, makeToken, now = Date.now()) {
  const r = pending.get(id);
  if (!r || now - r.at > REQUEST_TTL_MS) return { ok: false, status: 400, error: 'this sign-in has expired; start it again from the assistant' };
  pending.delete(id);
  const connector = { assistant: r.assistant, client: r.clientId, name: r.clientName };
  const token = makeToken(`${r.clientName} (connector)`, scopes, days, connector);
  let refreshToken = null, expiresIn = token.expiresIn;
  if (token.row) token.row.connector = { ...(token.row.connector || {}), ...connector };
  if (r.refresh && token.row) {
    refreshToken = REFRESH_PREFIX + rnd(32);
    token.row.connector.rh = rsha(refreshToken);
    token.row.aexp = Math.min(now + ACCESS_TTL_MS, token.row.exp || Infinity);
    expiresIn = Math.round((token.row.aexp - now) / 1000);
  }
  for (const [k, v] of codes) if (now - v.at > CODE_TTL_MS) codes.delete(k);
  const code = rnd(32);
  codes.set(code, { token: token.value, refresh: refreshToken, scope: scopeString(token.scopes), expiresIn, clientId: r.clientId, redirect: r.redirect, challenge: r.challenge, at: now });
  return { ok: true, redirect: withQuery(r.redirect, { code, state: r.state || undefined, iss: r.issuer || undefined }) };
}
/** The person said no. */
export function deny(pending, id) {
  const r = pending.get(id);
  if (!r) return { ok: false, status: 400, error: 'this sign-in has expired' };
  pending.delete(id);
  return { ok: true, redirect: withQuery(r.redirect, { error: 'access_denied', state: r.state || undefined, iss: r.issuer || undefined }) };
}

/* ---------- the token endpoint ---------- */

/** client_id from `Authorization: Basic` when the form has none (a client that registered as
 *  public but authenticates the way its library does by default). */
export function basicClientId(header) {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(String(header || '').trim());
  if (!m) return null;
  try { const s = Buffer.from(m[1], 'base64').toString('utf8'); const i = s.indexOf(':'); return decodeURIComponent(i < 0 ? s : s.slice(0, i)) || null; } catch { return null; }
}

/** The token endpoint for `grant_type=authorization_code` (form fields as a Map-like `get`). { status, body } */
export function exchange(codes, form, db, now = Date.now()) {
  const bad = (error, desc) => ({ status: 400, body: { error, error_description: desc } });
  if (form.get('grant_type') !== 'authorization_code') return bad('unsupported_grant_type', 'only authorization_code and refresh_token');
  const code = form.get('code') || '';
  const c = codes.get(code);
  // Single use whatever happens next: a code that was tried is gone.
  codes.delete(code);
  if (!c || now - c.at > CODE_TTL_MS) return bad('invalid_grant', 'the code is unknown, used or expired');
  if (form.get('client_id') && form.get('client_id') !== c.clientId) return bad('invalid_grant', 'the code was issued to another client');
  if (form.get('redirect_uri') && !sameRedirect(c.redirect, form.get('redirect_uri'))) return bad('invalid_grant', 'redirect_uri does not match');
  const verifier = form.get('code_verifier') || '';
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || b64sha(verifier) !== c.challenge) return bad('invalid_grant', 'code_verifier does not match the challenge');
  const client = clientOf(db, c.clientId);
  if (client) client.used = now;
  return { status: 200, body: { access_token: c.token, token_type: 'Bearer', scope: c.scope, ...(c.expiresIn ? { expires_in: c.expiresIn } : {}), ...(c.refresh ? { refresh_token: c.refresh } : {}) } };
}

/**
 * `grant_type=refresh_token`: a new access token and a new refresh token on the same token row,
 * the old pair dead. `ownerOf(userId)` is the account, or null when it may not sign in.
 * { status, body, changed } — `changed` says db needs saving.
 */
export function refresh(db, form, ownerOf, now = Date.now()) {
  const bad = (desc, changed = false) => ({ status: 400, body: { error: 'invalid_grant', error_description: desc }, changed });
  const value = form.get('refresh_token') || '';
  if (!value.startsWith(REFRESH_PREFIX) || value.length !== REFRESH_PREFIX.length + 43) return bad('the refresh token is unknown');
  const h = rsha(value);
  let row = null, stale = false;
  for (const r of db.apiTokens || []) {
    if (!r?.connector) continue;
    if (sameHash(r.connector.rh, h)) { row = r; stale = false; }
    else if (sameHash(r.connector.prh, h)) { row = r; stale = true; }
  }
  if (!row) return bad('the refresh token is unknown, used or revoked');
  if (form.get('client_id') && form.get('client_id') !== row.connector.client) return bad('the refresh token was issued to another client');
  const owner = ownerOf(row.userId);
  if ((row.exp && row.exp <= now) || !owner || owner.disabled || (owner.sv || 0) !== row.sv) return bad('the connection has ended; connect the assistant again');
  // A refresh token used again after its replacement went out: either the answer got lost (a
  // retry within the grace minute, answered with a fresh pair), or somebody else holds a copy,
  // and then the connection ends for both.
  if (stale && now - (row.connector.rotated || 0) > REFRESH_GRACE_MS) {
    db.apiTokens = db.apiTokens.filter(r => r !== row);
    return bad('this refresh token was already used, so the connection was ended for safety; connect the assistant again', true);
  }
  const access = rotateToken(row);
  const next = REFRESH_PREFIX + rnd(32);
  row.connector = { ...row.connector, prh: stale ? row.connector.prh : row.connector.rh, rh: rsha(next), rotated: now };
  row.aexp = Math.min(now + ACCESS_TTL_MS, row.exp || Infinity);
  const client = clientOf(db, row.connector.client);
  if (client) client.used = now;
  return { status: 200, changed: true, body: { access_token: access, token_type: 'Bearer', scope: scopeString(row.scopes), expires_in: Math.round((row.aexp - now) / 1000), refresh_token: next } };
}

/** RFC 7009: the connector's token row a refresh token (or, via `findAccess`, an access token) belongs to. */
export function revocable(db, value, findAccess) {
  if (typeof value !== 'string') return null;
  if (value.startsWith(REFRESH_PREFIX)) {
    const h = rsha(value);
    return (db.apiTokens || []).find(r => r?.connector && (sameHash(r.connector.rh, h) || sameHash(r.connector.prh, h))) || null;
  }
  const row = findAccess(value);
  return row && row.connector ? row : null;
}

function withQuery(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}
