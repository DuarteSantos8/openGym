/* /api/sync/*: the hub's way in, for one profile at a time, with no session at all.
 *
 * A separate service syncs each person's data in the background. It holds no cookie and no paired
 * token of anyone's: for every call it signs a hub token (hub-token.js) for that profile, good for
 * a minute, and only these routes accept one. They are deliberately apart from sessionOf, in both
 * directions:
 *
 *   - a hub token is not a session: every other route reads the cookie or a paired Bearer token,
 *     which a hub token can never pass for, so it reaches no sign-out, pairing, passkey, admin,
 *     Coach or delete route;
 *   - a session is not a hub token: a cookie or a paired Bearer token here is refused like no
 *     credential at all.
 *
 * The profile is looked up again on every call. A deleted one answers 404 with `code: user-gone`
 * and a disabled one 401 with `code: disabled`, so the hub can tell "stop syncing this person"
 * from "this person is gone" — and either from the plain `{"error":"not found"}` of an instance
 * with no hub configured, which must never read as a deletion.
 *
 * GET only so far. A route that writes needs no CSRF exemption of its own: the dispatcher's
 * csrfOk already passes any request that carries a Bearer token, which a browser never attaches
 * by itself.
 *
 * Handed its helpers by server.js, like coach/routes.js, so it closes over nothing of the server. */
import { verifyHubToken, HUB_AUDIENCE } from './hub-token.js';

// The answer GET /api/data/rev gives, from the same state document. That route in server.js keeps
// its own copy of this one line, so it stays exactly as upstream has it; server-sync.test.js pins
// the two answers to each other.
const revOf = doc => ({ rev: doc?._rev || 0, ...(doc?._wid ? { wid: doc._wid } : {}) });

export function syncRoutes({ hub, json, findUser, readStateCached, auditFail }) {
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
    const user = findUser(v.claims.sub);
    if (!user) return json(res, 404, { error: 'no such user', code: 'user-gone' });
    if (user.disabled) return json(res, 401, { error: 'this account has been disabled', code: 'disabled' });
    return handler(req, res, user, v.claims);
  };

  return {
    // The hub's check that a profile is still there and syncable, before it starts a run.
    'GET /api/sync/ping': authed(async (req, res, user) => json(res, 200, { ok: true, user: { id: user.id, name: user.name } })),

    // The same answer GET /api/data/rev gives the profile's own devices: the hub polls it and
    // reads further only when the number moved.
    'GET /api/sync/rev': authed(async (req, res, user) => json(res, 200, revOf(readStateCached(user.id))))

    // The data routes (workouts since a revision, body weight per date) go here, each through
    // authed() and each added to openapi.yaml under the `sync` tag.
  };
}
