/* Moderation of the community library (library design 6): reports that hide an item by
 * themselves, and the admin's approve, hide, restore, remove and ban. Every admin action needs a
 * short reason and lands in the activity log (`shared.*`). Removing is the one place the server
 * reaches into other people's upload folders, and only for the files an import of that very
 * item copied there (the item's own importer list, never a search). */

export const REPORT_REASONS = ['spam', 'offensive', 'not-theirs', 'licensed', 'personal', 'other'];
const ACTIONS = ['approve', 'hide', 'restore', 'remove'];

/** After a report: should the item step out of sight until an admin looks? Reports from
 *  different people since the last review count; one "licensed material" report is enough.
 *  Mutates `it` and returns whether it went pending. */
export function autoHide(it, cfg) {
  if (it.status !== 'live') return false;
  const since = ['approve', 'restore', 'unban'].includes(it.mod?.action) ? it.mod.at : 0;
  const fresh = (it.reports || []).filter(r => r.at > since);
  const people = new Set(fresh.map(r => r.by)).size;
  if (people >= cfg.autohide || fresh.some(r => r.reason === 'licensed')) {
    it.status = 'pending';
    it.mod = { by: null, at: Date.now(), action: 'auto-hide', reason: fresh.some(r => r.reason === 'licensed') ? 'licensed' : 'reports' };
    return true;
  }
  return false;
}

export function moderationRoutes({ json, readBody, readSession, requireAdmin, isAdmin, audit, userById, perms, budgets, log, media, store, cfg, forClient, saveDb }) {
  const off = res => json(res, 404, { error: 'the community library is off on this server', code: 'sharing-off' });
  // Admins, and a gym's leads for that gym's items (permissions.js library:moderate).
  const modGuard = fn => async (req, res) => {
    if (!cfg.on) return off(res);
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const wait = budgets.take('admin.gyms', user.id);
    if (wait) return json(res, 429, { error: 'slow down a little', code: 'rate-limited', retryAfter: wait }, { 'Retry-After': String(wait) });
    await fn(req, res, user);
  };
  const nameOf = uid => (uid ? userById(uid)?.name || '' : '');
  const modView = (it, viewer) => ({
    ...forClient(it, viewer, { full: true }),
    owner: { id: it.owner, name: nameOf(it.owner), banned: !!userById(it.owner)?.share?.banned },
    reports: (it.reports || []).map(r => ({ by: nameOf(r.by), reason: r.reason, note: r.note, at: r.at })),
    importers: (it.importers || []).length,
    mod: it.mod ? { by: nameOf(it.mod.by), at: it.mod.at, action: it.mod.action, reason: it.mod.reason } : null,
    consent: it.consent ? { v: it.consent.v, at: it.consent.at } : null,
  });

  /** Removal: the bytes go from the shared folder and from every importer's folder, and the
   *  hashes are blocked for good. Text copies (a routine) stay with the people who took them. */
  function removeItem(it, admin, reason) {
    const hashes = [...(it.media || [])];
    store.blockHashes(hashes, 'removed');
    // A file another live item still names goes too: blocked bytes are never served again.
    for (const h of hashes) store.drop(h);
    let copies = 0;
    for (const uid of it.importers || []) for (const h of hashes) { try { if (media.dropFile(uid, h)) copies++; } catch { /* their folder may be gone */ } }
    it.status = 'removed';
    it.payload = null;
    it.mod = { by: admin.id, at: Date.now(), action: 'remove', reason };
    try { log.append(it.owner, { ev: 'library.removed', msg: `${it.type}: ${it.title}` }); } catch { /* record only */ }
    return copies;
  }

  return {
    'GET /api/admin/shared': modGuard(async (req, res, user) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const status = q.get('status') || '';
      const reported = q.get('reported') === '1';
      const type = q.get('type') || '';
      const owner = q.get('owner') || '';
      const mine = store.all().filter(it => perms.can(user, 'library:moderate', { item: it }).ok);
      if (!mine.length && !isAdmin(user)) return json(res, 403, { error: 'forbidden', code: 'forbidden' });
      const rows = mine.filter(it => (!status || it.status === status) && (!reported || (it.reports || []).length) && (!type || it.type === type) && (!owner || it.owner === owner))
        .sort((a, b) => (b.reports?.length || 0) - (a.reports?.length || 0) || b.updatedAt - a.updatedAt)
        .slice(0, 200);
      json(res, 200, {
        items: rows.map(it => modView(it, user)),
        counts: {
          reported: mine.filter(it => it.status !== 'removed' && (it.reports || []).some(r => !it.mod || r.at > it.mod.at)).length,
          pending: mine.filter(it => it.status === 'pending').length,
          all: mine.length,
        },
        review: cfg.review,
      });
    }),

    'POST /api/admin/shared/{id}': modGuard(async (req, res, user) => {
      const body = await readBody(req);
      const it = store.get(req.itemId);
      if (!it) return json(res, 404, { error: 'no such item', code: 'not-found' });
      if (!perms.can(user, 'library:moderate', { item: it }).ok) return json(res, 403, { error: 'forbidden', code: 'forbidden' });
      const action = ACTIONS.includes(body.action) ? body.action : null;
      if (!action) return json(res, 400, { error: 'approve, hide, restore or remove', code: 'bad-action' });
      const reason = String(body.reason || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
      if (!reason) return json(res, 400, { error: 'a short reason, please', code: 'reason-needed' });
      if (it.status === 'removed') return json(res, 409, { error: 'that one is gone already', code: 'removed' });
      if (it.status === 'withdrawn' && action !== 'remove') return json(res, 409, { error: 'the owner stopped sharing it', code: 'withdrawn' });
      let copies = 0;
      store.update(it.id, x => {
        if (action === 'remove') { copies = removeItem(x, user, reason); return; }
        if (action === 'approve' || action === 'restore') x.status = 'live';
        if (action === 'hide') x.status = 'hidden';
        x.mod = { by: user.id, at: Date.now(), action, reason };
        x.rev++;
      });
      audit(req, 'shared.' + action, { user, target: userById(it.owner) || { id: it.owner, name: '' }, msg: `${it.id} ${reason}`.slice(0, 120) });
      json(res, 200, { status: it.status, ...(action === 'remove' ? { copiesRemoved: copies } : {}), item: modView(it, user) });
    }),

    // Sharing paused or resumed for one person. Their live items step out of sight with it and come
    // back with the unban; what an admin hid for another reason stays hidden.
    'POST /api/admin/users/{uid}/sharing': async (req, res) => {
      if (!cfg.on) return off(res);
      const admin = requireAdmin(req, res); if (!admin) return;
      const wait = budgets.take('admin.gyms', admin.id);
      if (wait) return json(res, 429, { error: 'slow down a little', code: 'rate-limited', retryAfter: wait }, { 'Retry-After': String(wait) });
      const body = await readBody(req);
      const u = userById(req.targetUid);
      if (!u) return json(res, 404, { error: 'no such user', code: 'not-found' });
      if (u.id === admin.id) return json(res, 400, { error: 'not on yourself', code: 'self' });
      const banned = body.banned === true;
      const reason = String(body.reason || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
      if (banned && !reason) return json(res, 400, { error: 'a short reason, please', code: 'reason-needed' });
      const t = Date.now();
      if (banned) u.share = { banned: true, bannedAt: t, reason };
      else delete u.share;
      saveDb();
      let n = 0;
      store.batch(items => {
        for (const it of items) {
          if (it.owner !== u.id) continue;
          if (banned && (it.status === 'live' || it.status === 'pending')) { it.status = 'hidden'; it.mod = { by: admin.id, at: t, action: 'ban', reason }; n++; }
          if (!banned && it.status === 'hidden' && it.mod?.action === 'ban') { it.status = 'live'; it.mod = { by: admin.id, at: t, action: 'unban', reason }; n++; }
        }
      });
      audit(req, banned ? 'shared.ban' : 'shared.unban', { user: admin, target: u, msg: reason || '' });
      json(res, 200, { banned, items: n });
    }
  };
}
