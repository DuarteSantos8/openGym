/* Invite codes: who may use one, for how long, and what a stranger holding one may learn.
 *
 * An invite works once and for INVITE_TTL_MS after it was made. "Once" was always the rule
 * (`usedBy`); the expiry is new, and an invite from before it gets one at the first boot that
 * knows about it (migrateInvites): the moment of that boot plus the same fourteen days, so a code
 * already sent to someone does not stop working the day the server is updated.
 *
 * A revoked invite stays on record (`revoked`, `revokedAt`) instead of being deleted, so the
 * public check can tell its holder "no longer valid" rather than "never existed". The admin list
 * leaves revoked ones out, as it did when revoking deleted them.
 *
 * The public check (GET /api/invites/{code}) is for the invite landing page: before anyone signs
 * up, the app shows who sent the link and whether it still works. It answers the status, the
 * inviter's display name and the name the inviter typed for the person, and nothing else: never
 * the note (the inviter's own label, "for Mum"), who used it, when, or any id. It never uses the
 * invite up. Kept out of server.js so every rule can be tested without a server. */

export const INVITE_TTL_MS = 14 * 86400000;
// What the inviter may type as the invitee's name; the same cap as a profile name.
export const INVITE_NAME_MAX = 40;
// A code as the server mints them (16 hex characters) or as older servers did (8). Anything a
// path segment could carry beyond that is answered like an unknown code, without a lookup.
export const INVITE_CODE = /^[A-Za-z0-9]{4,64}$/;

const ms = iso => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** 'valid' | 'used' | 'revoked' | 'expired', in that order of precedence after the first. */
export function inviteStatus(inv, now = Date.now()) {
  if (inv.usedBy) return 'used';
  if (inv.revoked) return 'revoked';
  const exp = ms(inv.expiresAt);
  if (exp == null || exp <= now) return 'expired';
  return 'valid';
}

/** The invite `code` names, when it can still be used to sign up; otherwise null. */
export function usableInvite(invites, code, now = Date.now()) {
  const inv = (invites || []).find(i => i.code === code);
  return inv && inviteStatus(inv, now) === 'valid' ? inv : null;
}

/** A new invite record. `name` is optional: what the app prefills as the new profile's name. */
export function newInvite({ code, note, name, createdBy, now = Date.now() }) {
  const created = new Date(now).toISOString();
  const suggested = inviteName(name);
  return {
    code, note, createdBy, created,
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    ...(suggested ? { name: suggested } : {})
  };
}

// A name typed by the inviter: control and invisible format characters out (as passkey names,
// passkeys-store.js), whitespace folded, capped.
export const inviteName = v => (typeof v === 'string' ? v : '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/(?![‌‍])\p{Cf}/gu, '')
  .replace(/\s+/g, ' ').trim().slice(0, INVITE_NAME_MAX);

/** Gives every invite without an expiry one, `now` + INVITE_TTL_MS. True when anything changed. */
export function migrateInvites(invites, now = Date.now()) {
  let changed = false;
  for (const inv of invites || []) {
    if (inv && typeof inv === 'object' && !inv.expiresAt) {
      inv.expiresAt = new Date(now + INVITE_TTL_MS).toISOString();
      changed = true;
    }
  }
  return changed;
}

/** Marks an invite revoked. It stays on record for the public check. */
export function revokeInvite(inv, now = Date.now()) {
  inv.revoked = true;
  inv.revokedAt = new Date(now).toISOString();
}

/**
 * What the invite landing page may know about `code`, or null for a code that names no invite.
 * Names only while the invite can still be used (`users` resolves the inviter's; a deleted
 * inviter is null): a code that is used, revoked or expired opens nothing, so it tells whoever
 * holds it nothing about anyone either, only the status.
 */
export function inviteCheck(invites, users, code, now = Date.now()) {
  if (typeof code !== 'string' || !INVITE_CODE.test(code)) return null;
  const inv = (invites || []).find(i => i.code === code.toUpperCase());
  if (!inv) return null;
  const status = inviteStatus(inv, now);
  if (status !== 'valid') return { status, inviterName: null, suggestedName: null };
  const inviter = (users || []).find(u => u.id === inv.createdBy);
  return {
    status,
    inviterName: inviter && typeof inviter.name === 'string' && inviter.name ? inviter.name : null,
    suggestedName: inv.name || null
  };
}

/** How the audit log names a code that may still be live: enough to tell two apart, never usable. */
export const codeHint = code => (typeof code === 'string' ? `${code.slice(0, 4)}…` : '');
