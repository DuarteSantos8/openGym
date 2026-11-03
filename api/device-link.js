/* One-time device links (#95).
 *
 * A signed-in device shows a code, and a QR code of a link that carries it. Another device of the
 * same person redeems it by creating a passkey of its own, and that passkey is what signs it in.
 * For those few minutes the code is the whole credential, so:
 *
 *   - 12 characters from the pairing alphabet (no 0/O/1/I), 60 bits, typed as XXXX-XXXX-XXXX when
 *     the other device cannot scan;
 *   - stored only as a SHA-256, like an admin's reset code: a copy of db.json holds no code that
 *     works. The code is random, so a slow hash would add nothing;
 *   - one per profile — a new one replaces the one before — good for DEVICE_LINK_TTL_MS, and gone
 *     with the first passkey made with it. An expired one is dropped the next time links are read.
 *
 * A recovery code (#584) is the same kind of link, made by someone else for a person who has lost
 * every way in: an admin from the dashboard, or the server's own command (recover.js, through the
 * local admin socket). It carries `kind: 'recovery'` and who made it, and lives a day like an
 * admin's password reset code, because it has to reach the person first.
 *
 * Pure bookkeeping on `db.deviceLinks`; the routes, the throttle and the audit are server.js's. */
import crypto from 'node:crypto';

// Long enough to walk to the other device, find the camera and sign in; short enough that a code
// photographed off a screen is dead by the time anyone could use it.
export const DEVICE_LINK_TTL_MS = 10 * 60 * 1000;
// A recovery code is handed over by an admin, by message or in person: a day, like a reset code.
export const RECOVERY_TTL_MS = 24 * 3600 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 12;

export function makeLinkCode() {
  // 256 is a multiple of 32, so the modulo is unbiased.
  const raw = Array.from(crypto.randomBytes(LENGTH), b => ALPHABET[b % ALPHABET.length]).join('');
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8);
}
// Dashes, spaces and case are how a person types it, not part of it.
const clean = code => (typeof code === 'string' ? code : '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashLinkCode = code => crypto.createHash('sha256').update('opengym-link:' + clean(code)).digest('hex');

function prune(db, now) {
  db.deviceLinks = (db.deviceLinks || []).filter(l => l && typeof l.h === 'string' && l.exp > now);
}

// → { code, link }. The code is returned once and never stored. `extra` marks a recovery code:
// { kind: 'recovery', by } (who made it: an admin's id, or 'server').
export function createDeviceLink(db, userId, now = Date.now(), ttlMs = DEVICE_LINK_TTL_MS, extra = {}) {
  prune(db, now);
  db.deviceLinks = db.deviceLinks.filter(l => l.userId !== userId);
  const code = makeLinkCode();
  const link = { h: hashLinkCode(code), userId, exp: now + ttlMs, created: now, ...(extra.kind === 'recovery' ? { kind: 'recovery', by: String(extra.by || 'server') } : {}) };
  db.deviceLinks.push(link);
  return { code, link };
}

// The live link a code belongs to, or null — a wrong code, a used one and an expired one all look
// the same from outside. Finding a link does not use it up; burnDeviceLink does.
export function findDeviceLink(db, code, now = Date.now()) {
  prune(db, now);
  if (clean(code).length !== LENGTH) return null;
  const h = Buffer.from(hashLinkCode(code), 'hex');
  return db.deviceLinks.find(l => {
    const stored = Buffer.from(l.h, 'hex');
    return stored.length === h.length && crypto.timingSafeEqual(stored, h);
  }) || null;
}

export function burnDeviceLink(db, link) {
  db.deviceLinks = (db.deviceLinks || []).filter(l => l !== link);
}

// Every unused link of a profile, for the moments its sessions end: an unused link is a way in
// waiting to be taken, like a pairing code. Says whether anything went, so a caller can skip a save.
export function dropDeviceLinks(db, userId) {
  const before = (db.deviceLinks || []).length;
  db.deviceLinks = (db.deviceLinks || []).filter(l => l.userId !== userId);
  return db.deviceLinks.length !== before;
}

// The live recovery code of a profile, if any (for the admin dashboard: "recovery code until").
export function recoveryLinkOf(db, userId, now = Date.now()) {
  return (db.deviceLinks || []).find(l => l && l.userId === userId && l.kind === 'recovery' && l.exp > now) || null;
}
