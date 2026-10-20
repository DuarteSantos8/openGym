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
 * Readings go into the profile's own state through `merge` (api/health/fold.js mergeReadings):
 * src 'renpho', sid `<RENPHO id>:<type>`, so a reading already there is updated, never added twice,
 * whichever device or how many times "Sync now" was pressed. RENPHO's whole reading, unknown fields
 * included, is kept per reading beside the state (`rawFile`): provider, external_id,
 * external_timestamp, synced_at and raw_provider_data.
 */
import { createRenphoClient, RenphoError } from './client.js';
import { mapMeasurement, belongsTo, PROVIDER } from './mapping.js';

const MESSAGES = {
  auth: 'RENPHO did not accept this e-mail and password',
  rejected: 'RENPHO refused the request; sign in again',
  network: 'RENPHO could not be reached; try again later',
  format: 'RENPHO answered in a way this version does not understand',
  failed: 'The sync failed',
};
const problem = e => {
  const code = e instanceof RenphoError || MESSAGES[e?.code] ? e.code : 'failed';
  return { code, message: MESSAGES[code] || MESSAGES.failed };
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
    };
  }

  /** Signs in to RENPHO and keeps the account on the user row; the first sync follows. */
  async function connect(user, { email, password, areaCode }) {
    const creds = { email: String(email || '').trim(), password: String(password || ''), areaCode: String(areaCode || 'US').trim().toUpperCase() || 'US' };
    if (!creds.email || !creds.password) throw Object.assign(new Error(MESSAGES.auth), { code: 'auth' });
    const session = await client.login(creds);
    user.renpho = {
      email: creds.email, creds: seal(creds), session: seal({ token: session.token, userId: session.userId }),
      connected: now(), lastSync: null, error: null,
    };
    save();
    log('renpho.connect', user.id);
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
    const s = await client.login(creds);
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

  async function run(user) {
    const r = user.renpho;
    let session = unseal(r.session);
    if (!session?.token) session = await signIn(user);
    const got = await withSession(user, session, s => client.tables(s));
    session = got.session;
    const raws = [];
    let complete = true;
    for (const table of got.value) {
      const ids = table.userIds.length ? table.userIds : [session.userId];
      const who = ids.includes(String(session.userId)) ? String(session.userId) : ids[0];
      const page = await withSession(user, session, s => client.readings(s, table, who));
      session = page.session;
      complete = complete && page.value.complete;
      raws.push(...page.value.rows.filter(x => belongsTo(x, session.userId)));
    }
    // Map, keep the raw reading, and fold the values in.
    const at = now();
    const store = readRaw(user.id) || { provider: PROVIDER, measurements: {} };
    const readings = [];
    const fields = new Set(), unknown = new Set();
    let segmental = false;
    for (const raw of raws) {
      const m = mapMeasurement(raw);
      if (!m) continue;
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
    return { measurements: raws.length, added, updated, complete, fields: [...fields].sort(), unknown: [...unknown].sort(), segmental };
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
