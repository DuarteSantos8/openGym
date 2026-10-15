/* What the hub's data routes (sync-routes.js) read out of a profile's state and write back into it,
 * kept free of I/O so each rule can be tested on its own.
 *
 * Workouts. The state is one document with no record of when each workout changed, only the
 * revision of the whole. So the routes keep, per profile and in memory, a change log
 * (trackWorkouts): for every workout the revision at which its summary was last seen to change,
 * and for every workout that went away the revision at which it did. The log only learns at a
 * read, so a change made at revision 9 and first read at 12 is logged at 12. A pass of the
 * workouts route ends with `next_since`, a token naming this log (`epoch`) and the revision it was
 * read at, and no other route ever hands one out. The next pass, given that token, lists every
 * entry of the log past that revision: everything the hub has not yet received, however many
 * answers in between were lost on the way, as long as it sends the last token it did receive.
 * Anything else as `since` (a revision from another route, a token of a log that started over: a
 * restart, the profile's data going back in time) gets a `full` pass: everything.
 *
 * Body weight. One value per date, in kg on the wire and in the profile's unit in the state, like
 * the app's own weigh-in (frontend lib/units.js convertBodyWeight: to 0.1 in the stored unit).
 *
 * Dates are the strings the state holds. Nothing here turns an instant into a calendar date. */
import crypto from 'node:crypto';
import { highestStamp } from './sync-stamps.js';

const LB_PER_KG = 2.2046226218;
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);
const round2 = v => Math.round(v * 100) / 100;
const instant = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
// At most `n` characters, never cutting a character in two.
const clip = (s, n) => (s.length <= n ? s : Array.from(s).slice(0, n).join(''));

export const unitOf = S => (S?.unit === 'lb' ? 'lb' : 'kg');
// A stored body weight in kg, to 0.01: fine enough that kg on the wire and back to lb lands on the
// same 0.1 lb it started from.
export const toKg = (w, unit) => round2(unit === 'lb' ? w / LB_PER_KG : w);
// kg from the wire as the profile stores a weigh-in: in its unit, to 0.1.
export const fromKg = (kg, unit) => Math.round((unit === 'lb' ? kg * LB_PER_KG : kg) * 10) / 10;

/** A calendar date as `YYYY-MM-DD`, and a real one (no 2026-02-30). */
export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** A date the hub may name: a real one from 1900-01-01 to tomorrow (UTC, so every zone's today fits). */
export function isSyncDate(s, now = Date.now()) {
  return isDate(s) && s >= '1900-01-01' && s <= new Date(now + 86400000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ workouts */

// What a workout's text fields can be on the wire. The app makes ids of a dozen characters; an
// imported or hand-edited state can hold anything, and a page must stay a page.
export const ID_MAX = 128;
export const NAME_MAX = 200;

// The id a workout goes by on the wire: its own, or for one without (an import from before ids)
// the data contract's `d<date>s<start>`. One with neither has no stable name and is left out.
export function workoutId(w) {
  if (w?.id != null) return clip(String(w.id), ID_MAX);
  if (w?.start == null) return null;
  return clip(`d${w.d}s${w.start}`, ID_MAX);
}
// The same, from a key of `deleted.workouts` (sync-stamps.js workoutKey: the id, or `d|start`).
// App ids are base-36 and never hold a `|`.
const idOfKey = k => {
  const i = k.lastIndexOf('|');
  return clip(i < 0 ? k : `d${k.slice(0, i)}s${k.slice(i + 1)}`, ID_MAX);
};

// Done rows of a set: the set, or for a per-side set either side ticked.
const isDone = s => s.done === true ||
  (isMap(s.sides) && isMap(s.sides.L) && isMap(s.sides.R) && (s.sides.L.done === true || s.sides.R.done === true));

/**
 * A finished workout as the hub reads it: what it needs to post the session elsewhere and estimate
 * its energy, never the sets themselves. The server has no exercise library, so a cardio row is one
 * its exercise's target calls cardio, or that logged minutes without a target saying otherwise
 * (cardio sets are stored as `min` and `speed` in km/h, lib/speed.js). `content_hash` covers every
 * field but `edited_at`, so a change the hub cannot see (a note, a photo) does not count as one.
 */
export function workoutItem(w, unit) {
  const id = workoutId(w);
  if (id == null) return null;
  let done = 0, strength = 0;
  const cardio = [];
  for (const e of list(w.entries)) {
    if (!isMap(e)) continue;
    const mode = isMap(e.target) ? e.target.mode : undefined;
    for (const s of list(e.sets)) {
      if (!isMap(s) || !isDone(s)) continue;
      done++;
      const min = Number(s.min) > 0 ? Number(s.min) : 0;
      if (mode === 'cardio' || (mode !== 'reps' && mode !== 'time' && min > 0)) {
        const speed = Number(s.speed) > 0 ? Number(s.speed) : null;
        cardio.push({ min, speed_kmh: speed, km: speed && min ? round2(speed * min / 60) : null });
      } else strength++;
    }
  }
  const start = instant(w.start), end = instant(w.end);
  const bw = Number(w.bw);
  const facts = {
    id,
    date: typeof w.d === 'string' && isDate(w.d) ? w.d : null,
    start, end,
    duration_min: start && end && end > start ? Math.round((end - start) / 60000) : null,
    name: typeof w.name === 'string' ? clip(w.name, NAME_MAX) : null,
    routine_id: w.routineId != null ? clip(String(w.routineId), ID_MAX) : null,
    sets_done: done,
    strength_sets: strength,
    cardio,
    distance_km: cardio.some(c => c.km != null) ? round2(cardio.reduce((n, c) => n + (c.km || 0), 0)) : null,
    // To 0.1, not 0.01, and straight from the stored value: a unit switch converts every stored
    // `bw` and back lands on the same 0.1 kg (lib/units.js), so the hash of every workout does not
    // move with it.
    bodyweight_kg: bw > 0 ? Math.round((unit === 'lb' ? bw / LB_PER_KG : bw) * 10) / 10 : null
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex');
  return { ...facts, edited_at: instant(Number(w._ts)), content_hash: 'sha256:' + hash };
}

/** Every workout of `S` as the hub reads it, by id (the first of two with one id). */
export function workoutItems(S) {
  const unit = unitOf(S);
  const items = new Map();
  for (const w of list(S?.workouts)) {
    if (!isMap(w)) continue;
    const it = workoutItem(w, unit);
    if (it && !items.has(it.id)) items.set(it.id, it);
  }
  return items;
}

// Past this many removals on record the log starts over rather than grow: a hub asking from before
// that is given everything again, which is always correct.
const GONE_MAX = 5000;
// Which start of a log a token or a cursor was made against: a log can start over at the revision
// it had, and after a restart a counter would repeat, so it is random.
const newEpoch = () => crypto.randomBytes(6).toString('hex');
// The log keeps a short hash per workout, not the summary: it only needs to tell a change.
const short = item => item.content_hash.slice(7, 23);

/**
 * The change log of a profile's workouts, brought up to `S` (see the top of this file), whose
 * summaries are `items` (workoutItems). `log` is the previous one (or undefined); the result is it,
 * updated, or a new one. { epoch, rev, wid, seen: Map<id, {rev, hash}>, gone: Map<id, {rev, at}> }
 */
export function trackWorkouts(log, S, items = workoutItems(S)) {
  const rev = Number(S?._rev) || 0, wid = typeof S?._wid === 'string' ? S._wid : null;
  if (log && log.rev === rev && log.wid === wid) return log;
  const removed = new Map();
  if (isMap(S?.deleted?.workouts)) {
    for (const [k, at] of Object.entries(S.deleted.workouts)) if (Number(at) > 0) removed.set(idOfKey(k), Number(at));
  }
  // Only a later revision is a continuation. The same number or a lower one with another write id
  // is the data directory gone back in time (a restored backup): start over.
  if (!log || rev <= log.rev || log.gone.size > GONE_MAX) {
    const fresh = { epoch: newEpoch(), rev, wid, seen: new Map(), gone: new Map() };
    for (const [id, it] of items) fresh.seen.set(id, { rev, hash: short(it) });
    for (const [id, at] of removed) if (!items.has(id)) fresh.gone.set(id, { rev, at });
    return fresh;
  }
  for (const [id, it] of items) {
    const was = log.seen.get(id);
    if (!was || was.hash !== short(it)) log.seen.set(id, { rev, hash: short(it) });
    log.gone.delete(id);
  }
  for (const id of [...log.seen.keys()]) {
    if (items.has(id)) continue;
    log.seen.delete(id);
    log.gone.set(id, { rev, at: removed.get(id) ?? null });
  }
  Object.assign(log, { rev, wid });
  return log;
}

// Tokens and cursors are base64url JSON. Neither is a secret: each is read against the caller's
// own log only, and a made-up one is at worst a pass the hub asked to miss things from.
const TOKEN_MAX = 4096;
const encode = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function decode(s) {
  if (typeof s !== 'string' || !s || s.length > TOKEN_MAX || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try { const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); return isMap(v) ? v : null; } catch { return null; }
}
/** A cursor this module handed out, or null for anything else. */
export function decodeCursor(s) {
  const c = decode(s);
  if (!c || !Number.isInteger(c.s) || typeof c.f !== 'boolean' || typeof c.b !== 'string' ||
      !Number.isInteger(c.r) || typeof c.k !== 'string' || c.k.length > ID_MAX * 2) return null;
  return c;
}
// A `since` token of `log`: the revision a pass of it ended at, or null for anything else.
function sinceOf(log, token) {
  const t = decode(token);
  return t && t.e === log.epoch && Number.isInteger(t.r) && t.r >= 0 && t.r <= log.rev ? t.r : null;
}

// A page stops at `limit` entries or at about this many bytes of them, whichever comes first.
const PAGE_BYTES = 256 * 1024;

/**
 * One page of what changed since the pass `since` (a `next_since` token) ended, in revision order
 * (then id), from `log` and the current summaries `items`: workouts changed and workouts gone, each
 * at most once per page. `full` says the pass lists every workout there is (and every removal on
 * record): no `since`, or one that is not a token of this log. A cursor carries the pass on; if the
 * log started over in between, the pass starts over too, in full. The last page carries
 * `next_since`, for the next pass.
 */
export function changesSince(log, items, { since = null, cursor = null, limit = 100 }) {
  let s, full, after = null;
  if (cursor && cursor.b === log.epoch) {
    s = cursor.s; full = cursor.f; after = cursor;
  } else if (cursor) {
    s = -1; full = true;
  } else {
    const from = since == null ? null : sinceOf(log, since);
    full = from == null;
    s = full ? -1 : from;
  }
  const events = [];
  for (const [id, x] of log.seen) if (x.rev > s) events.push({ rev: x.rev, id });
  for (const [id, x] of log.gone) if (x.rev > s) events.push({ rev: x.rev, id, at: x.at });
  events.sort((a, b) => a.rev - b.rev || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rest = after ? events.filter(e => e.rev > after.r || (e.rev === after.r && e.id > after.k)) : events;
  const page = [];
  let bytes = 0;
  for (const e of rest) {
    if (page.length >= limit) break;
    const out = 'at' in e ? { id: e.id, deleted_at: e.at } : items.get(e.id);
    const size = JSON.stringify(out).length;
    if (page.length && bytes + size > PAGE_BYTES) break;
    bytes += size;
    page.push({ e, out });
  }
  const more = rest.length > page.length;
  const last = page.length ? page[page.length - 1].e : null;
  return {
    full,
    items: page.filter(p => !('at' in p.e)).map(p => p.out),
    deleted: page.filter(p => 'at' in p.e).map(p => p.out),
    next_cursor: more ? encode({ s, f: full, b: log.epoch, r: last.rev, k: last.id }) : null,
    next_since: more ? null : encode({ e: log.epoch, r: log.rev })
  };
}

/* ------------------------------------------------------------------ body weight */

// The weigh-in of each day as every device shows it: of several entries for one day the later `t`
// (sync-merge.js mergeBodyweight), and none where a removal on record is as late as it
// (sync-merge.js applyDeletions).
function weighIns(S) {
  const tomb = isMap(S?.deleted?.bodyweight) ? S.deleted.bodyweight : {};
  const byDay = new Map();
  for (const e of list(S?.bodyweight)) {
    if (!isMap(e) || typeof e.d !== 'string' || !(Number(e.w) > 0)) continue;
    const cur = byDay.get(e.d);
    if (!cur || (Number(e.t) || 0) > (Number(cur.t) || 0)) byDay.set(e.d, e);
  }
  for (const [d, e] of byDay) {
    const at = Number(tomb[d]) || 0;
    if (at > 0 && at >= (Number(e.t) || 0)) byDay.delete(d);
  }
  return { byDay, tomb };
}

const entryOut = (e, unit) => ({ date: e.d, kg: toKg(Number(e.w), unit), t: instant(Number(e.t)) });

/** The day's weigh-in in kg, or null. */
export function weighInOf(S, date) {
  const e = weighIns(S).byDay.get(date);
  return e ? entryOut(e, unitOf(S)) : null;
}

/** Weigh-ins and removals between `from` and `to` (inclusive, either open), by date. */
export function bodyweightView(S, { from = null, to = null } = {}) {
  const unit = unitOf(S);
  const inRange = d => (from == null || d >= from) && (to == null || d <= to);
  const { byDay, tomb } = weighIns(S);
  const items = [...byDay.values()].filter(e => inRange(e.d)).map(e => entryOut(e, unit))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const deleted = Object.entries(tomb)
    .filter(([d, at]) => Number(at) > 0 && isDate(d) && inRange(d) && !byDay.has(d))
    .map(([d, at]) => ({ date: d, deleted_at: Number(at) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { unit, items, deleted };
}

// The stamp a write of `date` carries: the server's clock, moved past anything the profile holds
// for that day and past every stamp of the document, so each device's merge takes it as the
// newest change (as the app's own stampChange does). Never a caller's time: one ahead of the clock
// would outrank a correction made on a phone after it, and the phone's change would be lost.
function stampFor(cur, date, now) {
  let m = Math.max(Number(now) || 0, highestStamp(cur) + 1);
  for (const e of list(cur?.bodyweight)) if (isMap(e) && e.d === date) m = Math.max(m, (Number(e.t) || 0) + 1);
  return Math.max(m, Math.abs(Number(cur?.deleted?.bodyweight?.[date]) || 0) + 1);
}
const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
// A changed document is one later change: its `_ts` moves to the change's stamp, as a device's own
// push does, so a device comparing copies by `_ts` (useStore restoredStateFor) takes this one as
// the newer and never pushes an older copy back over it.
const stamped = (next, at) => { next._ts = Math.max(Number(next._ts) || 0, at); return next; };

/**
 * `cur` with `date` set to `kg`, as a new document, or null when nothing would change: the value
 * stored would be the one the day holds, or is within half the stored step of it (what the hub
 * read, kg to 0.01, written back). The day's other fields (anything the app keeps on a weigh-in
 * besides `d`, `w`, `t`) are kept. Throws on a value that would not be stored as a weight at all:
 * the route refuses those first.
 */
export function withWeighIn(cur, date, kg, { now = Date.now() } = {}) {
  const unit = unitOf(cur);
  const w = fromKg(kg, unit);
  if (!(w > 0)) throw new RangeError('not a body weight');
  const old = weighIns(cur).byDay.get(date);
  if (old && (Number(old.w) === w || Math.abs(Number(old.w) - (unit === 'lb' ? kg * LB_PER_KG : kg)) < 0.05)) return null;
  const next = structuredClone(cur);
  const keep = old ? structuredClone(old) : {};
  const at = stampFor(cur, date, now);
  next.bodyweight = [
    ...list(next.bodyweight).filter(e => !(isMap(e) && e.d === date)),
    { ...keep, d: date, w, t: at }
  ].sort(byDate);
  return stamped(next, at);
}

/** `cur` without a weigh-in on `date`, with the removal on record, or null when there is none. */
export function withoutWeighIn(cur, date, { now = Date.now() } = {}) {
  if (!weighIns(cur).byDay.has(date)) return null;
  const next = structuredClone(cur);
  const at = stampFor(cur, date, now);
  next.bodyweight = list(next.bodyweight).filter(e => !(isMap(e) && e.d === date));
  const del = isMap(next.deleted) ? next.deleted : (next.deleted = {});
  (isMap(del.bodyweight) ? del.bodyweight : (del.bodyweight = {}))[date] = at;
  return stamped(next, at);
}

/* The profiles the hub may sync (GET /api/sync/users): who exists, who is switched off, who is gone,
 * and the one number that says whether there is anything new to read from each.
 *
 * Only what the hub needs to decide whether to call a profile's own routes. No name, e-mail,
 * credential or anything else a profile holds: an id is already what the hub signs every per-profile
 * token with, and `rev` is what GET /api/sync/rev gives for that profile anyway.
 *
 * Paged by key, not by position: ordered by id, a page starts after the last id of the one before.
 * A profile created, disabled or deleted between two pages therefore never makes another one repeat
 * or go missing, which a page number or an offset into a list that has just changed would. A profile
 * that appears behind the cursor after the pass has gone by is simply not in this pass; the next
 * pass has it. */
// 64 for both, and not the 500 of the per-profile change list: a page whose profiles are not in the
// version index yet (server.js stateVersion) parses one state file each, synchronously, and 64 is
// the number of parsed states the server already keeps (STATE_CACHE_MAX). Most pages stat and
// nothing more; this only bounds the one that does not.
export const USERS_LIMIT_MAX = 64;
export const USERS_LIMIT_DEFAULT = 64;
// An id as this server mints them, and nothing a query string could use to say something else.
export const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `users` are the profiles, `gone` the ones deleted (`{ id, at }`), `versionOf(id)` the version of a
 *  profile's stored state, `{ rev, wid }` (rev 0 and no wid when it has none yet). The write id
 *  comes with the revision because a restored backup can bring the same revision back with other
 *  contents (sync-routes.js etagOf). A profile that is both listed and in `gone` is listed: the
 *  record of a deletion never hides one that exists. → { users, next_after }, where `next_after` is
 *  the id to pass as `after` for the next page, or null at the end. */
export function usersPage({ users, gone = [], versionOf, after = null, limit = USERS_LIMIT_DEFAULT }) {
  const rows = new Map();
  for (const g of list(gone)) {
    if (isMap(g) && typeof g.id === 'string' && USER_ID.test(g.id)) rows.set(g.id, { id: g.id, state: 'gone', gone_at: instant(g.at) });
  }
  for (const u of list(users)) {
    if (!isMap(u) || typeof u.id !== 'string' || !USER_ID.test(u.id)) continue;
    rows.set(u.id, { id: u.id, state: u.disabled ? 'disabled' : 'active' });
  }
  // By code unit, not by locale: the order must be the same on every host and every call.
  const ordered = [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rest = after == null ? ordered : ordered.filter(r => r.id > after);
  const page = rest.slice(0, limit);
  return {
    // The version is read for the page only: it costs a stat per profile, not per call.
    users: page.map(r => {
      if (r.state === 'gone') return { id: r.id, state: 'gone', rev: 0, gone_at: r.gone_at };
      const v = versionOf(r.id) || {};
      return {
        id: r.id, state: r.state, rev: Math.max(0, Number(v.rev) || 0),
        ...(typeof v.wid === 'string' && v.wid ? { wid: v.wid } : {})
      };
    }),
    next_after: rest.length > page.length ? page[page.length - 1].id : null
  };
}
