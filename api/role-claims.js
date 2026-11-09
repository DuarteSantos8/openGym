/* A provider's group claims mapped onto openGym roles, for OIDC sign-in (api/oidc/: accounts.js
 * asks rolesFromGroups, routes.js applyRoles hands studio roles to org-store syncClaimRoles and
 * `admin` to db.users; `access` gates sign-up). Roles given by hand are never taken away by a claim.
 *
 * OIDC_ROLE_MAP, comma separated `role=group` pairs; a studio role names its gym id:
 *   OIDC_ROLE_MAP="access=opengym, admin=opengym-admins, trainer=pt-freelance,
 *                  lead@g_x1=fitbox-leads, trainer@g_x1=fitbox-staff, member@g_x1=fitbox"
 * `access` is "may have an account at all" (create on first sign-in); `trainer` alone is a free
 * trainer. A group may appear in several pairs. */

const ROLES = new Set(['access', 'admin', 'trainer', 'lead', 'member']);
const GYM_ROLES = new Set(['lead', 'trainer', 'member']);

export function parseRoleMap(spec) {
  const rules = [];
  for (const part of String(spec || '').split(',')) {
    const m = /^\s*([a-z]+)(?:@([A-Za-z0-9_-]{1,40}))?\s*=\s*(\S.*?)\s*$/.exec(part);
    if (!m) continue;
    const [, role, gymId, group] = m;
    if (!ROLES.has(role) || (gymId && !GYM_ROLES.has(role)) || (!gymId && (role === 'lead' || role === 'member'))) continue;
    rules.push({ role, gymId: gymId || null, group });
  }
  return rules;
}

/** `groups` as the claim gave them (an array, or one string). */
export function rolesFromGroups(groups, rules) {
  const have = new Set((Array.isArray(groups) ? groups : typeof groups === 'string' ? [groups] : []).map(String));
  const out = { access: false, admin: false, freeTrainer: false, staff: [], memberOf: [] };
  for (const r of rules) {
    if (!have.has(r.group)) continue;
    out.access = true;
    if (!r.gymId) {
      if (r.role === 'admin') out.admin = true;
      if (r.role === 'trainer') out.freeTrainer = true;
    } else if (r.role === 'member') { if (!out.memberOf.includes(r.gymId)) out.memberOf.push(r.gymId); }
    else if (!out.staff.some(s => s.gymId === r.gymId && s.role === r.role)) out.staff.push({ gymId: r.gymId, role: r.role });
  }
  return out;
}
