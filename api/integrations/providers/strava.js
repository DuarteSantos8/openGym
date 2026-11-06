/* Strava (#478, idea by @workhardbekind): finished workouts go up to Strava as activities, cardio
 * as what it was (a run, a ride, a row) and, when the person switches it on, strength sessions as
 * Weight Training. Upload only: nothing is read back from Strava.
 *
 * Strava gives one API application per Strava account and wants every self-hoster to register
 * their own (https://www.strava.com/settings/api), so this is off unless the admin sets
 * INTEGRATIONS=strava (beside any others) and STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET, with the
 * app's "Authorization Callback Domain" set to the host of ORIGIN. docs/INTEGRATIONS.md, Strava.
 *
 * Two choices follow from that one app being shared with whatever else its owner runs:
 *   - no webhook subscription (an app gets one; openGym taking it would take it from the other)
 *   - Disconnect forgets the tokens here and never calls /oauth/deauthorize, which would end the
 *     app's access for that athlete everywhere
 *
 * The OAuth exchange (code → tokens) and the refresh go to www.strava.com; the upload is
 * POST /api/v3/activities (a manual activity: name, sport type, start, length, distance, a
 * description with every exercise and its sets). Tokens are sealed by the hub (crypto.js).
 * `fetchFn` is the network, injectable for the tests: (url, { method, headers, body }) →
 * { status, json() }. */

export const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const TOKEN_URL = 'https://www.strava.com/oauth/token';
export const ACTIVITY_URL = 'https://www.strava.com/api/v3/activities';
export const SCOPE = 'activity:write';
const TIMEOUT_MS = 15_000;
// Strava's own limits are 100 requests per 15 minutes and 1000 a day per application; the
// instance stays well under them, a profile further still.
const RATE = { capacity: 60, refillMs: 15_000 };
const CONN_RATE = { capacity: 10, refillMs: 60_000 };
const DESC_MAX = 3500;

// What a cardio exercise is on Strava, by its name. The first that matches wins.
const SPORTS = [
  [/treadmill/i, 'Run', true], [/\b(run|running|jog|jogging|sprint)/i, 'Run', false],
  [/\b(walk|walking)\b/i, 'Walk', false], [/\bhike|hiking\b/i, 'Hike', false],
  [/(stationary|spin|assault|air)\s*bike|bike|cycl|ergometer.*bike/i, 'Ride', true],
  [/row/i, 'Rowing', true], [/elliptical|cross.?trainer/i, 'Elliptical', true],
  [/stair|step.?mill|stepper|climb/i, 'StairStepper', true], [/swim/i, 'Swim', false],
  [/ski.?erg|nordic/i, 'NordicSki', true], [/jump.?rope|skipping/i, 'Workout', false],
];
export function sportOf(name) {
  for (const [re, sport, trainer] of SPORTS) if (re.test(String(name || ''))) return { sport, trainer };
  return { sport: 'Workout', trainer: false };
}

const isCardioSet = s => s && !s.sides && Number(s.minutes) > 0 && !(Number(s.reps) > 0);
const cardioOf = ex => (ex.sets || []).filter(isCardioSet);

const fmt = n => String(Math.round(n * 100) / 100);
function setText(s, unit) {
  if (s.sides) return `L ${setText(s.sides.left, unit)} / R ${setText(s.sides.right, unit)}`;
  if (isCardioSet(s)) {
    const km = s.distanceKm != null ? s.distanceKm : (s.speedKmh ? s.speedKmh * s.minutes / 60 : null);
    return [fmt(s.minutes) + ' min', km ? fmt(km) + ' km' : null, s.incline ? fmt(s.incline) + '%' : null].filter(Boolean).join(' · ');
  }
  if (s.seconds != null && !(s.reps > 0)) return (s.weight ? fmt(s.weight) + unit + ' × ' : '') + fmt(s.seconds) + ' s';
  return (s.weight ? fmt(s.weight) + unit + ' × ' : '') + fmt(s.reps || 0);
}

/**
 * The activity for a workout (events.js workoutPayload), or null when there is nothing to send:
 * a strength-only workout with strength uploads off.
 */
export function activityFor(w, { strength = false } = {}) {
  if (!w || typeof w !== 'object') return null;
  const exercises = Array.isArray(w.exercises) ? w.exercises : [];
  const cardio = exercises.filter(e => cardioOf(e).length);
  const lifting = exercises.filter(e => (e.sets || []).some(s => !isCardioSet(s)));
  if (!cardio.length && !(strength && lifting.length)) return null;
  const cardioMin = cardio.reduce((a, e) => a + cardioOf(e).reduce((b, s) => b + Number(s.minutes), 0), 0);
  const distanceKm = cardio.reduce((a, e) => a + cardioOf(e).reduce((b, s) => b + (s.distanceKm != null ? Number(s.distanceKm) : s.speedKmh ? s.speedKmh * s.minutes / 60 : 0), 0), 0);
  // Strength on: the whole session as Weight Training, its cardio in the description. Off: the
  // cardio as what it was, the longest exercise naming the sport.
  const asStrength = strength && lifting.length > 0;
  const main = cardio.slice().sort((a, b) => cardioOf(b).reduce((x, s) => x + s.minutes, 0) - cardioOf(a).reduce((x, s) => x + s.minutes, 0))[0];
  const { sport, trainer } = asStrength ? { sport: 'WeightTraining', trainer: true } : sportOf(main?.name);
  const elapsed = asStrength || !cardioMin
    ? (w.durationMin > 0 ? w.durationMin * 60 : Math.max(60, Math.round(cardioMin * 60)))
    : Math.round(cardioMin * 60);
  const unit = w.unit === 'lb' ? ' lb' : ' kg';
  const lines = [];
  for (const e of asStrength ? exercises : cardio) {
    const sets = (e.sets || []).filter(s => !s.warmup && (asStrength || isCardioSet(s)));
    if (sets.length) lines.push(`${e.name}: ${sets.map(s => setText(s, unit)).join(', ')}`);
  }
  if (asStrength && w.totals?.volume) lines.push('', `Volume ${fmt(w.totals.volume)}${unit}, ${w.totals.sets} sets`);
  if (Array.isArray(w.records) && w.records.length) lines.push(`PRs: ${w.records.map(r => r.name).join(', ')}`);
  if (w.note) lines.push('', w.note);
  lines.push('', 'Logged with openGym');
  const name = (w.name || (asStrength ? 'Strength training' : main?.name) || 'Workout').slice(0, 120);
  return {
    name,
    sport_type: sport,
    start_date_local: w.startedAt || (w.date ? w.date + 'T12:00:00Z' : new Date().toISOString()),
    elapsed_time: Math.max(1, Math.round(elapsed)),
    description: lines.join('\n').slice(0, DESC_MAX),
    ...(trainer ? { trainer: 1 } : {}),
    ...(!asStrength && distanceKm > 0 ? { distance: Math.round(distanceKm * 1000) } : {}),
  };
}

const form = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');

async function call(fetchFn, url, body) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  tm.unref?.();
  const t0 = Date.now();
  try {
    const r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form(body), signal: ctrl.signal });
    let data = null;
    try { data = await r.json(); } catch { /* no body */ }
    return { status: r.status, data, ms: Date.now() - t0 };
  } finally { clearTimeout(tm); }
}
async function authed(fetchFn, url, token, body) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  tm.unref?.();
  const t0 = Date.now();
  try {
    const r = await fetchFn(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form(body), signal: ctrl.signal });
    let data = null;
    try { data = await r.json(); } catch { /* no body */ }
    return { status: r.status, data, ms: Date.now() - t0 };
  } finally { clearTimeout(tm); }
}

export function stravaProvider({ env = process.env, fetchFn = globalThis.fetch, now = Date.now } = {}) {
  const clientId = String(env.STRAVA_CLIENT_ID || '').trim();
  const clientSecret = String(env.STRAVA_CLIENT_SECRET || '').trim();

  /** Tokens from Strava's answer, or a refusal the hub turns into a message. */
  const tokensFrom = (r, refreshToken = null) => {
    if (r.status === 200 && r.data?.access_token) {
      return { access: r.data.access_token, refresh: r.data.refresh_token || refreshToken, expiresAt: Number(r.data.expires_at) * 1000 || now() + 3600_000, athlete: r.data.athlete || null };
    }
    return null;
  };

  async function refresh(reveal, reseal) {
    const rt = reveal('refresh');
    if (!rt) return { error: { ok: false, retry: false, gone: true, code: 'reconnect', msg: 'Reconnect Strava: its sign-in is gone.' } };
    let r;
    try { r = await call(fetchFn, TOKEN_URL, { client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: rt }); }
    catch { return { error: { ok: false, retry: true, code: 'network', msg: 'Could not reach Strava.' } }; }
    const tok = tokensFrom(r, rt);
    if (!tok) {
      // 400/401: Strava no longer honours it (revoked, or replaced by another service of the same app).
      if (r.status === 400 || r.status === 401) return { error: { ok: false, retry: false, gone: true, status: r.status, code: 'reconnect', msg: 'Reconnect Strava: it no longer accepts this sign-in.' } };
      return { error: { ok: false, retry: true, status: r.status, code: 'http', msg: `Strava answered ${r.status} to the sign-in refresh.` } };
    }
    reseal({ access: tok.access, refresh: tok.refresh, expires: String(tok.expiresAt) });
    return { access: tok.access };
  }

  return {
    id: 'strava',
    kind: 'oauth',
    category: 'training',
    events: ['workout.finished'],
    env: ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'],
    configured: e => !!String(e.STRAVA_CLIENT_ID || '').trim() && !!String(e.STRAVA_CLIENT_SECRET || '').trim(),
    max: 1,
    rate: RATE,
    connRate: CONN_RATE,

    authorizeUrl({ state, redirectUri }) {
      const u = new URL(AUTHORIZE_URL);
      u.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, approval_prompt: 'auto', scope: SCOPE, state }).toString();
      return u.toString();
    },

    /** The callback's code for tokens. → { label, info, secrets, events } or throws { status, code, message }. */
    async callback(query) {
      const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
      if (query.error) fail(400, 'denied', 'Strava was not given access.');
      const granted = String(query.scope || '').split(/[\s,]+/);
      if (!granted.includes(SCOPE)) fail(400, 'scope', 'Strava has to be allowed to upload activities. Connect again and leave that box ticked.');
      if (!query.code) fail(400, 'code', 'Strava sent no code back.');
      let r;
      try { r = await call(fetchFn, TOKEN_URL, { client_id: clientId, client_secret: clientSecret, code: String(query.code).slice(0, 200), grant_type: 'authorization_code' }); }
      catch { fail(502, 'network', 'Could not reach Strava.'); }
      const tok = tokensFrom(r);
      if (!tok) fail(502, 'exchange', `Strava did not hand over the sign-in (${r.status}).`);
      const a = tok.athlete || {};
      const who = [a.firstname, a.lastname].filter(Boolean).join(' ').trim() || (a.id ? 'Athlete ' + a.id : 'Strava');
      return {
        label: who.slice(0, 60),
        events: ['workout.finished'],
        info: { athlete: who.slice(0, 80), ...(a.id ? { athleteId: String(a.id).slice(0, 20) } : {}), strength: 'off' },
        secrets: { access: tok.access, refresh: tok.refresh, expires: String(tok.expiresAt) },
      };
    },

    connect() { throw Object.assign(new Error('connect Strava through its sign-in'), { status: 400, code: 'oauth' }); },

    /** The one setting: strength workouts too, as Weight Training. And pause. */
    update(input, rec) {
      const patch = {};
      if (typeof input.strength === 'boolean') patch.info = { ...(rec?.info || {}), strength: input.strength ? 'on' : 'off' };
      if (typeof input.paused === 'boolean') patch.paused = input.paused;
      return patch;
    },

    /** One upload. `reveal(name)` opens a sealed secret, `reseal(map)` stores refreshed ones. */
    async deliver(job, reveal, { reseal = () => {}, info = {} } = {}) {
      const w = job.payload?.data?.workout;
      if (job.ev === 'test') {
        // "Send test" checks the sign-in without posting an activity nobody did.
        const r = await refresh(reveal, reseal);
        return r.error || { ok: true, status: 200 };
      }
      const act = activityFor(w, { strength: info.strength === 'on' });
      if (!act) return { ok: true, status: 0, msg: 'Nothing to upload: strength workouts are off.' };
      let token = reveal('access');
      const exp = Number(reveal('expires')) || 0;
      if (!token || exp - now() < 120_000) {
        const r = await refresh(reveal, reseal);
        if (r.error) return r.error;
        token = r.access;
      }
      let res;
      try { res = await authed(fetchFn, ACTIVITY_URL, token, act); }
      catch { return { ok: false, retry: true, code: 'network', msg: 'Could not reach Strava.' }; }
      if (res.status === 401) {
        const r = await refresh(reveal, reseal);
        if (r.error) return r.error;
        try { res = await authed(fetchFn, ACTIVITY_URL, r.access, act); }
        catch { return { ok: false, retry: true, code: 'network', msg: 'Could not reach Strava.' }; }
      }
      if (res.status === 201 || res.status === 200) return { ok: true, status: res.status, ms: res.ms };
      if (res.status === 429) return { ok: false, retry: true, retryAfterMs: 15 * 60_000, status: 429, code: 'rate', msg: 'Strava says slow down, trying again in 15 minutes.' };
      if (res.status >= 500) return { ok: false, retry: true, status: res.status, code: 'http', msg: `Strava answered ${res.status}.` };
      if (res.status === 403 || res.status === 401) return { ok: false, retry: false, gone: true, status: res.status, code: 'reconnect', msg: 'Reconnect Strava: it no longer lets openGym upload.' };
      return { ok: false, retry: false, status: res.status, code: 'http', msg: `Strava refused the activity (${res.status}).` };
    },
  };
}
