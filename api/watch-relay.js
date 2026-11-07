/* The watch relay: a mailbox on the user's own server for watches whose phone app cannot be
 * openGym's (docs/ZEPP_OS.md). A Zepp OS watch talks to the phone through a "Side Service" that runs
 * inside the Zepp app, not inside openGym, so the two meet here instead of on the phone:
 *
 *   openGym (phone or web)  --PUT snapshot-->  [ this mailbox ]  <--GET snapshot--  Side Service
 *   openGym (phone or web)  <--GET events---   [ this mailbox ]  <--POST events---  Side Service
 *
 * The messages are exactly the Apple Watch's (frontend/src/lib/watch-sync.js): the snapshot as the
 * page builds it, the events as the page applies them. Nothing here reads either one beyond what
 * keeps the mailbox sane (sizes, ids, types); the page stays the only place that applies them.
 *
 * A watch link is a token of its own, never a session: it reaches the two mailbox routes and
 * nothing else, it is stored only as a SHA-256 (a copy of db.json holds no token that works), and
 * it carries the account's session version, so "sign out everywhere", a new password and a
 * disabled account end it with every session. A link nobody used for WATCH_IDLE_MS is dropped.
 *
 * Pure bookkeeping on `db.watchLinks` and on one mailbox object per profile; the routes, the
 * throttle, the audit and the file are server.js's. */
import crypto from 'node:crypto';

// Long enough to find the Zepp app's settings page and type the code; short enough to be dead by
// the time anyone who photographed the screen could use it.
export const WATCH_CODE_TTL_MS = 10 * 60 * 1000;
export const WATCH_IDLE_MS = 90 * 24 * 3600 * 1000;
export const WATCH_LINKS_MAX = 5;
// The page keeps its snapshots under 48 KB (watch-sync.js SNAPSHOT_MAX_BYTES); room to spare.
export const SNAPSHOT_MAX_BYTES = 64 * 1024;
export const EVENT_MAX_BYTES = 4096;
export const EVENTS_PER_POST = 50;
export const QUEUE_MAX = 500;
// An event the page never came to fetch in two weeks is about a workout long over.
export const EVENT_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
export const EVENT_TYPES = new Set(['start', 'setDone', 'setHr', 'finish', 'discard', 'watchStatus', 'weighIn']);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const clean = code => (typeof code === 'string' ? code : '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sha = (tag, v) => crypto.createHash('sha256').update(tag + v).digest('hex');
const sameHash = (a, b) => {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/* ---------- pairing codes (in memory: a restart only means asking for a new one) ---------- */

/** A new code for `userId`, replacing the one before. 12 characters, 60 bits, typed as XXXX-XXXX-XXXX. */
export function createWatchCode(codes, userId, now = Date.now()) {
  for (const [k, v] of codes) if (v.userId === userId || v.exp <= now) codes.delete(k);
  const raw = Array.from(crypto.randomBytes(CODE_LENGTH), b => ALPHABET[b % ALPHABET.length]).join('');
  codes.set(sha('opengym-watch-code:', raw), { userId, exp: now + WATCH_CODE_TTL_MS });
  return { code: raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8), exp: now + WATCH_CODE_TTL_MS };
}

/** The profile a code belongs to, and the code used up; null for a wrong, used or expired one. */
export function takeWatchCode(codes, code, now = Date.now()) {
  const c = clean(code);
  if (c.length !== CODE_LENGTH) return null;
  const h = sha('opengym-watch-code:', c);
  for (const [k, v] of codes) {
    if (!sameHash(k, h)) continue;
    codes.delete(k);
    return v.exp > now ? v.userId : null;
  }
  return null;
}

export function dropWatchCodes(codes, userId) {
  for (const [k, v] of codes) if (v.userId === userId) codes.delete(k);
}

/* ---------- links ---------- */

const linkName = v => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Zepp OS watch';

function prune(db, now) {
  db.watchLinks = (db.watchLinks || []).filter(l => l && typeof l.h === 'string' && now - (l.seen || l.created || 0) < WATCH_IDLE_MS);
}

/**
 * A new link for `user` (its session version `sv`): → { token, link }. The token is returned once
 * and never stored. Past WATCH_LINKS_MAX the least recently used link of the profile goes.
 */
export function createWatchLink(db, userId, sv, name, now = Date.now()) {
  prune(db, now);
  const token = 'ogw_' + crypto.randomBytes(32).toString('base64url');
  const link = { id: crypto.randomBytes(6).toString('hex'), userId, sv, h: sha('opengym-watch:', token), name: linkName(name), created: now, seen: now };
  const mine = db.watchLinks.filter(l => l.userId === userId).sort((a, b) => (a.seen || 0) - (b.seen || 0));
  const drop = new Set(mine.slice(0, Math.max(0, mine.length - WATCH_LINKS_MAX + 1)));
  db.watchLinks = db.watchLinks.filter(l => !drop.has(l)).concat(link);
  return { token, link };
}

/** The live link a token stands for, or null. `svOf(userId)` is the account's session version, null when it may not sign in. */
export function findWatchLink(db, token, svOf, now = Date.now()) {
  if (typeof token !== 'string' || !token.startsWith('ogw_') || token.length > 100) return null;
  const h = sha('opengym-watch:', token);
  const link = (db.watchLinks || []).find(l => l && typeof l.h === 'string' && sameHash(l.h, h));
  if (!link || now - (link.seen || link.created || 0) >= WATCH_IDLE_MS) return null;
  const sv = svOf(link.userId);
  return sv != null && sv === link.sv ? link : null;
}

/** Marks a link used; true when that is worth a save (at most once an hour per link). */
export function touchWatchLink(link, now = Date.now()) {
  if (now - (link.seen || 0) < 3600e3) return false;
  link.seen = now;
  return true;
}

/** A profile's links as Settings lists them: no hash. */
export const listWatchLinks = (db, userId) => (db.watchLinks || [])
  .filter(l => l && l.userId === userId)
  .map(l => ({ id: l.id, name: l.name, created: l.created, seen: l.seen }));

/** One link gone (`id`), or all of a profile's (no `id`). Says whether anything went. */
export function dropWatchLinks(db, userId, id = null) {
  const before = (db.watchLinks || []).length;
  db.watchLinks = (db.watchLinks || []).filter(l => !(l && l.userId === userId && (id == null || l.id === id)));
  return db.watchLinks.length !== before;
}

/* ---------- the mailbox ---------- */

/** A mailbox read back from its file (or nothing): always the full shape. */
export function boxOf(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    snapshot: typeof b.snapshot === 'string' ? b.snapshot : null,
    snapAt: Number(b.snapAt) || 0,
    events: Array.isArray(b.events) ? b.events.filter(e => e && typeof e.id === 'string' && e.ev && typeof e.ev === 'object') : [],
  };
}

/** The page's snapshot, as the JSON text it sends to its watches. → null when it is not one. */
export function snapshotText(json) {
  if (typeof json !== 'string' || !json || Buffer.byteLength(json) > SNAPSHOT_MAX_BYTES) return null;
  let v;
  try { v = JSON.parse(json); } catch { return null; }
  return v && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(v.v) ? json : null;
}

export function putSnapshot(box, json, now = Date.now()) {
  const text = snapshotText(json);
  if (!text) return false;
  box.snapshot = text;
  box.snapAt = now;
  return true;
}

// One event from the watch that holds up: an object with a short string id and a known type, small.
function eventOk(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return false;
  if (typeof ev.id !== 'string' || !ev.id || ev.id.length > 80) return false;
  if (!EVENT_TYPES.has(ev.type)) return false;
  try { return Buffer.byteLength(JSON.stringify(ev)) <= EVENT_MAX_BYTES; } catch { return false; }
}

/**
 * Events from a watch, queued in order. → the ids the watch may forget: queued now, queued before,
 * or refused for good (malformed). Ids missing from the answer (the queue is full) are sent again.
 */
export function pushEvents(box, events, now = Date.now()) {
  const done = [];
  if (!Array.isArray(events)) return done;
  box.events = box.events.filter(e => now - (e.at || 0) < EVENT_MAX_AGE_MS);
  const have = new Set(box.events.map(e => e.id));
  for (const ev of events.slice(0, EVENTS_PER_POST)) {
    if (!eventOk(ev)) { if (ev && typeof ev.id === 'string' && ev.id.length <= 80) done.push(ev.id); continue; }
    if (have.has(ev.id)) { done.push(ev.id); continue; }
    if (box.events.length >= QUEUE_MAX) break;
    box.events.push({ id: ev.id, at: now, ev });
    have.add(ev.id);
    done.push(ev.id);
  }
  return done;
}

/** What waits for the page, oldest first. */
export const queuedEvents = (box, now = Date.now()) => box.events.filter(e => now - (e.at || 0) < EVENT_MAX_AGE_MS).map(e => e.ev);

/** The page applied these: out of the queue. Says whether anything went. */
export function ackEvents(box, ids) {
  if (!Array.isArray(ids)) return false;
  const gone = new Set(ids.filter(x => typeof x === 'string'));
  const before = box.events.length;
  box.events = box.events.filter(e => !gone.has(e.id));
  return box.events.length !== before;
}
