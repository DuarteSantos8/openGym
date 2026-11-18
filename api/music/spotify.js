/* Spotify on the account: the music bar of a workout (frontend components/MusicBar.jsx) on every
 * device a person signs in on, through this server.
 *
 * The instance's operator registers one Spotify app (developer.spotify.com) and gives the server
 * its Client ID (SPOTIFY_CLIENT_ID, and SPOTIFY_CLIENT_SECRET if they want the classic flow; PKCE
 * otherwise). Each person then connects their own Spotify account once, from Settings → Features:
 * the sign-in comes back here (/api/music/spotify/callback), and the tokens are kept on their
 * user row, encrypted with the instance's secret like the Coach's credentials. After that every
 * device of the profile, the phone app paired to this server included, reads what plays and
 * steers it through the routes below, with nothing to set up on the device.
 *
 * Nothing here is sent to Spotify for anyone who has not connected.
 */
import crypto from 'node:crypto';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
// How long a sign-in may take between Connect and the way back.
const PENDING_MS = 10 * 60000;
// Several devices of one profile polling the bar at once: one answer from Spotify serves them all.
const CACHE_MS = 2500;
export const ACTIONS = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] };

/** The configuration from the environment, or null when Spotify is not offered on this instance. */
export function spotifyConfig(env, origin) {
  const clientId = String(env.SPOTIFY_CLIENT_ID || '').trim();
  if (!clientId) return null;
  if (!/^[0-9a-zA-Z]{16,64}$/.test(clientId)) { console.error('SPOTIFY_CLIENT_ID ignored: not a Spotify Client ID'); return null; }
  const redirectUri = String(env.SPOTIFY_REDIRECT_URI || '').trim() || String(origin).replace(/\/$/, '') + '/api/music/spotify/callback';
  return { clientId, clientSecret: String(env.SPOTIFY_CLIENT_SECRET || '').trim() || null, redirectUri };
}

const err = (code, status, message) => Object.assign(new Error(message || 'spotify ' + code), { code, status });
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// What the bar shows, the same shape as the phone's Apple Music side.
export function trackOf(j) {
  if (!j || !j.item) return { playing: !!j?.is_playing, title: '', artist: '', art: '' };
  const it = j.item;
  const images = it.album?.images || it.images || it.show?.images || [];
  const small = images.length ? images.reduce((a, b) => ((b.width || 0) >= 64 && (b.width || 0) < (a.width || 1e9) ? b : a), images[0]) : null;
  return {
    id: String(it.id || it.uri || it.name || ''),
    playing: !!j.is_playing,
    title: String(it.name || ''),
    artist: (it.artists || []).map(a => a.name).join(', ') || it.show?.name || '',
    art: small && /^https:\/\//.test(small.url) ? small.url : '',
  };
}

/**
 * The account side of Spotify. `seal`/`unseal` encrypt the tokens for the user row, `save` writes
 * the user rows (db.json); `fetchFn` and `now` are there for the tests.
 */
export function createSpotify(cfg, { seal, unseal, save, fetchFn = fetch, now = Date.now }) {
  const pending = new Map();   // state → { uid, verifier, app, back, bind, exp }
  const handoffs = new Map();  // one-time code → { uid, code, verifier, exp }: the phone app's way back
  const cache = new Map();     // uid → { at, track }
  const refreshing = new Map(); // uid → the refresh under way

  const sweep = () => {
    const t = now();
    for (const m of [pending, handoffs]) for (const [k, v] of m) if (v.exp < t) m.delete(k);
  };

  // Only Spotify's invalid_grant means the refresh token is gone for good (access removed in the
  // Spotify account): that is the one refusal that disconnects. Any other (a request Spotify did not
  // like, the operator's Client secret changed) keeps the connection and fails this call only.
  async function tokenRequest(body) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (cfg.clientSecret) headers.Authorization = 'Basic ' + Buffer.from(cfg.clientId + ':' + cfg.clientSecret).toString('base64');
    else body.client_id = cfg.clientId;
    const r = await fetchFn(ACCOUNTS + '/api/token', { method: 'POST', headers, body: new URLSearchParams(body).toString() });
    if (!r.ok) {
      let oauth = null;
      try { oauth = (await r.json())?.error || null; } catch { /* not JSON */ }
      throw Object.assign(err(oauth === 'invalid_grant' ? 'auth' : 'failed', r.status), { oauth });
    }
    return r.json();
  }

  function keep(user, j, old) {
    const t = { access: j.access_token, refresh: j.refresh_token || old?.refresh, exp: now() + (j.expires_in ?? 3600) * 1000 };
    user.spotify = { ...(user.spotify || {}), tokens: seal(t), connected: user.spotify?.connected || now() };
    return t;
  }

  /**
   * The sign-in address for this person, and `bind`: a browser's sign-in only comes back in the
   * browser that started it, which holds `bind` in a cookie (the route sets it). Without that, a
   * sign-in address someone else started for their own profile, opened by you, would put your
   * Spotify on their profile. `app` says the way back is the phone app's link instead, which
   * cannot carry the cookie: the app redeems a one-time code with its own session (redeem).
   */
  function start(user, { app = false, back = null } = {}) {
    sweep();
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(18));
    const bind = b64url(crypto.randomBytes(24));
    pending.set(state, { uid: user.id, verifier, app: !!app, back, bind, exp: now() + PENDING_MS });
    const q = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, scope: SCOPES, redirect_uri: cfg.redirectUri, state });
    if (!cfg.clientSecret) {
      q.set('code_challenge_method', 'S256');
      q.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
    }
    return { url: ACCOUNTS + '/authorize?' + q, bind };
  }

  // The code Spotify gave, turned into tokens on the user row, with the account's name.
  async function buy(user, code, verifier) {
    const body = { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri };
    if (!cfg.clientSecret) body.code_verifier = verifier;
    const j = await tokenRequest(body);
    const t = keep(user, j);
    user.spotify.connected = now();
    // The name shown in Settings, so a household can tell whose Spotify this profile steers.
    try {
      const me = await fetchFn(API + '/me', { headers: { Authorization: 'Bearer ' + t.access } });
      if (me.ok) { const m = await me.json(); user.spotify.name = String(m.display_name || m.id || '').slice(0, 80); }
    } catch { /* the name is a nicety */ }
    cache.delete(user.id);
    save();
  }

  /**
   * The way back from Spotify: the callback's query, and `bind` from the browser's cookie. Returns
   * { ok, app, back } for a state this server handed out, or null for anything else. A browser's
   * sign-in is saved here, only with the `bind` it started with; the phone app's gets a one-time
   * `handoff` code for its link instead, and is saved when the app redeems it (redeem).
   */
  async function finish(query, userById, { bind = null } = {}) {
    sweep();
    const state = String(query.get('state') || '');
    const p = state && pending.get(state);
    if (!p) return null;
    pending.delete(state);
    const user = userById(p.uid);
    const failed = { ok: false, app: p.app, back: p.back };
    if (!user || query.get('error') || !query.get('code')) return failed;
    if (p.app) {
      const handoff = b64url(crypto.randomBytes(24));
      handoffs.set(handoff, { uid: p.uid, code: String(query.get('code')), verifier: p.verifier, exp: now() + PENDING_MS });
      return { ok: true, app: true, back: null, handoff };
    }
    if (!same(bind, p.bind)) return failed;
    try { await buy(user, String(query.get('code')), p.verifier); return { ok: true, app: false, back: p.back }; }
    catch { return failed; }
  }

  /** The phone app's way back: its one-time code, redeemed with the session of the profile that started. */
  async function redeem(user, handoff) {
    sweep();
    const h = typeof handoff === 'string' && handoffs.get(handoff);
    if (!h) return false;
    handoffs.delete(handoff);
    if (h.uid !== user.id) return false;
    try { await buy(user, h.code, h.verifier); return true; } catch { return false; }
  }

  async function access(user, force) {
    // The connection this call is for: keep() and connecting again put a new object on the row,
    // disconnecting removes it. A refresh that ends after either changes nothing.
    const rec = user.spotify;
    const t = rec?.tokens ? unseal(rec.tokens) : null;
    if (!t || !t.refresh) throw err('auth', 409, 'not connected');
    if (!force && t.access && t.exp - 60000 > now()) return t.access;
    // One refresh at a time per profile: Spotify may hand out a new refresh token and stop honouring
    // the old one, so a second refresh racing the first (two devices polling, a tap during a poll)
    // would read as access removed and disconnect the account.
    if (refreshing.has(user.id)) return refreshing.get(user.id);
    const run = (async () => {
      try {
        const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
        if (user.spotify !== rec) throw err('auth', 409, 'not connected');
        const n = keep(user, j, t);
        save();
        return n.access;
      } catch (e) {
        // A refresh token Spotify no longer honours (access removed in the Spotify account): connect
        // again. Only for the connection the refresh was for: a newer one stays.
        if (e.code === 'auth' && e.status !== 409) {
          if (user.spotify === rec) { delete user.spotify; save(); }
          throw err('auth', 409, 'not connected');
        }
        throw e;
      }
    })().finally(() => refreshing.delete(user.id));
    refreshing.set(user.id, run);
    return run;
  }

  async function call(user, method, p) {
    let r;
    for (const force of [false, true]) {
      const token = await access(user, force);
      r = await fetchFn(API + p, { method, headers: { Authorization: 'Bearer ' + token } });
      if (r.status !== 401) break;
    }
    return r;
  }

  const refusal = r => err(r.status === 403 ? 'premium' : r.status === 404 ? 'device' : r.status === 429 ? 'busy' : 'failed', r.status);

  async function nowPlaying(user) {
    const c = cache.get(user.id);
    if (c && now() - c.at < CACHE_MS) return c.track;
    const r = await call(user, 'GET', '/me/player?additional_types=episode');
    if (r.status !== 204 && !r.ok) throw refusal(r);
    const track = r.status === 204 ? null : trackOf(await r.json());
    cache.set(user.id, { at: now(), track });
    return track;
  }

  async function control(user, action) {
    const [method, p] = ACTIONS[action];
    const r = await call(user, method, p);
    cache.delete(user.id);
    if (!r.ok) throw refusal(r);
  }

  function status(user) {
    return { available: true, connected: !!user.spotify?.tokens, name: user.spotify?.name || null, redirect: cfg.redirectUri };
  }

  function disconnect(user) { delete user.spotify; cache.delete(user.id); save(); }

  return { start, finish, redeem, nowPlaying, control, status, disconnect };
}
