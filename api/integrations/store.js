/* Who connected what: one small JSON file per profile under DATA_DIR/integrations/, never db.json
 * (which is rewritten whole on every save) and never the profile's own state file (which syncs to
 * every device and rides in every backup). Written temp-then-rename like every other file here,
 * mode 0600, and whatever is secret (a webhook URL, its signing secret, later OAuth tokens) is
 * sealed with crypto.js before it gets near the disk.
 *
 * Every field is capped on the way in, not only the ones a form sends: the lesson of GHSA-g65f
 * was that a stored value nobody limits is a value somebody makes huge.
 *
 * A record:
 *   { id, provider, label, createdAt, updatedAt, events: [..], paused,
 *     secrets: { name: sealed },            // crypto.js seal(), bound to uid + id + name
 *     info: { key: short string },          // what the app may show (a masked URL)
 *     status: 'ok' | 'attention', failures, lastOk, lastError: { at, msg, code } | null,
 *     log: [{ at, ev, ok, status, ms, msg }]   // the newest LOG_MAX, newest last
 *   } */
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from '../durable.js';
import { seal, open } from './crypto.js';

export const LOG_MAX = 50;
export const MAX_CONNECTIONS = 20;
export const LABEL_MAX = 60;
export const INFO_MAX = 200;
export const SECRET_MAX = 4096;
export const MSG_MAX = 160;
export const EVENTS_MAX = 10;

const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
const plainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** One log line, capped. */
export function logEntry(e, now = Date.now()) {
  return {
    at: Number.isFinite(e?.at) ? e.at : now,
    ev: str(e?.ev || 'event', 40),
    ok: e?.ok === true,
    ...(Number.isInteger(e?.status) && e.status >= 0 && e.status < 1000 ? { status: e.status } : {}),
    ...(Number.isFinite(e?.ms) && e.ms >= 0 ? { ms: Math.min(Math.round(e.ms), 600000) } : {}),
    ...(e?.msg ? { msg: str(e.msg, MSG_MAX) } : {}),
  };
}

/** A record as it may be stored: unknown keys dropped, every value capped. */
export function capRecord(r, now = Date.now()) {
  const secrets = {};
  for (const [k, v] of Object.entries(plainObject(r.secrets) ? r.secrets : {}).slice(0, 8)) {
    if (typeof v === 'string' && v.length <= SECRET_MAX) secrets[str(k, 40)] = v;
  }
  const info = {};
  for (const [k, v] of Object.entries(plainObject(r.info) ? r.info : {}).slice(0, 8)) info[str(k, 40)] = str(v, INFO_MAX);
  const lastError = plainObject(r.lastError)
    ? { at: Number.isFinite(r.lastError.at) ? r.lastError.at : now, msg: str(r.lastError.msg, MSG_MAX), ...(r.lastError.code ? { code: str(r.lastError.code, 40) } : {}) }
    : null;
  return {
    id: str(r.id, 40),
    provider: str(r.provider, 40),
    label: str(r.label, LABEL_MAX).trim(),
    createdAt: Number.isFinite(r.createdAt) ? r.createdAt : now,
    updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : now,
    events: [...new Set((Array.isArray(r.events) ? r.events : []).map(e => str(e, 40)))].slice(0, EVENTS_MAX),
    paused: r.paused === true,
    secrets,
    info,
    status: r.status === 'attention' ? 'attention' : 'ok',
    failures: Number.isInteger(r.failures) && r.failures > 0 ? Math.min(r.failures, 1000) : 0,
    lastOk: Number.isFinite(r.lastOk) ? r.lastOk : null,
    lastError,
    log: (Array.isArray(r.log) ? r.log : []).slice(-LOG_MAX).map(e => logEntry(e, now)),
  };
}

const safeUid = uid => String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

export function createStore({ dir, key, now = Date.now }) {
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = uid => path.join(dir, 'u-' + safeUid(uid) + '.json');
  const cache = new Map();   // uid -> [records]; a profile without a file is []

  function load(uid) {
    if (cache.has(uid)) return cache.get(uid);
    let list = [];
    try {
      const doc = JSON.parse(fs.readFileSync(fileOf(uid), 'utf8'));
      if (Array.isArray(doc?.connections)) list = doc.connections.filter(plainObject).slice(0, MAX_CONNECTIONS).map(r => capRecord(r, now()));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('integrations: cannot read the connections of', safeUid(uid), e.message);
    }
    cache.set(uid, list);
    return list;
  }
  function save(uid, list) {
    cache.set(uid, list);
    if (!list.length) { try { fs.unlinkSync(fileOf(uid)); } catch { /* never written */ } return; }
    atomicWrite(fileOf(uid), JSON.stringify({ v: 1, connections: list }), 0o600);
  }
  const aad = (uid, id, name) => `${safeUid(uid)}:${id}:${name}`;

  const api = {
    list: uid => load(uid).map(r => ({ ...r })),
    has: uid => load(uid).length > 0,
    get: (uid, id) => { const r = load(uid).find(x => x.id === id); return r ? { ...r } : null; },
    add(uid, rec) {
      const list = load(uid);
      if (list.length >= MAX_CONNECTIONS) throw Object.assign(new Error('too many connections'), { status: 409, code: 'too-many' });
      const r = capRecord({ ...rec, createdAt: now(), updatedAt: now() }, now());
      save(uid, [...list, r]);
      return { ...r };
    },
    /** `fn(record)` changes a copy; the copy is capped and stored. Answers the stored record or null. */
    update(uid, id, fn) {
      const list = load(uid);
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return null;
      const next = structuredClone(list[i]);
      fn(next);
      const r = capRecord({ ...next, id: list[i].id, provider: list[i].provider, createdAt: list[i].createdAt, updatedAt: now() }, now());
      save(uid, list.map((x, j) => (j === i ? r : x)));
      return { ...r };
    },
    remove(uid, id) {
      const list = load(uid);
      if (!list.some(x => x.id === id)) return false;
      save(uid, list.filter(x => x.id !== id));
      return true;
    },
    removeUser(uid) { cache.delete(uid); try { fs.unlinkSync(fileOf(uid)); } catch { /* none */ } },
    /** One more line in the connection's log, the oldest dropping out past LOG_MAX. */
    log(uid, id, entry) {
      return api.update(uid, id, r => { r.log = [...r.log, logEntry(entry, now())].slice(-LOG_MAX); });
    },
    seal: (uid, id, name, value) => seal(key, value, aad(uid, id, name)),
    reveal: (uid, rec, name) => open(key, rec?.secrets?.[name], aad(uid, rec?.id, name)),
    forget: uid => cache.delete(uid),
  };
  return api;
}
