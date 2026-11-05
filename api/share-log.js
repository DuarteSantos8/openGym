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

const INBOX_DAYS = 365;

export function createShareLog({ dir, maxEntries = 5000, keepDays = 365, undoDays = 30, now = Date.now } = {}) {
  const file = uid => path.join(dir, safe(uid) + '.json');
  const cache = new Map();

  function read(uid) {
    if (cache.has(uid)) return cache.get(uid);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file(uid), 'utf8')); } catch { doc = null; }
    if (!doc || !Array.isArray(doc.log)) doc = { v: 1, log: [] };
    if (!Array.isArray(doc.inbox)) doc.inbox = [];
    if (!Array.isArray(doc.undo)) doc.undo = [];
    cache.set(uid, doc);
    return doc;
  }
  function write(uid, doc) {
    // Retention: older than keepDays goes, and the file never grows past maxEntries lines.
    const cut = keepDays > 0 ? now() - keepDays * DAY : -Infinity;
    doc.log = doc.log.filter(e => e.at >= cut).slice(-maxEntries);
    // The inbox: an answered or expired item goes after INBOX_DAYS, an open one stays until it is
    // answered or its offer runs out. Undo material lives UNDO_DAYS (design 4.3: 30 days).
    const t = now();
    doc.inbox = doc.inbox.filter(i => (i.status === 'open' ? !(i.expires && i.expires < t - INBOX_DAYS * DAY) : (i.answeredAt || i.at) >= t - INBOX_DAYS * DAY)).slice(-500);
    doc.undo = doc.undo.filter(u => u.at >= t - undoDays * DAY).slice(-300);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWrite(file(uid), JSON.stringify(doc), 0o600);
    cache.set(uid, doc);
  }
  const actorOf = a => (a ? { kind: a.kind, id: a.id, name: String(a.name || '').slice(0, 60) } : null);

  return {
    /** Appends one event. `ev` is a short code ('grant.create', 'grant.end', 'data.admin-view', …);
     *  `peer` is the other side of a grant event (the trainer, the gym), kept apart from `msg` so
     *  a deleted trainer's name can be taken out again. */
    append(uid, { ev, actor, peer, cat, grantId, msg }) {
      const doc = read(uid);
      const entry = { id: 'l_' + crypto.randomBytes(6).toString('base64url'), at: now(), ev,
        ...(actor ? { actor: actorOf(actor) } : {}), ...(peer ? { peer: actorOf(peer) } : {}), ...(cat ? { cat } : {}), ...(grantId ? { grantId } : {}),
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

    /* The member's inbox (a trainer's suggestions and comments, notices about their connections)
     * and the Undo material of every change a trainer made. Same file, so export and delete
     * carry them without a second place to forget. */
    inbox: uid => read(uid).inbox.slice(),
    addInbox(uid, item) {
      const doc = read(uid);
      const row = { id: 'i_' + crypto.randomBytes(8).toString('base64url'), at: now(), status: 'open', seen: false, ...item };
      doc.inbox.push(row);
      write(uid, doc);
      return row;
    },
    /** Changes the items `match` picks (a function); returns them. */
    updateInbox(uid, match, patch) {
      const doc = read(uid);
      const hit = doc.inbox.filter(match);
      for (const i of hit) Object.assign(i, typeof patch === 'function' ? patch(i) : patch);
      if (hit.length) write(uid, doc);
      return hit;
    },
    undos: uid => read(uid).undo.slice(),
    addUndo(uid, rec) {
      const doc = read(uid);
      const row = { id: 'u_' + crypto.randomBytes(8).toString('base64url'), at: now(), ...rec };
      doc.undo.push(row);
      write(uid, doc);
      return row;
    },
    markUndone(uid, id) {
      const doc = read(uid);
      const u = doc.undo.find(x => x.id === id);
      if (u) { u.undoneAt = now(); write(uid, doc); }
      return u || null;
    },
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
        for (const e of [...doc.log, ...doc.inbox, ...doc.undo]) {
          for (const k of ['actor', 'peer', 'from', 'by']) {
            if (e[k]?.id === actorId && e[k].kind !== 'self') { e[k] = { kind: e[k].kind, id: null, name: '' }; changed = true; }
          }
        }
        if (changed) write(uid, doc);
      }
    }
  };
}
