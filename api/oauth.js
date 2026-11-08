/* OAuth 2.1 for the MCP connector (coach-146, the "Not yet" of docs/MCP_REMOTE.md).
 *
 * Claude and ChatGPT add a custom connector by URL and then sign in with OAuth; neither lets a
 * person paste a header on most plans. So openGym is its own small authorization server, and what
 * it issues is nothing new: the same scoped `ogt_` token Settings → API tokens makes, created only
 * when the signed-in person approves it on a consent screen, listed and revocable with the others.
 *
 *   discovery   /.well-known/oauth-authorization-server (RFC 8414) and the protected resource
 *               document the mcp container's 401 points at (RFC 9728)
 *   register    Dynamic Client Registration (RFC 7591): a public client, redirect URIs https or
 *               loopback only, a few hundred at most
 *   authorize   checks the client, the redirect URI (exact match) and the PKCE S256 challenge,
 *               parks the request for ten minutes, and sends the browser to the app's consent page
 *   approve     the session route the consent page calls: makes the token, returns the redirect
 *   token       a one-time code, ten minutes, bound to client, redirect URI and challenge, for the
 *               token. No refresh token: the token lives as long as the person chose.
 *
 * Pure functions over a `db` and two in-memory maps; server.js mounts the routes. */
import crypto from 'node:crypto';
import { TOKEN_CATEGORIES, TOKEN_LEVELS, TOKEN_DAYS, cleanTokenScopes } from './tokens.js';

export const CLIENTS_MAX = 300;
export const REQUEST_TTL_MS = 10 * 60000;
export const CODE_TTL_MS = 10 * 60000;
const CLIENT_IDLE_MS = 90 * 86400000;
const rnd = n => crypto.randomBytes(n).toString('base64url');
const b64sha = v => crypto.createHash('sha256').update(v).digest('base64url');

/** Scope words for the connector, one per category and level: "workouts:view", "plans:apply". */
export const SCOPES = TOKEN_CATEGORIES.flatMap(c => (c.max === 'apply' ? [`${c.id}:view`, `${c.id}:apply`] : [`${c.id}:view`]));
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

export function authServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SCOPES
  };
}
export function protectedResourceMetadata(origin, mcpPath = '/mcp') {
  return { resource: origin + mcpPath, authorization_servers: [origin], scopes_supported: SCOPES, bearer_methods_supported: ['header'], resource_name: 'openGym' };
}

/* A redirect URI a client may register: https anywhere, or http on the loopback (Claude Code,
   RFC 8252), never with a fragment or credentials. */
export function redirectOk(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.hash || u.username || u.password || String(raw).length > 500) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}
// A loopback redirect matches whatever port it comes back on (RFC 8252 7.3); everything else exactly.
function sameRedirect(registered, asked) {
  if (registered === asked) return true;
  try {
    const a = new URL(registered), b = new URL(asked);
    return a.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(a.hostname)
      && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search && b.protocol === 'http:';
  } catch { return false; }
}

/** RFC 7591 registration. { status, body } */
export function registerClient(db, body, now = Date.now()) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter(u => typeof u === 'string') : [];
  if (!uris.length || uris.length > 5 || !uris.every(redirectOk)) return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'redirect_uris: 1-5 https addresses (or http on localhost)' } };
  const name = String(body?.client_name || 'MCP client').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || 'MCP client';
  db.oauthClients = (db.oauthClients || []).filter(c => c && now - (c.used || c.created) < CLIENT_IDLE_MS);
  if (db.oauthClients.length >= CLIENTS_MAX) db.oauthClients.sort((a, b) => (a.used || a.created) - (b.used || b.created)).shift();
  const client = { id: 'ogc_' + rnd(18), name, redirects: uris, created: now, used: null };
  db.oauthClients.push(client);
  return {
    status: 201,
    body: { client_id: client.id, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }
  };
}
export const clientOf = (db, id) => (db.oauthClients || []).find(c => c && c.id === id) || null;

/** The authorize request, checked. { ok, request } with the parked request, or { ok:false, error, redirect? }. */
export function startAuthorize(db, q, pending, now = Date.now()) {
  const client = clientOf(db, q.get('client_id'));
  const redirect = q.get('redirect_uri') || (client && client.redirects.length === 1 ? client.redirects[0] : '');
  // Without a known client and a matching redirect nothing may be sent anywhere: the error is shown here.
  if (!client) return { ok: false, error: 'unknown client_id: register the client first' };
  if (!client.redirects.some(r => sameRedirect(r, redirect))) return { ok: false, error: 'redirect_uri is not one this client registered' };
  const back = (error, description) => ({ ok: false, error: description, redirect: withQuery(redirect, { error, error_description: description, state: q.get('state') || undefined }) });
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'response_type must be code');
  const challenge = q.get('code_challenge') || '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back('invalid_request', 'PKCE with code_challenge_method S256 is required');
  for (const [k, v] of pending) if (now - v.at > REQUEST_TTL_MS) pending.delete(k);
  if (pending.size > 1000) pending.delete(pending.keys().next().value);
  const id = rnd(18);
  const request = { id, clientId: client.id, clientName: client.name, redirect, challenge, state: q.get('state') || null, scopes: scopesFrom(q.get('scope')), resource: q.get('resource') || null, at: now };
  pending.set(id, request);
  return { ok: true, request };
}

/** What the consent page shows for a parked request, or null. */
export function describeRequest(pending, id, now = Date.now()) {
  const r = pending.get(id);
  if (!r || now - r.at > REQUEST_TTL_MS) return null;
  let host = '';
  try { host = new URL(r.redirect).host; } catch { /* checked at authorize */ }
  return { id, client: r.clientName, redirectHost: host, scopes: r.scopes, categories: TOKEN_CATEGORIES, days: TOKEN_DAYS };
}

/** The person said yes: the code goes back on the redirect. `makeToken(name, scopes, days)` makes the ogt_ token. */
export function approve(pending, codes, id, { scopes, days }, makeToken, now = Date.now()) {
  const r = pending.get(id);
  if (!r || now - r.at > REQUEST_TTL_MS) return { ok: false, status: 400, error: 'this sign-in has expired; start it again from the assistant' };
  pending.delete(id);
  const token = makeToken(`${r.clientName} (connector)`, scopes, days);
  for (const [k, v] of codes) if (now - v.at > CODE_TTL_MS) codes.delete(k);
  const code = rnd(32);
  codes.set(code, { token: token.value, scope: scopeString(token.scopes), expiresIn: token.expiresIn, clientId: r.clientId, redirect: r.redirect, challenge: r.challenge, at: now });
  return { ok: true, redirect: withQuery(r.redirect, { code, state: r.state || undefined }) };
}
/** The person said no. */
export function deny(pending, id) {
  const r = pending.get(id);
  if (!r) return { ok: false, status: 400, error: 'this sign-in has expired' };
  pending.delete(id);
  return { ok: true, redirect: withQuery(r.redirect, { error: 'access_denied', state: r.state || undefined }) };
}

/** The token endpoint (form fields as a Map-like `get`). { status, body } */
export function exchange(codes, form, db, now = Date.now()) {
  const bad = (error, desc) => ({ status: 400, body: { error, error_description: desc } });
  if (form.get('grant_type') !== 'authorization_code') return bad('unsupported_grant_type', 'only authorization_code');
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
  return { status: 200, body: { access_token: c.token, token_type: 'Bearer', scope: c.scope, ...(c.expiresIn ? { expires_in: c.expiresIn } : {}) } };
}

function withQuery(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}
