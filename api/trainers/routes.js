/* /api/sharing (the member), /api/trainer (the trainer) and /api/admin/gyms (the admin): the
 * roles-and-consent foundation of the trainer feature (docs/TRAINERS.md). Handed the session
 * helpers by server.js like coach/routes.js. With TRAINERS off every route answers 404
 * { code: 'trainers-off' }, so an app can tell "off here" from "old server". Every decision about
 * another profile goes through permissions.js; every route spends an account budget (budgets.js). */
import { OrgError, normalizeCode, OFFER_DAYS } from './org-store.js';
import { cleanScopes, leadScopes, TRAINER_DEFAULTS, CATEGORY_IDS } from './scopes.js';
import { currentConsent, consentCurrent } from '../consent.js';

const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, n) : '');
const idOf = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);

export function trainerRoutes({ json, readBody, readSession, requireAdmin, userById, isAdmin, audit, addressOf, org, perms, log, budgets, codeGuard, on, origin, notify, nutrition }) {
  // Everything below runs only with TRAINERS on and a session; refusals the store throws are the caller's to read.
  const guard = (budget, fn) => async (req, res) => {
    if (!on()) return json(res, 404, { error: 'trainers are off on this server', code: 'trainers-off' });
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const wait = budgets.take(budget, user.id);
    if (wait) return json(res, 429, { error: 'slow down a little', code: 'rate-limited', retryAfter: wait }, { 'Retry-After': String(wait) });
    try { await fn(req, res, user); }
    catch (e) {
      if (!(e instanceof OrgError)) throw e;
      json(res, e.status, { error: e.message, code: e.code, ...(e.extra || {}) });
    }
  };
  const adminGuard = (budget, fn) => async (req, res) => {
    if (!on()) return json(res, 404, { error: 'trainers are off on this server', code: 'trainers-off' });
    const admin = requireAdmin(req, res); if (!admin) return;
    const wait = budgets.take(budget, admin.id);
    if (wait) return json(res, 429, { error: 'slow down a little', code: 'rate-limited', retryAfter: wait }, { 'Retry-After': String(wait) });
    try { await fn(req, res, admin); }
    catch (e) {
      if (!(e instanceof OrgError)) throw e;
      json(res, e.status, { error: e.message, code: e.code, ...(e.extra || {}) });
    }
  };
  const nameOf = uid => userById(uid)?.name || '';
  const person = uid => ({ id: uid, name: nameOf(uid) });
  const self = u => ({ kind: 'self', id: u.id, name: u.name });
  const gymCard = gid => {
    const g = org.gym(gid);
    if (!g) return null;
    const leads = org.get().staff.filter(s => s.gymId === gid && s.role === 'lead' && !s.until).map(s => nameOf(s.userId)).filter(Boolean);
    return { id: g.id, name: g.name, contact: g.contact || '', disabled: !!g.disabled, leads };
  };
  // Whether a grant does anything right now, and if not why (the member sees "paused").
  const pausedWhy = g => {
    if (g.status !== 'active') return null;
    if (g.gymId) {
      const gy = org.gym(g.gymId);
      if (!gy || gy.disabled) return 'gym-off';
      if (g.kind === 'trainer' && !org.staffOf(g.gymId, g.granteeId, 'trainer')) return 'left-gym';
    } else if (g.kind === 'trainer' && !org.isFreeTrainer(g.granteeId)) return 'not-trainer';
    return null;
  };
  // Open suggestions of a connection that ended lapse (design 3.3): what was taken stays the member's.
  const lapseSuggestions = (memberId, grantIds) => log.updateInbox(memberId,
    i => i.status === 'open' && i.kind === 'suggest' && grantIds.includes(i.grantId), { status: 'expired', answeredAt: Date.now() });
  // "Keep training with Marco privately?" for every studio trainer grant a gym change cut (design 3.5, 3.6),
  // but only where Marco may train people outside a gym: a private connection to a trainer who may
  // not would sit paused for nothing. Without the offer the grant waits paused for his return.
  const offerPrivate = (grants, gymName) => {
    for (const g of grants) {
      if (g.kind !== 'trainer' || !g.gymId || !org.rolesOf(g.granteeId).freeTrainer) continue;
      const tName = nameOf(g.granteeId);
      log.addInbox(g.memberId, { kind: 'offer', grantId: g.id, gymId: g.gymId, from: { kind: 'trainer', id: g.granteeId, name: tName },
        names: [tName, gymName || ''], expires: g.offerUntil || Date.now() + OFFER_DAYS * 86400000 });
      notify.push(g.memberId, 'offer', [tName, gymName || '']);
    }
  };
  // A trainer leaves a gym (an admin or lead took the role, or they left): pause, offer, tell.
  const trainerLeaves = (gid, uid) => {
    const cut = org.trainerLeft(gid, uid);
    offerPrivate(cut, org.gym(gid)?.name);
    for (const g of cut) log.append(g.memberId, { ev: 'trainer.left-gym', actor: { kind: 'trainer', ...person(uid) }, grantId: g.id, peer: { kind: 'gym', id: gid, name: org.gym(gid)?.name } });
    return cut.length;
  };
  const trainerReturns = (gid, uid) => {
    org.trainerBack(gid, uid);
    for (const g of org.get().grants.filter(x => x.kind === 'trainer' && x.granteeId === uid && x.gymId === gid && x.status !== 'ended')) {
      log.updateInbox(g.memberId, i => i.kind === 'offer' && i.status === 'open' && i.grantId === g.id, { status: 'lapsed', answeredAt: Date.now() });
    }
  };
  const consentBody = (res, given, kind = 'trainer') => {
    if (consentCurrent(kind, given)) return true;
    json(res, 409, { error: 'the consent text changed, please read it again', code: 'consent-outdated', consent: currentConsent(kind) });
    return false;
  };
  // A wrong code costs the address and the account; a right one clears the account's count.
  const codePaused = (req, user) => Math.max(codeGuard.addr.retryAfter(addressOf(req)), codeGuard.acct.retryAfter(user.id));
  const codeFailed = (req, user) => { codeGuard.addr.fail(addressOf(req)); codeGuard.acct.fail(user.id); };
  const lookupCode = (req, res, user, typed) => {
    const wait = codePaused(req, user);
    if (wait) { json(res, 429, { error: 'too many wrong codes, try again later', code: 'code-paused', retryAfter: wait }, { 'Retry-After': String(wait) }); return null; }
    const c = normalizeCode(typed) ? org.findCode(typed) : null;
    // An owner who is gone, disabled or no longer allowed to invite makes the code as dead as an expired one.
    const owner = c && userById(c.ownerId);
    const may = owner && (c.kind === 'gym' ? perms.can(owner, 'gym:invite', { gymId: c.gymId }) : perms.can(owner, 'trainer:invite', { gymId: c.gymId }));
    if (!c || !owner || owner.disabled || !may?.ok) {
      codeFailed(req, user);
      json(res, 404, { error: 'that code is wrong, used up or expired', code: 'code-invalid' });
      return null;
    }
    codeGuard.acct.clear(user.id);
    return c;
  };

  const routes = {
    /* ---------- the member ---------- */
    'GET /api/sharing': guard('sharing.read', async (req, res, user) => {
      const rec = org.memberRecord(user.id);
      const grants = rec.grants.filter(g => g.status !== 'ended');
      const connections = grants.filter(g => g.kind === 'trainer').map(g => {
        const lead = g.pairId ? grants.find(x => x.id === g.pairId) || null : null;
        return {
          id: g.id, status: g.status, paused: pausedWhy(g), scopes: g.scopes, since: g.created, updated: g.updated,
          trainer: person(g.granteeId), gym: g.gymId ? gymCard(g.gymId) : null,
          lead: lead ? { id: lead.id, status: lead.status, scopes: lead.scopes, paused: pausedWhy(lead) } : null
        };
      });
      // A gym lead row without a trainer (joined a gym directly, later).
      const leadOnly = grants.filter(g => g.kind === 'lead' && !grants.some(t => t.pairId === g.id))
        .map(g => ({ id: g.id, status: g.status, scopes: g.scopes, gym: gymCard(g.gymId), paused: pausedWhy(g) }));
      const gyms = rec.memberships.filter(m => !m.until).map(m => ({ ...gymCard(m.gymId), since: m.since }));
      json(res, 200, { leadMode: org.leadMode, consent: currentConsent('trainer'), leadConsent: currentConsent('lead'), defaults: TRAINER_DEFAULTS, connections, leadOnly, gyms,
        nutrition: nutrition ? nutrition.status(user.id) : 'not-linked' });
    }),

    'POST /api/sharing/code': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      const c = lookupCode(req, res, user, body.code); if (!c) return;
      if (c.kind === 'gym') {
        return json(res, 200, {
          kind: 'gym', gym: gymCard(c.gymId), leadMode: org.leadMode, member: !!org.membership(c.gymId, user.id),
          leadDefaults: org.leadMode !== 'none' ? leadScopes(org.leadMode, null, TRAINER_DEFAULTS) : null,
          consent: currentConsent('lead'), expires: c.expires
        });
      }
      if (c.ownerId === user.id) return json(res, 400, { error: 'that is your own code', code: 'self' });
      json(res, 200, { kind: 'trainer',
        trainer: person(c.ownerId), gym: c.gymId ? gymCard(c.gymId) : null, leadMode: org.leadMode,
        defaults: TRAINER_DEFAULTS, leadDefaults: c.gymId && org.leadMode !== 'none' ? leadScopes(org.leadMode, TRAINER_DEFAULTS) : null,
        consent: currentConsent('trainer'), expires: c.expires
      });
    }),

    'POST /api/sharing/connect': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      const pre = normalizeCode(body.code) ? org.findCode(body.code) : null;
      // A gym's join code: a membership and the lead row, agreed to under the lead text.
      if (pre?.kind === 'gym') {
        if (!consentBody(res, body.consent, 'lead')) return;
        const c = lookupCode(req, res, user, body.code); if (!c) return;
        const out = org.joinGym({ memberId: user.id, code: c, leadPicked: body.leadScopes, lang: body.lang });
        const gName = org.gym(c.gymId)?.name;
        log.append(user.id, { ev: 'gym.join', actor: self(user), grantId: out.lead?.id, peer: { kind: 'gym', id: c.gymId, name: gName } });
        notify.notice(user.id, 'joined', { from: { kind: 'gym', id: c.gymId, name: gName }, names: [gName] });
        return json(res, 200, { ok: true, gymId: c.gymId, leadId: out.lead?.id || null, status: 'active' });
      }
      if (!consentBody(res, body.consent)) return;
      const c = lookupCode(req, res, user, body.code); if (!c) return;
      const { grant, lead } = org.connect({ memberId: user.id, code: c, scopes: body.scopes, leadPicked: body.leadScopes, lang: body.lang });
      log.append(user.id, { ev: 'grant.create', actor: self(user), grantId: grant.id, peer: { kind: 'trainer', ...person(c.ownerId) } });
      if (lead) log.append(user.id, { ev: 'gym.lead', actor: self(user), grantId: lead.id, peer: { kind: 'gym', id: c.gymId, name: org.gym(c.gymId)?.name } });
      json(res, 200, { ok: true, id: grant.id, status: grant.status, leadId: lead?.id || null });
    }),

    // "Not now" on the consent screen. Nothing is created and the code stays usable; the
    // member's own log says they said no, which is all anyone ever learns of it.
    'POST /api/sharing/decline': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      const c = normalizeCode(body.code) ? org.findCode(body.code) : null;
      if (c) log.append(user.id, { ev: 'invite.decline', actor: self(user), peer: { kind: 'trainer', ...person(c.ownerId) } });
      json(res, 200, { ok: true });
    }),

    'POST /api/sharing/update': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      if (!consentBody(res, body.consent)) return;
      const out = org.updateScopes(user.id, idOf(body.id), body.scopes, body.lang);
      log.append(user.id, { ev: 'grant.update', actor: self(user), grantId: out.grant.id });
      const who = out.grant.kind === 'lead' ? org.gym(out.grant.granteeId)?.name : nameOf(out.grant.granteeId);
      notify.notice(user.id, 'scopes', { names: [who], grantId: out.grant.id });
      json(res, 200, { ok: true, scopes: out.grant.scopes, pairScopes: out.pair?.scopes || null });
    }),

    'POST /api/sharing/disconnect': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      const g = org.grant(idOf(body.id));
      if (!g || g.memberId !== user.id || g.status === 'ended') return json(res, 404, { error: 'no such connection', code: 'no-grant' });
      org.endGrant(g.id, 'member');
      lapseSuggestions(user.id, [g.id]);
      log.updateInbox(user.id, i => i.kind === 'offer' && i.status === 'open' && i.grantId === g.id, { status: 'declined', answeredAt: Date.now() });
      log.append(user.id, { ev: 'grant.end', actor: self(user), grantId: g.id, peer: g.kind === 'lead' ? { kind: 'gym', id: g.gymId, name: org.gym(g.gymId)?.name } : { kind: 'trainer', ...person(g.granteeId) } });
      json(res, 200, { ok: true });
    }),

    'POST /api/sharing/leave': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      const gid = idOf(body.gymId);
      const ended = org.leaveGym(user.id, gid);
      lapseSuggestions(user.id, ended.map(g => g.id));
      log.append(user.id, { ev: 'gym.leave', actor: self(user), peer: { kind: 'gym', id: gid, name: org.gym(gid)?.name } });
      // Only the trainers who are still around get the offer; one who left the gym already has theirs.
      offerPrivate(ended.filter(g => g.kind === 'trainer' && org.staffOf(gid, g.granteeId, 'trainer')), org.gym(gid)?.name);
      json(res, 200, { ok: true, ended: ended.length });
    }),

    'GET /api/sharing/log': guard('sharing.read', async (req, res, user) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const before = Number(q.get('before')) || Infinity;
      const limit = Math.max(1, Math.min(200, Number(q.get('limit')) || 100));
      json(res, 200, log.list(user.id, { before, limit }));
    }),

    // Art. 15/20: everything the server keeps about this member's sharing, in one file.
    'GET /api/sharing/export': guard('sharing.read', async (req, res, user) => {
      json(res, 200, { exported: Date.now(), server: origin, ...org.memberRecord(user.id), log: log.all(user.id), inbox: log.inbox(user.id), undo: log.undos(user.id) },
        { 'Content-Disposition': 'attachment; filename="opengym-sharing.json"' });
    }),

    /* ---------- the trainer ---------- */
    // The trainer's own overview: roles, live codes, requests waiting, connected members and what
    // each one shares. Never any member data: that is the dashboard's projection (later).
    'GET /api/trainer': guard('trainer.list', async (req, res, user) => {
      const roles = org.rolesOf(user.id);
      const mine = org.get().grants.filter(g => g.kind === 'trainer' && g.granteeId === user.id && g.status !== 'ended');
      const requests = mine.filter(g => g.status === 'pending' && userById(g.memberId) && !userById(g.memberId).disabled)
        .map(g => ({ id: g.id, member: person(g.memberId), gym: g.gymId ? { id: g.gymId, name: org.gym(g.gymId)?.name || '' } : null, scopes: g.scopes, created: g.created }));
      const members = mine.filter(g => g.status === 'active').map(g => {
        const levels = {};
        for (const cat of CATEGORY_IDS) { const r = perms.can(user, 'view', { memberId: g.memberId }, cat); levels[cat] = r.ok && r.via === g.id ? r.level : 'off'; }
        return { grantId: g.id, member: person(g.memberId), gym: g.gymId ? { id: g.gymId, name: org.gym(g.gymId)?.name || '' } : null, scopes: g.scopes, levels, paused: pausedWhy(g), since: g.created };
      });
      json(res, 200, {
        canInviteFree: roles.freeTrainer,
        gyms: roles.staff.filter(s => s.role === 'trainer').map(s => ({ id: s.gymId, name: org.gym(s.gymId)?.name || '', disabled: !!org.gym(s.gymId)?.disabled })),
        codes: org.codesOf(user.id).map(c => ({ id: c.id, gymId: c.gymId, uses: c.uses, maxUses: c.maxUses, expires: c.expires })),
        requests, members
      });
    }),

    // The code is shown once, here. `link` opens the member's sharing page with it filled in (the QR).
    'POST /api/trainer/codes': guard('trainer.code', async (req, res, user) => {
      const body = await readBody(req);
      const gymId = body.gymId ? idOf(body.gymId) : null;
      const may = perms.can(user, 'trainer:invite', { gymId });
      if (!may.ok) return json(res, 403, { error: 'you cannot invite members here', code: may.reason });
      const { code, row } = org.createCode({ ownerId: user.id, gymId, maxUses: +body.maxUses || 1, days: +body.days || 7 });
      audit(req, 'trainer.code', { user, msg: gymId ? org.gym(gymId)?.name : 'free' });
      json(res, 200, { id: row.id, code, link: `${origin}/#/settings/trainer?code=${encodeURIComponent(code)}`, expires: row.expires, maxUses: row.maxUses, gymId });
    }),

    'POST /api/trainer/codes/revoke': guard('trainer.answer', async (req, res, user) => {
      const body = await readBody(req);
      org.revokeCode(user.id, idOf(body.id));
      json(res, 200, { ok: true });
    }),

    'POST /api/trainer/requests/answer': guard('trainer.answer', async (req, res, user) => {
      const body = await readBody(req);
      const g = org.answer(user.id, idOf(body.id), body.accept === true);
      const actor = { kind: 'trainer', id: user.id, name: user.name };
      log.append(g.memberId, { ev: body.accept === true ? 'grant.accept' : 'grant.decline', actor, grantId: g.id });
      if (body.accept === true) notify.notice(g.memberId, 'connected', { from: actor, names: [user.name], grantId: g.id });
      json(res, 200, { ok: true, status: g.status });
    }),

    'POST /api/trainer/disconnect': guard('trainer.answer', async (req, res, user) => {
      const body = await readBody(req);
      const g = org.grant(idOf(body.id));
      if (!g || g.kind !== 'trainer' || g.granteeId !== user.id || g.status === 'ended') return json(res, 404, { error: 'no such member', code: 'no-grant' });
      org.endGrant(g.id, 'trainer');
      lapseSuggestions(g.memberId, [g.id]);
      log.append(g.memberId, { ev: 'grant.end', actor: { kind: 'trainer', id: user.id, name: user.name }, grantId: g.id });
      json(res, 200, { ok: true });
    }),

    /* ---------- the admin: gyms and roles ---------- */
    // Counts and names, never content: an admin runs the place, they do not read its members.
    'GET /api/admin/gyms': adminGuard('admin.gyms', async (req, res) => {
      const o = org.get();
      json(res, 200, {
        leadMode: org.leadMode,
        gyms: o.gyms.map(g => ({ ...g, counts: org.gymCounts(g.id),
          staff: o.staff.filter(s => s.gymId === g.id && !s.until).map(s => ({ userId: s.userId, name: nameOf(s.userId), role: s.role, since: s.since, ...(s.source ? { source: s.source } : {}) })) })),
        freeTrainers: o.trainers.filter(t => !t.until).map(t => ({ ...person(t.userId), since: t.since })),
        grants: o.grants.filter(g => g.status === 'active').length
      });
    }),

    'POST /api/admin/gyms/new': adminGuard('admin.gyms', async (req, res, admin) => {
      const body = await readBody(req);
      const name = text(body.name, 60);
      if (!name) return json(res, 400, { error: 'a gym needs a name', code: 'name' });
      if (org.get().gyms.length >= 200) return json(res, 400, { error: 'that is a lot of gyms already', code: 'gym-limit' });
      const g = org.createGym({ name, contact: text(body.contact, 200) });
      audit(req, 'admin.gym.create', { user: admin, msg: name });
      json(res, 200, { ok: true, gym: g });
    }),

    'POST /api/admin/gyms/update': adminGuard('admin.gyms', async (req, res, admin) => {
      const body = await readBody(req);
      const patch = {};
      if (typeof body.name === 'string') { patch.name = text(body.name, 60); if (!patch.name) return json(res, 400, { error: 'a gym needs a name', code: 'name' }); }
      if (typeof body.contact === 'string') patch.contact = text(body.contact, 200);
      if (typeof body.disabled === 'boolean') patch.disabled = body.disabled;
      const g = org.updateGym(idOf(body.id), patch);
      audit(req, 'admin.gym.update', { user: admin, msg: g.name + (typeof patch.disabled === 'boolean' ? (patch.disabled ? ' (off)' : ' (on)') : '') });
      json(res, 200, { ok: true, gym: g });
    }),

    'POST /api/admin/gyms/staff': adminGuard('admin.gyms', async (req, res, admin) => {
      const body = await readBody(req);
      const role = body.role === 'lead' || body.role === 'trainer' ? body.role : null;
      if (!role) return json(res, 400, { error: 'role is lead or trainer', code: 'role' });
      const target = userById(idOf(body.userId));
      if (!target) return json(res, 404, { error: 'no such user' });
      const gid = idOf(body.gymId);
      const may = perms.can(admin, 'gym:staff', { gymId: gid, role });
      if (!may.ok) return json(res, may.status, { error: 'forbidden', code: may.reason });
      const was = !!org.staffOf(gid, target.id, role);
      org.setStaff(gid, target.id, role, body.on !== false);
      if (role === 'trainer' && was && body.on === false) trainerLeaves(gid, target.id);
      if (role === 'trainer' && !was && body.on !== false) trainerReturns(gid, target.id);
      audit(req, body.on !== false ? 'admin.gym.staff.add' : 'admin.gym.staff.remove', { user: admin, target, msg: `${role} @ ${org.gym(gid)?.name || gid}` });
      json(res, 200, { ok: true });
    }),

    // A trainer without a gym (a personal trainer). Taking it away pauses their private members at once.
    'POST /api/admin/user/trainer': adminGuard('admin.gyms', async (req, res, admin) => {
      const body = await readBody(req);
      const target = userById(idOf(body.id));
      if (!target) return json(res, 404, { error: 'no such user' });
      org.setFreeTrainer(target.id, body.free === true);
      audit(req, body.free === true ? 'admin.trainer.add' : 'admin.trainer.remove', { user: admin, target });
      json(res, 200, { ok: true, free: body.free === true });
    })
  };
  // The dashboard's routes (dashboard-routes.js) share the helpers above.
  return { routes, helpers: { guard, nameOf, person, self, gymCard, pausedWhy, consentBody, lookupCode, lapseSuggestions, offerPrivate, trainerLeaves, trainerReturns, text, idOf } };
}
