/* RENPHO Health on a profile: connect, sync, disconnect (routes in server.js, Settings → Health in
 * the app). The client (client.js) talks to RENPHO, the mapping (mapping.js) turns its readings
 * into openGym's; this file holds the account and runs a sync.
 *
 * The account lives on the user row (db.json) as `renpho`: the e-mail (shown in Settings), the
 * sign-in and the RENPHO session, both sealed with the instance's at-rest encryption (the Coach's,
 * coach/config.js), and what the last sync did. The session is used while RENPHO takes it; the
 * sealed password only signs in again when RENPHO no longer does, so a sync keeps working without
 * anyone typing it twice. Neither ever reaches a log, an answer or the app.
 *
 * RENPHO keeps one session per account, so signing in with the account the RENPHO app uses signs
 * the app out. A second RENPHO account avoids that (`mode: 'friend'`): added as a friend of the
 * main one in the RENPHO app, it reads the main account's daily values through RENPHO's friend
 * pages, and the app stays signed in. One value per day then (the day's last weigh-in) and no
 * segmental values: RENPHO's friend pages have none.
 *
 * Readings go into the profile's own state through `merge` (api/health/fold.js mergeReadings):
 * src 'renpho', sid `<RENPHO id>:<type>`, so a reading already there is updated, never added twice,
 * whichever device or how many times "Sync now" was pressed. RENPHO's whole reading, unknown fields
 * included, is kept per reading beside the state (`rawFile`): provider, external_id,
 * external_timestamp, synced_at and raw_provider_data.
 */
import { createRenphoClient, RenphoError, FRIEND_PARAMS, newDeviceId, zoneOf } from './client.js';
import { mapMeasurement, mapFriendDay, belongsTo, PROVIDER } from './mapping.js';

const MESSAGES = {
  auth: 'RENPHO did not accept this e-mail and password',
  rejected: 'RENPHO refused the request; sign in again',
  network: 'RENPHO could not be reached; try again later',
  format: 'RENPHO answered in a way this version does not understand',
  failed: 'The sync failed',
  'no-friend': 'This RENPHO account has no friends: add it as a friend of your main account in the RENPHO app',
  'friend-choice': 'This RENPHO account has more than one friend: give the e-mail of the one to import',
};
// RENPHO's own code and words for a refusal ("50012: …"), kept so Settings can say why; nothing
// of the request is in it, only what RENPHO answered.
export const reasonOf = e => {
  const m = /\(code ([^)]*)\)/.exec(String(e?.message || ''));
  return m ? m[1].slice(0, 160) : null;
};
const problem = e => {
  const code = e instanceof RenphoError || MESSAGES[e?.code] ? e.code : 'failed';
  const reason = reasonOf(e);
  return { code, message: MESSAGES[code] || MESSAGES.failed, ...(reason ? { reason } : {}) };
};

/**
 * `seal`/`unseal` encrypt for the user row, `save` writes db.json, `merge(uid, readings)` folds
 * readings into the profile and answers { added, updated }, `readRaw(uid)`/`writeRaw(uid, obj)`
 * keep the raw readings, `log` is told what happened (never a secret).
 */
export function createRenphoService({ seal, unseal, save, merge, readRaw, writeRaw, removeRaw, client = createRenphoClient(), now = Date.now, log = () => {} }) {
  const running = new Map();   // uid → the sync in flight

  function status(user) {
    const r = user.renpho;
    if (!r) return { connected: false };
    return {
      connected: true, email: r.email || null, connectedAt: r.connected || null,
      lastSync: r.lastSync || null, lastResult: r.lastResult || null, error: r.error || null,
      syncing: running.has(user.id), fields: r.fields || [], unknown: r.unknown || [], segmental: !!r.segmental,
      mode: r.mode === 'friend' ? 'friend' : 'account', friend: r.friend ? (r.friend.email || r.friend.name || null) : null,
    };
  }

  // What every request tells RENPHO about the connection: its device id and the profile's zone.
  const device = r => ({ devId: r.devId, zone: r.zone });

  // The friend whose readings a second account imports: the one whose e-mail (or name) was given,
  // or the only one it has.
  async function pickFriend(dev, session, wanted) {
    const list = await client.friends(dev, session);
    if (!list.length) throw new RenphoError('no-friend', MESSAGES['no-friend']);
    const w = String(wanted || '').trim().toLowerCase();
    const hit = w ? list.find(f => f.email.toLowerCase() === w || f.name.toLowerCase() === w) : list.length === 1 ? list[0] : null;
    if (!hit) throw new RenphoError('friend-choice', MESSAGES['friend-choice']);
    return { id: hit.userId, name: hit.name, email: hit.email };
  }

  /**
   * Signs in to RENPHO and keeps the account on the user row; the first sync follows. `mode`
   * 'friend' signs in with a second account and imports its friend's readings (`friendEmail`,
   * or its only friend); `zone` is the profile's time zone, which RENPHO groups days by.
   */
  async function connect(user, { email, password, areaCode, mode, friendEmail, zone }) {
    const creds = { email: String(email || '').trim(), password: String(password || ''), areaCode: String(areaCode || 'US').trim().toUpperCase() || 'US' };
    if (!creds.email || !creds.password) throw Object.assign(new Error(MESSAGES.auth), { code: 'auth' });
    const friendMode = mode === 'friend';
    const dev = { devId: user.renpho?.devId || newDeviceId(), zone: zoneOf(zone || user.renpho?.zone) };
    const session = await client.login(creds, dev);
    const friend = friendMode ? await pickFriend(dev, session, friendEmail) : null;
    user.renpho = {
      email: creds.email, mode: friendMode ? 'friend' : 'account', ...dev, ...(friend ? { friend } : {}),
      weightUnit: session.weightUnit ?? null,
      creds: seal(creds), session: seal({ token: session.token, userId: session.userId }),
      connected: now(), lastSync: null, error: null,
    };
    save();
    log('renpho.connect', user.id, user.renpho.mode);
    return status(user);
  }

  function disconnect(user) {
    delete user.renpho;
    save();
    try { removeRaw(user.id); } catch { /* nothing kept yet */ }
    log('renpho.disconnect', user.id);
  }

  async function signIn(user) {
    const creds = unseal(user.renpho.creds);
    if (!creds?.email || !creds?.password) throw new RenphoError('auth', MESSAGES.auth);
    const s = await client.login(creds, device(user.renpho));
    user.renpho.session = seal({ token: s.token, userId: s.userId });
    save();
    return { token: s.token, userId: s.userId };
  }

  // A request with the kept session, and once more after signing in again if RENPHO refused it.
  async function withSession(user, session, fn) {
    try { return { session, value: await fn(session) }; }
    catch (e) {
      if (e.code !== 'rejected') throw e;
      const fresh = await signIn(user);
      return { session: fresh, value: await fn(fresh) };
    }
  }

  // The account's own readings, every one RENPHO keeps, as [mapped, raw] pairs.
  async function ownReadings(user, session) {
    const dev = device(user.renpho);
    const got = await withSession(user, session, s => client.tables(dev, s));
    session = got.session;
    const raws = [];
    let complete = true;
    for (const table of got.value) {
      const ids = table.userIds.length ? table.userIds : [session.userId];
      const who = ids.includes(String(session.userId)) ? String(session.userId) : ids[0];
      const page = await withSession(user, session, s => client.readings(dev, s, table, who));
      session = page.session;
      complete = complete && page.value.complete;
      raws.push(...page.value.rows.filter(x => belongsTo(x, session.userId)));
    }
    return { items: raws.map(raw => [mapMeasurement(raw), raw]), complete };
  }

  // A friend's daily values, one trend per value, put together by day. After the first sync only
  // the last few days are asked again (and the windows they fall in), not the whole history.
  async function friendReadings(user, session) {
    const r = user.renpho, dev = device(r), fid = r.friend?.id;
    if (!fid) throw new RenphoError('no-friend', MESSAGES['no-friend']);
    const since = r.lastSync ? r.lastSync - 3 * 86400000 : 0;
    const days = new Map();
    for (const param of FRIEND_PARAMS) {
      const got = await withSession(user, session, s => client.trend(dev, s, fid, param, { since }));
      session = got.session;
      for (const pt of got.value) {
        if (param !== 'weight' && !days.has(pt.day)) continue;   // a day is a weigh-in
        const d = days.get(pt.day) || { day: pt.day, ts: pt.ts, weightUnit: r.weightUnit ?? 1, values: {} };
        d.values[param] = pt.value;
        days.set(pt.day, d);
      }
    }
    return { items: [...days.values()].map(d => [mapFriendDay(fid, d), d]), complete: true };
  }

  async function run(user) {
    const r = user.renpho;
    let session = unseal(r.session);
    if (!session?.token) session = await signIn(user);
    const friendMode = r.mode === 'friend';
    const { items, complete } = friendMode ? await friendReadings(user, session) : await ownReadings(user, session);
    // Map, keep the raw reading, and fold the values in.
    const at = now();
    const store = readRaw(user.id) || { provider: PROVIDER, measurements: {} };
    // A day the account's own readings already cover (imported before a switch to a second
    // account) keeps them: the friend's value of that day would be the same weigh-in twice.
    const ownDays = new Set();
    if (friendMode) {
      for (const m of Object.values(store.measurements)) {
        if (String(m.external_id).startsWith('day:')) continue;
        const d = mapMeasurement(m.raw_provider_data)?.d;
        if (d) ownDays.add(d);
      }
    }
    const readings = [];
    const fields = new Set(), unknown = new Set();
    let segmental = false, count = 0;
    for (const [m, raw] of items) {
      if (!m || ownDays.has(m.d)) continue;
      count++;
      const prev = store.measurements[m.externalId];
      const same = prev && JSON.stringify(prev.raw_provider_data) === JSON.stringify(raw);
      store.measurements[m.externalId] = {
        provider: PROVIDER, external_id: m.externalId, external_timestamp: m.t,
        synced_at: same ? prev.synced_at : at, raw_provider_data: raw,
      };
      readings.push(...m.readings);
      m.fields.forEach(f => fields.add(f));
      m.unknown.forEach(f => unknown.add(f));
      if (m.fields.some(f => /^(segFat|segMuscle|imp20|imp100)/.test(f))) segmental = true;
    }
    writeRaw(user.id, store);
    const { added, updated } = readings.length ? merge(user.id, readings) : { added: 0, updated: 0 };
    return { measurements: count, added, updated, complete, fields: [...fields].sort(), unknown: [...unknown].sort(), segmental };
  }

  /** One sync of the profile's RENPHO readings; a second call while one runs waits for it. */
  function sync(user) {
    if (!user.renpho) return Promise.reject(Object.assign(new Error('not connected'), { code: 'not-connected' }));
    if (running.has(user.id)) return running.get(user.id);
    const p = (async () => {
      try {
        const res = await run(user);
        if (!user.renpho) return res;   // disconnected meanwhile
        Object.assign(user.renpho, {
          lastSync: now(), error: null, fields: res.fields, unknown: res.unknown, segmental: res.segmental,
          lastResult: { measurements: res.measurements, added: res.added, updated: res.updated, complete: res.complete },
        });
        save();
        log('renpho.sync', user.id, `${res.measurements} readings, ${res.added} added, ${res.updated} updated`);
        return res;
      } catch (e) {
        const err = problem(e);
        if (user.renpho) { user.renpho.error = { ...err, at: now() }; save(); }
        log('renpho.sync-failed', user.id, err.code);
        throw Object.assign(new Error(err.message), { code: err.code });
      } finally { running.delete(user.id); }
    })();
    running.set(user.id, p);
    return p;
  }

  /** The profiles whose readings are due: connected, not refused, last sync older than `everyMs`. */
  function due(users, everyMs) {
    const t = now();
    return users.filter(u => {
      const r = u.renpho;
      if (!r || u.disabled || running.has(u.id)) return false;
      // A failed sync waits as well, so RENPHO is never asked again every ten minutes (signing in
      // over and over is what gets an account refused): an hour after a passing problem, the whole
      // interval after a refused sign-in, which is tried again then rather than given up on.
      const e = r.error;
      if (e?.at) return t - e.at >= (e.code === 'auth' ? everyMs : Math.min(everyMs, 3600000));
      return t - (r.lastSync || 0) >= everyMs;
    });
  }

  return { status, connect, disconnect, sync, due };
}
