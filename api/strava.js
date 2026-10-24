/* Strava — upload finished workouts as activities. Upload only: nothing is read back from Strava.
 *
 * Off unless STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are set. One Strava API application per
 * Strava account is all Strava allows, so the instance may well share its app with another
 * service of the same owner. Two consequences shape this file:
 *
 *  - Disconnecting only forgets the tokens here. It never calls Strava's /oauth/deauthorize,
 *    which revokes the app for that athlete everywhere — including the other service.
 *  - No webhook subscription. An app gets exactly one, and the other service may hold it.
 *    Uploads are driven by the profile's own sync (PUT /api/data) instead.
 *
 * Tokens live in DATA_DIR/strava.json (0600), one record per openGym user. Written as a factory
 * taking server.js's helpers, like coach/routes.js, so it has no import cycle and tests can hand
 * it a fake fetch.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { libraryName } from './coach/core/library.js';

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/activities';
const STATE_TTL_MS = 10 * 60000;
// A sync that carries an old workout (a restored backup, a first sync of a long history) must
// not flood Strava: only sessions that ended after connecting and recently are uploaded on their
// own. Anything older can still be sent by hand.
const AUTO_WINDOW_MS = 7 * 86400000;
const MAX_AUTO_PER_SYNC = 5;
const MAX_TRIES = 3;
const DESC_MAX = 2000;

export function createStrava({ dataDir, clientId, clientSecret, origin, secret, fetchImpl = globalThis.fetch, now = Date.now }) {
  const configured = !!(clientId && clientSecret);
  const file = path.join(dataDir, 'strava.json');
  let store = {};
  try { store = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* first use */ }
  const save = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  const redirectUri = origin.replace(/\/+$/, '') + '/api/strava/callback';

  /* ---------- OAuth state: binds the round trip to the user who started it ---------- */
  const mac = s => crypto.createHmac('sha256', secret).update('strava:' + s).digest('base64url');
  const makeState = uid => {
    const body = `${uid}.${now() + STATE_TTL_MS}.${crypto.randomBytes(9).toString('base64url')}`;
    return body + '.' + mac(body);
  };
  const stateUser = st => {
    const parts = String(st || '').split('.');
    if (parts.length !== 4) return null;
    const body = parts.slice(0, 3).join('.');
    const want = Buffer.from(mac(body)), got = Buffer.from(parts[3]);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    if (+parts[1] < now()) return null;
    return parts[0];
  };

  /* ---------- tokens ---------- */
  async function tokenRequest(params) {
    const r = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params })
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.message || `Strava answered ${r.status}`), { status: r.status });
    return body;
  }
  const keepTokens = (rec, t) => {
    rec.access = t.access_token;
    rec.refresh = t.refresh_token || rec.refresh;
    rec.expiresAt = (t.expires_at || 0) * 1000;
  };
  async function accessToken(uid) {
    const rec = store[uid];
    if (!rec) throw new Error('not connected');
    if (rec.access && rec.expiresAt - 60000 > now()) return rec.access;
    try {
      keepTokens(rec, await tokenRequest({ grant_type: 'refresh_token', refresh_token: rec.refresh }));
      delete rec.needsReconnect;
      save();
      return rec.access;
    } catch (e) {
      // 400/401 on a refresh is a token Strava no longer honours — revoked from the Strava side,
      // or replaced by another service refreshing the same athlete on the same app.
      if (e.status === 400 || e.status === 401) { rec.needsReconnect = true; save(); }
      throw e;
    }
  }

  /* ---------- workout → activity ---------- */
  const exName = (S, id) => (S.customEx || []).find(c => c && c.id === id)?.n || libraryName(id) || 'Exercise';
  const num = v => (Number.isFinite(+v) ? +(+v).toFixed(2) : 0);
  function setText(set, unit) {
    if (!set || set.done !== true) return null;
    const w = num(set.w), r = num(set.r), sec = num(set.sec);
    if (r && w) return `${w}${unit}×${r}`;
    if (r) return `${r}`;
    if (sec) return `${sec}s`;
    return null;
  }
  function entrySets(set, unit) {
    if (set && set.sides && set.sides.L && set.sides.R) {
      const l = setText(set.sides.L, unit), r = setText(set.sides.R, unit);
      return l || r ? [`L ${l || '–'} / R ${r || '–'}`] : [];
    }
    const s = setText(set, unit);
    return s ? [s] : [];
  }
  function activityFor(S, w) {
    const unit = S.unit === 'lb' ? 'lb' : 'kg';
    const lines = [];
    let sets = 0, volume = 0;
    for (const e of w.entries || []) {
      const done = (e.sets || []).flatMap(s => entrySets(s, unit));
      if (!done.length) continue;
      sets += done.length;
      for (const s of e.sets || []) if (s?.done) volume += num(s.w) * num(s.r);
      lines.push(`${exName(S, e.id)}: ${done.join(', ')}`);
    }
    const head = [`${sets} sets`];
    if (volume) head.push(`${Math.round(volume).toLocaleString('en')} ${unit} volume`);
    if ((w.prs || []).length) head.push(`${w.prs.length} PR${w.prs.length === 1 ? '' : 's'}`);
    let description = [head.join(' · '), '', ...lines, ...(w.note ? ['', w.note] : []), '', 'Logged with openGym'].join('\n');
    if (description.length > DESC_MAX) description = description.slice(0, DESC_MAX - 1) + '…';
    const start = +w.start || +w.end;
    const elapsed = Math.max(60, Math.round(((+w.end || start) - start) / 1000));
    return {
      name: (w.name || 'Strength workout').slice(0, 200),
      sport_type: 'WeightTraining',
      start_date_local: new Date(start).toISOString(),
      elapsed_time: elapsed,
      description
    };
  }

  async function upload(uid, S, w) {
    const token = await accessToken(uid);
    const r = await fetchImpl(ACTIVITIES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(activityFor(S, w))
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.message || `Strava answered ${r.status}`), { status: r.status });
    return body.id;
  }

  // One upload per workout per process, even with two syncs racing in.
  const inFlight = new Set();
  async function uploadOne(uid, S, w) {
    const rec = store[uid];
    const key = uid + ':' + w.id;
    if (!rec || inFlight.has(key) || rec.uploaded?.[w.id]) return rec?.uploaded?.[w.id] || null;
    inFlight.add(key);
    try {
      const id = await upload(uid, S, w);
      rec.uploaded = { ...rec.uploaded, [w.id]: id };
      if (rec.failed) delete rec.failed[w.id];
      save();
      return id;
    } catch (e) {
      rec.failed = { ...rec.failed, [w.id]: { tries: (rec.failed?.[w.id]?.tries || 0) + 1, error: String(e.message).slice(0, 200), at: now() } };
      rec.lastError = rec.failed[w.id].error;
      save();
      throw e;
    } finally { inFlight.delete(key); }
  }

  const finished = w => w && typeof w === 'object' && w.id && +w.end > 0 &&
    (w.entries || []).some(e => (e?.sets || []).some(s => s?.done === true || s?.sides?.L?.done === true || s?.sides?.R?.done === true));

  /** Called after every successful PUT /api/data. Never throws; never blocks the sync. */
  function onState(uid, S) {
    const rec = store[uid];
    if (!configured || !rec || !rec.auto || rec.needsReconnect || !Array.isArray(S?.workouts)) return;
    const t = now();
    const due = S.workouts.filter(w => finished(w) &&
      +w.end >= rec.connectedAt && t - +w.end <= AUTO_WINDOW_MS &&
      !rec.uploaded?.[w.id] && (rec.failed?.[w.id]?.tries || 0) < MAX_TRIES).slice(-MAX_AUTO_PER_SYNC);
    (async () => {
      for (const w of due) {
        try { await uploadOne(uid, S, w); }
        catch (e) { console.warn('strava upload failed', uid, w.id, e.message); if (store[uid]?.needsReconnect) return; }
      }
    })();
  }

  function routes({ json, readBody, readSession, readState }) {
    const signedIn = (req, res) => {
      const user = readSession(req);
      if (!user) json(res, 401, { error: 'not signed in' });
      return user;
    };
    const redirect = (res, to) => { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); };
    const back = q => origin.replace(/\/+$/, '') + '/#/settings?strava=' + q;

    return {
      'GET /api/strava/status': async (req, res) => {
        const user = signedIn(req, res); if (!user) return;
        const rec = store[user.id];
        json(res, 200, {
          configured,
          connected: !!rec,
          ...(rec ? {
            athlete: rec.athlete || null, auto: !!rec.auto, connectedAt: rec.connectedAt,
            uploads: Object.keys(rec.uploaded || {}).length, needsReconnect: !!rec.needsReconnect,
            lastError: rec.lastError || null
          } : {})
        });
      },

      // A top-level navigation from Settings, so the session cookie rides along; answers with a
      // redirect to Strava's consent screen.
      'GET /api/strava/connect': async (req, res) => {
        const user = readSession(req);
        if (!user) return redirect(res, back('signin'));
        if (!configured) return redirect(res, back('off'));
        const q = new URLSearchParams({
          client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
          approval_prompt: 'auto', scope: 'activity:write', state: makeState(user.id)
        });
        redirect(res, AUTHORIZE_URL + '?' + q);
      },

      'GET /api/strava/callback': async (req, res) => {
        const url = new URL(req.url, 'http://x');
        const user = readSession(req);
        const uid = stateUser(url.searchParams.get('state'));
        // The state must have been minted for whoever is signed in here — otherwise a link
        // carrying someone else's code would connect their Strava to this profile.
        if (!user || !uid || uid !== user.id) return redirect(res, back('error'));
        if (url.searchParams.get('error')) return redirect(res, back('denied'));
        if (!/(^|,)activity:write(,|$)/.test(url.searchParams.get('scope') || '')) return redirect(res, back('scope'));
        try {
          const t = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '' });
          const a = t.athlete || {};
          const rec = { athlete: { id: a.id, name: [a.firstname, a.lastname].filter(Boolean).join(' ') }, auto: true, connectedAt: now(), uploaded: {} };
          // Reconnecting keeps the record of what was already sent, so nothing goes up twice.
          if (store[user.id]) { rec.uploaded = store[user.id].uploaded || {}; rec.auto = store[user.id].auto !== false; rec.connectedAt = store[user.id].connectedAt; }
          keepTokens(rec, t);
          store[user.id] = rec;
          save();
          redirect(res, back('connected'));
        } catch (e) {
          console.warn('strava token exchange failed', e.message);
          redirect(res, back('error'));
        }
      },

      'POST /api/strava/settings': async (req, res) => {
        const user = signedIn(req, res); if (!user) return;
        const body = await readBody(req);
        const rec = store[user.id];
        if (!rec) return json(res, 409, { error: 'Strava is not connected' });
        if (typeof body.auto === 'boolean') rec.auto = body.auto;
        save();
        json(res, 200, { ok: true, auto: rec.auto });
      },

      'POST /api/strava/upload': async (req, res) => {
        const user = signedIn(req, res); if (!user) return;
        if (!configured || !store[user.id]) return json(res, 409, { error: 'Strava is not connected' });
        const body = await readBody(req);
        const S = readState(user.id) || {};
        const w = (S.workouts || []).find(x => x && x.id === body.id);
        if (!w) return json(res, 404, { error: 'that workout has not synced yet' });
        if (!finished(w)) return json(res, 400, { error: 'that workout has no completed sets' });
        const done = store[user.id].uploaded?.[w.id];
        if (done) return json(res, 200, { ok: true, activity: done, already: true });
        try { json(res, 200, { ok: true, activity: await uploadOne(user.id, S, w) }); }
        catch (e) { json(res, 502, { error: 'Strava: ' + e.message, reconnect: !!store[user.id]?.needsReconnect }); }
      },

      // Forgets the tokens on this server only — see the note at the top of the file.
      'POST /api/strava/disconnect': async (req, res) => {
        const user = signedIn(req, res); if (!user) return;
        delete store[user.id];
        save();
        json(res, 200, { ok: true });
      }
    };
  }

  return { configured, routes, onState, activityFor, uploadedId: (uid, wid) => store[uid]?.uploaded?.[wid] || null };
}
