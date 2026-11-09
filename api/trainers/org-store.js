/* Studios, roles and sharing grants: DATA_DIR/org.json (docs/TRAINERS.md).
 *
 * One small document held in memory and written through on every change (temp-then-rename, plus
 * org.json.bak like db.json). permissions.js reads this in-memory copy on every request, so a
 * disconnect or a removed trainer counts from the very next request; nothing about a grant is
 * ever copied into a session.
 *
 *   gyms[]         { id, name, contact, created, disabled }
 *   staff[]        { gymId, userId, role: 'lead'|'trainer', since, until, source? }
 *   trainers[]     { userId, since, until, source? }          free trainers, allowed by an admin
 *   memberships[]  { gymId, userId, since, until }
 *   grants[]       { id, memberId, kind: 'trainer'|'lead', granteeId, gymId, scopes, status,
 *                    pairId?, consentId, created, updated, endedAt?, endedBy? }
 *   consents[]     consent.js records
 *   codes[]        { id, hash, kind: 'trainer'|'gym', ownerId, gymId, uses, maxUses, expires, created, revokedAt }
 *
 * A studio grant whose trainer left the gym carries `offerUntil`: until then the member can keep the
 * trainer privately (stayPrivate), after it expireOffers() ends the grant.
 *
 * A grant is 'pending' until the trainer confirms it, then 'active', then 'ended' (by either
 * side). Pausing is never stored: a grant whose trainer left the gym, or whose gym is disabled,
 * simply fails the check in permissions.js, and comes back if the trainer is re-added. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { atomicWrite } from '../durable.js';
import { cleanScopes, leadScopes, leadModeOf, sharesNothing } from './scopes.js';
import { consentRecord } from '../consent.js';

const DAY = 86400000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I
const empty = () => ({ v: 1, gyms: [], staff: [], trainers: [], memberships: [], grants: [], consents: [], codes: [] });
const id = prefix => prefix + crypto.randomBytes(9).toString('base64url');
const LISTS = Object.keys(empty()).filter(k => k !== 'v');

export class OrgError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

/** `TR-ABCDE-FGHJK` (a trainer's) or `GY-…` (a gym's join code), 50 random bits. Only its hash is stored. */
export function makeCode(rand = crypto.randomBytes, prefix = 'TR') {
  const b = rand(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += CODE_ALPHABET[b[i] & 31];
  return `${prefix}-${s.slice(0, 5)}-${s.slice(5)}`;
}
/** What was typed, the way it was printed: case, spaces, dashes and the TR/GY prefix do not matter. */
export const normalizeCode = v => {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(TR|GY)(?=[A-Z0-9]{10}$)/, '');
  return s.length === 10 ? s : null;
};
// How long a member has to answer "stay connected privately?" (design 3.5).
export const OFFER_DAYS = 30;
const hashCode = norm => crypto.createHash('sha256').update('trainer-code:' + norm).digest('hex');

export function createOrgStore({ file, now = Date.now, leadMode = 'row' } = {}) {
  let org = load();
  const LEAD = leadModeOf(leadMode);

  function load() {
    if (!file) return empty();
    const parse = t => { const v = JSON.parse(t); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object'); return v; };
    const fill = v => { for (const k of LISTS) if (!Array.isArray(v[k])) v[k] = []; v.v = 1; return v; };
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return empty(); throw e; }
    try { return fill(parse(raw)); } catch (err) {
      try { fs.copyFileSync(file, `${file}.unreadable-${now()}`); } catch { /* stays where it is */ }
      console.error(`org.json cannot be read (${err.message}); trying org.json.bak`);
      // Without either file nobody shares anything until it is restored, which is the safe way to fail.
      try { return fill(parse(fs.readFileSync(file + '.bak', 'utf8'))); } catch { return empty(); }
    }
  }
  function save() {
    if (!file) return;
    const text = JSON.stringify(org);
    atomicWrite(file, text, 0o600);
    try { atomicWrite(file + '.bak', text, 0o600); } catch (e) { console.error('org.json.bak could not be written', e.message); }
  }
  // Every change goes through here: on a throw nothing is written and the copy in memory is put back.
  function mutate(fn) {
    const before = JSON.stringify(org);
    try { const out = fn(org); save(); return out; }
    catch (e) { org = JSON.parse(before); throw e; }
  }

  const live = r => !r.until;
  const gym = gid => org.gyms.find(g => g.id === gid) || null;
  const activeGym = gid => { const g = gym(gid); return g && !g.disabled ? g : null; };
  const staffOf = (gid, uid, role) => org.staff.find(s => s.gymId === gid && s.userId === uid && s.role === role && live(s)) || null;
  const isFreeTrainer = uid => org.trainers.some(t => t.userId === uid && live(t));
  const membership = (gid, uid) => org.memberships.find(m => m.gymId === gid && m.userId === uid && live(m)) || null;
  const grant = gid => org.grants.find(g => g.id === gid) || null;

  function endGrant(o, g, by) {
    if (g.status === 'ended') return;
    g.status = 'ended'; g.endedAt = now(); g.endedBy = by; g.updated = now();
    for (const c of o.consents) if (c.subjectId === g.id && !c.revokedAt) c.revokedAt = now();
  }
  function addConsent(o, rec) { o.consents.push(rec); return rec; }
  // The gym lead row stays when its trainer row goes the private way: it is the member's
  // membership, not the trainer's (design 3.5). It just stops following that trainer row.
  function unpair(g) {
    const lead = g.pairId ? grant(g.pairId) : null;
    if (lead && lead.pairId === g.id) delete lead.pairId;
    delete g.pairId;
  }
  function rolesOf(uid) {
    return {
      freeTrainer: isFreeTrainer(uid),
      staff: org.staff.filter(s => s.userId === uid && live(s)).map(s => ({ gymId: s.gymId, role: s.role, since: s.since })),
      memberOf: org.memberships.filter(m => m.userId === uid && live(m)).map(m => m.gymId)
    };
  }

  return {
    get: () => org,
    gym, activeGym, staffOf, isFreeTrainer, membership, grant,
    leadMode: LEAD,

    /* ---------- admin: gyms and roles ---------- */
    createGym({ name, contact }) {
      return mutate(o => {
        const g = { id: id('g_'), name, contact: contact || '', created: now(), disabled: false };
        o.gyms.push(g);
        return g;
      });
    },
    updateGym(gid, patch) {
      return mutate(() => {
        const g = gym(gid);
        if (!g) throw new OrgError(404, 'no-gym', 'no such gym');
        if (typeof patch.name === 'string') g.name = patch.name;
        if (typeof patch.contact === 'string') g.contact = patch.contact;
        if (typeof patch.disabled === 'boolean') g.disabled = patch.disabled;
        return g;
      });
    },
    /** Adds or ends one role. Ending a trainer's role cuts their studio grants on the next request. */
    setStaff(gid, uid, role, on, source) {
      return mutate(o => {
        if (!gym(gid)) throw new OrgError(404, 'no-gym', 'no such gym');
        const cur = staffOf(gid, uid, role);
        if (on && !cur) o.staff.push({ gymId: gid, userId: uid, role, since: now(), until: null, ...(source ? { source } : {}) });
        if (!on && cur) cur.until = now();
        return { gymId: gid, userId: uid, role, on };
      });
    },
    setFreeTrainer(uid, on, source) {
      return mutate(o => {
        const cur = o.trainers.find(t => t.userId === uid && live(t));
        if (on && !cur) o.trainers.push({ userId: uid, since: now(), until: null, ...(source ? { source } : {}) });
        if (!on && cur) cur.until = now();
        return on;
      });
    },
    rolesOf,
    gymCounts(gid) {
      return {
        leads: org.staff.filter(s => s.gymId === gid && s.role === 'lead' && live(s)).length,
        trainers: org.staff.filter(s => s.gymId === gid && s.role === 'trainer' && live(s)).length,
        members: org.memberships.filter(m => m.gymId === gid && live(m)).length
      };
    },

    /* ---------- trainer codes ---------- */
    /** A new invite code. A studio code needs a trainer role in that gym, a free one free-trainer status. */
    createCode({ ownerId, gymId = null, maxUses = 1, days = 7, kind = 'trainer' }) {
      return mutate(o => {
        const code = makeCode(crypto.randomBytes, kind === 'gym' ? 'GY' : 'TR');
        const row = { id: id('k_'), hash: hashCode(normalizeCode(code)), kind: kind === 'gym' ? 'gym' : 'trainer', ownerId, gymId, uses: 0,
          maxUses: Math.max(1, Math.min(200, Math.floor(maxUses) || 1)), expires: now() + Math.max(1, Math.min(30, days || 7)) * DAY,
          created: now(), revokedAt: null };
        o.codes.push(row);
        // Spent, expired and revoked codes go after a month: nothing about them is worth keeping.
        o.codes = o.codes.filter(c => c === row || Math.max(c.expires, c.revokedAt || 0) > now() - 30 * DAY);
        return { code, row };
      });
    },
    /** The live code a typed one stands for, or null. Never says why it is not good. */
    findCode(typed) {
      const norm = normalizeCode(typed);
      if (!norm) return null;
      const h = hashCode(norm);
      const c = org.codes.find(x => x.hash === h);
      if (!c || c.revokedAt || c.expires <= now() || c.uses >= c.maxUses) return null;
      return c;
    },
    revokeCode(ownerId, codeId) {
      return mutate(() => {
        const c = org.codes.find(x => x.id === codeId && x.ownerId === ownerId);
        if (!c) throw new OrgError(404, 'no-code', 'no such code');
        c.revokedAt = c.revokedAt || now();
        return c;
      });
    },
    codesOf: ownerId => org.codes.filter(c => c.ownerId === ownerId && !c.revokedAt && c.expires > now() && c.uses < c.maxUses),

    /** The member used a gym's join code: a membership and, unless leads see names only, the lead
     *  row with what the member ticked. No trainer to confirm, so it counts at once. */
    joinGym({ memberId, code, leadPicked, lang }) {
      return mutate(o => {
        if (code.kind !== 'gym' || !code.gymId) throw new OrgError(400, 'not-gym-code', 'that is not a gym code');
        if (membership(code.gymId, memberId)) throw new OrgError(409, 'already-member', 'you are in this gym already');
        code.uses += 1;
        o.memberships.push({ gymId: code.gymId, userId: memberId, since: now(), until: null });
        let lead = null;
        const open = o.grants.find(g => g.memberId === memberId && g.kind === 'lead' && g.granteeId === code.gymId && g.status !== 'ended');
        if (!open && LEAD !== 'none') {
          const ls = leadScopes(LEAD, null, leadPicked);
          lead = { id: id('gr_'), memberId, kind: 'lead', granteeId: code.gymId, gymId: code.gymId, scopes: ls, status: 'active', created: now(), updated: now() };
          lead.consentId = addConsent(o, consentRecord({ kind: 'lead', memberId, subjectId: lead.id, scopes: ls, lang, now: now() })).id;
          o.grants.push(lead);
        }
        return { gymId: code.gymId, lead };
      });
    },

    /** A trainer stops working at a gym (removed, or left): their studio grants are paused at once
     *  (permissions.js sees the missing role) and each gets an offer to stay privately. Returns them. */
    trainerLeft(gid, uid) {
      return mutate(o => {
        const out = o.grants.filter(g => g.kind === 'trainer' && g.granteeId === uid && g.gymId === gid && g.status !== 'ended');
        for (const g of out) { g.offerUntil = now() + OFFER_DAYS * DAY; g.updated = now(); }
        return out;
      });
    },
    /** The trainer is back before anyone answered: the offers lapse, the grants simply work again. */
    trainerBack(gid, uid) {
      return mutate(o => {
        for (const g of o.grants) if (g.kind === 'trainer' && g.granteeId === uid && g.gymId === gid && g.offerUntil) delete g.offerUntil;
      });
    },
    /** "Stay connected privately": a new grant without the gym (and so without the lead row), with
     *  the same scopes and a fresh consent record. The studio grant ends. */
    stayPrivate({ memberId, grantId, lang }) {
      return mutate(o => {
        const g = grant(grantId);
        if (!g || g.memberId !== memberId || g.kind !== 'trainer' || !g.gymId) throw new OrgError(404, 'no-grant', 'no such connection');
        const dupe = o.grants.find(x => x.memberId === memberId && x.kind === 'trainer' && x.granteeId === g.granteeId && !x.gymId && x.status !== 'ended');
        if (dupe) throw new OrgError(409, 'already-connected', 'you are already connected to this trainer', { grantId: dupe.id });
        const p = { id: id('gr_'), memberId, kind: 'trainer', granteeId: g.granteeId, gymId: null, scopes: cleanScopes(g.scopes),
          status: 'active', from: g.id, created: now(), updated: now() };
        p.consentId = addConsent(o, consentRecord({ kind: 'trainer', memberId, subjectId: p.id, scopes: p.scopes, lang, now: now() })).id;
        o.grants.push(p);
        if (g.status !== 'ended') endGrant(o, g, 'member');
        unpair(g);
        return p;
      });
    },
    /** Offers nobody answered within OFFER_DAYS: the paused studio grant ends. Returns the ended ones. */
    expireOffers() {
      const due = org.grants.filter(g => g.offerUntil && g.offerUntil <= now() && g.status !== 'ended');
      if (!due.length) return [];
      return mutate(o => {
        for (const g of due) { endGrant(o, g, 'expired'); unpair(g); }
        return due;
      });
    },

    /* ---------- member: connect, change, disconnect ---------- */
    /** The member said yes on the consent screen. A pending trainer grant (the trainer confirms
     *  it), and with a studio trainer the studio membership and the lead row. */
    connect({ memberId, code, scopes, leadPicked, lang }) {
      return mutate(o => {
        if (code.ownerId === memberId) throw new OrgError(400, 'self', 'that is your own code');
        const already = o.grants.find(g => g.memberId === memberId && g.kind === 'trainer' && g.granteeId === code.ownerId
          && (g.gymId || null) === (code.gymId || null) && g.status !== 'ended');
        if (already) throw new OrgError(409, 'already-connected', 'you are already connected to this trainer', { grantId: already.id });
        const tScopes = cleanScopes(scopes);
        if (sharesNothing(tScopes)) throw new OrgError(400, 'nothing-shared', 'share at least one category');
        code.uses += 1;
        const t = { id: id('gr_'), memberId, kind: 'trainer', granteeId: code.ownerId, gymId: code.gymId || null,
          scopes: tScopes, status: 'pending', created: now(), updated: now() };
        t.consentId = addConsent(o, consentRecord({ kind: 'trainer', memberId, subjectId: t.id, scopes: tScopes, lang, now: now() })).id;
        o.grants.push(t);
        let lead = null;
        if (code.gymId) {
          if (!membership(code.gymId, memberId)) o.memberships.push({ gymId: code.gymId, userId: memberId, since: now(), until: null });
          if (LEAD !== 'none') {
            const ls = leadScopes(LEAD, tScopes, leadPicked);
            lead = { id: id('gr_'), memberId, kind: 'lead', granteeId: code.gymId, gymId: code.gymId, scopes: ls,
              status: 'pending', pairId: t.id, created: now(), updated: now() };
            lead.consentId = addConsent(o, consentRecord({ kind: 'trainer', memberId, subjectId: lead.id, scopes: ls, lang, now: now() })).id;
            t.pairId = lead.id;
            o.grants.push(lead);
          }
        }
        return { grant: t, lead };
      });
    },
    /** The trainer confirms or turns down a pending connection. */
    answer(trainerId, grantId, yes) {
      return mutate(o => {
        const g = grant(grantId);
        if (!g || g.kind !== 'trainer' || g.granteeId !== trainerId || g.status !== 'pending') throw new OrgError(404, 'no-request', 'no such request');
        const pair = g.pairId ? grant(g.pairId) : null;
        if (yes) {
          g.status = 'active'; g.updated = now();
          if (pair && pair.status === 'pending') { pair.status = 'active'; pair.updated = now(); }
        } else {
          endGrant(o, g, 'trainer');
          if (pair) endGrant(o, pair, 'trainer');
        }
        return g;
      });
    },
    /** The member changes what one grant shares. A lead row follows the trainer row down, never up. */
    updateScopes(memberId, grantId, scopes, lang) {
      return mutate(o => {
        const g = grant(grantId);
        if (!g || g.memberId !== memberId || g.status === 'ended') throw new OrgError(404, 'no-grant', 'no such connection');
        if (g.kind === 'lead' && LEAD === 'mirror') throw new OrgError(400, 'lead-mirrors', 'on this server the gym lead sees what your trainer sees');
        const pair = g.pairId ? grant(g.pairId) : null;
        if (g.kind === 'trainer') {
          g.scopes = cleanScopes(scopes);
          if (pair && pair.status !== 'ended') pair.scopes = leadScopes(LEAD, g.scopes, LEAD === 'row' ? pair.scopes : null);
        } else {
          g.scopes = leadScopes(LEAD, pair && pair.status !== 'ended' ? pair.scopes : null, scopes);
        }
        for (const x of [g, pair]) {
          if (!x || x.status === 'ended') continue;
          x.updated = now();
          for (const c of o.consents) if (c.subjectId === x.id && !c.revokedAt) c.revokedAt = now();
          x.consentId = addConsent(o, consentRecord({ kind: 'trainer', memberId, subjectId: x.id, scopes: x.scopes, lang, now: now() })).id;
        }
        return { grant: g, pair };
      });
    },
    /** Either side ends a connection. The member's trainer grant takes its lead row with it. */
    endGrant(grantId, by) {
      return mutate(o => {
        const g = grant(grantId);
        if (!g || g.status === 'ended') throw new OrgError(404, 'no-grant', 'no such connection');
        endGrant(o, g, by);
        if (g.kind === 'trainer' && g.pairId) { const p = grant(g.pairId); if (p) endGrant(o, p, by); }
        return g;
      });
    },
    leaveGym(memberId, gymId) {
      return mutate(o => {
        const m = membership(gymId, memberId);
        if (!m) throw new OrgError(404, 'not-member', 'you are not in that gym');
        m.until = now();
        const ended = [];
        for (const g of o.grants) if (g.memberId === memberId && g.gymId === gymId && g.status !== 'ended') { endGrant(o, g, 'member'); ended.push(g); }
        return ended;
      });
    },

    /** Everything a member is part of, for the sharing page and the export. */
    memberRecord(uid) {
      return {
        memberships: org.memberships.filter(m => m.userId === uid),
        grants: org.grants.filter(g => g.memberId === uid),
        consents: org.consents.filter(c => c.memberId === uid)
      };
    },

    /** An account is deleted. As a member: every row about them goes (Art. 17). As a trainer or
     *  lead: their grants end and their roles stop; the members' logs are anonymized by the caller.
     *  Returns the members whose logs mention them. */
    removeUser(uid) {
      return mutate(o => {
        const touched = new Set(o.grants.filter(g => g.kind === 'trainer' && g.granteeId === uid).map(g => g.memberId));
        for (const g of o.grants) if (g.kind === 'trainer' && g.granteeId === uid) endGrant(o, g, 'deleted');
        o.grants = o.grants.filter(g => g.memberId !== uid);
        o.consents = o.consents.filter(c => c.memberId !== uid);
        o.memberships = o.memberships.filter(m => m.userId !== uid);
        o.staff = o.staff.filter(s => s.userId !== uid);
        o.trainers = o.trainers.filter(t => t.userId !== uid);
        o.codes = o.codes.filter(c => c.ownerId !== uid);
        touched.delete(uid);
        return [...touched];
      });
    },

    /** OIDC (api/oidc/routes.js applyRoles): bring the roles a sign-in's group claims grant in line, touching only rows
     *  that came from claims before (`source: 'oidc'`), so roles an admin gave by hand stay. */
    syncClaimRoles(uid, roles, source = 'oidc') {
      mutate(o => {
        const wantStaff = new Set((roles.staff || []).filter(s => gym(s.gymId)).map(s => s.gymId + '|' + s.role));
        for (const s of o.staff) {
          if (s.userId !== uid || !live(s) || s.source !== source) continue;
          if (!wantStaff.has(s.gymId + '|' + s.role)) s.until = now();
        }
        for (const k of wantStaff) {
          const [gid, role] = k.split('|');
          if (!staffOf(gid, uid, role)) o.staff.push({ gymId: gid, userId: uid, role, since: now(), until: null, source });
        }
        const free = o.trainers.find(t => t.userId === uid && live(t));
        if (roles.freeTrainer && !free) o.trainers.push({ userId: uid, since: now(), until: null, source });
        if (!roles.freeTrainer && free && free.source === source) free.until = now();
        for (const gid of roles.memberOf || []) {
          if (gym(gid) && !membership(gid, uid)) o.memberships.push({ gymId: gid, userId: uid, since: now(), until: null, source });
        }
      });
      return rolesOf(uid);
    }
  };
}
