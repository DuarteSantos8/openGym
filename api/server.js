/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import { dayReminderPush, restTimerPush, testPush } from './push-messages.js';
import { verifyError } from './verify-error.js';
import {
  StorageCorruptError, durableAtomicWrite, etagFor, normalizeIfMatch, readJson,
  isSafeId
} from './storage.js';
import { EXDB } from '../frontend/src/lib/exercises-data.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// Guest mode ("Continue without account") keeps everything in the browser and never touches this
// server — but on an instance meant for a known set of people, an entrance nobody can walk back
// out of is still the wrong front door (#42). Default ON, so existing instances are unchanged;
// the polarity is inverted from INVITE_ONLY because the safe default here is the permissive one.
const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(process.env.ALLOW_GUEST || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 16 * 1024 * 1024;
// Personalization services are opt-in. A missing env var must preserve the existing deployment
// surface; Compose enables them only when an operator explicitly sets the flags to 1/true.
const enabled = name => /^(1|true|yes|on)$/i.test(process.env[name] || '');
const MCP_ENABLED = enabled('MCP_ENABLED');
const PROPOSALS_ENABLED = enabled('MCP_PROPOSALS_ENABLED');
const ASSETS_ENABLED = enabled('CUSTOM_IMAGES_ENABLED');
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [] };
let dbError = null;
try {
  const parsed = readJson(dbFile, { missing: undefined });
  if (parsed !== undefined && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.users) || !Array.isArray(parsed.creds))) {
    throw new Error('db.json has an invalid shape');
  }
  if (parsed !== undefined) db = parsed;
} catch (error) { dbError = error; }
let SECRET;
try { SECRET = fs.readFileSync(secretFile, 'utf8').trim(); }
catch (error) {
  if (dbError) SECRET = crypto.randomBytes(32).toString('hex');
  else {
    SECRET = crypto.randomBytes(32).toString('hex');
    durableAtomicWrite(secretFile, SECRET, 0o600);
  }
}
db.subs = db.subs || [];
db.invites = db.invites || [];
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
function storageFailure(res, error = dbError) {
  const code = error?.code === 'STORAGE_CORRUPT' ? 'storage_corrupt' : 'storage_unavailable';
  return json(res, 503, { error: code, message: 'persistent storage is unavailable; no write was accepted' });
}
function requireWritable(res) {
  if (!dbError) return true;
  storageFailure(res, dbError);
  return false;
}
function saveDb() {
  if (dbError) throw dbError;
  durableAtomicWrite(dbFile, JSON.stringify(db, null, 2), 0o600);
}
function atomicWrite(file, content) {
  durableAtomicWrite(file, content, 0o600);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
const stateTxnFile = uid => path.join(DATA, '.state-txn-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  recoverStateTxn(uid);
  return readJson(stateFile(uid), { missing: null });
}
function readStateRecord(uid) {
  recoverStateTxn(uid);
  const file = stateFile(uid);
  const raw = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (raw === null) return { state: null, etag: '"0"' };
  let state;
  try { state = JSON.parse(raw.toString('utf8')); }
  catch (error) { throw new StorageCorruptError(file, error); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new StorageCorruptError(file, new Error('state is not an object'));
  return { state, etag: etagFor(raw) };
}
function writeState(uid, state) {
  const text = JSON.stringify(state);
  durableStateWrite(stateFile(uid), text);
  return etagFor(text);
}
// Disposable acceptance-only ENOSPC injection. It is read once at process start and is never set
// by Compose; the staging harness uses it to exercise the same fail-closed boundary as a genuinely
// full filesystem without filling a developer or production volume.
let testStateWriteFailures = Math.max(0, Math.floor(Number(process.env.OPENGYM_TEST_FAIL_STATE_WRITES) || 0));
function durableStateWrite(file, content) {
  if (testStateWriteFailures > 0) {
    testStateWriteFailures--;
    throw Object.assign(new Error('test-injected full-disk state write failure'), { code: 'ENOSPC' });
  }
  durableAtomicWrite(file, content, 0o600);
}
// A single API process is the intended deployment. This queue still makes the read/compare/write
// section atomic when two HTTP requests arrive in the same event-loop turn; a second writer must
// not be pointed at the bind mount without replacing this with an inter-process lock.
const stateLocks = new Map();
async function withStateLock(uid, fn) {
  const previous = stateLocks.get(uid) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  stateLocks.set(uid, current);
  await previous;
  try { return await fn(); }
  finally { release(); if (stateLocks.get(uid) === current) stateLocks.delete(uid); }
}

const receiptFile = path.join(DATA, 'idempotency.json');
let receipts = { entries: [] };
let receiptsError = null;
try {
  const parsed = readJson(receiptFile, { missing: undefined });
  if (parsed !== undefined) {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) throw new Error('idempotency.json has an invalid shape');
    receipts = parsed;
  }
} catch (error) { receiptsError = error; }
function saveReceipts() {
  if (receiptsError) throw receiptsError;
  // Failure injection is used only by the disposable acceptance harness to prove that a journal
  // survives a receipt-write failure. It is inert unless an operator explicitly sets this
  // test-only variable and never changes authorization or normal deployment behavior.
  if (saveReceipts.failures > 0) { saveReceipts.failures--; throw new Error('test-injected receipt write failure'); }
  // Keep the receipt file bounded; old keys cannot be safely replayed forever.
  const cutoff = Date.now() - 30 * 86400000;
  receipts.entries = receipts.entries.filter(e => e.ts > cutoff).slice(-20000);
  durableAtomicWrite(receiptFile, JSON.stringify(receipts, null, 2), 0o600);
}
saveReceipts.failures = Math.max(0, Math.floor(Number(process.env.OPENGYM_TEST_FAIL_RECEIPT_WRITES) || 0));
const requestHash = body => crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

// PUT /api/data updates two durable files (the profile and the idempotency receipt). A process
// crash between those renames must not turn a retried request into a false 412 or a duplicate
// write. The small per-user journal is written first and replayed before any subsequent read;
// replay is idempotent and leaves the journal in place until both files are durable.
function durableUnlink(file) {
  try { fs.unlinkSync(file); }
  catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  const dirFd = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}
function recoverStateTxn(uid) {
  const file = stateTxnFile(uid);
  if (!fs.existsSync(file)) return;
  let txn;
  try { txn = readJson(file); }
  catch (error) { throw error; }
  if (!txn || typeof txn !== 'object' || Array.isArray(txn) || !txn.state || typeof txn.state !== 'object' || Array.isArray(txn.state)) {
    throw new StorageCorruptError(file, new Error('state transaction has an invalid shape'));
  }
  const text = JSON.stringify(txn.state);
  const revision = etagFor(text);
  const receipt = txn.receipt;
  const stateHash = receipt?.stateHash || receipt?.hash;
  if (!receipt || receipt.uid !== uid || !receipt.key || stateHash !== requestHash(txn.state) || receipt.revision !== revision) {
    throw new StorageCorruptError(file, new Error('state transaction receipt is invalid'));
  }
  if (receiptsError) throw receiptsError;
  const prior = receipts.entries.find(e => e.uid === uid && e.key === receipt.key);
  if (prior && (prior.hash !== receipt.hash || prior.revision !== receipt.revision ||
    (prior.stateHash && receipt.stateHash && prior.stateHash !== receipt.stateHash))) {
    throw new StorageCorruptError(file, new Error('state transaction conflicts with its receipt'));
  }
  // The journal is the source of truth for this operation. Replaying the same bytes after a
  // crash is safe because both writes are complete-file replacements and the receipt is keyed.
  // Validate an existing receipt first so a corrupt/conflicting journal can never overwrite a
  // good profile copy that was already acknowledged.
  durableAtomicWrite(stateFile(uid), text, 0o600);
  if (!prior) receipts.entries.push(receipt);
  // Always persist, even when an in-memory receipt already exists from an earlier failed save.
  // Only the on-disk receipt makes a retry idempotent after a process restart.
  saveReceipts();
  durableUnlink(file);
}

/* ---------- scoped MCP grants + private assets ---------- */
const grantFile = path.join(DATA, 'mcp-grants.json');
const GRANT_SCOPES = new Set(['exercise:read', 'routine:read', 'workout:read', 'bodyweight:read', 'progress:read', 'routine:propose']);
const MAX_PROPOSALS = 500;
let grants = { grants: [] };
let grantsError = null;
try {
  const parsed = readJson(grantFile, { missing: undefined });
  if (parsed !== undefined) {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.grants)) throw new Error('mcp-grants.json has an invalid shape');
    grants = parsed;
  }
} catch (error) { grantsError = error; }
function persistentError() {
  return dbError || receiptsError || (MCP_ENABLED && (grantsError || oauthClientsError)) || null;
}
const grantHash = token => crypto.createHash('sha256').update(String(token)).digest('hex');
function saveGrants() {
  if (grantsError) throw grantsError;
  durableAtomicWrite(grantFile, JSON.stringify(grants, null, 2), 0o600);
}
function grantToken() { return crypto.randomBytes(32).toString('base64url'); }
function grantView(g) {
  return { id: g.id, name: g.name, uid: g.uid, scopes: g.scopes, created: g.created, expires: g.expires, audience: g.audience || null, revoked: !!g.revoked, lastUsed: g.lastUsed || null };
}

// OAuth clients are public metadata (no secret is issued for the PKCE-only flow), but keeping
// the registration in the API data root makes a restart deterministic and lets the MCP gateway
// remain stateless with respect to profile files.  Redirect URIs are exact-match allow-list
// entries; wildcards, fragments, credentials, and non-local plain HTTP are rejected below.
const oauthClientFile = path.join(DATA, 'oauth-clients.json');
const OAUTH_CLIENT_LIMIT = 1000;
const OAUTH_REGISTER_WINDOW_MS = 15 * 60 * 1000;
const OAUTH_REGISTER_MAX_PER_WINDOW = 20;
const oauthRegistrationAttempts = new Map();
let oauthClients = { clients: [] };
let oauthClientsError = null;
try {
  const parsed = readJson(oauthClientFile, { missing: undefined });
  if (parsed !== undefined) {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clients)) throw new Error('oauth-clients.json has an invalid shape');
    oauthClients = parsed;
  }
} catch (error) { oauthClientsError = error; }
function saveOAuthClients() {
  if (oauthClientsError) throw oauthClientsError;
  durableAtomicWrite(oauthClientFile, JSON.stringify(oauthClients, null, 2), 0o600);
}
function oauthRegistrationAllowed(req) {
  const now = Date.now();
  const key = String(req.socket?.remoteAddress || 'unknown').slice(0, 80);
  const prior = oauthRegistrationAttempts.get(key) || [];
  const recent = prior.filter(ts => ts > now - OAUTH_REGISTER_WINDOW_MS);
  if (recent.length >= OAUTH_REGISTER_MAX_PER_WINDOW) {
    oauthRegistrationAttempts.set(key, recent);
    return false;
  }
  recent.push(now); oauthRegistrationAttempts.set(key, recent);
  // Keep this in-memory limiter bounded even when a scanner rotates source addresses.
  if (oauthRegistrationAttempts.size > 2000) {
    for (const [candidate, timestamps] of oauthRegistrationAttempts) {
      if (!timestamps.some(ts => ts > now - OAUTH_REGISTER_WINDOW_MS)) oauthRegistrationAttempts.delete(candidate);
    }
  }
  return true;
}
function oauthClientView(c) {
  const createdAt = Date.parse(c.createdAt) || Date.now();
  return {
    client_id: c.clientId, client_name: c.clientName, redirect_uris: c.redirectUris,
    grant_types: c.grantTypes, response_types: c.responseTypes,
    token_endpoint_auth_method: c.tokenEndpointAuthMethod, scope: c.scope, created_at: c.createdAt,
    client_id_issued_at: Math.floor(createdAt / 1000), client_secret_expires_at: 0
  };
}
function localRedirect(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch { return false; }
}
function validRedirect(uri) {
  try {
    const u = new URL(uri);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.hash) return false;
    return u.protocol === 'https:' || localRedirect(uri);
  } catch { return false; }
}
function registrationMetadata(body) {
  const redirectUris = Array.isArray(body?.redirect_uris) ? [...new Set(body.redirect_uris.map(String))] : [];
  if (!redirectUris.length || redirectUris.length > 10 || redirectUris.some(uri => uri.length > 2000 || !validRedirect(uri))) return { error: 'invalid_redirect_uris' };
  const grantTypes = Array.isArray(body?.grant_types) && body.grant_types.length ? [...new Set(body.grant_types.map(String))] : ['authorization_code'];
  const responseTypes = Array.isArray(body?.response_types) && body.response_types.length ? [...new Set(body.response_types.map(String))] : ['code'];
  if (grantTypes.length !== 1 || grantTypes[0] !== 'authorization_code' || responseTypes.length !== 1 || responseTypes[0] !== 'code') return { error: 'unsupported_grant_or_response_type' };
  const tokenEndpointAuthMethod = String(body?.token_endpoint_auth_method || 'none');
  if (tokenEndpointAuthMethod !== 'none') return { error: 'public_pkce_client_required' };
  const requested = String(body?.scope || '').trim().split(/\s+/).filter(Boolean);
  const scope = [...new Set(requested.length ? requested : ['exercise:read', 'routine:read', 'workout:read', 'progress:read'])];
  if (!scope.length || scope.some(s => !GRANT_SCOPES.has(s))) return { error: 'invalid_scope' };
  return {
    clientId: crypto.randomBytes(18).toString('base64url'),
    clientName: String(body?.client_name || 'MCP client').trim().slice(0, 120) || 'MCP client',
    redirectUris, grantTypes, responseTypes, tokenEndpointAuthMethod, scope: scope.join(' '), createdAt: new Date().toISOString()
  };
}
function grantFor(req) {
  if (grantsError || dbError) return null;
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  const hash = grantHash(auth.slice(7).trim());
  const g = grants.grants.find(x => x.tokenHash === hash && !x.revoked && (!x.expires || x.expires > Date.now()));
  if (!g || !db.users.some(u => u.id === g.uid && !u.disabled)) return null;
  g.lastUsed = Date.now();
  // Last-use telemetry is intentionally best effort and is not needed for authorization.
  try { saveGrants(); } catch {}
  return g;
}
function requireGrant(req, res, scope) {
  const grant = grantFor(req);
  if (!grant) {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    json(res, 401, { error: 'invalid_token' });
    return null;
  }
  if (scope && !grant.scopes.includes(scope)) {
    res.setHeader('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${scope}"`);
    json(res, 403, { error: 'insufficient_scope', scope });
    return null;
  }
  return grant;
}
const uploadDir = uid => path.join(DATA, 'uploads', uid);
const assetFile = (uid, id) => path.join(uploadDir(uid), id);
const assetRef = (S, id) => (S?.customEx || []).find(e => e.media?.id === id)?.media || null;
const allowedImage = new Map([
  ['image/jpeg', b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))],
  ['image/webp', b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP']
]);
function imageBytes(body) {
  const mime = String(body?.mime || '').toLowerCase();
  const check = allowedImage.get(mime);
  if (!check) throw Object.assign(new Error('unsupported image type'), { code: 'IMAGE_TYPE' });
  const encoded = String(body?.data || '');
  if (!encoded || encoded.length > 14 * 1024 * 1024) throw Object.assign(new Error('image exceeds 10 MiB'), { code: 'IMAGE_SIZE' });
  let bytes;
  try { bytes = Buffer.from(encoded, 'base64'); } catch { throw Object.assign(new Error('invalid image data'), { code: 'IMAGE_DATA' }); }
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !check(bytes)) throw Object.assign(new Error('invalid image data'), { code: 'IMAGE_DATA' });
  return { mime, bytes };
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

/* A push subscription's `endpoint` is a URL this server connects out to, chosen by whoever is
   signed in — so without a check /api/push/* is a request-forgery lever, and the api container
   sits on the same Docker network as the rest of the self-hoster's stack. Three limits below:

   1. PUSH_AGENT rejects any connection to a private/loopback/link-local address at the moment
      the socket is opened. Validating the URL alone would leave a DNS-rebinding window — the
      name is resolved a second time inside web-push — so the check has to live in the lookup
      the request itself uses, not in a prior pass.
   2. PUSH_TIMEOUT_MS: an endpoint that accepts TCP and then stalls used to hang the request
      handler that awaited it, indefinitely. web-push sets no timeout of its own.
   3. PUSH_CONCURRENCY: one small request must not turn into an unbounded burst of outbound
      connections (with MAX_SUBS_PER_USER below, that is the other half of the same problem). */
const PUSH_TIMEOUT_MS = 10000;
const PUSH_CONCURRENCY = 6;
const MAX_SUBS_PER_USER = 20;

function isPrivateAddr(ip) {
  const v = String(ip).toLowerCase();
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m4) {
    const a = +m4[1], b = +m4[2];
    if (a === 0 || a === 10 || a === 127) return true;            // this-network, private, loopback
    if (a === 169 && b === 254) return true;                      // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;             // private
    if (a === 192 && b === 168) return true;                      // private
    if (a === 192 && b === 0) return true;                        // 192.0.0.0/24, 192.0.2.0/24
    if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT
    if (a >= 224) return true;                                    // multicast + reserved
    return false;
  }
  const m6 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v);
  if (m6) return isPrivateAddr(m6[1]);                            // IPv4-mapped IPv6
  if (v === '::' || v === '::1') return true;                     // unspecified, loopback
  if (/^fe[89ab]/.test(v)) return true;                           // link-local
  if (/^f[cd]/.test(v)) return true;                              // unique local
  return false;
}

// Same shape as dns.lookup, so https.Agent can use it directly.
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.some(a => isPrivateAddr(a.address))) {
      return cb(Object.assign(new Error('refusing to connect to a private address: ' + hostname), { code: 'EPUSHBLOCKED' }));
    }
    cb(null, address, family);
  });
}
const PUSH_AGENT = new https.Agent({ lookup: guardedLookup, keepAlive: false });

// Cheap pre-check so a bad endpoint is refused at subscribe time with a useful message, rather
// than silently never delivering. PUSH_AGENT is what actually enforces the address rule.
function pushEndpointError(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'endpoint is not a valid URL'; }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL';
  if (u.username || u.password) return 'endpoint must not carry credentials';
  // A literal address can be judged right here, which turns the common case into a clear error
  // at subscribe time instead of a delivery that quietly never happens. Hostnames are left to
  // PUSH_AGENT, which is the check that actually has to hold.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddr(host)) return 'endpoint must not point at a private address';
  }
  return null;
}

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  let next = 0;
  const worker = async () => {
    while (next < subs.length) {
      const sub = subs[next++];
      // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
      // low-urgency background push more aggressively under battery-saving modes. TTL is left
      // at the library default (long) so a briefly-offline device still gets it once reconnected,
      // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
      // actually control anyway.
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body,
          { urgency: 'high', timeout: PUSH_TIMEOUT_MS, agent: PUSH_AGENT });
      } catch (e) {
        console.error('push send failed', userId, e.statusCode, e.body || e.message);
        if (e.statusCode === 404 || e.statusCode === 410) {
          db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, subs.length) }, worker));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec, lang) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, restTimerPush(lang));
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    let S;
    try { S = readState(user.id); } catch (e) { console.error('reminder state unreadable', user.id, e.message); continue; }
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, dayReminderPush(S.lang, routine));
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
// With the __Host- prefix the *browser* guarantees the cookie is host-only (no Domain attribute
// is even allowed) — which is what stops a sibling subdomain, e.g. anything-else.example.com
// against gym.example.com, from planting a second session cookie for the shared parent domain
// and having it shadow the real one. The prefix also requires Secure, so it only works on an
// https ORIGIN; over plain http://localhost the old name stays, and localhost has no sibling
// subdomains to worry about. Both names are accepted on the way in, so upgrading an instance
// does not sign anybody out — they move onto the prefixed cookie at their next sign-in.
const COOKIE = SECURE ? '__Host-gymsid' : 'gymsid';
const LEGACY_COOKIE = 'gymsid';
// Every value for a given name, in the order the browser sent them. Not an object: reducing
// duplicates to one entry silently picks a winner, and picking the *last* one handed a shadowing
// cookie the session outright.
function cookieValues(req, name) {
  const out = [];
  for (const c of (req.headers.cookie || '').split(';')) {
    const i = c.indexOf('=');
    if (i < 0) continue;
    if (c.slice(0, i).trim() === name) out.push(c.slice(i + 1).trim());
  }
  return out;
}
function cookieToken(req) {
  for (const name of (COOKIE === LEGACY_COOKIE ? [COOKIE] : [COOKIE, LEGACY_COOKIE])) {
    const vals = cookieValues(req, name);
    if (!vals.length) continue;
    // Two different values under one name is not something a browser does on its own — it means
    // somebody else got to set one. There is no safe way to guess which is the real session, so
    // refuse both: a signed-out user signs back in, a shadowing attempt gets nothing.
    if (vals.some(v => v !== vals[0])) return null;
    return vals[0];
  }
  return null;
}
function readSession(req) {
  // The paired mobile app has no cookie jar shared with the API's origin, so it carries the same
  // signed token in an Authorization header instead — same payload, same verification below.
  const auth = req.headers.authorization || '';
  const tok = cookieToken(req) || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : null);
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  // Only the 403 is recorded: a 401 is any unauthenticated bot poking /api/admin/*, and
  // logging those would bury the events an operator actually wants to see.
  if (!isAdmin(user)) { audit(req, 'admin.denied', { ok: false, user }); json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
const expireCookie = name => `${name}=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;
function sessionCookie(user) {
  const fresh = `${COOKIE}=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
  // Signing in also retires any pre-upgrade cookie, so nobody is left carrying an unprefixed one
  // (or a shadowing copy of it) alongside the new session.
  return COOKIE === LEGACY_COOKIE ? [fresh] : [fresh, expireCookie(LEGACY_COOKIE)];
}
const clearCookie = COOKIE === LEGACY_COOKIE
  ? [expireCookie(LEGACY_COOKIE)]
  : [expireCookie(COOKIE), expireCookie(LEGACY_COOKIE)];

/* ---------- CSRF ---------- */
// SameSite=Lax keeps the session cookie off a genuinely cross-*site* request. It does not keep it
// off a *sibling subdomain*: gym.example.com and anything-else.example.com are the same site, and
// that is the ordinary self-hosting layout — one domain, one reverse proxy, several apps. Nothing
// else in a request was being checked either; readBody() JSON.parse's the body whatever the
// Content-Type claims, so a hostile page could reach the state-changing routes with a form-style
// POST that needs no CORS preflight at all.
//
// So a state-changing request that came from a browser has to come from ORIGIN. The exemptions
// below are not holes: each of those routes carries its own credential in the body (a WebAuthn
// challenge id, a one-shot pairing code), none of them acts on the caller's existing session, and
// they have to keep working from the mobile WebView, whose origin is never ORIGIN.
const CSRF_EXEMPT = new Set([
  'POST /api/register/options', 'POST /api/register/verify',
  'POST /api/login/options', 'POST /api/login/verify',
  'POST /api/pair/redeem'
]);
const originsMatch = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
function csrfOk(req, key) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  if (CSRF_EXEMPT.has(key)) return true;
  // The paired mobile app authenticates with a Bearer token. A browser never attaches one on its
  // own, so there is no ambient authority for a hostile page to borrow and no origin to check.
  if ((req.headers.authorization || '').startsWith('Bearer ')) return true;
  // Sec-Fetch-Site is set by the browser itself and no page can forge it, and it states exactly
  // the property wanted here — more precisely than comparing origins can. 'same-origin' is the
  // app talking to its own backend; a hostile page reports 'cross-site'; a sibling subdomain,
  // the case SameSite=Lax misses entirely, reports 'same-site'. It is also what keeps the Vite
  // dev server working, where the page is on another port and its Origin is legitimately not
  // ORIGIN. Absent on older Safari and on proxies that strip it, hence the fallback below.
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.origin;
  // No Origin header at all means no browser sent this — curl, a script, a monitoring check.
  // Browsers put an Origin on every state-changing request and a page cannot suppress it, so the
  // forgery this exists to stop always carries one.
  if (!origin) return true;
  return originsMatch(origin, ORIGIN);
}

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

// ---------- device pairing (mobile app "connect to my server", no WebAuthn ceremony) ----------
// A passkey ceremony can't run inside the app's WebView (its origin never matches RP_ID), so the
// app authenticates by redeeming a short code minted from an already signed-in browser tab —
// same 5-min-TTL/one-shot shape as the WebAuthn challenge store above.
const pairings = new Map(); // code -> {uid, exp}
const PAIR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — read off a screen
function makePairCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(8)).map(b => PAIR_CODE_ALPHABET[b % PAIR_CODE_ALPHABET.length]).join('');
  } while (pairings.has(code));
  return code;
}
setInterval(() => { for (const [k, v] of pairings) if (v.exp < Date.now()) pairings.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- audit log ---------- */
// Who signed in, who tried and failed, and what an admin changed. One JSON object per line in
// ./data/audit.log, appended and never rewritten in place. It deliberately does not live in
// db.json: that file is rewritten whole on every save, and the login/register handshakes are
// unauthenticated and unthrottled by design (see SECURITY.md), so an audit trail in there would
// turn one bogus request into a full db.json rewrite. A line torn by a crash costs one event and
// is dropped on read.
//
// On by default. It records strictly less than the instance already holds — every account is in
// db.json and every workout is in state-<uid>.json, both readable by any admin — and a security
// feature that ships switched off protects nobody. IP addresses are the exception: off unless you
// ask for them, because they are the one field here that says where somebody physically is.
const AUDIT_ON = !/^(0|false|no|off)$/i.test(process.env.AUDIT_LOG || '');
const AUDIT_MAX = Math.max(0, +(process.env.AUDIT_MAX || 5000) || 0);     // 0 = no count cap
const AUDIT_DAYS = Math.max(0, +(process.env.AUDIT_DAYS || 90) || 0);     // 0 = no age cap
const AUDIT_IP = /^full$/i.test(process.env.AUDIT_IP || '') ? 'full'
  : /^(1|true|yes|on|net)$/i.test(process.env.AUDIT_IP || '') ? 'net' : 'off';
const auditFile = path.join(DATA, 'audit.log');
let auditSeq = 0;      // never reset, not even by a clear — a wiped log leaves a visible id gap
let auditCount = 0;

// Which header holds the caller depends on what is in front of the API. CF-Connecting-IP comes
// first because a Cloudflare tunnel does NOT forward the client in X-Forwarded-For — that header
// then only carries the tunnel's own container, which looks like a valid answer and isn't. After
// that, the first entry of X-Forwarded-For is the client and everything behind it is our own hops.
// All three are only as trustworthy as the proxy in front: it has to overwrite them rather than
// pass a client-supplied one through. In 'net' mode only the network survives — enough to tell
// one source from another, not enough to point at a person.
function clientIp(req) {
  if (AUDIT_IP === 'off') return null;
  const raw = String(req.headers['cf-connecting-ip'] || '').trim()
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '').trim()
    // Nothing in front at all: the socket peer is the client, and it cannot be forged. Behind
    // the bundled web container a header always wins before this is reached.
    || String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '').trim();
  const ip = raw.replace(/^\[|\]$/g, '').slice(0, 45);
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return null;    // never store a header verbatim
  if (AUDIT_IP === 'full') return ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0/24');
  const g = ip.split(':').filter(Boolean).slice(0, 3).join(':');
  return g ? g + '::/48' : null;
}

function auditLines() {
  let text;
  try { text = fs.readFileSync(auditFile, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && r.id && r.ev) rows.push(r); } catch { /* torn line */ }
  }
  return rows;
}
// Retention is a cap, not an archive: age first, then the newest AUDIT_MAX of what's left.
function auditKeep(rows) {
  let out = rows;
  if (AUDIT_DAYS) { const cut = Date.now() - AUDIT_DAYS * 86400000; out = out.filter(r => r.ts >= cut); }
  if (AUDIT_MAX && out.length > AUDIT_MAX) out = out.slice(out.length - AUDIT_MAX);
  return out;
}
function compactAudit() {
  const rows = auditLines();
  for (const r of rows) if (+r.id > auditSeq) auditSeq = +r.id;
  const keep = auditKeep(rows);
  auditCount = keep.length;
  if (keep.length === rows.length) return;
  try { atomicWrite(auditFile, keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')); }
  catch (e) { console.error('audit compact failed', e.message); }
}

// Never throws: a log that can't be written must not break signing in.
function audit(req, ev, f = {}) {
  if (!AUDIT_ON) return;
  const rec = { id: ++auditSeq, ts: Date.now(), ev, ok: f.ok !== false };
  if (f.user) { rec.uid = f.user.id; rec.name = String(f.user.name || '').slice(0, 40); }
  else {
    if (f.uid) rec.uid = f.uid;
    if (f.name) rec.name = String(f.name).slice(0, 40);
  }
  if (f.target) { rec.tgt = f.target.id; rec.tname = String(f.target.name || '').slice(0, 40); }
  if (f.msg) rec.msg = String(f.msg).slice(0, 120);
  const ip = clientIp(req);
  if (ip) rec.ip = ip;
  try { fs.appendFileSync(auditFile, JSON.stringify(rec) + '\n'); }
  catch (e) { return console.error('audit write failed', e.message); }
  // Amortized: a 5000-event cap rewrites the file once per ~1250 events.
  if (AUDIT_MAX && ++auditCount > AUDIT_MAX * 1.25) compactAudit();
}
if (AUDIT_ON) {
  compactAudit();                                // prune on boot, seed auditSeq/auditCount
  setInterval(compactAudit, 3600000).unref();    // honour AUDIT_DAYS on an idle instance too
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => persistentError()
    ? storageFailure(res, persistentError())
    : json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
  },

  // Named, narrow grants are minted from an already authenticated browser session. The bearer
  // token is returned once; only its hash and revocation metadata are retained on disk.
  'GET /api/mcp/grants': async (req, res) => {
    if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (grantsError) return storageFailure(res, grantsError);
    json(res, 200, { grants: grants.grants.filter(g => g.uid === user.id).map(grantView) });
  },

  'POST /api/mcp/grants': async (req, res) => {
    if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
    if (!requireWritable(res) || grantsError) return grantsError ? storageFailure(res, grantsError) : undefined;
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const scopes = [...new Set(Array.isArray(body.scopes) ? body.scopes.map(String) : [])];
    if (!scopes.length || scopes.some(s => !GRANT_SCOPES.has(s))) return json(res, 400, { error: 'invalid scopes', allowed: [...GRANT_SCOPES] });
    const ttlSeconds = Number(body.expires_in);
    const expires = Number.isFinite(ttlSeconds) && ttlSeconds >= 1
      ? Date.now() + Math.min(365 * 86400, Math.floor(ttlSeconds)) * 1000
      : Date.now() + Math.max(1, Math.min(365, Number(body.days) || 30)) * 86400000;
    const audience = body.audience == null ? null : String(body.audience).trim().slice(0, 500);
    if (audience) {
      try { const u = new URL(audience); if (u.protocol !== 'https:' || u.username || u.password || u.hash) return json(res, 400, { error: 'invalid audience' }); }
      catch { return json(res, 400, { error: 'invalid audience' }); }
    }
    const token = grantToken();
    const grant = {
      id: crypto.randomBytes(12).toString('base64url'), uid: user.id,
      name: String(body.name || 'MCP client').trim().slice(0, 80) || 'MCP client',
      scopes, tokenHash: grantHash(token), created: new Date().toISOString(), expires, ...(audience ? { audience } : {})
    };
    grants.grants.push(grant);
    try { saveGrants(); } catch (e) { grants.grants.pop(); return storageFailure(res, e); }
    json(res, 201, { grant: grantView(grant), token });
  },

  'POST /api/mcp/grants/revoke': async (req, res) => {
    if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
    if (!requireWritable(res) || grantsError) return grantsError ? storageFailure(res, grantsError) : undefined;
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const grant = grants.grants.find(g => g.id === body.id && g.uid === user.id);
    if (!grant) return json(res, 404, { error: 'no such grant' });
    grant.revoked = Date.now();
    try { saveGrants(); } catch (e) { return storageFailure(res, e); }
    json(res, 200, { ok: true, id: grant.id, revoked: true });
  },

  // Public OAuth 2.1 dynamic-client registration.  Clients are PKCE-only public clients: no
  // client secret is generated or accepted, and the redirect URI list is the complete allow-list.
  'POST /api/oauth/clients': async (req, res) => {
    if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
    if (!requireWritable(res) || oauthClientsError) return oauthClientsError ? storageFailure(res, oauthClientsError) : undefined;
    if (!oauthRegistrationAllowed(req)) {
      res.setHeader('Retry-After', '900');
      return json(res, 429, { error: 'registration rate limit exceeded' });
    }
    if (oauthClients.clients.length >= OAUTH_CLIENT_LIMIT) return json(res, 429, { error: 'client registration limit reached' });
    let body;
    try { body = await readBody(req, 256 * 1024); } catch { return json(res, 400, { error: 'invalid_client_metadata' }); }
    const metadata = registrationMetadata(body);
    if (metadata.error) return json(res, 400, { error: metadata.error });
    oauthClients.clients.push(metadata);
    try { saveOAuthClients(); }
    catch (e) { oauthClients.clients.pop(); return storageFailure(res, e); }
    json(res, 201, oauthClientView(metadata));
  },

  // Used by the remote MCP transport to validate a token on every request. This makes revocation
  // effective without restarting the MCP container and never accepts a caller-supplied user id.
  'GET /api/mcp/introspect': async (req, res) => {
    if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
    const grant = requireGrant(req, res);
    if (!grant) return;
    const user = db.users.find(u => u.id === grant.uid);
    json(res, 200, { user: { id: user.id, name: user.name }, grant: grantView(grant) });
  },

  'GET /api/mcp/catalog': async (req, res) => {
    if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
    const grant = requireGrant(req, res, 'exercise:read');
    if (!grant) return;
    let S;
    try { S = readState(grant.uid) || {}; } catch (e) { return storageFailure(res, e); }
    const q = new URL(req.url, 'http://x').searchParams;
    const offset = Math.max(0, Number(q.get('offset')) || 0);
    const limit = Math.max(1, Math.min(200, Number(q.get('limit')) || 100));
    const custom = (S.customEx || []).map(e => ({ ...e, custom: true, media: undefined }));
    const all = [...custom, ...EXDB];
    const page = all.slice(offset, offset + limit);
    json(res, 200, { offset, limit, total: all.length, next_offset: offset + page.length < all.length ? offset + page.length : null, exercises: page });
  },

  // Scope-filtered state snapshots keep the MCP service stateless and unmounted from /data.
  'GET /api/mcp/state': async (req, res) => {
    if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
    const query = new URL(req.url, 'http://x').searchParams;
    const scope = query.get('scope');
    const grant = requireGrant(req, res, scope);
    if (!grant) return;
    const requestedUid = query.get('uid');
    if (requestedUid && requestedUid !== grant.uid) return json(res, 403, { error: 'cross-user access denied' });
    let record;
    try { record = readStateRecord(grant.uid); } catch (e) { return storageFailure(res, e); }
    const S = record.state;
    if (!S) return json(res, 200, { state: null, revision: record.etag });
    const state = { unit: S.unit || 'kg' };
    if (scope === 'exercise:read') state.customEx = S.customEx || [];
    if (scope === 'routine:read') Object.assign(state, { routines: S.routines || [], week: S.week || {}, dayPlan: S.dayPlan || {}, customEx: S.customEx || [] });
    if (scope === 'workout:read') state.workouts = S.workouts || [];
    if (scope === 'bodyweight:read') Object.assign(state, { bodyweight: S.bodyweight || [], targetW: S.targetW || null });
    if (scope === 'progress:read') Object.assign(state, { workouts: S.workouts || [], routines: S.routines || [], customEx: S.customEx || [] });
    json(res, 200, { state, revision: record.etag });
  },

  // The signed-in app reviews proposals without needing to expose a bearer grant to the browser.
  'GET /api/mcp/proposals': async (req, res) => {
    if (!MCP_ENABLED || !PROPOSALS_ENABLED) return json(res, 404, { error: 'feature disabled' });
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    let record;
    try { record = readStateRecord(user.id); } catch (e) { return storageFailure(res, e); }
    json(res, 200, { proposals: record.state?.proposals || [], revision: record.etag }, { ETag: record.etag });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked)) {
      // The rejected code itself is never recorded — a near-miss guess in the log is a liability.
      audit(req, 'auth.register.denied', { ok: false, name, msg: 'invite-rejected' });
      return json(res, 403, { error: 'a valid invite code is required' });
    }
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) {
      audit(req, 'auth.register.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) {
      // e.message can echo attacker-supplied response fields, so only the reason code is kept.
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'verify-error' });
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'not-verified' });
      return json(res, 400, { error: 'not verified' });
    }
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'credential-exists' });
      return json(res, 409, { error: 'credential already registered' });
    }
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) {
        audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'invite-invalid' });
        return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
      }
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    audit(req, 'auth.register.ok', { user, msg: invite ? invite.code : null });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) {
      audit(req, 'auth.login.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) {
      // No credential id goes in the log: it is a stable handle for one passkey, and recording it
      // would let an admin correlate an unknown device across attempts. Nothing here identifies
      // the caller beyond the timestamp (and the network, if AUDIT_IP is on).
      audit(req, 'auth.login.fail', { ok: false, msg: 'unknown-credential' });
      return json(res, 404, { error: 'unknown passkey — create a profile first' });
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) {
      audit(req, 'auth.login.fail', { ok: false, user: db.users.find(u => u.id === cred.userId), uid: cred.userId, msg: 'verify-error' });
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      audit(req, 'auth.login.fail', { ok: false, user: db.users.find(u => u.id === cred.userId), uid: cred.userId, msg: 'not-verified' });
      return json(res, 400, { error: 'not verified' });
    }
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) {
      audit(req, 'auth.login.fail', { ok: false, uid: cred.userId, msg: 'user-missing' });
      return json(res, 500, { error: 'user missing' });
    }
    if (user.disabled) {
      audit(req, 'auth.login.fail', { ok: false, user, msg: 'account-disabled' });
      return json(res, 403, { error: 'this account has been disabled' });
    }
    audit(req, 'auth.login.ok', { user });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  // Reads the session purely so the sign-out can be recorded; the cookie is cleared either way.
  // A logout with no valid cookie is a no-op and isn't worth an entry.
  'POST /api/logout': async (req, res) => {
    const user = readSession(req);
    if (user) audit(req, 'auth.logout', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    audit(req, 'auth.logout.all', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // Mobile app pairing: called from an already signed-in browser tab (Settings → "Pair the
  // mobile app") to mint a short code the phone can redeem below.
  'POST /api/pair/create': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const code = makePairCode();
    pairings.set(code, { uid: user.id, exp: Date.now() + 5 * 60000 });
    audit(req, 'auth.pair.create', { user });
    json(res, 200, { code });
  },

  // Called from the mobile app itself with the code shown in the browser. No session required —
  // the code IS the credential, one-shot and 5-minute-lived like a WebAuthn challenge.
  'POST /api/pair/redeem': async (req, res) => {
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    const p = pairings.get(code);
    if (p) pairings.delete(code);
    if (!p || p.exp < Date.now()) {
      audit(req, 'auth.pair.fail', { ok: false, msg: 'code-invalid' });
      return json(res, 400, { error: 'invalid or expired code' });
    }
    const user = db.users.find(u => u.id === p.uid);
    if (!user || user.disabled) {
      audit(req, 'auth.pair.fail', { ok: false, uid: p.uid, msg: 'user-unavailable' });
      return json(res, 400, { error: 'invalid or expired code' });
    }
    audit(req, 'auth.pair.ok', { user });
    json(res, 200, { token: makeSession(user), user: { id: user.id, name: user.name, admin: isAdmin(user) } });
  },

  'GET /api/data': async (req, res) => {
    if (dbError) return storageFailure(res, dbError);
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const record = readStateRecord(user.id);
      json(res, 200, { state: record.state, revision: record.etag }, { ETag: record.etag });
    } catch (e) { storageFailure(res, e); }
  },

  'PUT /api/data': async (req, res) => {
    if (!requireWritable(res) || receiptsError) return receiptsError ? storageFailure(res, receiptsError) : undefined;
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const expected = normalizeIfMatch(req.headers['if-match']);
    if (!expected) return json(res, 428, { error: 'If-Match precondition required' });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.state || typeof body.state !== 'object' || Array.isArray(body.state)) return json(res, 400, { error: 'state required' });
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (key.length > 200) return json(res, 400, { error: 'Idempotency-Key is too long' });
    const hash = requestHash(body.state);
    return withStateLock(user.id, async () => {
      let current;
      try { current = readStateRecord(user.id); } catch (e) { return storageFailure(res, e); }
      const prior = key && receipts.entries.find(e => e.uid === user.id && e.key === key);
      if (prior) {
        if (prior.hash !== hash) return json(res, 409, { error: 'idempotency key was already used for another request' });
        return json(res, 200, { ok: true, ts: prior.tsValue || null, revision: prior.revision }, { ETag: prior.revision });
      }
      if (expected !== current.etag) return json(res, 412, { error: 'stale revision', revision: current.etag }, { ETag: current.etag });
      const next = JSON.parse(JSON.stringify(body.state));
      delete next.active;                       // in-progress workouts stay device-local
      try {
        const text = JSON.stringify(next);
        const revision = etagFor(text);
        // `hash` remains the caller's exact request hash for receipt compatibility. `active` is
        // intentionally stripped from the durable profile, so the journal also records the hash
        // of those persisted bytes for crash-recovery validation.
        const receipt = key && { uid: user.id, key: key.slice(0, 200), hash, stateHash: requestHash(next), revision, tsValue: next._ts || null, ts: Date.now() };
        if (receipt) durableAtomicWrite(stateTxnFile(user.id), JSON.stringify({ state: next, receipt }), 0o600);
        durableStateWrite(stateFile(user.id), text);
        if (receipt) {
          receipts.entries.push(receipt);
          saveReceipts();
          durableUnlink(stateTxnFile(user.id));
        }
        json(res, 200, { ok: true, ts: next._ts || null, revision }, { ETag: revision });
      } catch (e) { storageFailure(res, e); }
    });
  },

  'POST /api/assets': async (req, res) => {
    if (!ASSETS_ENABLED) return json(res, 404, { error: 'feature disabled' });
    if (!requireWritable(res)) return;
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    let body;
    try { body = await readBody(req, 16 * 1024 * 1024); } catch (e) { return json(res, 400, { error: 'invalid image upload' }); }
    let image;
    try { image = imageBytes(body); } catch (e) { return json(res, 400, { error: e.message, code: e.code }); }
    const id = crypto.randomBytes(18).toString('base64url');
    const hash = crypto.createHash('sha256').update(image.bytes).digest('hex');
    try {
      durableAtomicWrite(assetFile(user.id, id), image.bytes, 0o600);
      json(res, 201, { asset: { id, mime: image.mime, size: image.bytes.length, sha256: hash } });
    } catch (e) { storageFailure(res, e); }
  },

  'POST /api/mcp/proposals': async (req, res) => {
    if (!MCP_ENABLED || !PROPOSALS_ENABLED) return json(res, 404, { error: 'feature disabled' });
    if (!requireWritable(res)) return;
    const grant = requireGrant(req, res, 'routine:propose');
    if (!grant) return;
    let body;
    try { body = await readBody(req, 256 * 1024); } catch { return json(res, 400, { error: 'bad json or proposal too large' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'routine draft is invalid' });
    const key = String(req.headers['idempotency-key'] || body.request_id || '').trim();
    if (!key || key.length > 200) return json(res, 400, { error: 'Idempotency-Key required' });
    return withStateLock(grant.uid, async () => {
      let record;
      try { record = readStateRecord(grant.uid); } catch (e) { return storageFailure(res, e); }
      const S = record.state || { routines: [], week: {}, dayPlan: {}, customEx: [], workouts: [], bodyweight: [] };
      const proposals = Array.isArray(S.proposals) ? S.proposals : [];
      const prior = proposals.find(p => p.requestId === key);
      if (prior) return json(res, 200, { proposal: prior, revision: record.etag }, { ETag: record.etag });
      if (proposals.length >= MAX_PROPOSALS) return json(res, 409, { error: 'proposal history is full; review existing proposals first' });
      const expected = normalizeIfMatch(req.headers['if-match']);
      if (!expected) return json(res, 428, { error: 'If-Match precondition required' });
      if (expected !== record.etag) return json(res, 412, { error: 'stale revision', revision: record.etag }, { ETag: record.etag });
      const draft = body.routine || body;
      if (!draft || typeof draft !== 'object' || !String(draft.name || '').trim() || !Array.isArray(draft.ex) || !draft.ex.length || draft.ex.length > 100) return json(res, 400, { error: 'routine draft is invalid' });
      const customIds = new Set((S.customEx || []).map(e => e.id));
      for (const ex of draft.ex) {
        if (!ex || !isSafeId(ex.id) || (!EXDB.some(e => e.id === ex.id) && !customIds.has(ex.id))) return json(res, 400, { error: 'routine contains an unknown exercise' });
        if (!Number.isFinite(Number(ex.sets)) || Number(ex.sets) < 1 || Number(ex.sets) > 100) return json(res, 400, { error: 'routine set count is invalid' });
      }
      const exerciseFields = ['reps', 'repsMin', 'sec', 'min', 'speed', 'weight', 'inc', 'bw', 'sg', 'policy', 'note'];
      const cleanExercises = draft.ex.map(ex => {
        const clean = { id: String(ex.id), sets: Number(ex.sets) };
        for (const field of exerciseFields) {
          if (ex[field] == null) continue;
          if (['sg', 'policy', 'note'].includes(field)) clean[field] = String(ex[field]).slice(0, 120);
          else if (Number.isFinite(Number(ex[field]))) clean[field] = Number(ex[field]);
        }
        return clean;
      });
      const proposal = {
        id: crypto.randomBytes(12).toString('base64url'), requestId: key, status: 'pending',
        created: new Date().toISOString(), routine: JSON.parse(JSON.stringify({ name: String(draft.name).trim().slice(0, 100), emoji: typeof draft.emoji === 'string' ? draft.emoji.slice(0, 16) : null, ex: cleanExercises }))
      };
      S.proposals = [...proposals, proposal];
      try {
        const revision = writeState(grant.uid, S);
        json(res, 201, { proposal, revision }, { ETag: revision });
      } catch (e) { storageFailure(res, e); }
    });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    const bad = pushEndpointError(sub.endpoint);
    if (bad) return json(res, 400, { error: bad });
    // Only the two keys the push protocol needs are kept: `sub` is caller-supplied and would
    // otherwise put arbitrary fields into db.json, which every admin route reads back out.
    const keys = { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) };
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    // A browser holds one subscription per device, so this cap is far above real use. Without
    // it a single account could pile up endpoints without limit — every one of them a target
    // sendPush() would then contact, and a whole rewrite of db.json per addition.
    const mine = db.subs.filter(s => s.userId === user.id);
    if (mine.length >= MAX_SUBS_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_SUBS_PER_USER + 1).map(s => s.endpoint));
      db.subs = db.subs.filter(s => !drop.has(s.endpoint));
    }
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, testPush(readState(user.id)?.lang));
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec, readState(user.id)?.lang);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    audit(req, u.disabled ? 'admin.user.disable' : 'admin.user.enable', { user: admin, target: u });
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    audit(req, 'admin.invite.create', { user: admin, msg: code });
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    audit(req, 'admin.invite.revoke', { user: admin, msg: inv.code });
    json(res, 200, { ok: true });
  },

  /* ---------- activity log ---------- */
  // Newest first, paged by id. Not by offset: the log grows at the front of this view, so an
  // offset cursor would repeat a row whenever an event lands between two pages; and not by
  // timestamp, because two events can share a millisecond. auditKeep() runs on read as well as
  // on the hourly compaction, so nothing past its retention is ever served.
  'GET /api/admin/audit': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const limit = Math.max(1, Math.min(200, +q.get('limit') || 100));
    const before = +q.get('before') || Infinity;
    const cat = q.get('cat') || '';
    let rows = auditKeep(auditLines()).reverse();
    if (cat === 'fail') rows = rows.filter(r => !r.ok);
    else if (cat) rows = rows.filter(r => String(r.ev).startsWith(cat + '.'));
    const page = rows.filter(r => r.id < before).slice(0, limit);
    json(res, 200, {
      events: page,
      total: rows.length,
      nextBefore: page.length === limit ? page[page.length - 1].id : null,
      enabled: AUDIT_ON, ip_mode: AUDIT_IP,
      retention: { max: AUDIT_MAX, days: AUDIT_DAYS },
      now: Date.now()
    });
  },

  // Deleting the log is itself logged, and auditSeq is not reset — so a clear always leaves a
  // visible gap in the ids and can't be used to quietly erase a trace. There is no export route:
  // ./data/audit.log already is the export, in a format jq reads directly.
  'POST /api/admin/audit/clear': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    try { fs.unlinkSync(auditFile); } catch { /* nothing logged yet */ }
    auditCount = 0;
    audit(req, 'admin.audit.clear', { user: admin });
    json(res, 200, { ok: true });
  }
};

async function serveAsset(req, res, id) {
  if (!isSafeId(id)) return json(res, 404, { error: 'not found' });
  const user = readSession(req);
  if (!user) return json(res, 401, { error: 'not signed in' });
  let record;
  try { record = readStateRecord(user.id); } catch (e) { return storageFailure(res, e); }
  const ref = assetRef(record.state, id);
  if (!ref) return json(res, 404, { error: 'not found' });
  const file = assetFile(user.id, id);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { return json(res, 404, { error: 'not found' }); }
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (ref.sha256 && ref.sha256 !== digest) return storageFailure(res, new Error('asset checksum mismatch'));
  res.writeHead(200, {
    'Content-Type': ref.mime || 'application/octet-stream', 'Content-Length': bytes.length,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'
  });
  res.end(bytes);
}

async function getProposal(req, res, id) {
  if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
  const grant = requireGrant(req, res);
  if (!grant) return;
  if (!grant.scopes.includes('routine:read') && !grant.scopes.includes('routine:propose')) {
    res.setHeader('WWW-Authenticate', 'Bearer error="insufficient_scope", scope="routine:read"');
    return json(res, 403, { error: 'insufficient_scope', scope: 'routine:read' });
  }
  let record;
  try { record = readStateRecord(grant.uid); } catch (e) { return storageFailure(res, e); }
  const proposal = (record.state?.proposals || []).find(p => p.id === id);
  if (!proposal) return json(res, 404, { error: 'no such proposal' });
  json(res, 200, { proposal, revision: record.etag }, { ETag: record.etag });
}

async function approveProposal(req, res, id) {
  if (!MCP_ENABLED || !PROPOSALS_ENABLED) return json(res, 404, { error: 'feature disabled' });
  if (!requireWritable(res)) return;
  const user = readSession(req);
  if (!user) return json(res, 401, { error: 'not signed in' });
  return withStateLock(user.id, async () => {
    let record;
    try { record = readStateRecord(user.id); } catch (e) { return storageFailure(res, e); }
    const S = record.state;
    const proposal = (S?.proposals || []).find(p => p.id === id);
    if (!proposal) return json(res, 404, { error: 'no such proposal' });
    if (proposal.status === 'approved' && proposal.routineId) {
      const routine = (S.routines || []).find(r => r.id === proposal.routineId) || null;
      return json(res, 200, { proposal, routine, revision: record.etag }, { ETag: record.etag });
    }
    if (proposal.status !== 'pending') return json(res, 409, { error: 'proposal is not pending' });
    const expected = normalizeIfMatch(req.headers['if-match']);
    if (!expected) return json(res, 428, { error: 'If-Match precondition required' });
    if (expected !== record.etag) return json(res, 412, { error: 'stale revision', revision: record.etag }, { ETag: record.etag });
    const routine = { ...JSON.parse(JSON.stringify(proposal.routine)), id: crypto.randomBytes(12).toString('base64url') };
    S.routines = [...(S.routines || []), routine];
    proposal.status = 'approved'; proposal.routineId = routine.id; proposal.approved = new Date().toISOString();
    try {
      const revision = writeState(user.id, S);
      json(res, 200, { proposal, routine, revision }, { ETag: revision });
    } catch (e) { storageFailure(res, e); }
  });
}

http.createServer(async (req, res) => {
  // Same-origin (the deployed nginx-proxied web app) never triggers CORS, so this only matters
  // for the paired mobile app calling in from its own WebView origin. It carries no cookie
  // (auth is the Authorization header instead), so Allow-Credentials is deliberately never set —
  // reflecting the origin here can't expose the cookie session to anyone.
  const origin = req.headers.origin;
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-Match, Idempotency-Key',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  if (dbError && key !== 'GET /api/health') return storageFailure(res, dbError);
  if (url.pathname.startsWith('/api/assets/') && req.method === 'GET') return serveAsset(req, res, url.pathname.slice('/api/assets/'.length));
  const oauthClientMatch = /^\/api\/oauth\/clients\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (oauthClientMatch && req.method === 'GET') {
    if (!MCP_ENABLED) return json(res, 404, { error: 'feature disabled' });
    if (oauthClientsError) return storageFailure(res, oauthClientsError);
    const client = oauthClients.clients.find(c => c.clientId === oauthClientMatch[1]);
    return client ? json(res, 200, oauthClientView(client)) : json(res, 404, { error: 'unknown client' });
  }
  const proposalMatch = /^\/api\/mcp\/proposals\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (proposalMatch && req.method === 'GET') return getProposal(req, res, proposalMatch[1]);
  if (proposalMatch && req.method === 'POST') {
    if (!csrfOk(req, key)) return json(res, 403, { error: 'cross-origin request refused' });
    return approveProposal(req, res, proposalMatch[1]);
  }
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  if (!csrfOk(req, key)) {
    // Logged, not audited: this is reachable without a session, and an audit entry per attempt
    // would let anyone fill the log. An operator who has genuinely mis-set ORIGIN needs to see
    // the mismatch, and the container log is where they will look.
    console.warn('refused cross-origin', key, 'origin=' + req.headers.origin, 'expected=' + ORIGIN);
    return json(res, 403, { error: 'cross-origin request refused' });
  }
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
