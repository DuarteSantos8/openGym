/* ChatGPT plan usage through Sign in with ChatGPT, for open-source apps (preview, behind
 * COACH_CHATGPT_PLAN=on; sub-connect-146).
 *
 * OpenAI documents this for open-source and locally hosted apps
 * (developers.openai.com/siwc/token-sharing-open-source, checked 2026-11-08): the app registers a
 * "user-defined agent" during the sign-in (client_id=dynamic_agent_client, no secret, no partner
 * key), the person approves plan usage, and the access token then pays for Responses API requests
 * from their ChatGPT Plus or Pro plan. A paid or remotely hosted app needs OpenAI's approval
 * first (openai.com/form/sign-in-with-chatgpt-interest), which is why this is off by default and
 * meant for a self-hoster's own instance, where it is "an open-source app on a self-hosted VM"
 * (siwc/token-sharing-open-source/self-hosted-vms).
 *
 * The callback is a loopback address on the computer running the browser. By default the admin
 * pastes the address back into openGym. With the optional listener reachable from that browser,
 * openGym receives the callback directly. The PKCE verifier stays on the server in both cases.
 *
 * Pure functions plus an injected fetch; the admin routes and the adapter use them. */
import crypto from 'node:crypto';

export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize';
export const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token';
export const JWKS_URL = 'https://auth.openai.com/.well-known/jwks.json';
export const OIDC_CONFIG_URL = 'https://auth.openai.com/.well-known/openid-configuration';
export const RESOURCE = 'https://api.openai.com/v1';
export const REDIRECT_URI = 'http://127.0.0.1:1455/auth/callback';
export const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
export const AGENT_NAME = 'openGym';
export const USAGE_URL = 'https://chatgpt.com/settings/usage';
export const PENDING_TTL_MS = 15 * 60000;
/** Refresh this long before the access token runs out. */
export const REFRESH_EARLY_MS = 5 * 60000;

export const on = (env = process.env) => /^(1|true|yes|on)$/i.test(env.COACH_CHATGPT_PLAN || '');

const b64 = buf => Buffer.from(buf).toString('base64url');
/** A host id the docs accept: urn:uuid:<v4>, made once per instance and kept. */
export const newHostId = () => 'urn:uuid:' + crypto.randomUUID();

/**
 * The browser address for a sign-in, and what has to be kept to finish it. A saved `clientId`
 * (an earlier registration of this instance) reauthorizes instead of registering again.
 */
export function startSignIn({ hostId, clientId = null, idTokenHint = null } = {}) {
  if (!hostId) throw new Error('a host id is needed');
  const state = b64(crypto.randomBytes(24));
  const nonce = b64(crypto.randomBytes(24));
  const verifier = b64(crypto.randomBytes(48));
  const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({
    client_id: clientId || 'dynamic_agent_client',
    ...(clientId ? {} : { agent_name_hint: AGENT_NAME }),
    ext_agent_host_id: hostId,
    ...(idTokenHint ? { id_token_hint: idTokenHint } : {}),
    response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPE, resource: RESOURCE,
    state, nonce, code_challenge_method: 'S256', code_challenge: challenge
  });
  return { url: `${AUTHORIZE_URL}?${q}`, pending: { state, nonce, verifier, clientId, hostId, at: Date.now() } };
}

/**
 * The address the browser ended on, pasted back: { ok, code, clientId } or { ok:false, error }.
 * Takes the whole URL or just its query.
 */
export function parseCallback(raw, pending, now = Date.now()) {
  if (!pending || now - pending.at > PENDING_TTL_MS) return { ok: false, error: 'this sign-in has expired; start it again' };
  const s = String(raw || '').trim();
  let q;
  try { q = new URL(s).searchParams; } catch { q = new URLSearchParams(s.replace(/^[^?]*\?/, '')); }
  if (q.get('state') !== pending.state) return { ok: false, error: 'that address belongs to another sign-in; start again and paste the newest one' };
  if (q.get('error')) return { ok: false, error: q.get('error') === 'access_denied' ? 'ChatGPT plan use was not allowed' : 'ChatGPT said: ' + q.get('error').slice(0, 80) };
  const code = q.get('code');
  if (!code) return { ok: false, error: 'no code in that address' };
  const issued = q.get('client_id');
  // A new registration hands back its client id; a reauthorization keeps the one it was started with.
  if (pending.clientId && issued && issued !== pending.clientId) return { ok: false, error: 'the sign-in came back for another registration' };
  const clientId = pending.clientId || issued;
  if (!clientId || clientId === 'dynamic_agent_client') return { ok: false, error: 'the registration did not finish (no client id came back)' };
  return { ok: true, code, clientId };
}

async function postForm(fetchImpl, url, fields) {
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(fields).toString() });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}

/** The code for tokens. { ok, tokens } or { ok:false, error } */
export async function exchangeCode(fetchImpl, pending, code, clientId) {
  const r = await postForm(fetchImpl, TOKEN_URL, { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: REDIRECT_URI, resource: RESOURCE });
  if (r.status !== 200 || !r.data?.access_token) return { ok: false, error: `the token exchange failed (${r.status}${r.data?.error ? ' ' + r.data.error : ''})` };
  return { ok: true, tokens: r.data };
}

/* ---------- the ID token (RS256 against OpenAI's JWKS) ---------- */

const part = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
/** { ok, claims } or { ok:false, error }. `jwks` is the parsed key set. */
export function verifyIdToken(idToken, jwks, { audience, nonce, now = Date.now() }) {
  const bits = String(idToken || '').split('.');
  if (bits.length !== 3) return { ok: false, error: 'the ID token is malformed' };
  let header, claims;
  try { header = part(bits[0]); claims = part(bits[1]); } catch { return { ok: false, error: 'the ID token is malformed' }; }
  if (header.alg !== 'RS256') return { ok: false, error: 'unexpected ID token algorithm' };
  const jwk = (jwks?.keys || []).find(k => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) return { ok: false, error: 'the ID token was signed with an unknown key' };
  let good = false;
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    good = crypto.verify('RSA-SHA256', Buffer.from(bits[0] + '.' + bits[1]), key, Buffer.from(bits[2], 'base64url'));
  } catch { good = false; }
  if (!good) return { ok: false, error: 'the ID token signature does not verify' };
  if (claims.iss !== ISSUER) return { ok: false, error: 'the ID token comes from another issuer' };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(audience)) return { ok: false, error: 'the ID token is for another client' };
  if (!claims.exp || claims.exp * 1000 < now - 60000) return { ok: false, error: 'the ID token has expired' };
  if (nonce && claims.nonce !== nonce) return { ok: false, error: 'the ID token does not belong to this sign-in' };
  return { ok: true, claims };
}

/** Whether a token response granted plan usage (a valid ID token alone does not, per the docs). */
export const planGranted = scope => String(scope || '').split(/\s+/).includes(PLAN_SCOPE);

/** The credential openGym files, encrypted, as the Coach's instance credential. */
export function credentialOf(tokens, { clientId, hostId, claims, now = Date.now() }) {
  return {
    token: tokens.access_token, refresh: tokens.refresh_token || null, idToken: tokens.id_token || null,
    exp: tokens.expires_in ? now + tokens.expires_in * 1000 : null, scope: tokens.scope || '',
    clientId, hostId, sub: claims?.sub || null, email: claims?.email || null
  };
}
export const needsRefresh = (cred, now = Date.now()) => !!(cred && cred.refresh && cred.exp && cred.exp - REFRESH_EARLY_MS <= now);

/** A refreshed credential (rotating refresh token), or { ok:false, error, gone } when the session ended. */
export async function refreshCredential(fetchImpl, cred, now = Date.now()) {
  const r = await postForm(fetchImpl, TOKEN_URL, { grant_type: 'refresh_token', client_id: cred.clientId, refresh_token: cred.refresh, resource: RESOURCE });
  if (r.status !== 200 || !r.data?.access_token) {
    return { ok: false, gone: r.data?.error === 'invalid_grant', error: `ChatGPT refused to renew the sign-in (${r.status}${r.data?.error ? ' ' + r.data.error : ''})${r.data?.error === 'invalid_grant' ? '; sign in again on the admin card' : ''}` };
  }
  return {
    ok: true,
    cred: { ...cred, token: r.data.access_token, refresh: r.data.refresh_token || cred.refresh, idToken: r.data.id_token || cred.idToken, exp: r.data.expires_in ? now + r.data.expires_in * 1000 : cred.exp, scope: r.data.scope || cred.scope }
  };
}

/** Sign out: end the renewable session (RFC 7009 at OpenAI). True when OpenAI confirmed it. */
export async function revokeCredential(fetchImpl, cred) {
  if (!cred?.refresh) return false;
  try {
    const r = await postForm(fetchImpl, ISSUER + '/api/accounts/oauth/revoke', { token: cred.refresh, token_type_hint: 'refresh_token', client_id: cred.clientId });
    return r.status === 200;
  } catch { return false; }
}

/* ---------- the Responses API request (preview rules) ---------- */

/**
 * The request body plan usage takes: store false, stream true, the whole context in `input`,
 * the rules in `instructions`, and none of the fields the preview refuses (max_output_tokens,
 * temperature, metadata, ...; siwc/token-sharing-open-source/preview-limitations).
 */
export function responsesBody({ model, prompt, instructions, schema }) {
  return {
    model, instructions, store: false, stream: true,
    input: [{ role: 'user', content: prompt }],
    ...(schema ? { text: { format: { type: 'json_schema', name: 'coach_answer', schema, strict: false } } } : { text: { format: { type: 'json_object' } } })
  };
}
/** The answer text of a Responses stream, or why there is none. `events` are { event, data }. */
export function foldResponses(events) {
  let text = '', done = false, failure = null;
  for (const { event, data } of events) {
    const type = data?.type || event;
    if (type === 'response.output_text.delta' && typeof data.delta === 'string') text += data.delta;
    else if (type === 'response.completed') done = true;
    else if (type === 'response.failed' || type === 'error') failure = data?.response?.error?.code || data?.error?.code || data?.code || 'failed';
    else if (type === 'response.incomplete') failure = 'incomplete: ' + (data?.response?.incomplete_details?.reason || 'cut off');
  }
  if (failure) {
    const limit = /subscription_sharing_usage_(limit_exceeded|unavailable)/.test(failure);
    return { ok: false, error: limit ? `your ChatGPT plan's usage limit was reached; see ${USAGE_URL}` : 'ChatGPT said: ' + String(failure).slice(0, 120), limit };
  }
  if (!done) return { ok: false, error: 'the answer stopped before ChatGPT finished it' };
  return { ok: true, text };
}
