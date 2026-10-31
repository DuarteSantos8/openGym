/* Integrations (v1.4.4): the hub that ties providers, the connection store and the outbox
 * together. server.js creates one, hands its routes the session helpers, and calls
 * onStateWrite after every successful PUT /api/data.
 *
 * Off unless the admin names providers: INTEGRATIONS=webhook (comma-separated, more to come).
 * With it unset nothing here runs, nothing is written, and /api/config says nothing, so the app
 * looks exactly as it did.
 *
 * A provider is a plain object (providers/webhook.js is the first):
 *
 *   id, kind ('webhook' | 'apikey' | 'oauth'), category, events: [types it can receive]
 *   env: [names of the env vars it needs], configured(env) -> whether they are all there
 *   max: connections per profile
 *   rate / connRate: { capacity, refillMs } token buckets, per instance and per connection
 *   connect(input) -> { label, events, info, secrets, reveal }   validate a form, say what to store
 *   update(input) -> patch                                       label / events / paused
 *   deliver(job, reveal) -> { ok, retry, retryAfterMs, gone, status, ms, code, msg }
 *
 * The OAuth kind (Strava, PR #478, next) adds authorizeUrl(uid, state) and callback(query) for a
 * GET /api/integrations/oauth/callback route, and refresh(reveal) for an expired token; the
 * store, the sealing, the outbox and the log are already the ones it will use. */
import path from 'node:path';
import { createStore } from './store.js';
import { createOutbox, createBuckets } from './outbox.js';
import { deriveKey, newId } from './crypto.js';
import { detectEvents, eventData, envelope, testData, EVENTS } from './events.js';
import { webhookProvider } from './providers/webhook.js';

const on = v => /^(1|true|yes|on)$/i.test(String(v || ''));

/** The provider ids an admin switched on, known ones only. */
export function enabledIds(env, known) {
  const ids = String(env.INTEGRATIONS || '').split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  const out = [];
  for (const id of ids) {
    if (!known.includes(id)) { console.warn(`INTEGRATIONS: "${id.slice(0, 30)}" is not an integration this server has, ignored`); continue; }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function createIntegrations({ dataDir, secret, env = process.env, now = Date.now, transport = null, version = 'dev' }) {
  const allowLan = on(env.INTEGRATIONS_ALLOW_LAN);
  const all = { webhook: webhookProvider({ allowLan, transport, version }) };
  const ids = enabledIds(env, Object.keys(all)).filter(id => {
    if (all[id].configured(env)) return true;
    console.warn(`INTEGRATIONS: ${id} needs ${all[id].env.join(', ')}; left off`);
    return false;
  });
  const providers = Object.fromEntries(ids.map(id => [id, all[id]]));
  const active = ids.length > 0;

  // Nothing is created on disk for an instance that never turned this on.
  const dir = path.join(dataDir, 'integrations');
  let store = null, outbox = null;
  const ensure = () => {
    if (store) return;
    const key = deriveKey(secret);
    store = createStore({ dir, key, now });
    outbox = createOutbox({
      file: path.join(dir, 'outbox.json'), now,
      deliver: job => {
        const p = providers[job.provider];
        const rec = store.get(job.uid, job.conn);
        if (!p || !rec) return { ok: false, retry: false, code: 'gone', msg: 'Disconnected.' };
        if (rec.paused) return { defer: 3600_000 };
        return p.deliver(job, name => store.reveal(job.uid, rec, name));
      },
      rateOf: job => {
        const p = providers[job.provider];
        if (!p) return [];
        return [{ key: 'p:' + p.id, ...p.rate }, ...(p.connRate ? [{ key: 'c:' + job.conn, ...p.connRate }] : [])];
      },
      onSettled: (job, res, { final }) => settle(job.uid, job.conn, job.ev, res, final),
    });
  };
  if (active) ensure();

  // What a person may do per minute: connect, change and test.
  const userActs = createBuckets({ now });
  const userLimit = (uid, what) => {
    const wait = userActs.take(what + ':' + uid, what === 'test' ? { capacity: 6, refillMs: 10_000 } : { capacity: 20, refillMs: 3000 });
    if (wait) throw Object.assign(new Error('slow down a little'), { status: 429, code: 'rate', retryAfter: Math.ceil(wait / 1000) });
  };

  function settle(uid, id, ev, res, final) {
    store.update(uid, id, r => {
      r.log = [...r.log, { at: now(), ev, ok: !!res?.ok, status: res?.status, ms: res?.ms, msg: res?.ok ? '' : res?.msg }];
      if (res?.ok) { r.status = 'ok'; r.failures = 0; r.lastOk = now(); r.lastError = null; return; }
      r.failures = (r.failures || 0) + 1;
      r.lastError = { at: now(), msg: res?.msg || 'Delivery failed.', code: res?.code };
      if (final || res?.gone) r.status = 'attention';
      if (res?.gone) r.paused = true;
    });
  }

  const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
  const off = () => fail(404, 'integrations are off on this server', 'off');
  const own = (uid, id) => {
    const rec = typeof id === 'string' ? store.get(uid, id) : null;
    if (!rec || !providers[rec.provider]) fail(404, 'no such connection', 'missing');
    return rec;
  };

  /** A connection as the app gets it: never a secret, never the full URL. */
  function view(uid, rec) {
    const sealed = Object.keys(rec.secrets).length > 0 && Object.keys(rec.secrets).some(k => store.reveal(uid, rec, k) == null);
    const counts = outbox.counts(uid, rec.id);
    return {
      id: rec.id, provider: rec.provider, label: rec.label, events: rec.events, paused: rec.paused,
      status: sealed || rec.status === 'attention' ? 'attention' : rec.paused ? 'paused' : 'connected',
      info: rec.info, createdAt: rec.createdAt, lastOk: rec.lastOk,
      lastError: sealed ? { at: rec.updatedAt, msg: 'Its settings cannot be read any more. Add it again.', code: 'sealed' } : rec.lastError,
      failures: rec.failures, queued: counts.queued, failed: counts.failed,
    };
  }

  const hub = {
    active,
    allowLan,
    ids,
    /** For /api/config: which integrations this server offers, or null for none. */
    publicConfig: () => (active ? { providers: ids, ...(allowLan ? { lan: true } : {}) } : null),

    describe(uid) {
      if (!active) return { providers: [], connections: [] };
      return {
        providers: ids.map(id => ({ id, kind: providers[id].kind, category: providers[id].category, events: providers[id].events, max: providers[id].max, ...(id === 'webhook' && allowLan ? { lan: true } : {}) })),
        connections: store.list(uid).filter(r => providers[r.provider]).map(r => view(uid, r)),
      };
    },

    connect(uid, providerId, input) {
      if (!active) off();
      const p = providers[providerId];
      if (!p) fail(404, 'no such integration', 'missing');
      userLimit(uid, 'act');
      if (store.list(uid).filter(r => r.provider === p.id).length >= p.max) fail(409, `at most ${p.max} of these per profile`, 'too-many');
      const made = p.connect(input || {});
      const id = newId('c');
      const secrets = Object.fromEntries(Object.entries(made.secrets || {}).map(([k, v]) => [k, store.seal(uid, id, k, v)]));
      const rec = store.add(uid, { id, provider: p.id, label: made.label, events: made.events, info: made.info, secrets, log: [{ at: now(), ev: 'connected', ok: true }] });
      return { connection: view(uid, rec), ...(made.reveal ? { reveal: made.reveal } : {}) };
    },

    update(uid, id, input) {
      if (!active) off();
      const rec = own(uid, id);
      userLimit(uid, 'act');
      const patch = providers[rec.provider].update ? providers[rec.provider].update(input || {}) : {};
      const next = store.update(uid, id, r => {
        Object.assign(r, patch);
        // Switching a paused one back on is also the user saying "I fixed it".
        if (patch.paused === false) { r.status = 'ok'; r.failures = 0; }
      });
      return { connection: view(uid, next) };
    },

    disconnect(uid, id) {
      if (!active) off();
      const rec = own(uid, id);
      store.remove(uid, id);
      outbox.dropConnection(uid, id);
      return { ok: true, provider: rec.provider, label: rec.label };
    },

    /** "Send test event": straight to the receiver, not through the outbox, answered at once. */
    async test(uid, id, type) {
      if (!active) off();
      const rec = own(uid, id);
      userLimit(uid, 'test');
      const ev = EVENTS.includes(type) ? type : rec.events[0] || 'workout.finished';
      const job = { id: newId('evt'), uid, conn: id, provider: rec.provider, ev: 'test', payload: envelope({ id: newId('evt'), type: ev, data: testData(ev, now()), at: now(), test: true }) };
      const res = await providers[rec.provider].deliver(job, name => store.reveal(uid, rec, name));
      settle(uid, id, 'test', res, !res.ok && !res.retry);
      return { ok: !!res.ok, status: res.status ?? null, ms: res.ms ?? null, msg: res.ok ? null : res.msg, connection: view(uid, store.get(uid, id)) };
    },

    /** The Retry button: failed deliveries go back into the queue and are sent now. */
    async retry(uid, id) {
      if (!active) off();
      own(uid, id);
      userLimit(uid, 'act');
      const n = outbox.retry(uid, id);
      store.update(uid, id, r => { if (r.status === 'attention') { r.status = 'ok'; r.failures = 0; } });
      await outbox.run();
      return { requeued: n, connection: view(uid, store.get(uid, id)) };
    },

    log(uid, id) {
      if (!active) off();
      const rec = own(uid, id);
      return { log: [...rec.log].reverse(), ...outbox.counts(uid, id) };
    },

    /** After a stored PUT /api/data: queue what the profile's connections asked to hear about. */
    onStateWrite(uid, prev, next) {
      if (!active || !store.has(uid)) return 0;
      const conns = store.list(uid).filter(r => providers[r.provider] && !r.paused);
      if (!conns.length) return 0;
      const evs = detectEvents(prev, next, { now: now() });
      let n = 0;
      for (const ev of evs) {
        for (const c of conns) {
          if (!c.events.includes(ev.type) || ev.at < c.createdAt) continue;
          const eid = newId('evt');
          const r = outbox.enqueue({
            id: eid, key: `${c.provider}:${uid}:${c.id}:${ev.type}:${ev.entity}`, uid, conn: c.id, provider: c.provider, ev: ev.type,
            payload: envelope({ id: eid, type: ev.type, data: eventData(ev, next), at: ev.at }),
          });
          if (r === 'queued') n++;
          else if (r === 'full') settle(uid, c.id, ev.type, { ok: false, msg: 'Too much waiting to be sent, this one was skipped.' }, false);
        }
      }
      return n;
    },

    removeUser(uid) {
      if (!store) return;
      store.removeUser(uid);
      outbox.dropUser(uid);
    },

    start(everyMs) { if (active) outbox.start(everyMs); },
    stop() { outbox?.stop(); },
    // For the tests.
    _outbox: () => outbox,
    _store: () => store,
  };
  return hub;
}
