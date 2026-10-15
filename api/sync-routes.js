/* /api/sync/*: the hub's way in, for one profile at a time, with no session at all.
 *
 * A separate service syncs each person's data in the background. It holds no cookie and no paired
 * token of anyone's: for every call it signs a hub token (hub-token.js) for that profile, good for
 * a minute and for one call, and only these routes accept one. They are deliberately apart from
 * sessionOf, in both directions:
 *
 *   - a hub token is not a session: every other route reads the cookie or a paired Bearer token,
 *     which a hub token can never pass for, so it reaches no sign-out, pairing, passkey, admin,
 *     Coach or delete route;
 *   - a session is not a hub token: a cookie or a paired Bearer token here is refused like no
 *     credential at all.
 *
 * A token is accepted once: the same `jti` again, while the token is still in date, is a 401 with
 * `code: replay`. The profile is looked up again on every call. A deleted one answers 404 with
 * `code: user-gone` and a disabled one 401 with `code: disabled`, so the hub can tell "stop syncing
 * this person" from "this person is gone" — and either from the plain `{"error":"not found"}` of an
 * instance with no hub configured, which must never read as a deletion.
 *
 * Reads (workouts changed since the last pass, body weight by date) are sync-data.js over the stored
 * document. The onboarding seed (sync-seed.js) is the one write besides weigh-ins; it fills in only
 * what the profile has not decided, so it needs no precondition. Weigh-ins are written one at a
 * time, read-modify-written here the way PUT /api/data
 * writes: the stored document read, changed, stamped (sync-stamps.js stampPut) and written with
 * nothing awaited in between, so a browser's save can never land inside it and be lost. Each write
 * names the version it was decided on (`If-Match`, revision and write id), and one made over any
 * other is refused with a 409, the current entry attached. A write moves the revision, so every
 * open device picks it up on its next poll and merges it like another device's weigh-in. A write needs no CSRF exemption of
 * its own: the dispatcher's csrfOk already passes any request that carries a Bearer token, which a
 * browser never attaches by itself.
 *
 * Handed its helpers by server.js, like coach/routes.js, so it closes over nothing of the server. */
import { verifyHubToken, replayCache, HUB_AUDIENCE, HUB_USERS_AUDIENCE, HUB_USERS_SCOPE, HUB_SERVICE_SUB } from './hub-token.js';
import { createWindow } from './rate-limit.js';
import { stampPut } from './sync-stamps.js';
import { parseSeed, seedState, seedView } from './sync-seed.js';
import {
  isSyncDate, workoutItems, trackWorkouts, changesSince, decodeCursor, bodyweightView, weighInOf, withWeighIn, withoutWeighIn, unitOf,
  usersPage, USER_ID, USERS_LIMIT_MAX, USERS_LIMIT_DEFAULT
} from './sync-data.js';

// The answer GET /api/data/rev gives, from the same state document. That route in server.js keeps
// its own copy of this one line, so it stays exactly as upstream has it; server-sync.test.js pins
// the two answers to each other.
const revOf = doc => ({ rev: doc?._rev || 0, ...(doc?._wid ? { wid: doc._wid } : {}) });
// The document's version as a strong ETag, `"<rev>:<wid>"` (`"<rev>"` before its first write). A
// write's `If-Match` must carry the write id whenever the document has one: the revision alone is
// the same number again after a restored backup, and would let a write decided on the other
// document through.
const etagOf = doc => `"${doc?._rev || 0}${doc?._wid ? ':' + doc._wid : ''}"`;
const IF_MATCH = /^\s*"?(\d{1,15})(?::([0-9a-f]{1,64}))?"?\s*$/;
const LIMIT_MAX = 500;
const LIMIT_DEFAULT = 100;
const LIST_BURST_MAX = 120;
// A body weight a person weighs, in kg: anything outside is a mistake (a value in grams, a unit
// mix-up, one that would round to nothing in the stored unit and vanish without a removal on record).
const KG_MIN = 20;
const KG_MAX = 400;
// A weigh-in's body is a few dozen bytes.
const BODY_MAX = 4096;
// An onboarding seed is at most seven routines of twenty exercises: a few KB.
const SEED_BODY_MAX = 32 * 1024;
// A profile this new may get its first document from the onboarding write (see the route). One
// older than that with no document is the empty data volume the `no-state` answer exists for.
const NEW_PROFILE_MS = 30 * 86400000;
// How many profiles' workout change logs are kept (sync-data.js trackWorkouts), a few dozen bytes per
// workout each. One that is dropped is rebuilt on its next read, and costs that hub a full pass, so
// this sits far above the number of profiles one instance syncs at once.
const LOGS_MAX = 1000;

const bad = (json, res, code, error) => json(res, 400, { error, code });

export function syncRoutes({ hub, json, findUser, listProfiles, stateVersion, readStateCached, readStateStrict, UNREADABLE, readBody, commitState, auditSyncFail }) {
  const replays = replayCache();
  // The listing is the hub's alone and a page of it costs a stat per profile, so this is generous:
  // 120 a minute against the one call a scheduler makes per page. It counts only calls that carry a
  // valid, unspent token (serviceAuthed), so junk from anywhere cannot spend the hub's allowance.
  const listBurst = createWindow({ max: LIST_BURST_MAX, windowMs: 60000, maxKeys: 1 });
  const logs = new Map();
  const logOf = (uid, S, items) => {
    const log = trackWorkouts(logs.get(uid), S, items);
    logs.delete(uid);
    logs.set(uid, log);
    while (logs.size > LOGS_MAX) logs.delete(logs.keys().next().value);
    return log;
  };

  // The credential every route here starts from: a hub token for `audience` with one of `scopes`,
  // seen for the first time. Answers 401 itself and returns null when it is not; otherwise the
  // verified claims. One cache of used `jti`s for all of them, so a token cannot be replayed on
  // another route either.
  const credential = (req, res, audience, scopes) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) { json(res, 401, { error: 'not signed in' }); return null; }
    const v = verifyHubToken(hub, token, { audience, scopes });
    if (!v.ok) {
      // The reason only, never the token. auditSyncFail folds a storm of the same reason into
      // one counted row an hour (server.js), so a misconfigured hub cannot fill the log.
      auditSyncFail(req, v.reason);
      json(res, 401, { error: 'invalid sync token', code: 'token-invalid' });
      return null;
    }
    // After the signature: only a token the hub signed can take a place in the cache.
    if (replays.seen(v.claims)) {
      auditSyncFail(req, 'replay');
      json(res, 401, { error: 'sync token already used', code: 'replay' });
      return null;
    }
    return v.claims;
  };

  // Every per-profile route below is wrapped in this; there is no other way to reach one.
  const authed = handler => async (req, res) => {
    const claims = credential(req, res, HUB_AUDIENCE, ['sync']);
    if (!claims) return;
    const user = findUser(claims.sub);
    if (!user) return json(res, 404, { error: 'no such user', code: 'user-gone' });
    if (user.disabled) return json(res, 401, { error: 'this account has been disabled', code: 'disabled' });
    return handler(req, res, user, claims);
  };

  // The route that is about no one profile: its own audience, scope and `sub` (hub-token.js), and no
  // profile looked up, since there is none to find. A token with any other audience or scope is
  // refused by verifyHubToken before this runs, and one that names a profile by `sub` is refused
  // here: it was minted for a per-profile route and does not become a listing credential by being
  // re-aimed. Same refusals, same codes and same audit as every other route.
  const serviceAuthed = handler => async (req, res) => {
    const claims = credential(req, res, HUB_USERS_AUDIENCE, [HUB_USERS_SCOPE]);
    if (!claims) return;
    if (claims.sub !== HUB_SERVICE_SUB) {
      auditSyncFail(req, 'sub');
      return json(res, 401, { error: 'invalid sync token', code: 'token-invalid' });
    }
    return handler(req, res);
  };

  // The stored document, or null once answered: 503 for a file that cannot be read, 409 no-state
  // for one that is not there (no device has synced, or the data volume is mounted empty). Neither
  // is ever an empty profile, which would read as every workout and weigh-in deleted, nor one to
  // write a first document into.
  const stored = (res, uid) => {
    const S = readStateStrict(uid);
    if (S === UNREADABLE) {
      console.error('state file unreadable for', uid);
      json(res, 503, { error: 'state unreadable', code: 'state-unreadable' });
      return null;
    }
    if (!S) json(res, 409, { error: 'this profile has no data on this server yet', code: 'no-state', rev: 0 });
    return S || null;
  };

  // A weigh-in write: the date, the precondition, then (for a body) the body, then the profile
  // again (it may have gone while the body was in flight), and from the read of the document to
  // commitState nothing awaited, so the compare-and-write is atomic for this process.
  const writeWeighIn = change => authed(async (req, res, user) => {
    const date = req.syncDate;
    if (!isSyncDate(date)) return bad(json, res, 'bad-date', 'date must be a real YYYY-MM-DD date, from 1900-01-01 to tomorrow');
    const raw = req.headers['if-match'];
    if (raw == null) return json(res, 428, { error: 'If-Match with the revision this write was decided on is required', code: 'precondition-required' });
    const m = IF_MATCH.exec(String(raw));
    if (!m) return bad(json, res, 'bad-if-match', 'If-Match must be "<rev>" or "<rev>:<wid>"');
    const input = await change.read(req, res);
    if (!input) return;
    const again = findUser(user.id);
    if (!again) return json(res, 404, { error: 'no such user', code: 'user-gone' });
    if (again.disabled) return json(res, 401, { error: 'this account has been disabled', code: 'disabled' });
    const cur = stored(res, user.id);
    if (!cur) return;
    if (cur._wid && !m[2]) {
      return json(res, 428, { error: 'If-Match must carry the write id: "<rev>:<wid>", as the ETag gives it', code: 'precondition-required' }, { ETag: etagOf(cur) });
    }
    const rev = cur._rev || 0;
    if (Number(m[1]) !== rev || (m[2] && m[2] !== cur._wid)) {
      return json(res, 409, { error: 'conflict', code: 'rev-mismatch', ...revOf(cur), entry: weighInOf(cur, date) }, { ETag: etagOf(cur) });
    }
    const next = change.apply(cur, date, input);
    if (!next) return json(res, 200, { ok: true, changed: false, entry: weighInOf(cur, date), unit: unitOf(cur), ...revOf(cur) }, { ETag: etagOf(cur) });
    stampPut(cur, next, { overRead: true, stamped: true });
    const done = commitState(user.id, cur, next);
    json(res, 200, { ok: true, changed: true, entry: weighInOf(next, date), unit: unitOf(next), ...done }, { ETag: etagOf(next) });
  });

  return {
    // Who the hub may sync: every profile's id, whether it is active, disabled or gone, and its
    // revision, a page at a time, after the id a page's `next_after` gave. This is how the hub finds
    // a person who has logged a workout somewhere else without opening this app here.
    //
    // PRIVACY: ids, states, revisions and write ids only. Never a name, an e-mail address, a
    // credential, a device, or anything from a profile's data. An id is what the hub already signs
    // per-profile tokens with, and the revision and write id are what /api/sync/rev gives for that
    // profile. Keep it that way: this answers for every profile on the instance to a caller that
    // holds no profile's token.
    //
    // Reading the versions stats each profile's state file (stateVersion in server.js) and parses
    // none of them that has not changed, without touching the cache the polling routes share.
    'GET /api/sync/users': serviceAuthed(async (req, res) => {
      const wait = listBurst.take('list');
      if (wait) return json(res, 429, { error: 'too many listings, try again shortly', code: 'rate-limited', retryAfter: wait }, { 'Retry-After': String(wait) });
      const q = new URL(req.url, 'http://x').searchParams;
      const after = q.get('after'), limit = q.get('limit');
      if (limit != null && !(/^\d{1,4}$/.test(limit) && +limit >= 1 && +limit <= USERS_LIMIT_MAX)) return bad(json, res, 'bad-limit', `limit must be 1 to ${USERS_LIMIT_MAX}`);
      if (after != null && !USER_ID.test(after)) return bad(json, res, 'bad-cursor', 'after must be the next_after of a previous page');
      const { users, gone } = listProfiles();
      json(res, 200, usersPage({
        users, gone, after, limit: limit == null ? USERS_LIMIT_DEFAULT : +limit, versionOf: stateVersion
      }));
    }),

    // The hub's check that a profile is still there and syncable, before it starts a run.
    'GET /api/sync/ping': authed(async (req, res, user) => json(res, 200, { ok: true, user: { id: user.id, name: user.name } })),

    // The same answer GET /api/data/rev gives the profile's own devices: the hub polls it and
    // reads further only when the number moved.
    'GET /api/sync/rev': authed(async (req, res, user) => {
      const doc = readStateCached(user.id);
      json(res, 200, revOf(doc), { ETag: etagOf(doc) });
    }),

    // Finished workouts changed since the pass a `next_since` token names, and the ones gone since,
    // a page at a time. Any `since` that is not such a token of this profile's log is a full pass.
    'GET /api/sync/workouts': authed(async (req, res, user) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const since = q.get('since'), limit = q.get('limit'), cur = q.get('cursor');
      if (limit != null && !(/^\d{1,4}$/.test(limit) && +limit >= 1 && +limit <= LIMIT_MAX)) return bad(json, res, 'bad-limit', `limit must be 1 to ${LIMIT_MAX}`);
      const cursor = cur == null ? null : decodeCursor(cur);
      if (cur != null && !cursor) return bad(json, res, 'bad-cursor', 'cursor is not one this server handed out');
      const S = stored(res, user.id);
      if (!S) return;
      const items = workoutItems(S);
      const page = changesSince(logOf(user.id, S, items), items, {
        since, cursor, limit: limit == null ? LIMIT_DEFAULT : +limit
      });
      json(res, 200, { ...revOf(S), unit: unitOf(S), reset_at: Number(S.resetAt) > 0 ? Number(S.resetAt) : null, ...page }, { ETag: etagOf(S) });
    }),

    // Weigh-ins (kg) and removals by date, from and to inclusive.
    'GET /api/sync/bodyweight': authed(async (req, res, user) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const from = q.get('from'), to = q.get('to');
      if ((from != null && !isSyncDate(from)) || (to != null && !isSyncDate(to))) return bad(json, res, 'bad-date', 'from and to must be real YYYY-MM-DD dates, from 1900-01-01 to tomorrow');
      if (from != null && to != null && from > to) return bad(json, res, 'bad-range', 'from is after to');
      const S = stored(res, user.id);
      if (!S) return;
      json(res, 200, { ...revOf(S), ...bodyweightView(S, { from, to }) }, { ETag: etagOf(S) });
    }),

    'PUT /api/sync/bodyweight/{date}': writeWeighIn({
      async read(req, res) {
        const body = await readBody(req, BODY_MAX);
        const kg = body.kg, t = body.t;
        if (typeof kg !== 'number' || !Number.isFinite(kg) || kg < KG_MIN || kg > KG_MAX) {
          bad(json, res, 'bad-weight', `kg must be a number from ${KG_MIN} to ${KG_MAX}`);
          return null;
        }
        // Taken for the hub's own record and checked, never used: the server stamps every write
        // with its own clock (sync-data.js stampFor).
        if (t != null && !(Number.isSafeInteger(t) && t > 0)) {
          bad(json, res, 'bad-time', 't must be a time in ms');
          return null;
        }
        return { kg };
      },
      apply: (cur, date, { kg }) => withWeighIn(cur, date, kg)
    }),

    'DELETE /api/sync/bodyweight/{date}': writeWeighIn({
      read: async () => ({}),
      apply: (cur, date) => withoutWeighIn(cur, date)
    }),

    // What the profile has already answered, for the hub's onboarding to skip those questions
    // (sync-seed.js seedView). A profile with no document yet answers too: with nothing answered.
    'GET /api/sync/onboarding': authed(async (req, res, user) => {
      const S = readStateStrict(user.id);
      if (S === UNREADABLE) {
        console.error('state file unreadable for', user.id);
        return json(res, 503, { error: 'state unreadable', code: 'state-unreadable' });
      }
      json(res, 200, { ...revOf(S), ...seedView(S || {}) }, { ETag: etagOf(S) });
    }),

    // The hub's onboarding answers, written once into the profile: the unit, the first weigh-in,
    // the Coach intake answers, a starter plan and the check-in switch (sync-seed.js). Every field
    // goes in only where the profile has not decided it already, so the same write sent again
    // changes nothing: no If-Match, since the hub decides nothing on a version it read. The
    // decision is made here, on the stored document, read and written with nothing awaited in
    // between, like the weigh-in writes. A profile with no document yet gets its first one only
    // while it is new (NEW_PROFILE_MS): its devices then merge it like another device's copy.
    'POST /api/sync/onboarding': authed(async (req, res, user) => {
      const parsed = parseSeed(await readBody(req, SEED_BODY_MAX));
      if (!parsed.ok) return bad(json, res, parsed.code, parsed.error);
      const again = findUser(user.id);
      if (!again) return json(res, 404, { error: 'no such user', code: 'user-gone' });
      if (again.disabled) return json(res, 401, { error: 'this account has been disabled', code: 'disabled' });
      const cur = readStateStrict(user.id);
      if (cur === UNREADABLE) {
        console.error('state file unreadable for', user.id);
        return json(res, 503, { error: 'state unreadable', code: 'state-unreadable' });
      }
      const newProfile = Date.now() - Date.parse(again.created) < NEW_PROFILE_MS;
      if (!cur && !newProfile) {
        return json(res, 409, { error: 'this profile has no data on this server yet', code: 'no-state', rev: 0 });
      }
      const { next, applied, skipped } = seedState(cur, parsed.seed, { newProfile });
      if (!next) return json(res, 200, { ok: true, changed: false, applied, skipped, ...revOf(cur) }, { ETag: etagOf(cur) });
      stampPut(cur, next, { overRead: true, stamped: true });
      const done = commitState(user.id, cur, next);
      json(res, 200, { ok: true, changed: true, applied, skipped, ...done }, { ETag: etagOf(next) });
    })
  };
}
