/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import * as coachConfig from './coach/config.js';
import * as coachJobs from './coach/jobs.js';
import { coachRoutes } from './coach/routes.js';
import { startCadence } from './coach/cadence.js';
import { startWarmup } from './coach/warmup.js';
import { dayReminderPush, restTimerPush, testPush } from './push-messages.js';
import { verifyError } from './verify-error.js';
import { socialRoutes } from './social/routes.js';

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
const MAX_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });
/* The secrets are locked down file by file rather than by sealing the whole directory.
 *
 * A blanket `chmod 0700` on DATA looks stronger and is worse: ./data is a host bind mount and
 * this container runs as root, so it lands on the host as root-owned 0700 and anything else
 * the owner runs against their own data directory — a backup script, the MCP server in #19,
 * their own `jq` — gets EACCES on files that are theirs. Locking the four files that actually
 * hold secrets keeps the Coach runtime out of them without taking the directory hostage.
 *
 * Best-effort throughout: a bind-mounted host filesystem may refuse chmod, and that is not a
 * reason to refuse to boot. The privilege drop in adapters/spawn.js is the control that does
 * fail closed. */
const lock = f => { try { fs.chmodSync(path.join(DATA, f), 0o600); } catch { /* not present yet, or host says no */ } };
['secret', 'db.json', 'coach.json'].forEach(lock);

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
// 0600: db.json holds passkey credential material. It used to be covered by a blanket 0700 on
// the whole directory; now that the directory stays traversable, the file carries its own mode.
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2), 0o600); }
function atomicWrite(file, content, mode) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

const socialFile = path.join(DATA, 'social.json');
function loadSocial() {
  try { return JSON.parse(fs.readFileSync(socialFile, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return { connections: [], plans: [] };
    throw e;
  }
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
      the request itself uses, not in a prior pass. A literal IP address never goes through
      that lookup at all — Node hands it straight to connect() — so literals are judged by
      pushEndpointError instead: at subscribe, and again in sendPush for an endpoint that got
      into db.json some other way.
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
  // IPv6 is judged on its eight groups, never on the text: the same address arrives as
  // `::ffff:127.0.0.1` from dns.lookup, as `::ffff:7f00:1` from new URL, and in whatever
  // spelling a caller chose, and a rule keyed to one spelling misses the others.
  const g = ipv6Groups(v);
  if (!g) return false;
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) {     // IPv4-mapped IPv6
    return isPrivateAddr(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if (g.slice(0, 7).every(x => x === 0) && g[7] <= 1) return true; // unspecified, loopback
  if ((g[0] & 0xffc0) === 0xfe80) return true;                    // link-local fe80::/10
  if ((g[0] & 0xfe00) === 0xfc00) return true;                    // unique local fc00::/7
  return false;
}

// The eight 16-bit groups of an IPv6 literal in any textual form — compressed, zero-padded,
// upper-case, with a dotted IPv4 tail — or null when the string is not one.
function ipv6Groups(v) {
  if (!net.isIPv6(v)) return null;
  let s = v.replace(/%.*$/, '');                                  // zone id
  const m4 = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (m4) {
    const [a, b, c, d] = m4[1].split('.').map(Number);
    s = s.slice(0, -m4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail = ''] = s.split('::');
  const groups = head ? head.split(':') : [];
  const rest = tail ? tail.split(':') : [];
  if (s.includes('::')) while (groups.length + rest.length < 8) groups.push('0');
  return groups.concat(rest).map(x => parseInt(x, 16));
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
// than silently never delivering. For a hostname PUSH_AGENT is what actually enforces the address
// rule; for a literal address this is the check, which is why sendPush runs it again.
function pushEndpointError(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'endpoint is not a valid URL'; }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL';
  if (u.username || u.password) return 'endpoint must not carry credentials';
  // A literal address is judged right here — and only here: Node hands a literal straight to
  // connect() without consulting the Agent's lookup. Hostnames are left to PUSH_AGENT, which is
  // the check that has to hold against rebinding.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddr(host)) return 'endpoint must not point at a private address';
  }
  return null;
}

// `deviceId` narrows the send to the subscriptions one browser registered (the rest-timer alert
// belongs to the device that started the rest); a subscription stored without one — an older
// client — still gets everything, as before.
async function sendPush(userId, payload, deviceId) {
  let subs = db.subs.filter(s => s.userId === userId);
  if (deviceId && subs.some(s => s.deviceId === deviceId)) subs = subs.filter(s => s.deviceId === deviceId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  let next = 0;
  const worker = async () => {
    while (next < subs.length) {
      const sub = subs[next++];
      // Re-judged before every send: PUSH_AGENT never sees a literal address, so an endpoint
      // that is private (however it got into db.json) is dropped here rather than connected to.
      const bad = pushEndpointError(sub.endpoint);
      if (bad) {
        console.error('push endpoint refused', userId, bad);
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
        continue;
      }
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
        // 404/410: the push service says the subscription is gone. 403: it refuses our VAPID
        // signature — a subscription made against a key this instance no longer has (data/vapid.json
        // regenerated). Neither will ever deliver again; keeping them only hides the fact from the
        // Settings toggle, which reads the browser's side. The client re-subscribes on its next boot.
        if (e.statusCode === 404 || e.statusCode === 410 || e.statusCode === 403) {
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
// One timer per device, not per account: a phone resting in the gym and a desktop tab at home
// each carry their own, so the tab's on-screen completion (which cancels) cannot silence the
// phone's alert. A client that sends no device id gets the old account-wide behaviour.
// In memory only — an API restart drops whatever is pending.
const restTimers = new Map(); // `${userId}:${deviceId}` -> Timeout
const restKey = (userId, deviceId) => `${userId}:${deviceId || ''}`;
function scheduleRestTimer(userId, deviceId, sec, lang) {
  const k = restKey(userId, deviceId);
  const t = restTimers.get(k);
  if (t) clearTimeout(t);
  restTimers.set(k, setTimeout(() => {
    restTimers.delete(k);
    sendPush(userId, restTimerPush(lang), deviceId);
  }, sec * 1000));
}
function cancelRestTimer(userId, deviceId) {
  // no device id: an older client — clear everything the account has pending, as it always did
  for (const [k, t] of restTimers) {
    if (deviceId ? k === restKey(userId, deviceId) : k.startsWith(userId + ':')) { clearTimeout(t); restTimers.delete(k); }
  }
}
// A device id is what the browser made up for itself (lib/push.js): one short token per browser
// profile, nothing identifying. Anything else is treated as absent.
const deviceIdOf = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : undefined);

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
// A weekday can hold a routine-id list (combine routines); the reminder only needs the first.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return [].concat(S.week?.[wd] || []).find(id => S.routines?.some(r => r.id === id)) || null;
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
    const date = `${g('year')}-${g('month')}-${g('day')}`;
    // Weekday is derived from the zone's own date, not the server's — a Sunday-evening review
    // has to be Sunday where the user is, which is what the reminder already assumes for time.
    return { date, hhmm: `${g('hour')}:${g('minute')}`, weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
// The tick used to want the exact minute: `reminder.time === now.hhmm`, checked every 10 s. Any
// restart, redeploy or stalled event loop across that one minute lost the whole day's reminder —
// "sometimes it just doesn't come". A reminder that is due is now sent for up to this many
// minutes after its time, once per local date (`user.lastReminder`); later than that it is
// skipped rather than delivered at a time nobody asked for.
const REMINDER_WINDOW_MIN = 15;
// How often the tick looks. 10 s keeps a reminder within ~9 s of its minute; the tests shorten it.
const REMINDER_TICK_MS = Math.max(50, +(process.env.REMINDER_TICK_MS || 10000));
const hhmmToMin = v => {
  const m = /^(\d{2}):(\d{2})$/.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
// Minutes since the reminder's time on the user's clock; negative before it, NaN when either
// side does not parse. Same-day only — a 23:55 reminder is not owed at 00:05 the next day.
const minutesLate = (time, now) => hhmmToMin(now.hhmm) - hhmmToMin(time);
// The tick reads every subscribed user's state file every 10 s. Most of those files do not
// change between ticks; a stat is far cheaper than a read and a parse of a state that can be
// megabytes, and it keeps the tick short — a slow tick was one more way to miss the minute.
const stateCache = new Map(); // uid -> { mtimeMs, size, S }
function readStateCached(uid) {
  let st;
  try { st = fs.statSync(stateFile(uid)); } catch { stateCache.delete(uid); return null; }
  const hit = stateCache.get(uid);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.S;
  const S = readState(uid);
  stateCache.set(uid, { mtimeMs: st.mtimeMs, size: st.size, S });
  return S;
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    // One user's state file is one user's problem: a shape this tick cannot read is logged and
    // skipped, not allowed to take the process — and everyone else's reminders — down with it.
    // PUT /api/data refuses the obvious shapes, but a file already on disk answers to nobody.
    try {
      const S = readStateCached(user.id);
      if (!S?.reminder?.on) continue;
      const now = userNow(S.reminder.tz || 'UTC');
      if (!now) continue;
      const late = minutesLate(S.reminder.time, now);
      if (!(late >= 0 && late <= REMINDER_WINDOW_MIN)) continue;
      if (user.lastReminder === now.date) continue;
      if ((S.workouts || []).some(w => w.d === now.date)) continue;
      const rid = effectiveRoutineId(S, now.date);
      if (!rid) continue; // rest day — nothing planned
      const routine = (S.routines || []).find(r => r.id === rid);
      console.log('reminder firing', user.id, rid);
      user.lastReminder = now.date;
      saveDb();
      sendPush(user.id, dayReminderPush(S.lang, routine));
    } catch (e) {
      console.error('reminder tick', user.id, e);
    }
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, REMINDER_TICK_MS).unref();

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
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
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
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in. `coach` is absent unless
  // the instance has both switched the Coach on and successfully connected a provider — the
  // single flag every piece of Coach UI hangs off, so an unconfigured instance is byte-for-byte
  // the app it was before the feature existed.
  'GET /api/config': async (req, res) => {
    const coach = coachConfig.publicConfig();
    json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST, ...(coach ? { coach } : {}) });
  },

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
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
    // An unredeemed pairing code is a session-in-waiting for this account; it goes too.
    for (const [k, v] of pairings) if (v.uid === user.id) pairings.delete(k);
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

  // `rev` is the server's own count of writes to this profile (also stored inside the document as
  // `_rev`, so every other reader of the file — reminder tick, admin, Coach, MCP — is unaffected).
  // A client pushes it back as `baseRev`, and a write over a document it never saw is refused.
  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const state = readState(user.id);
    json(res, 200, { state, rev: state?._rev || 0 });
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    // The reminder tick and the admin routes iterate these two on the server's side, so a truthy
    // non-array would throw there on every pass for as long as it sat on disk. Absent or null is
    // fine — every client fills its own defaults.
    const list = v => v == null || Array.isArray(v);
    if (!list(body.state.workouts) || !list(body.state.routines)) return json(res, 400, { error: 'invalid state' });
    // Conditional write: a `baseRev` that is not the current revision means this client last
    // read an older document — another device has written since — and the copy it is about to
    // push would silently drop that write. The current document travels back with the 409, so
    // the client can merge and try again without a second request. No `baseRev` (a client from
    // before revisions, or a deliberate replace such as a backup import) overwrites, as before.
    // readState and atomicWrite are synchronous with nothing awaited between them, so the
    // compare-and-write is atomic for this process.
    const cur = readState(user.id);
    const curRev = cur?._rev || 0;
    if (body.baseRev != null && body.baseRev !== curRev) {
      return json(res, 409, { error: 'conflict', rev: curRev, state: cur });
    }
    delete body.state.active;              // in-progress workouts stay device-local
    body.state._rev = curRev + 1;          // server-owned; whatever the client sent is ignored
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    json(res, 200, { ok: true, ts: body.state._ts || null, rev: body.state._rev });
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
    const deviceId = deviceIdOf(body.deviceId);
    // An upsert: the client re-sends its subscription on every boot (lib/push.js) so a row this
    // instance lost — pruned after a dead send, a rebuilt db.json — comes back without anyone
    // touching Settings. The same endpoint sent again keeps its original `created`.
    const prev = db.subs.find(s => s.endpoint === sub.endpoint);
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    // A browser holds one subscription per device, so this cap is far above real use. Without
    // it a single account could pile up endpoints without limit — every one of them a target
    // sendPush() would then contact, and a whole rewrite of db.json per addition.
    const mine = db.subs.filter(s => s.userId === user.id);
    if (mine.length >= MAX_SUBS_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_SUBS_PER_USER + 1).map(s => s.endpoint));
      db.subs = db.subs.filter(s => !drop.has(s.endpoint));
    }
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys, ...(deviceId ? { deviceId } : {}), created: prev?.created || new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  // Whether this instance still holds the caller's subscription for `endpoint`. The browser's
  // side (PushManager.getSubscription) says nothing about ours — a row pruned after a dead send
  // leaves the browser subscribed to nowhere — so Settings asks here before it shows "on".
  'GET /api/push/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const endpoint = new URL(req.url, 'http://x').searchParams.get('endpoint') || '';
    json(res, 200, { subscribed: db.subs.some(s => s.userId === user.id && s.endpoint === endpoint) });
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
    scheduleRestTimer(user.id, deviceIdOf(body.deviceId), sec, readState(user.id)?.lang);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    cancelRestTimer(user.id, deviceIdOf(body.deviceId));
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
  },

  ...socialRoutes({ json, readBody, readSession, users: () => db.users, readState,
    load: loadSocial, save: data => atomicWrite(socialFile, JSON.stringify(data), 0o600), secret: SECRET, userNow }),

  /* ---------- AI Coach ---------- */
  // Routes live in coach/routes.js and are handed the helpers above rather than importing
  // them: they are closures over db and SECRET, and passing them in keeps that module free of
  // a cycle. Every one of them is inert while the feature is unconfigured.
  ...coachRoutes({ json, readBody, readSession, requireAdmin })
};

/* ---------- Coach: boot recovery, notifications, scheduled reviews ---------- */
// A job that was running when the process died is not coming back; say so rather than leaving
// a spinner that never resolves.
coachJobs.recoverOnBoot();
// A ready proposal is the one Coach event worth a notification. Failures and "nothing to
// change" stay silent on purpose (FR-38/E4).
coachJobs.setProposalHook((uid, pending) => {
  const n = (pending?.changes || []).length;
  if (!n) return;
  sendPush(uid, {
    title: 'Your Coach has been reading',
    body: n === 1 ? '1 suggestion after this week' : `${n} suggestions after this week`,
    tag: 'coach-proposal', url: '#/coach'
  });
});
startCadence({ users: () => db.users, userNow });
startWarmup();

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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  // A target that does not parse (`//`, `//api%2Fhealth`) is a bad request, not a server error —
  // and the try below only covers the route handler, so it is refused here.
  let url;
  try { url = new URL(req.url, 'http://x'); }
  catch { return json(res, 400, { error: 'bad request' }); }
  const key = req.method + ' ' + url.pathname;
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
