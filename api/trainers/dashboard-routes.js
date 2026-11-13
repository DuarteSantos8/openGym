/* The trainer dashboard, the gym lead's view, a trainer's writes and the member's inbox and Undo
 * (docs/TRAINERS.md). Built on routes.js: same guard, budgets, permissions and sharing log.
 *
 *   trainer   GET  /api/trainer/members      the list: last workout, streak, this week, flags
 *             GET  /api/trainer/member       one member, only the categories they shared
 *             GET  /api/trainer/member/photo one progress photo, only with the photos category shared
 *             POST /api/trainer/ops          a change: applied where "Change directly", a suggestion where "Suggest"
 *             POST /api/trainer/assign       one of the trainer's routines to one or many members
 *             POST /api/trainer/comment      a note on a workout, into the member's inbox
 *             POST /api/trainer/leave-gym    stop working at a gym (members get the private offer)
 *   lead      GET  /api/gym                  the gym: its trainers, its members, who shares what
 *             POST /api/gym/code             a join code for the gym (GY-…)
 *             POST /api/gym/staff            add or remove a trainer of the gym
 *   member    GET  /api/sharing/inbox        suggestions, comments, notices, offers, and what trainers changed
 *             POST /api/sharing/inbox/answer take or leave a suggestion or an offer, dismiss a notice
 *             POST /api/sharing/inbox/seen   mark as seen
 *             POST /api/sharing/undo         undo one change a trainer made
 *             GET  /api/sharing/preview      exactly what one connection sees of me
 *
 * Reads are projections (projections.js), writes are whitelisted ops (ops.js) written through the
 * server's own sync path (`state.write`, the stamps of PUT /api/data). Every check is permissions.js,
 * read fresh on each request, and a member nobody may see answers 404, never 403. */
import { OrgError } from './org-store.js';
import { CATEGORY_IDS, cleanScopes, rank } from './scopes.js';
import { summarize, project, customNames, progressPhotos } from './projections.js';
import { cleanOps, applyOps, applyRestores, fingerprintOf, OpError, OP_CATEGORY, customCopy, routineCopy } from './ops.js';
import { originFor } from '../origin.js';

const DAY = 86400000;
const isISO = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const UNDO_DAYS = 30;

export function dashboardRoutes({ json, readBody, userById, audit, org, perms, log, budgets, notify, nutrition, state, origin, helpers, media = null }) {
  const { guard, nameOf, person, gymCard, pausedWhy, consentBody, text, idOf } = helpers;
  const nowMs = () => Date.now();

  // The day the dashboard is looking at: the client's own date (its time zone), if it is within a
  // day of the server's; otherwise the server's.
  const todayOf = req => {
    const q = new URL(req.url, 'http://x').searchParams.get('today');
    const server = new Date().toISOString().slice(0, 10);
    return isISO(q) && Math.abs(Date.parse(q) - Date.parse(server)) <= 1.5 * DAY ? q : server;
  };
  const query = req => new URL(req.url, 'http://x').searchParams;
  const actorOf = (user, viaGrant) => ({ kind: org.grant(viaGrant)?.kind === 'lead' ? 'lead' : 'trainer', id: user.id, name: user.name });
  const label = user => ({ kind: 'trainer', id: user.id, name: user.name });

  /** What `actor` may see of a member per category, and through which grant: read fresh. */
  function access(actor, memberId) {
    const levels = {}, via = {};
    for (const c of CATEGORY_IDS) {
      const r = perms.can(actor, 'view', { memberId }, c);
      levels[c] = r.ok ? r.level : 'off';
      if (r.ok) via[c] = r.via;
    }
    return { levels, via, any: Object.values(levels).some(l => l !== 'off') };
  }
  const pendingFrom = (memberId, trainerId) => log.inbox(memberId).filter(i => i.kind === 'suggest' && i.status === 'open' && i.from?.id === trainerId).length;
  const lookedAt = (memberId, actor, cats) => { for (const c of cats) { try { log.noteAccess(memberId, actor, c); } catch (e) { console.error('share log', e.message); } } };
  const prNames = (S, sum) => {
    const ids = sum.flags.find(f => f.kind === 'pr')?.ex || [];
    return ids.length ? customNames(S, ids) : [];
  };

  /** Applies ops to a member's profile (the sync path) and keeps the Undo material. */
  function applyFor(member, ops, by, { accepted = false, grantId = null } = {}) {
    const recs = state.write(member.id, (S, t) => {
      const r = applyOps(S, ops, { by, t });
      return { recs: r, fp: fingerprintOf(S, r.flatMap(x => x.touched)) };
    });
    const cats = [...new Set(recs.recs.map(r => r.cat))];
    const undo = log.addUndo(member.id, {
      by, grantId, accepted, cats, summary: recs.recs.map(r => r.summary),
      inverse: recs.recs.flatMap(r => r.inverse), touched: recs.recs.flatMap(r => r.touched), fp: recs.fp
    });
    log.append(member.id, { ev: accepted ? 'suggest.accept' : 'trainer.change', actor: accepted ? { kind: 'self', id: member.id, name: member.name } : by,
      ...(accepted ? { peer: by } : {}), cat: cats[0], msg: summaryLine(recs.recs.map(r => r.summary)), undoId: undo.id });
    return { undo, recs: recs.recs };
  }
  // A short English line for the log export; the app renders its own from `summary`.
  const summaryLine = sums => sums.map(s => `${s.kind}${s.name ? ' ' + s.name : ''}${s.d ? ' ' + s.d : ''}`).join(', ').slice(0, 200);

  /** A suggestion: what it would do, worked out on a copy (so it is checked now, not at accept). */
  function suggest(member, ops, by, grantId, message) {
    const S = state.read(member.id) || {};
    const preview = applyOps(JSON.parse(JSON.stringify(S)), ops, { by, t: nowMs() }).map(r => r.summary);
    const item = log.addInbox(member.id, { kind: 'suggest', from: by, grantId, ops, summary: preview, cats: [...new Set(ops.map(o => OP_CATEGORY[o.op]))], ...(message ? { message } : {}) });
    log.append(member.id, { ev: 'suggest.new', actor: by, cat: item.cats[0], msg: summaryLine(preview) });
    notify.push(member.id, 'suggest', [by.name]);
    return item;
  }

  // Splits ops by what the actor may do with each one's category, for this member.
  function triage(user, memberId, ops) {
    const apply = [], sugg = [], refused = [];
    let via = null, status = 404;
    for (const o of ops) {
      const cat = OP_CATEGORY[o.op];
      const a = perms.can(user, 'apply', { memberId }, cat);
      if (a.ok) { apply.push(o); via = via || a.via; continue; }
      const s = perms.can(user, 'suggest', { memberId }, cat);
      if (s.ok) { sugg.push(o); via = via || s.via; continue; }
      refused.push(o);
      if (a.status === 403) status = 403;
    }
    return { apply, sugg, refused, via, status };
  }
  // No access: 404 to a stranger (a trainer cannot probe who is on the server), but 403 to someone
  // who was connected and is not any more, who knows the member exists and should hear that it ended.
  const refuse = (res, user, memberId) => {
    const was = !!memberId && org.get().grants.some(g => g.memberId === memberId && ((g.kind === 'trainer' && g.granteeId === user.id) || (g.kind === 'lead' && org.staffOf(g.granteeId, user.id, 'lead'))));
    return was ? json(res, 403, { error: 'they do not share that with you any more', code: 'not-shared' })
      : json(res, 404, { error: 'no such member', code: 'not-found' });
  };
  const opFail = (res, e) => {
    if (e instanceof OpError || e instanceof OrgError) { json(res, e.status, { error: e.message, code: e.code }); return true; }
    return false;
  };

  return {
    /* ---------- the trainer ---------- */
    'GET /api/trainer/members': guard('trainer.list', async (req, res, user) => {
      const today = todayOf(req);
      const inactiveDays = Math.max(2, Math.min(60, Number(query(req).get('inactive')) || 7));
      const mine = org.get().grants.filter(g => g.kind === 'trainer' && g.granteeId === user.id && g.status === 'active');
      const members = [];
      for (const g of mine) {
        const m = userById(g.memberId);
        if (!m || m.disabled) continue;
        const paused = pausedWhy(g);
        const levels = {};
        for (const c of CATEGORY_IDS) { const r = perms.can(user, 'view', { memberId: m.id }, c); levels[c] = r.ok && r.via === g.id ? r.level : 'off'; }
        const S = paused ? null : state.read(m.id);
        const sum = summarize(S, levels, { today, inactiveDays, pending: pendingFrom(m.id, user.id) });
        if (!paused && levels.metrics !== 'off') lookedAt(m.id, { kind: 'trainer', id: user.id, name: user.name }, ['metrics']);
        members.push({ grantId: g.id, member: person(m.id), gym: g.gymId ? { id: g.gymId, name: org.gym(g.gymId)?.name || '' } : null,
          levels, paused, since: g.created, summary: sum, exNames: S ? prNames(S, sum) : [] });
      }
      const requests = org.get().grants.filter(g => g.kind === 'trainer' && g.granteeId === user.id && g.status === 'pending' && userById(g.memberId) && !userById(g.memberId).disabled).length;
      const roles = org.rolesOf(user.id);
      json(res, 200, { today, members, requests,
        leads: roles.staff.filter(s => s.role === 'lead').map(s => ({ id: s.gymId, name: org.gym(s.gymId)?.name || '' })) });
    }),

    'GET /api/trainer/member': guard('trainer.detail', async (req, res, user) => {
      const q = query(req);
      const member = userById(idOf(q.get('id')));
      const acc = member ? access(user, member.id) : null;
      if (!member || member.disabled) return json(res, 404, { error: 'no such member', code: 'not-found' });
      if (!acc.any) return refuse(res, user, member.id);
      const today = todayOf(req);
      const before = isISO(q.get('before')) ? q.get('before') : null;
      const S = state.read(member.id);
      let nut = null;
      if (acc.levels.nutrition !== 'off' && nutrition) {
        const status = nutrition.status(member.id);
        nut = { status, ...(status === 'ok' ? { summary: await nutrition.getSummary(member.id) } : {}) };
      }
      const proj = project(S, acc.levels, { today, before, limit: Number(q.get('limit')) || 20, nutrition: nut });
      // What this person did here: their comments, suggestions and changes, as long as they still see the member.
      const inbox = log.inbox(member.id);
      const comments = acc.levels.workouts !== 'off' ? inbox.filter(i => i.kind === 'comment' && i.from?.id === user.id)
        .map(i => ({ id: i.id, workoutId: i.workoutId, text: i.text, at: i.at, seen: !!i.seen })) : [];
      const suggestions = inbox.filter(i => i.kind === 'suggest' && i.from?.id === user.id).slice(-20)
        .map(i => ({ id: i.id, at: i.at, status: i.status, summary: i.summary, cats: i.cats }));
      const changes = log.undos(member.id).filter(u => u.by?.id === user.id && !u.accepted).slice(-20)
        .map(u => ({ id: u.id, at: u.at, summary: u.summary, undoneAt: u.undoneAt || null }));
      const grants = org.get().grants.filter(g => g.memberId === member.id && g.status === 'active'
        && ((g.kind === 'trainer' && g.granteeId === user.id) || (g.kind === 'lead' && org.staffOf(g.granteeId, user.id, 'lead'))))
        .map(g => ({ id: g.id, kind: g.kind, gym: g.gymId ? { id: g.gymId, name: org.gym(g.gymId)?.name || '' } : null, since: g.created, paused: pausedWhy(g) }));
      // Each category shown once in the member's log for today, by whoever's grant let it through.
      const shown = proj.shared.filter(c => c !== 'nutrition' || nut);
      for (const c of shown) lookedAt(member.id, actorOf(user, acc.via[c]), [c]);
      const may = Object.fromEntries(CATEGORY_IDS.map(c => [c, acc.levels[c]]));
      json(res, 200, { member: person(member.id), today, levels: may, grants, ...proj, comments, suggestions, changes,
        pending: pendingFrom(member.id, user.id) });
    }),

    // One progress photo of a member: the grant is read again for this very file, the file has to be
    // one the photos category covers (projections.js progressPhotos), and it is sent with the same
    // locked-down headers as the member's own GET /api/media/{hash}. Their other media stay theirs.
    'GET /api/trainer/member/photo': guard('trainer.photo', async (req, res, user) => {
      const q = query(req);
      const member = userById(idOf(q.get('id')));
      if (!member || member.disabled) return json(res, 404, { error: 'no such member', code: 'not-found' });
      const acc = access(user, member.id);
      if (!acc.any) return refuse(res, user, member.id);
      if (acc.levels.photos === 'off') return json(res, 403, { error: 'they do not share their photos with you', code: 'level' });
      const hash = String(q.get('hash') || '');
      if (!/^[0-9a-f]{64}$/.test(hash)) return json(res, 400, { error: 'hash must be a lowercase sha256', code: 'bad-request' });
      const f = media && progressPhotos(state.read(member.id)).some(p => p.hash === hash) ? media.file(member.id, hash) : null;
      if (!f) return json(res, 404, { error: 'no such photo', code: 'media-missing' });
      lookedAt(member.id, actorOf(user, acc.via.photos), ['photos']);
      await media.send(res, f, hash);
    }),

    'POST /api/trainer/ops': guard('trainer.ops', async (req, res, user) => {
      const body = await readBody(req);
      const member = userById(idOf(body.memberId));
      if (!member || member.disabled) return json(res, 404, { error: 'no such member', code: 'not-found' });
      let ops;
      try { ops = cleanOps(body.ops); } catch (e) { if (opFail(res, e)) return; throw e; }
      const tri = triage(user, member.id, ops);
      if (tri.refused.length === ops.length) {
        if (tri.status === 403) return json(res, 403, { error: 'they did not let you change that', code: 'level' });
        return refuse(res, user, member.id);
      }
      const by = label(user);
      const message = text(body.message, 300);
      try {
        let undo = null, item = null;
        if (tri.apply.length) {
          undo = applyFor(member, tri.apply, by, { grantId: tri.via }).undo;
          notify.push(member.id, 'change', [user.name]);
        }
        if (tri.sugg.length) item = suggest(member, tri.sugg, by, tri.via, message);
        json(res, 200, { ok: true, applied: tri.apply.length, suggested: tri.sugg.length, refused: tri.refused.length, undoId: undo?.id || null, suggestionId: item?.id || null });
      } catch (e) { if (opFail(res, e)) return; throw e; }
    }),

    // One of the trainer's own routines, copied into each member's plans: directly where they said
    // "Change directly", as a suggestion where "Suggest", skipped where plans are not shared.
    'POST /api/trainer/assign': guard('trainer.list', async (req, res, user) => {
      const body = await readBody(req);
      const ids = (Array.isArray(body.memberIds) ? body.memberIds : []).map(idOf).filter(Boolean);
      if (!ids.length || ids.length > 50) return json(res, 400, { error: 'one to 50 members', code: 'members' });
      const own = state.read(user.id) || {};
      const src = (Array.isArray(own.routines) ? own.routines : []).find(r => r && String(r.id) === String(body.routineId));
      if (!src) return json(res, 404, { error: 'no such routine of yours', code: 'no-routine' });
      const day = body.day == null || body.day === '' ? null : Number(body.day);
      if (day != null && !(Number.isInteger(day) && day >= 0 && day <= 6)) return json(res, 400, { error: 'day is 0 (Sunday) to 6', code: 'day' });
      let routine;
      try { routine = routineCopy(src); } catch (e) { if (opFail(res, e)) return; throw e; }
      const need = new Set(routine.ex.map(e => String(e.id)));
      const customs = (Array.isArray(own.customEx) ? own.customEx : []).filter(c => c && need.has(String(c.id))).map(customCopy);
      const origin_ = originFor({ kind: 'trainer', id: user.id, sourceId: String(src.id), version: Number.isFinite(src._ts) ? 1 : undefined, by: user.name, server: origin });
      const ops = [
        ...customs.map(exercise => ({ op: 'custom.put', exercise })),
        { op: 'routine.put', routine, origin: origin_ },
        ...(day != null ? [{ op: 'week.add', day }] : []),
      ];
      const message = text(body.message, 300);
      const by = label(user);
      const results = [];
      for (const mid of [...new Set(ids)]) {
        const member = userById(mid);
        // A name only for someone this trainer may see: an id list must not turn into a phone book.
        const name = member && access(user, mid).any ? member.name : '';
        if (!member || member.disabled) { results.push({ memberId: mid, name: '', outcome: 'skipped', reason: 'not-shared' }); continue; }
        if (budgets.take('trainer.ops', user.id)) { results.push({ memberId: mid, name, outcome: 'skipped', reason: 'rate-limited' }); continue; }
        const a = perms.can(user, 'apply', { memberId: mid }, 'plans');
        const s = a.ok ? a : perms.can(user, 'suggest', { memberId: mid }, 'plans');
        if (!s.ok) { results.push({ memberId: mid, name, outcome: 'skipped', reason: s.status === 403 ? 'level' : 'not-shared' }); continue; }
        try {
          if (a.ok) {
            applyFor(member, ops, by, { grantId: a.via });
            if (message) log.addInbox(mid, { kind: 'comment', from: by, grantId: a.via, text: message, about: routine.name });
            notify.push(mid, 'change', [user.name]);
            results.push({ memberId: mid, name, outcome: 'applied' });
          } else {
            suggest(member, ops, by, s.via, message);
            results.push({ memberId: mid, name, outcome: 'suggested' });
          }
        } catch (e) {
          if (!(e instanceof OpError || e instanceof OrgError)) throw e;
          results.push({ memberId: mid, name, outcome: 'skipped', reason: e.code });
        }
      }
      audit(req, 'trainer.assign', { user, msg: `${routine.name} → ${results.filter(r => r.outcome !== 'skipped').length}` });
      json(res, 200, { ok: true, results,
        applied: results.filter(r => r.outcome === 'applied').length, suggested: results.filter(r => r.outcome === 'suggested').length,
        skipped: results.filter(r => r.outcome === 'skipped').length });
    }),

    'POST /api/trainer/comment': guard('trainer.comment', async (req, res, user) => {
      const body = await readBody(req);
      const member = userById(idOf(body.memberId));
      const may = member ? perms.can(user, 'comment', { memberId: member.id }, 'workouts') : null;
      if (!member || member.disabled) return json(res, 404, { error: 'no such member', code: 'not-found' });
      if (!may.ok) return may.status === 403 ? json(res, 403, { error: 'they do not share workouts with you', code: may.reason }) : refuse(res, user, member.id);
      const msg = text(body.text, 1000);
      if (!msg) return json(res, 400, { error: 'say something first', code: 'empty' });
      const S = state.read(member.id) || {};
      const w = (Array.isArray(S.workouts) ? S.workouts : []).find(x => x && String(x.id ?? `${x.d}|${x.start}`) === String(body.workoutId));
      if (!w) return json(res, 404, { error: 'no such workout', code: 'no-workout' });
      const by = actorOf(user, may.via);
      const item = log.addInbox(member.id, { kind: 'comment', from: by, grantId: may.via, workoutId: String(body.workoutId), workout: { d: w.d, name: String(w.name || '').slice(0, 80) }, text: msg });
      log.append(member.id, { ev: 'trainer.comment', actor: by, cat: 'workouts' });
      notify.push(member.id, 'comment', [user.name], msg);
      json(res, 200, { ok: true, id: item.id });
    }),

    'POST /api/trainer/leave-gym': guard('trainer.answer', async (req, res, user) => {
      const body = await readBody(req);
      const gid = idOf(body.gymId);
      if (!gid || !org.staffOf(gid, user.id, 'trainer')) return json(res, 404, { error: 'you do not train there', code: 'not-trainer' });
      org.setStaff(gid, user.id, 'trainer', false);
      const n = helpers.trainerLeaves(gid, user.id);
      audit(req, 'trainer.leave-gym', { user, msg: org.gym(gid)?.name || gid });
      json(res, 200, { ok: true, members: n });
    }),

    /* ---------- the gym lead ---------- */
    // The gym's trainers and members. Names of the members who joined, and of each member only
    // what their own lead row lets through (never more than view).
    'GET /api/gym': guard('trainer.list', async (req, res, user) => {
      const gid = idOf(query(req).get('id'));
      const may = gid ? perms.can(user, 'gym:members', { gymId: gid }) : null;
      if (!may?.ok) return json(res, 404, { error: 'no such gym', code: 'not-found' });
      const today = todayOf(req);
      const o = org.get();
      const live = r => !r.until;
      const trainerIds = o.staff.filter(s => s.gymId === gid && s.role === 'trainer' && live(s)).map(s => s.userId);
      const gymGrants = o.grants.filter(g => g.gymId === gid && g.status === 'active');
      const trainers = trainerIds.map(id => ({ ...person(id), members: gymGrants.filter(g => g.kind === 'trainer' && g.granteeId === id).length }));
      const members = [];
      for (const m of o.memberships.filter(x => x.gymId === gid && live(x))) {
        const u = userById(m.userId);
        if (!u || u.disabled) continue;
        const lead = gymGrants.find(g => g.kind === 'lead' && g.memberId === u.id);
        const levels = lead ? cleanScopes(lead.scopes, 'view') : cleanScopes({}, 'view');
        const shares = CATEGORY_IDS.filter(c => rank(levels[c]) > 0);
        const S = shares.length ? state.read(u.id) : null;
        const sum = summarize(S, levels, { today });
        if (levels.metrics !== 'off') lookedAt(u.id, { kind: 'lead', id: user.id, name: user.name }, ['metrics']);
        members.push({ member: person(u.id), since: m.since, sharesWithLead: shares.length > 0, levels,
          trainers: gymGrants.filter(g => g.kind === 'trainer' && g.memberId === u.id && trainerIds.includes(g.granteeId)).map(g => person(g.granteeId)),
          summary: sum });
      }
      const codes = org.codesOf(user.id).filter(c => c.kind === 'gym' && c.gymId === gid).map(c => ({ id: c.id, uses: c.uses, maxUses: c.maxUses, expires: c.expires }));
      json(res, 200, { gym: gymCard(gid), leadMode: org.leadMode, today, trainers, members, codes, iAmTrainer: !!org.staffOf(gid, user.id, 'trainer') });
    }),

    'POST /api/gym/code': guard('trainer.code', async (req, res, user) => {
      const body = await readBody(req);
      const gid = idOf(body.gymId);
      const may = perms.can(user, 'gym:invite', { gymId: gid });
      if (!may.ok) return json(res, may.status === 404 ? 404 : 403, { error: 'only the gym lead hands out its code', code: may.reason });
      const { code, row } = org.createCode({ ownerId: user.id, gymId: gid, kind: 'gym', maxUses: +body.maxUses || 50, days: +body.days || 30 });
      audit(req, 'gym.code', { user, msg: org.gym(gid)?.name });
      json(res, 200, { id: row.id, code, link: `${origin}/#/settings/trainer?code=${encodeURIComponent(code)}`, expires: row.expires, maxUses: row.maxUses, gymId: gid });
    }),

    'POST /api/gym/staff': guard('trainer.answer', async (req, res, user) => {
      const body = await readBody(req);
      const gid = idOf(body.gymId);
      const may = perms.can(user, 'gym:staff', { gymId: gid, role: 'trainer' });
      if (!may.ok) return json(res, 404, { error: 'no such gym', code: 'not-found' });
      // An account id, as Settings shows it (copy button), or a name that is unique on this server.
      const raw = text(body.user, 80);
      let target = userById(idOf(raw));
      if (!target && raw && body.on !== false) {
        return json(res, 404, { error: 'no account with that id', code: 'no-user' });
      }
      if (!target || target.disabled) return json(res, 404, { error: 'no such account', code: 'no-user' });
      const on = body.on !== false;
      const was = !!org.staffOf(gid, target.id, 'trainer');
      org.setStaff(gid, target.id, 'trainer', on);
      if (was && !on) helpers.trainerLeaves(gid, target.id);
      if (!was && on) helpers.trainerReturns(gid, target.id);
      audit(req, on ? 'gym.staff.add' : 'gym.staff.remove', { user, target, msg: org.gym(gid)?.name || gid });
      json(res, 200, { ok: true, trainer: person(target.id), on });
    }),

    /* ---------- the member ---------- */
    'GET /api/sharing/inbox': guard('sharing.read', async (req, res, user) => {
      // Offers nobody answered in time end here as anywhere: whichever request comes first.
      org.expireOffers();
      const t = nowMs();
      log.updateInbox(user.id, i => i.status === 'open' && i.expires && i.expires <= t, { status: 'expired', answeredAt: t });
      const items = log.inbox(user.id).reverse().slice(0, 100).map(i => {
        const { ops, ...rest } = i;
        return rest;
      });
      const undo = log.undos(user.id).reverse().slice(0, 50).map(u => ({
        id: u.id, at: u.at, by: u.by, accepted: !!u.accepted, cats: u.cats, summary: u.summary, undoneAt: u.undoneAt || null,
        canUndo: !u.undoneAt && u.at > t - UNDO_DAYS * DAY
      }));
      const unseen = items.filter(i => !i.seen && (i.status === 'open')).length;
      json(res, 200, { items, undo, unseen });
    }),

    'POST /api/sharing/inbox/seen': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
      const hit = log.updateInbox(user.id, i => !i.seen && (!ids || ids.has(i.id)), { seen: true });
      json(res, 200, { ok: true, seen: hit.length });
    }),

    'POST /api/sharing/inbox/answer': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      const item = log.inbox(user.id).find(i => i.id === String(body.id || ''));
      if (!item) return json(res, 404, { error: 'nothing like that in your inbox', code: 'no-item' });
      const yes = body.accept === true;
      const done = status => log.updateInbox(user.id, i => i.id === item.id, { status, seen: true, answeredAt: nowMs() });
      if (item.kind === 'notice' || item.kind === 'comment') { done('read'); return json(res, 200, { ok: true, status: 'read' }); }
      if (item.status !== 'open') return json(res, 410, { error: 'that one is not open any more', code: 'not-open', status: item.status });
      if (item.kind === 'suggest') {
        const g = org.grant(item.grantId);
        if (!g || g.status !== 'active' || pausedWhy(g)) { done('expired'); return json(res, 410, { error: 'that connection ended, so the suggestion did too', code: 'expired' }); }
        if (!yes) {
          done('declined');
          log.append(user.id, { ev: 'suggest.decline', actor: { kind: 'self', id: user.id, name: user.name }, peer: item.from });
          return json(res, 200, { ok: true, status: 'declined' });
        }
        try {
          const { undo } = applyFor(user, item.ops, item.from, { accepted: true, grantId: item.grantId });
          done('accepted');
          return json(res, 200, { ok: true, status: 'accepted', undoId: undo.id });
        } catch (e) { if (opFail(res, e)) return; throw e; }
      }
      if (item.kind === 'offer') {
        const g = org.grant(item.grantId);
        if (!yes) {
          if (g && g.status !== 'ended') { org.endGrant(g.id, 'member'); helpers.lapseSuggestions(user.id, [g.id]); }
          done('declined');
          log.append(user.id, { ev: 'grant.end', actor: { kind: 'self', id: user.id, name: user.name }, peer: item.from, grantId: item.grantId });
          return json(res, 200, { ok: true, status: 'declined' });
        }
        // The trainer lost the right to train freely since the offer: nothing to stay connected to.
        if (g && !org.rolesOf(g.granteeId).freeTrainer) {
          done('lapsed');
          return json(res, 409, { error: 'they cannot train people privately on this server', code: 'not-free' });
        }
        if (!consentBody(res, body.consent)) return;
        const p = org.stayPrivate({ memberId: user.id, grantId: item.grantId, lang: body.lang });
        done('accepted');
        log.append(user.id, { ev: 'grant.private', actor: { kind: 'self', id: user.id, name: user.name }, peer: item.from, grantId: p.id });
        return json(res, 200, { ok: true, status: 'accepted', grantId: p.id, paused: pausedWhy(p) });
      }
      json(res, 400, { error: 'cannot answer that', code: 'kind' });
    }),

    // Undo of one trainer change, as the member's own newest edit. When the member changed the same
    // entry since, it asks first (409 changed-since, then again with force).
    'POST /api/sharing/undo': guard('sharing.write', async (req, res, user) => {
      const body = await readBody(req);
      const u = log.undos(user.id).find(x => x.id === String(body.id || ''));
      if (!u) return json(res, 404, { error: 'nothing to undo there', code: 'no-undo' });
      if (u.undoneAt) return json(res, 409, { error: 'already undone', code: 'already-undone' });
      if (u.at < nowMs() - UNDO_DAYS * DAY) return json(res, 410, { error: 'too old to undo', code: 'too-old' });
      try {
        const changed = state.write(user.id, (S, t) => {
          const now = fingerprintOf(S, u.touched || []);
          const moved = Object.keys(u.fp || {}).some(k => now[k] !== u.fp[k]);
          if (moved && body.force !== true) return true;
          applyRestores(S, u.inverse || [], { t });
          return false;
        }, { skipIf: v => v === true });
        if (changed) return json(res, 409, { error: 'you changed it since; undo anyway?', code: 'changed-since' });
      } catch (e) { if (opFail(res, e)) return; throw e; }
      log.markUndone(user.id, u.id);
      log.append(user.id, { ev: 'trainer.undo', actor: { kind: 'self', id: user.id, name: user.name }, peer: u.by, msg: summaryLine(u.summary || []) });
      json(res, 200, { ok: true });
    }),

    // "See what Marco sees": the very projection that connection gets, nothing rebuilt.
    'GET /api/sharing/preview': guard('sharing.read', async (req, res, user) => {
      const g = org.grant(idOf(query(req).get('grant')));
      if (!g || g.memberId !== user.id || g.status === 'ended') return json(res, 404, { error: 'no such connection', code: 'no-grant' });
      const levels = cleanScopes(g.scopes, g.kind === 'lead' ? 'view' : 'apply');
      for (const c of CATEGORY_IDS) if (levels[c] !== 'off') levels[c] = 'view';
      const today = todayOf(req);
      const nut = levels.nutrition !== 'off' ? { status: nutrition ? nutrition.status(user.id) : 'not-linked' } : null;
      json(res, 200, { member: person(user.id), today, levels: cleanScopes(g.scopes, g.kind === 'lead' ? 'view' : 'apply'),
        ...project(state.read(user.id), levels, { today, nutrition: nut }), comments: [], suggestions: [], changes: [] });
    }),
  };
}
