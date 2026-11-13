/* Who a provider sign-in is, in openGym terms. Pure functions over db and the verified claims,
 * so every "may this person in, and as whom" rule has a unit test (test/oidc-accounts.test.js).
 *
 * An identity is (iss, sub), never an e-mail. A first sign-in either finds the profile linked to
 * it, links to a profile by e-mail (only when the operator turned that on AND the provider says
 * the address is verified), or makes a new profile, if the provider's groups let this person in.
 * An unverified address that matches a profile is refused, not linked and not duplicated. */
import { rolesFromGroups } from '../role-claims.js';
import { gated } from './config.js';

/** A claim by name, or a dotted path for providers that nest them (Keycloak realm_access.roles). */
export function claimAt(claims, path) {
  if (Object.hasOwn(claims, path)) return claims[path];
  let v = claims;
  for (const k of String(path).split('.')) { if (!v || typeof v !== 'object' || !Object.hasOwn(v, k)) return undefined; v = v[k]; }
  return v;
}

export function groupsOf(claims, cfg) {
  const v = claimAt(claims, cfg.groupsClaim);
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [];
  return arr.filter(g => typeof g === 'string' && g).map(g => g.slice(0, 200)).slice(0, 500);
}

/** Whether these claims may have an account here, and the roles the role map gives them. */
export function accessOf(claims, cfg) {
  const groups = groupsOf(claims, cfg);
  const roles = rolesFromGroups(groups, cfg.roleRules);
  const allowed = !gated(cfg) || roles.access || groups.some(g => cfg.allowedGroups.includes(g));
  return { groups, roles, allowed };
}

export const linkedTo = (db, iss, sub) => db.users.find(u => u.oidc && u.oidc.iss === iss && u.oidc.sub === sub) || null;

/**
 * What to do with a sign-in. Returns one of
 *   { kind: 'existing', user }           the identity is linked already
 *   { kind: 'link', user }               link it to this profile by its verified e-mail
 *   { kind: 'create' }                   a new profile
 *   { kind: 'refuse', code }             'group' | 'link-needed' | 'invite' | 'disabled'
 * `normalizeEmail` folds an address the way db stores them (api/password.js).
 */
export function decide(db, claims, cfg, { inviteOnly = false, normalizeEmail = e => e } = {}) {
  const { allowed } = accessOf(claims, cfg);
  const known = linkedTo(db, claims.iss, claims.sub);
  if (known) {
    if (known.disabled) return { kind: 'refuse', code: 'disabled', user: known };
    if (!allowed) return { kind: 'refuse', code: 'group', user: known };
    return { kind: 'existing', user: known };
  }
  if (!allowed) return { kind: 'refuse', code: 'group' };
  const email = typeof claims.email === 'string' ? normalizeEmail(claims.email) : null;
  const holder = email ? db.users.find(u => u.email === email || u.oidc?.email === email) || null : null;
  if (holder) {
    // Only `true` counts: a string "true" or a missing claim is not a provider vouching for it.
    if (cfg.linkByEmail && claims.email_verified === true && !holder.oidc && !holder.disabled) return { kind: 'link', user: holder };
    return { kind: 'refuse', code: 'link-needed' };
  }
  // With the groups deciding, being in the group is the invite. Without them, an invite-only
  // instance has no way to ask for a code mid-redirect, so a stranger is turned away.
  if (inviteOnly && !gated(cfg)) return { kind: 'refuse', code: 'invite' };
  return { kind: 'create' };
}

/** A name for a new profile: what the provider calls them, made unique among names that sign in. */
export function nameFor(claims, taken) {
  const pick = [claims.name, claims.preferred_username, claims.nickname, typeof claims.email === 'string' ? claims.email.split('@')[0] : '']
    .find(v => typeof v === 'string' && v.trim());
  const base = String(pick || 'Lifter').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 36) || 'Lifter';
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base} ${i}`)) return `${base} ${i}`;
  return base + ' ' + Date.now().toString(36).slice(-4);
}
