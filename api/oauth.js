/* OAuth 2.1 for the MCP endpoint (mcp/src/http.js), so an AI client connects by signing in to the
 * app — passkey or password, whatever the profile uses — instead of carrying a shared secret.
 *
 *   - Clients register themselves (RFC 7591), as MCP clients expect to. Nothing is stored for
 *     that: the client id is the client's name and redirect URIs, signed with the instance's
 *     secret, so an anonymous flood of registrations costs nothing and fills nothing.
 *   - Public clients with PKCE (S256) only. An authorization code lives five minutes in memory
 *     and is good once.
 *   - A grant is one profile's consent to one client: stored in db.json (`oauthGrants`) as
 *     SHA-256s of its access and refresh tokens, never the tokens. The MCP container reads the
 *     same db.json read-only and checks an access token against it (mcp/src/auth.js).
 *   - A grant carries the profile's session version, so "sign out everywhere" ends it like any
 *     session; a disabled or deleted profile ends it too. Refresh tokens rotate.
 *
 * Pure bookkeeping on `db`; the routes, the session and the audit are server.js's. */
import crypto from 'node:crypto';

export const CODE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 90 * 86400000;
const MAX_GRANTS_PER_USER = 20;

// Shared with mcp/src/auth.js — mcp/test/auth.test.js checks the two agree.
export const tokenHash = t => crypto.createHash('sha256').update('opengym-oauth:' + t).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// https anywhere; plain http only back to the client's own machine (RFC 8252 loopback); a
// native app's own scheme (cursor://…). Never a scheme a browser would run or read from.
export function redirectOk(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return !['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:', 'ws:', 'wss:', 'ftp:'].includes(u.protocol);
}

// RFC 7591 body → the client id, or an error string. `sign` is server.js's HMAC signer.
export function registerClient(body, sign) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every(u => typeof u === 'string' && u.length <= 500 && redirectOk(u))) {
    return { error: 'invalid_redirect_uri' };
  }
  const name = (typeof body.client_name === 'string' ? body.client_name : '').trim().slice(0, 80) || 'MCP client';
  return { client_id: sign(Buffer.from(JSON.stringify({ n: name, r: uris })).toString('base64url')), client_name: name, redirect_uris: uris };
}

// The client a signed id stands for, or null. `verify` is server.js's verifySig.
export function clientOf(clientId, verify) {
  const payload = typeof clientId === 'string' && clientId.length < 8000 ? verify(clientId) : null;
  if (!payload) return null;
  try {
    const { n, r } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof n === 'string' && Array.isArray(r) ? { name: n, redirectUris: r } : null;
  } catch { return null; }
}

export const pkceOk = (verifier, challenge) => typeof verifier === 'string' && verifier.length >= 43 && verifier.length <= 128
  && crypto.createHash('sha256').update(verifier).digest('base64url') === challenge;

function prune(db, now) {
  db.oauthGrants = (db.oauthGrants || []).filter(g => g && g.rexp > now);
}

// A new grant for a consent just given → the token response. Over the cap, the least recently
// used grant of that profile goes.
export function issueGrant(db, { user, clientId, clientName }, now = Date.now()) {
  prune(db, now);
  const mine = db.oauthGrants.filter(g => g.uid === user.id).sort((a, b) => a.used - b.used);
  while (mine.length >= MAX_GRANTS_PER_USER) {
    const old = mine.shift();
    db.oauthGrants = db.oauthGrants.filter(g => g !== old);
  }
  const grant = { id: crypto.randomBytes(9).toString('base64url'), uid: user.id, sv: user.sv || 0, clientId, clientName, created: now };
  db.oauthGrants.push(grant);
  return rotate(grant, now);
}

function rotate(grant, now) {
  const access = newToken(), refresh = newToken();
  Object.assign(grant, { ah: tokenHash(access), aexp: now + ACCESS_TTL_MS, rh: tokenHash(refresh), rexp: now + REFRESH_TTL_MS, used: now });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: 'read' };
}

// Whether a grant still stands for a live profile of the same session version.
export function grantUser(db, g) {
  const user = (db.users || []).find(u => u.id === g.uid);
  return user && !user.disabled && (user.sv || 0) === g.sv ? user : null;
}

// refresh_token grant → a new token pair, or null. The old refresh token is spent.
export function refreshGrant(db, refreshToken, clientId, now = Date.now()) {
  prune(db, now);
  const h = typeof refreshToken === 'string' ? tokenHash(refreshToken) : '';
  const g = db.oauthGrants.find(x => x.rh === h && x.clientId === clientId);
  if (!g) return null;
  if (!grantUser(db, g)) { db.oauthGrants = db.oauthGrants.filter(x => x !== g); return null; }
  return rotate(g, now);
}

export function dropGrants(db, uid) {
  db.oauthGrants = (db.oauthGrants || []).filter(g => g.uid !== uid);
}
