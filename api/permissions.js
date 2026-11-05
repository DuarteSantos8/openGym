/* The one place that decides who may do what to whom (docs/TRAINERS.md, "Permissions").
 *
 *   const { can } = createPermissions({ org, userById, isAdmin, isOwner, flags })
 *   can(actor, action, subject, category) -> { ok, level, reason, status, via }
 *
 * Every trainer, gym and library route asks this, and nothing else. It reads org.json's
 * in-memory copy and db.users on every call and caches nothing, so a disconnect, a removed role
 * or a disabled account counts from the very next request. `status` is what the route answers
 * when `ok` is false: 404 wherever a 403 would tell a stranger that a profile exists.
 *
 * Actions
 *   view | suggest | apply   a member's data in `category` (scopes.js); a member always may on their own
 *   comment                  on a member's workouts (needs workouts at view)
 *   admin:data-view          an admin reading a member's training data (ADMIN_DATA_VIEW only)
 *   gym:create               an admin
 *   gym:manage               an admin (name, contact, disable)
 *   gym:staff                an admin; a gym lead too, for the trainer role in their own gym
 *   gym:view                 an admin, or anyone with a role or membership in that gym (counts, names)
 *   gym:members              the gym's leads (the names of members who joined)
 *   gym:invite               the gym's leads (a join code, GY-…)
 *   trainer:invite           a free trainer (no gymId), or a trainer of subject.gymId
 *   library:read             any account; a studio item only for that studio's people
 *   library:import           as read, and the item must be live
 *   library:publish          any account not banned from sharing; into a studio only its people
 *   library:edit             the item's owner
 *   library:moderate         an admin; a studio item also that studio's leads */
import { CATEGORY_IDS, rank } from './trainers/scopes.js';

const NO = (reason, status = 403) => ({ ok: false, level: 'off', reason, status });
const YES = (level = 'apply', via = null) => ({ ok: true, level, reason: null, status: 200, via });
const LEVEL_NAMES = ['off', 'view', 'suggest', 'apply'];
const DATA_ACTIONS = { view: 1, suggest: 2, apply: 3, comment: 1 };

export function createPermissions({ org, userById, isAdmin, isOwner = () => false, flags = () => ({}) }) {
  const o = () => org.get();
  const usable = u => !!u && !u.disabled;
  const live = r => !r.until;
  const activeGym = gid => { const g = o().gyms.find(x => x.id === gid); return g && !g.disabled ? g : null; };
  const hasStaff = (gid, uid, role) => !!activeGym(gid) && o().staff.some(s => s.gymId === gid && s.userId === uid && s.role === role && live(s));
  const isMember = (gid, uid) => o().memberships.some(m => m.gymId === gid && m.userId === uid && live(m));
  const inGym = (gid, uid) => !!activeGym(gid) && (isMember(gid, uid) || o().staff.some(s => s.gymId === gid && s.userId === uid && live(s)));
  const freeTrainer = uid => o().trainers.some(t => t.userId === uid && live(t));

  /** The highest level `actor` holds on `memberId`'s `category`, through which grant, read fresh. */
  function grantLevel(actor, memberId, category) {
    let best = 0, via = null;
    for (const g of o().grants) {
      if (g.memberId !== memberId || g.status !== 'active') continue;
      let holds = false;
      if (g.kind === 'trainer' && g.granteeId === actor.id) {
        // A studio grant lives as long as the trainer works there and the gym is on; a private one
        // as long as an admin allows them to train freely.
        holds = g.gymId ? hasStaff(g.gymId, actor.id, 'trainer') : freeTrainer(actor.id);
      } else if (g.kind === 'lead') {
        holds = hasStaff(g.granteeId, actor.id, 'lead') && isMember(g.granteeId, memberId);
      }
      if (!holds) continue;
      // The lead row is never more than view, whatever ended up stored.
      const r = Math.min(rank(g.scopes?.[category]), g.kind === 'lead' ? 1 : 3);
      if (r > best) { best = r; via = g.id; }
    }
    return { best, via };
  }

  function memberData(actor, action, subject, category) {
    const f = flags();
    if (!f.trainers) return NO('off', 404);
    if (!CATEGORY_IDS.includes(category)) return NO('bad-category', 400);
    const member = userById(subject?.memberId);
    if (!usable(member)) return NO('not-found', 404);
    if (member.id === actor.id) return YES('apply', 'self');
    const need = action === 'comment' ? (category === 'workouts' ? 1 : 99) : DATA_ACTIONS[action];
    const { best, via } = grantLevel(actor, member.id, category);
    // No grant at all reads as "no such member": a trainer cannot probe who exists on the server.
    if (!best) return NO('not-found', 404);
    if (best < need) return { ok: false, level: LEVEL_NAMES[best], reason: 'level', status: 403, via };
    return YES(LEVEL_NAMES[best], via);
  }

  function library(actor, action, subject) {
    const f = flags();
    if (f.sharing === false) return NO('off', 404);
    const item = subject?.item || null;
    const gid = item ? item.gymId || null : subject?.gymId || null;
    if (gid && !activeGym(gid)) return NO('not-found', 404);
    const ownsIt = !!item && item.owner === actor.id;
    const seesGym = !gid || inGym(gid, actor.id) || isAdmin(actor);
    switch (action) {
      case 'library:read':
        if (!seesGym) return NO('not-found', 404);
        if (item && item.status !== 'live' && !ownsIt && !isAdmin(actor)) return NO('not-found', 404);
        return YES('view');
      case 'library:import':
        if (!seesGym || !item || item.status !== 'live') return NO('not-found', 404);
        return YES('view');
      case 'library:publish':
        if (actor.share?.banned) return NO('banned');
        if (gid && !inGym(gid, actor.id)) return NO('not-in-gym');
        return YES('apply');
      case 'library:edit':
        if (!item) return NO('not-found', 404);
        if (!ownsIt) return NO(seesGym && item.status === 'live' ? 'not-owner' : 'not-found', seesGym && item.status === 'live' ? 403 : 404);
        if (actor.share?.banned) return NO('banned');
        return YES('apply');
      case 'library:moderate':
        if (isAdmin(actor)) return YES('apply', 'admin');
        if (item?.gymId && hasStaff(item.gymId, actor.id, 'lead')) return YES('apply', 'lead');
        return NO('forbidden');
    }
    return NO('unknown-action', 400);
  }

  /** can(actor, action, subject, category): see the header. `actor` is a db.users record. */
  function can(actor, action, subject = {}, category) {
    if (!actor) return NO('signed-out', 401);
    if (actor.disabled) return NO('disabled', 401);
    if (action in DATA_ACTIONS) return memberData(actor, action, subject, category);
    if (action.startsWith('library:')) return library(actor, action, subject);
    const f = flags();
    switch (action) {
      case 'admin:data-view': {
        if (!isAdmin(actor)) return NO('forbidden');
        if (!f.adminDataView) return NO('data-view-off');
        // A disabled profile too: disabling one is exactly when an operator may need to look.
        return userById(subject?.memberId) ? YES('view', 'admin') : NO('not-found', 404);
      }
      case 'gym:create':
        if (!f.trainers) return NO('off', 404);
        return isAdmin(actor) ? YES('apply', 'admin') : NO('forbidden');
      case 'gym:manage':
        if (!f.trainers) return NO('off', 404);
        return isAdmin(actor) ? YES('apply', 'admin') : NO('forbidden');
      case 'gym:staff':
        if (!f.trainers) return NO('off', 404);
        if (isAdmin(actor)) return YES('apply', 'admin');
        // Leads add and remove trainers in their own gym, never other leads.
        if (subject?.role === 'trainer' && hasStaff(subject.gymId, actor.id, 'lead')) return YES('apply', 'lead');
        return NO('forbidden');
      case 'gym:view':
        if (!f.trainers) return NO('off', 404);
        if (isAdmin(actor)) return YES('view', 'admin');
        return inGym(subject?.gymId, actor.id) ? YES('view') : NO('not-found', 404);
      case 'gym:members':
        if (!f.trainers) return NO('off', 404);
        return hasStaff(subject?.gymId, actor.id, 'lead') ? YES('view', 'lead') : NO('not-found', 404);
      case 'gym:invite':
        // A gym's join code (GY-…) comes from its leads: joining is between the member and the gym.
        if (!f.trainers) return NO('off', 404);
        return hasStaff(subject?.gymId, actor.id, 'lead') ? YES('apply', 'lead') : NO('not-lead');
      case 'trainer:invite': {
        if (!f.trainers) return NO('off', 404);
        const gid = subject?.gymId || null;
        if (gid) return hasStaff(gid, actor.id, 'trainer') ? YES('apply', 'staff') : NO('not-trainer');
        return freeTrainer(actor.id) ? YES('apply', 'free') : NO('not-trainer');
      }
    }
    return NO('unknown-action', 400);
  }

  /** What one actor may see of one member, per category: the trainer dashboard's column header. */
  function levelsFor(actor, memberId) {
    const out = {};
    for (const c of CATEGORY_IDS) { const r = can(actor, 'view', { memberId }, c); out[c] = r.ok ? r.level : 'off'; }
    return out;
  }

  return { can, levelsFor, isOwner };
}
