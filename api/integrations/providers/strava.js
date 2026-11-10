/* Strava: every finished workout becomes a Weight Training activity, with the sets in its
 * description. Upload only: nothing is read from Strava, and no Strava webhook is registered.
 * The first `oauth` provider: the hub signs the state and stores what callback() answers, sealed
 * like a webhook's secret; deliver() refreshes the access token when it has run out and hands the
 * new pair back through keep().
 *
 * Every self-hoster registers their own Strava API application (STRAVA_CLIENT_ID,
 * STRAVA_CLIENT_SECRET); openGym ships no shared client secret. Strava allows one application per
 * Strava account, so an instance may share its application with another tool of the same owner.
 * That is why disconnecting only forgets the tokens here and never calls /oauth/deauthorize,
 * which would revoke the application for that athlete everywhere.
 *
 * Setting it up: docs/INTEGRATIONS.md. */

export const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const TOKEN_URL = 'https://www.strava.com/oauth/token';
export const ACTIVITIES_URL = 'https://www.strava.com/api/v3/activities';
export const ATHLETE_URL = 'https://www.strava.com/api/v3/athlete';
export const SCOPE = 'activity:write';
export const TIMEOUT_MS = 15_000;
export const DESC_MAX = 2000;
// Strava's limits are per application and a quarter of an hour long.
export const BUSY_WAIT_MS = 15 * 60_000;

const RECONNECT = { ok: false, retry: false, gone: true, code: 'reconnect', msg: 'Strava no longer accepts this connection. Connect it again.' };
// The server's own keys are wrong (STRAVA_CLIENT_SECRET mistyped or reset on strava.com). Nothing
// a profile can fix and nothing wrong with its connection: tried again later, never paused.
const APP_KEYS = { ok: false, retry: true, code: 'app', msg: 'Strava refused this server\'s application keys. Its admin has to check them.', retryAfterMs: 3600_000 };
const SEALED = { ok: false, retry: false, code: 'sealed', msg: 'Its settings cannot be read any more. Connect it again.' };

const n2 = v => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(2) : 0);

function setText(s, unit) {
  const w = n2(s?.weight), r = n2(s?.reps), sec = n2(s?.seconds), min = n2(s?.minutes);
  if (r && w) return `${w}${unit}×${r}`;
  if (r) return `${r}`;
  if (sec) return `${sec}s`;
  if (min) return `${min}min`;
  return null;
}
function setLine(s, unit) {
  if (s?.sides) {
    const l = setText(s.sides.left, unit), r = setText(s.sides.right, unit);
    return l || r ? `L ${l || '–'} / R ${r || '–'}` : null;
  }
  return setText(s, unit);
}

/** The Strava activity for a workout as events.js describes it (the webhook's payload). */
export function activityFor(w) {
  const unit = w?.unit === 'lb' ? 'lb' : 'kg';
  const lines = [];
  for (const e of Array.isArray(w?.exercises) ? w.exercises : []) {
    const done = (Array.isArray(e?.sets) ? e.sets : []).map(s => setLine(s, unit)).filter(Boolean);
    if (done.length) lines.push(`${e.name || 'Exercise'}: ${done.join(', ')}`);
  }
  const t = w?.totals || {};
  const records = Array.isArray(w?.records) ? w.records.length : 0;
  const head = [`${t.sets || 0} sets`];
  if (t.volume) head.push(`${Math.round(t.volume).toLocaleString('en')} ${unit} volume`);
  if (records) head.push(`${records} PR${records === 1 ? '' : 's'}`);
  let description = [head.join(' · '), '', ...lines, ...(w?.note ? ['', w.note] : []), '', 'Logged with openGym'].join('\n');
  if (description.length > DESC_MAX) description = description.slice(0, DESC_MAX - 1) + '…';
  const start = w?.startedAt || w?.endedAt || (w?.date ? w.date + 'T12:00:00Z' : new Date().toISOString());
  return {
    name: String(w?.name || 'Strength workout').slice(0, 200),
    sport_type: 'WeightTraining',
    start_date_local: start,
    elapsed_time: Math.max(60, Math.round((w?.durationMin || 0) * 60)),
    description,
  };
}

export function stravaProvider({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const clientId = String(env.STRAVA_CLIENT_ID || '').trim();
  const clientSecret = String(env.STRAVA_CLIENT_SECRET || '').trim();

  /** One JSON request. Answers { status, body }, or { fail } in the outbox's words on no answer. */
  async function call(url, { method = 'GET', token, body } = {}) {
    try {
      const r = await fetchImpl(url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    } catch (e) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      return { fail: { ok: false, retry: true, code: timeout ? 'timeout' : 'network', msg: timeout ? 'No answer from Strava within 15 seconds.' : 'Could not reach Strava.' } };
    }
  }
  const tokenRequest = params => call(TOKEN_URL, { method: 'POST', body: { client_id: clientId, client_secret: clientSecret, ...params } });
  const tokens = t => ({ access: String(t.access_token || ''), refresh: String(t.refresh_token || ''), expires: String((t.expires_at || 0) * 1000) });

  /** A Strava answer that is not a success, in the outbox's words. */
  function judge(r) {
    if (r.fail) return r.fail;
    const s = r.status;
    if (s === 429) return { ok: false, retry: true, status: s, code: 'busy', msg: 'Strava is rate limiting this server.', retryAfterMs: BUSY_WAIT_MS };
    if (s >= 500) return { ok: false, retry: true, status: s, code: 'busy', msg: `Strava answered ${s}.` };
    return { ok: false, retry: false, status: s, code: 'refused', msg: String(r.body?.message || `Strava answered ${s}.`).slice(0, 120) };
  }

  // One refresh at a time per connection. Strava may hand out a new refresh token with each
  // refresh, so two deliveries sending the same old one would see the second turned down, and a
  // healthy connection asked to sign in again.
  const refreshing = new Map();

  /** A usable access token: { token }, or { fail } saying why not. `refused` is an access token
   *  Strava just answered 401 to: it is not handed out again, whatever its expiry says. */
  async function accessToken(conn, reveal, keep, refused = null) {
    // Wait for a refresh another delivery started, then read what it stored.
    if (refreshing.has(conn)) await refreshing.get(conn);
    const access = reveal('access'), refresh = reveal('refresh'), expires = +reveal('expires') || 0;
    if (!refresh) return { fail: SEALED };
    if (access && access !== refused && expires - 60_000 > now()) return { token: access };
    if (!refreshing.has(conn)) {
      refreshing.set(conn, (async () => {
        const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
        // Strava says what it turned down. The refresh token: the connection was revoked on
        // Strava's side, or another tool on the same application replaced the token, and only
        // signing in again helps. The application: this server's keys, see APP_KEYS. Anything
        // else is a refusal like any other, and does not pause the connection.
        if (r.status === 400 || r.status === 401) {
          const what = (Array.isArray(r.body?.errors) ? r.body.errors : []).map(e => String(e?.resource || ''));
          if (what.includes('RefreshToken')) return { fail: RECONNECT };
          if (what.includes('Application')) return { fail: { ...APP_KEYS, status: r.status } };
        }
        if (r.fail || r.status !== 200 || !r.body?.access_token) return { fail: judge(r) };
        const next = tokens(r.body);
        if (!next.refresh) next.refresh = refresh;
        keep?.(next);
        return { token: next.access };
      })().finally(() => refreshing.delete(conn)));
    }
    return refreshing.get(conn);
  }

  return {
    id: 'strava',
    kind: 'oauth',
    category: 'training',
    events: ['workout.finished'],
    env: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'],
    configured: e => !!(String(e.STRAVA_CLIENT_ID || '').trim() && String(e.STRAVA_CLIENT_SECRET || '').trim()),
    max: 1,
    // Well inside Strava's default 100 requests per 15 minutes and 1,000 a day per application.
    rate: { capacity: 40, refillMs: 120_000 },
    connRate: { capacity: 10, refillMs: 60_000 },

    /** Where the browser goes to give consent. */
    authorizeUrl({ state, redirectUri }) {
      return AUTHORIZE_URL + '?' + new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: 'code', approval_prompt: 'auto', scope: SCOPE, state,
      });
    },

    /** Strava sent the browser back: trade the code for tokens and say what to store. */
    async callback(query) {
      const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
      if (query.error) fail(400, 'the Strava sign-in was cancelled', 'denied');
      if (!String(query.scope || '').split(',').includes(SCOPE)) fail(400, 'Strava was not allowed to upload activities', 'scope');
      const r = await tokenRequest({ grant_type: 'authorization_code', code: String(query.code || '') });
      if (r.fail || r.status !== 200 || !r.body?.access_token || !r.body?.refresh_token) fail(502, 'Strava did not hand out tokens', 'exchange');
      const a = r.body.athlete || {};
      const name = [a.firstname, a.lastname].filter(Boolean).join(' ').trim() || 'Strava';
      return { label: name, events: ['workout.finished'], info: { athlete: name, ...(a.id ? { athleteId: String(a.id) } : {}) }, secrets: tokens(r.body) };
    },

    connect() { throw Object.assign(new Error('Strava is connected through its sign-in'), { status: 400, code: 'oauth' }); },
    /** Pausing is all there is to change. */
    update(input) { return input?.paused != null ? { paused: input.paused === true } : {}; },

    async deliver(job, reveal, keep) {
      const started = now();
      const done = res => ({ ...res, ms: Math.max(0, now() - started) });
      const conn = `${job.uid}:${job.conn}`;
      let t = await accessToken(conn, reveal, keep);
      if (t.fail) return done(t.fail);
      // "Send test event" checks the connection; it does not put a made-up workout on Strava.
      const test = job.payload?.test === true;
      const workout = job.payload?.data?.workout;
      if (!test && !workout) return done({ ok: false, retry: false, code: 'payload', msg: 'Nothing to upload.' });
      const send = token => (test ? call(ATHLETE_URL, { token }) : call(ACTIVITIES_URL, { method: 'POST', token, body: activityFor(workout) }));
      let r = await send(t.token);
      if (r.status === 401) {
        t = await accessToken(conn, reveal, keep, t.token);
        if (t.fail) return done(t.fail);
        r = await send(t.token);
        if (r.status === 401) return done({ ...RECONNECT, status: 401 });
      }
      if (r.status >= 200 && r.status < 300) return done({ ok: true, status: r.status });
      return done(judge(r));
    },
  };
}
