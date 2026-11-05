/* A member's sharing log: who connected, what was agreed, who looked at what and who changed what.
 * One file per member, DATA_DIR/share/<uid>.json, outside the state document so a sync merge never
 * touches it. Entries are only ever appended; the one exception is a look, which is folded into
 * that day's line per person and category ("Marco looked at your workouts on 5 Nov", design 6.3),
 * so a dashboard that polls does not write a thousand lines. Only the member reads it. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from './durable.js';

const DAY = 86400000;
const safe = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');

export function createShareLog({ dir, maxEntries = 5000, keepDays = 365, now = Date.now } = {}) {
  const file = uid => path.join(dir, safe(uid) + '.json');
  const cache = new Map();

  function read(uid) {
    if (cache.has(uid)) return cache.get(uid);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file(uid), 'utf8')); } catch { doc = null; }
    if (!doc || !Array.isArray(doc.log)) doc = { v: 1, log: [] };
    cache.set(uid, doc);
    return doc;
  }
  function write(uid, doc) {
    // Retention: older than keepDays goes, and the file never grows past maxEntries lines.
    const cut = keepDays > 0 ? now() - keepDays * DAY : -Infinity;
    doc.log = doc.log.filter(e => e.at >= cut).slice(-maxEntries);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWrite(file(uid), JSON.stringify(doc), 0o600);
    cache.set(uid, doc);
  }
  const actorOf = a => (a ? { kind: a.kind, id: a.id, name: String(a.name || '').slice(0, 60) } : null);

  return {
    /** Appends one event. `ev` is a short code ('grant.create', 'grant.revoke', 'admin.view', …). */
    append(uid, { ev, actor, cat, grantId, msg }) {
      const doc = read(uid);
      const entry = { id: 'l_' + crypto.randomBytes(6).toString('base64url'), at: now(), ev,
        ...(actor ? { actor: actorOf(actor) } : {}), ...(cat ? { cat } : {}), ...(grantId ? { grantId } : {}),
        ...(msg ? { msg: String(msg).slice(0, 200) } : {}) };
      doc.log.push(entry);
      write(uid, doc);
      return entry;
    },
    /** A look at one category: counted into today's line for that person and category. */
    noteAccess(uid, actor, cat) {
      const doc = read(uid);
      const day = new Date(now()).toISOString().slice(0, 10);
      const hit = doc.log.findLast?.(e => e.ev === 'access' && e.day === day && e.cat === cat && e.actor?.id === actor.id && e.actor?.kind === actor.kind);
      if (hit) { hit.n = (hit.n || 1) + 1; hit.last = now(); }
      else doc.log.push({ id: 'l_' + crypto.randomBytes(6).toString('base64url'), at: now(), ev: 'access', day, cat, actor: actorOf(actor), n: 1 });
      write(uid, doc);
    },
    /** Newest first, paged by `before` (an `at`). */
    list(uid, { limit = 100, before = Infinity } = {}) {
      const all = read(uid).log.filter(e => e.at < before);
      const rows = all.slice(-limit).reverse();
      return { log: rows, nextBefore: all.length > limit ? rows[rows.length - 1].at : null };
    },
    all: uid => read(uid).log.slice(),
    /** Account deleted: the member's own log goes with them. */
    remove(uid) {
      cache.delete(uid);
      try { fs.unlinkSync(file(uid)); } catch { /* never had one */ }
    },
    /** A trainer or lead deleted their account: their name leaves every log it is in (design 10.4.4). */
    anonymize(memberIds, actorId) {
      for (const uid of memberIds) {
        const doc = read(uid);
        let changed = false;
        for (const e of doc.log) if (e.actor?.id === actorId && e.actor.kind !== 'self') { e.actor = { kind: e.actor.kind, id: null, name: '' }; changed = true; }
        if (changed) write(uid, doc);
      }
    }
  };
}
