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
 * document. Writes are one weigh-in at a time, read-modify-written here the way PUT /api/data
 * writes: the stored document read, changed, stamped (sync-stamps.js stampPut) and written with
 * nothing awaited in between, so a browser's save can never land inside it and be lost. Each write
 * names the version it was decided on (`If-Match`, revision and write id), and one made over any
 * other is refused with a 409, the current entry attached. A write moves the revision, so every
 * open device picks it up on its next poll and merges it like another device's weigh-in. A write needs no CSRF exemption of
 * its own: the dispatcher's csrfOk already passes any request that carries a Bearer token, which a
 * browser never attaches by itself.
 *
 * Handed its helpers by server.js, like coach/routes.js, so it closes over nothing of the server. */
import { verifyHubToken, replayCache, HUB_AUDIENCE } from './hub-token.js';
import { stampPut } from './sync-stamps.js';
import {
  isSyncDate, workoutItems, trackWorkouts, changesSince, decodeCursor, bodyweightView, weighInOf, withWeighIn, withoutWeighIn, unitOf
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
// A body weight a person weighs, in kg: anything outside is a mistake (a value in grams, a unit
// mix-up, one that would round to nothing in the stored unit and vanish without a removal on record).
const KG_MIN = 20;
const KG_MAX = 400;
// A weigh-in's body is a few dozen bytes.
const BODY_MAX = 4096;
// How many profiles' workout change logs are kept (sync-data.js trackWorkouts), a few dozen bytes per
// workout each. One that is dropped is rebuilt on its next read, and costs that hub a full pass, so
// this sits far above the number of profiles one instance syncs at once.
const LOGS_MAX = 1000;

const bad = (json, res, code, error) => json(res, 400, { error, code });

export function syncRoutes({ hub, json, findUser, readStateCached, readStateStrict, UNREADABLE, readBody, commitState, auditFail }) {
  const replays = replayCache();
  const logs = new Map();
  const logOf = (uid, S, items) => {
    const log = trackWorkouts(logs.get(uid), S, items);
    logs.delete(uid);
    logs.set(uid, log);
    while (logs.size > LOGS_MAX) logs.delete(logs.keys().next().value);
    return log;
  };

  // Every route below is wrapped in this; there is no other way to reach one.
  const authed = handler => async (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return json(res, 401, { error: 'not signed in' });
    const v = verifyHubToken(hub, token, { audience: HUB_AUDIENCE, scopes: ['sync'] });
    if (!v.ok) {
      // The reason only, never the token. auditFail keeps a flood of junk out of the log.
      auditFail(req, 'sync.token.fail', { ok: false, msg: v.reason });
      return json(res, 401, { error: 'invalid sync token', code: 'token-invalid' });
    }
    // After the signature: only a token the hub signed can take a place in the cache.
    if (replays.seen(v.claims)) {
      auditFail(req, 'sync.token.fail', { ok: false, msg: 'replay' });
      return json(res, 401, { error: 'sync token already used', code: 'replay' });
    }
    const user = findUser(v.claims.sub);
    if (!user) return json(res, 404, { error: 'no such user', code: 'user-gone' });
    if (user.disabled) return json(res, 401, { error: 'this account has been disabled', code: 'disabled' });
    return handler(req, res, user, v.claims);
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
    })
  };
}
