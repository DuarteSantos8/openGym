/* Shared scaffolding for the OIDC test suites: a real server.js child and an in-process provider,
 * so a sign-in through the provider is proven against a spawned process and a real HTTP round
 * trip rather than against mocked modules.
 *
 * The child always picks its own port (PORT=0, resolved through helpers.mjs's boundPort) for the
 * same reason every other suite in this directory does: a fixed port collides with whatever else
 * is running, and a port chosen by the test and handed to the child a process start later leaves
 * a window the kernel can reissue the same number inside.
 *
 * ORIGIN is a fixed value, not derived from the child's actual bound address: nothing here is a
 * real browser, so the "origin" a request carries is whatever this harness puts on it - the
 * request itself always goes to the loopback address the child announced.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { hashPassword } from '../password.js';
import { s256 } from '../oidc/flow.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ORIGIN = 'http://localhost:8080';
export const ST_COOKIE = 'oidc_st';
export const PENDING_COOKIE = 'oidc_pending';
export const PROOF_COOKIE = 'oidc_proof';
export const SESSION_COOKIE = 'gymsid';

const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();

export function cookieValue(cookies, name) {
  for (const c of cookies || []) {
    const eq = c.indexOf('=');
    if (eq >= 0 && c.slice(0, eq) === name) return c.slice(eq + 1).split(';')[0];
  }
  return null;
}

/* An OIDC provider that lives inside this test process rather than on the network: discovery, a
 * key set (RS256, generated fresh per run) and a token endpoint whose next answer a case controls.
 * Loopback plain http on 127.0.0.1 is what makes this work offline - the same host oidc/config.js
 * and oidc/issuer.js both carve out for the issuer itself, gated on the issuer actually
 * configured, so nothing here widens what a real https deployment accepts.
 */
export async function startProvider(t) {
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-key';
  const jwk = { ...kp.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const clientId = 'opengym-test-client';
  let tokenResponse = null;
  let base = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, base);
    const answer = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return answer(200, {
        issuer: base,
        authorization_endpoint: base + '/authorize',
        token_endpoint: base + '/token',
        jwks_uri: base + '/jwks'
      });
    }
    if (req.method === 'GET' && url.pathname === '/jwks') return answer(200, { keys: [jwk] });
    if (req.method === 'POST' && url.pathname === '/token') {
      if (!tokenResponse) return answer(500, { error: 'test armed no token response' });
      return answer(tokenResponse.status, tokenResponse.body);
    }
    answer(404, { error: 'not found' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));

  /* Signs a compact JWS by hand over the key this provider publishes. Fills in iss/aud/iat/exp
     from sensible defaults so a case only has to name what it is varying. An `auth_time` left
     undefined is left out of the token altogether, the way an issuer that never reports when the
     sign-in happened sends it. */
  function idTokenFor({ sub = 'subject-1', nonce, email, email_verified, auth_time, extra = {} } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: base, aud: clientId, sub, iat: now, exp: now + 300,
      ...(nonce !== undefined ? { nonce } : {}),
      ...(auth_time !== undefined ? { auth_time } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(email_verified !== undefined ? { email_verified } : {}),
      ...extra
    };
    const h = b64u(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })));
    const p = b64u(Buffer.from(JSON.stringify(payload)));
    const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), kp.privateKey).toString('base64url');
    return h + '.' + p + '.' + sig;
  }

  return {
    get base() { return base; },
    clientId,
    idTokenFor,
    setTokenResponse: (status, body) => { tokenResponse = { status, body }; }
  };
}

/* Spawns server.js the way a container does, pointed at the provider above: a fresh state
 * directory handed in through the environment, PORT=0, and the OIDC_* block. `db` is written
 * exactly as given - nothing normalises it before boot, so a stored-records case can seed the
 * minimal shape a real earlier build would have written and prove the server reads it unchanged.
 */
export async function startApi(t, { provider, env = {}, db = {}, states = {}, secret } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-oidc-'));
  const secretValue = secret || crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dataDir, 'secret'), secretValue, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  for (const [uid, state] of Object.entries(states)) {
    fs.writeFileSync(path.join(dataDir, `state-${uid}.json`), JSON.stringify(state));
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost',
      OIDC_ISSUER: provider.base, OIDC_CLIENT_ID: provider.clientId,
      TRUST_PROXY: '1', AUDIT_LOG: '1', ...env
    }
  });
  const h = { log: '', dataDir, secret: secretValue };
  child.stdout.on('data', d => { h.log += d; });
  child.stderr.on('data', d => { h.log += d; });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;

  // A request that never follows a redirect, so a browser-navigated route's own Location and
  // Set-Cookie headers are read directly rather than chased - what a real browser would see
  // before it acts on either. It carries the Sec-Fetch headers of the app's own top-level
  // navigation unless a case says otherwise (a header given as undefined is left off). Plain
  // node:http rather than fetch, because fetch always sends `Sec-Fetch-Mode: cors` and a route
  // that refuses anything but a navigation would refuse every request of it.
  h.raw = (method, p, { cookie, headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const sent = {
      'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers
    };
    for (const k of Object.keys(sent)) if (sent[k] === undefined) delete sent[k];
    const r = http.request(`${h.api}${p}`, { method, headers: sent }, res => {
      res.resume();
      res.on('end', () => {
        const location = res.headers.location ?? null;
        const query = location ? new URL(location, h.api).searchParams : new URLSearchParams();
        const hashIdx = location ? location.indexOf('#') : -1;
        const fragment = new URLSearchParams(hashIdx < 0 ? '' : location.slice(hashIdx + 1));
        resolve({ status: res.statusCode, location, query, fragment, cookies: res.headers['set-cookie'] || [] });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
  // The ordinary JSON request shape every other suite in this directory uses.
  h.req = async (method, p, { body, cookie, headers = {} } = {}) => {
    const r = await fetch(`${h.api}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let parsed = null;
    try { parsed = await r.json(); } catch { /* no body, e.g. a redirect a caller followed */ }
    return { status: r.status, body: parsed, headers: r.headers, cookies: r.headers.getSetCookie() };
  };
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  h.audit = () => {
    try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); }
    catch { return []; }
  };
  return h;
}

// A user.pw record with a real hash, for a case seeding a profile directly into db.json that
// needs to drive a password route's own check (the current password on removal, a sign-in)
// rather than a fixed record no route here would ever verify against.
export async function withPassword(pw) {
  return { h: await hashPassword(pw), set: new Date().toISOString() };
}

// Mints the same signed session-cookie value sessionCookie() would produce, for a case that
// needs an already-authenticated caller without driving a whole sign-in through the harness.
export function mintSession(secret, uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 90 * 86400000}:${sv}`;
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${SESSION_COOKIE}=${payload}.${mac}`;
}

// Departs for the provider and reads back everything a real browser would carry forward: the
// state and nonce the redirect to the provider names (both ride in that redirect's own query
// string, never returned any other way) and the departure cookie the response set.
export async function beginFlow(h) {
  const res = await h.raw('GET', '/api/oidc/start');
  const departure = cookieValue(res.cookies, ST_COOKIE);
  return {
    res,
    state: res.query.get('state'),
    nonce: res.query.get('nonce'),
    cookieHeader: departure ? `${ST_COOKIE}=${departure}` : null
  };
}

// Calls the callback address with whatever cookie header and query parameters a case is
// exercising -- a bare wrapper so a refusal case reads as the one line that varies.
export async function completeCallback(h, { cookieHeader, state, code = 'authcode-from-provider', error } = {}) {
  const params = new URLSearchParams();
  if (error) params.set('error', error);
  else if (code) params.set('code', code);
  if (state !== undefined) params.set('state', state);
  return h.raw('GET', `/api/oidc/callback?${params.toString()}`, { cookie: cookieHeader });
}

// Drives the full departure-and-return round trip a browser makes for a sign-in through the
// provider: GET /api/oidc/start, arm the provider's next token-endpoint answer with an identity
// token for the case's own claims, then GET /api/oidc/callback with the departure cookie and the
// state the provider echoed back. Returns the raw callback response plus the session cookie
// header a browser would carry forward, when one was set.
export async function providerSignIn(h, provider, { sub = 'subject-1', email, email_verified, extra = {}, code = 'authcode-from-provider' } = {}) {
  const flow = await beginFlow(h);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub, nonce: flow.nonce, email, email_verified, extra }) });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state, code });
  const session = cookieValue(res.cookies, SESSION_COOKIE);
  return { res, sessionCookie: session ? `${SESSION_COOKIE}=${session}` : null };
}

// The app's own PKCE pair, generated the way the app itself would with WebCrypto: a random
// verifier and the S256 challenge over it. Distinct from the harness's own provider-facing PKCE
// (which server.js's departTo() manages) - this is the app-to-server pair a redeem checks.
export function appPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: s256(verifier) };
}

// Departs for the provider through the phone app's own start route, carrying the app's S256
// challenge, and reads back everything a real app would carry forward: the state and nonce the
// redirect to the provider names, and the departure cookie the response set.
export async function appDepart(h, challenge) {
  const res = await h.raw('GET', `/api/oidc/app/start?challenge=${encodeURIComponent(challenge)}`);
  const departure = cookieValue(res.cookies, ST_COOKIE);
  return {
    res,
    state: res.query.get('state'),
    nonce: res.query.get('nonce'),
    cookieHeader: departure ? `${ST_COOKIE}=${departure}` : null
  };
}

// Parses an app departure's return Location into { code } | { err } | null, mirroring what the
// app's own parseAppReturn does on the real opengym:// address.
export function appReturnOf(res) {
  if (!res.location || !res.location.startsWith('opengym://oidc')) return null;
  const q = new URL(res.location.replace('opengym://', 'http://'), 'http://x').searchParams;
  if (q.has('code')) return { code: q.get('code') };
  if (q.has('err')) return { err: q.get('err') };
  return null;
}

// The full app departure-and-return round trip: mints the app's own PKCE pair, departs, arms the
// provider's next token-endpoint answer with an identity token for the case's own claims, then
// completes the callback with the departure cookie and the state the provider echoed back.
export async function appSignIn(h, provider, { sub = 'subject-1', email, email_verified, extra = {}, challenge, code = 'authcode-from-provider' } = {}) {
  const pkce = challenge ? { verifier: null, challenge } : appPkce();
  const flow = await appDepart(h, pkce.challenge);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub, nonce: flow.nonce, email, email_verified, extra }) });
  const res = await completeCallback(h, { cookieHeader: flow.cookieHeader, state: flow.state, code });
  const ret = appReturnOf(res);
  return { res, verifier: pkce.verifier, code: ret?.code || null, err: ret?.err || null };
}

// POST /api/oidc/app/redeem, carrying the headers a WebView actually sends: a cross-site
// Sec-Fetch-Site and an Origin that is never ORIGIN, since the app's WebView origin is its own
// bundled asset server, not the site this request reaches.
export async function appRedeem(h, body, { bearer, headers = {} } = {}) {
  return h.req('POST', '/api/oidc/app/redeem', {
    body,
    headers: {
      'Sec-Fetch-Site': 'cross-site',
      'Origin': 'https://localhost',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers
    }
  });
}

// POST /api/oidc/app/confirm, carrying the same WebView-shaped headers appRedeem above does: a
// cross-site Sec-Fetch-Site and an Origin that is never ORIGIN.
export async function appConfirm(h, body) {
  return h.req('POST', '/api/oidc/app/confirm', {
    body,
    headers: { 'Sec-Fetch-Site': 'cross-site', 'Origin': 'https://localhost' }
  });
}

// Mints a one-shot link ticket through POST /api/account/identities/link-ticket, carrying
// whatever proof body a case is exercising (`{}` for the bare-session case, a passkey assertion
// or `{ current }` for a proven one).
export async function linkTicket(h, cookie, proof = {}) {
  return h.req('POST', '/api/account/identities/link-ticket', { body: proof, cookie });
}

// The exact counterpart of beginFlow, aimed at the link departure (GET /api/oidc/link/start)
// instead of the sign-in one: carries whatever cookie header and ticket a case is exercising, and
// returns the raw response alongside everything a real browser would carry forward on success.
export async function beginLink(h, cookie, ticket) {
  const res = await h.raw('GET', `/api/oidc/link/start?ticket=${encodeURIComponent(ticket || '')}`, { cookie });
  const departure = cookieValue(res.cookies, ST_COOKIE);
  return {
    res,
    state: res.query.get('state'),
    nonce: res.query.get('nonce'),
    cookieHeader: departure ? `${ST_COOKIE}=${departure}` : null
  };
}

// Strips the cookie-name prefix a mintSession() value carries, for a case that wants the same
// signed value as a Bearer token instead of a cookie - the phone is played by requests carrying
// `Authorization: Bearer <this>` and no Cookie header at all.
export function bearerOf(cookie) {
  return cookie.slice(cookie.indexOf('=') + 1);
}

// Mints a one-shot link ticket the way the phone app would: over a Bearer session rather than a
// cookie, carrying the app's own challenge in the body alongside whatever proof a case is
// exercising.
export async function appLinkTicket(h, bearer, proof = {}, challenge) {
  return h.req('POST', '/api/account/identities/link-ticket', {
    body: { ...proof, ...(challenge !== undefined ? { challenge } : {}) },
    headers: { Authorization: `Bearer ${bearer}` }
  });
}

// The app's own link departure (GET /api/oidc/app/link/start): no cookie, no Authorization - the
// ticket alone is the credential. Read back the way beginLink reads the web one.
export async function appDepartLink(h, ticket) {
  const res = await h.raw('GET', `/api/oidc/app/link/start?ticket=${encodeURIComponent(ticket || '')}`);
  const departure = cookieValue(res.cookies, ST_COOKIE);
  return {
    res,
    state: res.query.get('state'),
    nonce: res.query.get('nonce'),
    cookieHeader: departure ? `${ST_COOKIE}=${departure}` : null
  };
}

// Mints a one-shot proof ticket through POST /api/account/identities/proof-ticket for the change
// `act` names. The ticket needs no proof of its own: it only lets the browser leave for the
// provider, and the sign-in there is what proves anything.
export async function proofTicket(h, cookie, act) {
  return h.req('POST', '/api/account/identities/proof-ticket', { body: act === undefined ? {} : { act }, cookie });
}

// The app's own counterpart of proofTicket, over a Bearer session and carrying the app's own
// challenge, like appLinkTicket above.
export async function appProofTicket(h, bearer, act, challenge) {
  return h.req('POST', '/api/account/identities/proof-ticket', {
    body: { ...(act === undefined ? {} : { act }), ...(challenge !== undefined ? { challenge } : {}) },
    headers: { Authorization: `Bearer ${bearer}` }
  });
}

// The proof departure (GET /api/oidc/proof/start), read back the way beginLink reads the link one.
export async function beginProof(h, cookie, ticket) {
  const res = await h.raw('GET', `/api/oidc/proof/start?ticket=${encodeURIComponent(ticket || '')}`, { cookie });
  const departure = cookieValue(res.cookies, ST_COOKIE);
  return {
    res,
    state: res.query.get('state'),
    nonce: res.query.get('nonce'),
    cookieHeader: departure ? `${ST_COOKIE}=${departure}` : null
  };
}

// The app's own proof departure (GET /api/oidc/app/proof/start): no cookie, no Authorization, like
// appDepartLink above.
export async function appDepartProof(h, ticket) {
  const res = await h.raw('GET', `/api/oidc/app/proof/start?ticket=${encodeURIComponent(ticket || '')}`);
  const departure = cookieValue(res.cookies, ST_COOKIE);
  return {
    res,
    state: res.query.get('state'),
    nonce: res.query.get('nonce'),
    cookieHeader: departure ? `${ST_COOKIE}=${departure}` : null
  };
}

// The whole proof round trip a browser makes: ticket, departure, the provider's answer for `sub`
// (carrying `authTime` as auth_time, or no auth_time at all when it is undefined), and the return
// carrying both the departure cookie and the session that asked. `proofCookie` is the cookie
// header a browser would carry into the change the proof was made for, or null when none was set.
export async function proofRoundTrip(h, provider, { cookie, act, sub = 'subject-1', authTime } = {}) {
  const ticket = await proofTicket(h, cookie, act);
  const start = await beginProof(h, cookie, ticket.body?.ticket);
  provider.setTokenResponse(200, { id_token: provider.idTokenFor({ sub, nonce: start.nonce, auth_time: authTime }) });
  const res = await completeCallback(h, { cookieHeader: `${start.cookieHeader}; ${cookie}`, state: start.state });
  const proof = cookieValue(res.cookies, PROOF_COOKIE);
  return { ticket, start, res, proofCookie: proof ? `${PROOF_COOKIE}=${proof}` : null };
}

// Just enough CBOR for an attestation object: a map of text keys to text, bytes or an empty map.
const cborHead = (major, n) => n < 24 ? Buffer.from([(major << 5) | n])
  : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const cborText = s => Buffer.concat([cborHead(3, Buffer.byteLength(s)), Buffer.from(s)]);
const cborBytes = b => Buffer.concat([cborHead(2, b.length), b]);

// A software authenticator: a P-256 key that makes attestations ("none") and assertions the way a
// browser's would, in the minimal stored row shape (no name, no created) an earlier build of this
// feature would have written.
export function softAuthenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y, 'base64url')
  ]);
  const rawId = crypto.randomBytes(16);
  const id = b64u(rawId);
  let counter = 0;
  return {
    id,
    row: (userId, extra = {}) => ({ id, userId, publicKey: cose.toString('base64url'), counter: 0, transports: ['internal'], ...extra }),
    // What navigator.credentials.create() hands back, serialised the way lib/api.js does.
    attestation(challenge) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false }));
      const len = Buffer.from([rawId.length >> 8, rawId.length & 255]);
      const authData = Buffer.concat([sha256('localhost'), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, rawId, cose]);
      const attestationObject = Buffer.concat([
        Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]),
        cborText('authData'), cborBytes(authData)
      ]);
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal', 'hybrid'] }
      };
    },
    assertion(challenge) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false }));
      const c = Buffer.alloc(4); c.writeUInt32BE(++counter);
      const authData = Buffer.concat([sha256('localhost'), Buffer.from([0x05]), c]);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), privateKey);
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null }
      };
    }
  };
}

// The passkey assertion a request for account routes needs to prove ownership, exactly as
// Settings would collect it.
export async function stepUp(h, key, cookie) {
  const opts = await h.req('POST', '/api/login/options', { body: {}, cookie });
  const { cid, options } = opts.body;
  return { cid, credential: key.assertion(options.challenge) };
}
