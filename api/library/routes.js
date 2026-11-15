/* /api/shared: the community library of one server (docs/dev/SHARED-LIBRARY-API.md). Share an item
 * of your own after a per-item consent, browse what others shared, copy it into your own profile,
 * report what does not belong. Handed the session helpers by server.js like trainers/routes.js.
 * With LIBRARY off (the default) every route answers 404 { code: 'sharing-off' }; every decision
 * about who may see or change an item is permissions.js; every route spends an account budget.
 *
 * The idea of letting people hand custom exercises to everyone on their server, and the first
 * version of it, came from davoloko (PR #441); this is a new build of the wider library. */
import { currentConsent, consentCurrent, consentRecord } from '../consent.js';
import { originFor } from '../origin.js';
import { MediaError, HASH_RE } from '../media.js';
import { newItemId, ITEM_ID_RE } from './store.js';
import { LibraryError, cleanText, cleanLang, cleanPayload, refsOf, refObjects, searchTextOf } from './clean.js';
import { checkShareable } from './metadata.js';
import { PERSONAL_TYPES, TEXT } from './config.js';
import { moderationRoutes, autoHide, REPORT_REASONS } from './moderation.js';

const EXT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', wav: 'audio/wav' };
const KIND_OF = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'gif', 'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video', 'audio/wav': 'audio' };
const PAGE = 50;
const MB = 1024 * 1024;
// What one person's item may be shared as, beside the per-kind caps: sounds are sounds, a
// profile picture is one small still, and so on.
const KINDS_FOR = {
  sound: ['audio'], exercise: ['image', 'gif', 'video'], avatar: ['image'],
  photo: ['image', 'gif', 'video'], progress: ['image'], formvideo: ['video', 'image'],
};

export function libraryRoutes(deps) {
  const { json, readBody, readSession, isAdmin, audit, userById, perms, budgets, log, media, store, cfg, origin, sendFile, saveDb } = deps;
  const on = () => cfg.on;
  const fail = (res, e) => json(res, e.status, { error: e.message, code: e.code, ...(e.extra || {}) });
  const refuse = (res, r) => {
    const code = r.reason === 'off' ? 'sharing-off' : r.reason === 'not-found' ? 'not-found' : r.reason;
    return json(res, r.status, { error: code === 'banned' ? 'sharing is paused for your account on this server' : code === 'not-found' ? 'no such item' : 'not allowed', code });
  };
  const guard = (budget, fn) => async (req, res) => {
    if (!on()) return json(res, 404, { error: 'the community library is off on this server', code: 'sharing-off' });
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const wait = budgets.take(budget, user.id);
    if (wait) return json(res, 429, { error: 'slow down a little', code: 'rate-limited', retryAfter: wait }, { 'Retry-After': String(wait) });
    try { await fn(req, res, user); }
    catch (e) {
      if (e instanceof LibraryError) return fail(res, e);
      throw e;
    }
  };

  // The attribution block, read fresh: a renamed person shows their new name.
  const avatarOf = owner => store.all().find(i => i.owner === owner && i.type === 'avatar' && i.status === 'live')?.media?.[0] || null;
  function forClient(it, viewer, { full = false } = {}) {
    const owner = userById(it.owner);
    const mine = it.owner === viewer.id;
    const out = {
      id: it.id, type: it.type, gymId: it.gymId || null, title: it.title, desc: it.desc, lang: it.lang,
      media: it.status === 'removed' ? [] : it.media, version: it.version, rev: it.rev, status: it.status,
      createdAt: it.createdAt, updatedAt: it.updatedAt, consentId: it.consent?.id || null,
      stats: { imports: it.stats?.imports || 0 },
      by: { id: it.owner, name: owner?.name || '', avatar: owner ? avatarOf(it.owner) : null },
      at: it.createdAt,
      // `src`: which of the owner's own things this is (`sound:<id>`), so their app can show
      // "Shared" on it without a marker in the synced state. Only ever sent to the owner.
      ...(mine ? { mine: true, ...(it.src ? { src: it.src } : {}) } : {}),
      ...(mine && it.mod && (it.status === 'hidden' || it.status === 'removed' || it.status === 'pending') ? { mod: { action: it.mod.action, at: it.mod.at } } : {}),
    };
    if (it.status === 'removed') return out;
    if (full || it.type !== 'plan') out.payload = it.payload;
    else out.summary = planSummary(it.payload);
    return out;
  }
  function planSummary(p) {
    const b = p?.bundle || {};
    const routines = (Array.isArray(b.routines) ? b.routines : []).slice(0, 20).map(r => ({ name: String(r?.name || '').slice(0, 60), n: Array.isArray(r?.ex) ? r.ex.length : 0 }));
    const exIds = [];
    for (const r of Array.isArray(b.routines) ? b.routines : []) for (const e of Array.isArray(r?.ex) ? r.ex : []) if (typeof e?.id === 'string' && !exIds.includes(e.id) && exIds.length < 80) exIds.push(e.id);
    return { routines, programmes: Array.isArray(b.programmes) ? b.programmes.length : 0, days: b.week && typeof b.week === 'object' ? Object.keys(b.week).length : 0, exIds, customEx: Array.isArray(b.customEx) ? b.customEx.length : 0 };
  }

  const itemOr404 = (req, res, user, action) => {
    const it = store.get(req.itemId);
    if (!it) { json(res, 404, { error: 'no such item', code: 'not-found' }); return null; }
    const r = perms.can(user, action, { item: it });
    if (!r.ok) { refuse(res, r); return null; }
    if (it.status === 'removed' && action !== 'library:read') { json(res, 404, { error: 'no such item', code: 'not-found' }); return null; }
    return it;
  };

  /* Every file the payload names: in the owner's uploads, a type this item may carry, within the
     sharing caps, clean of metadata, not blocked. Returns the refs' hashes or answers itself. */
  function checkMedia(res, user, type, payload) {
    const refs = refObjects(payload);
    const missing = [];
    const files = [];
    for (const r of refs) {
      if (store.blocked(r.hash)) {
        throw new LibraryError(422, 'media-blocked', store.fromCatalogue(r.hash)
          ? 'that is part of the built-in exercise library, which is licensed and can never be shared'
          : 'that file cannot be shared on this server');
      }
      const f = media.file(user.id, r.hash);
      if (!f) { if (!missing.includes(r.hash)) missing.push(r.hash); continue; }
      const mime = EXT_MIME[f.ext];
      const kind = KIND_OF[mime];
      const sameFamily = r.mime === mime || (KIND_OF[r.mime] === 'video' && kind === 'video' && mime !== 'video/webm');
      if (!sameFamily) throw new LibraryError(422, 'media-type', 'that file is not what the item says it is');
      if (!r.poster && !(KINDS_FOR[type] || ['image', 'gif', 'video']).includes(kind)) throw new LibraryError(422, 'media-type', 'that kind of file does not go with this item');
      const capMB = type === 'avatar' ? cfg.avatarKB / 1024 : kind === 'video' ? cfg.videoMB : kind === 'gif' ? cfg.gifMB : kind === 'audio' ? cfg.soundMB : cfg.imageMB;
      if (f.size > capMB * MB) throw new LibraryError(413, 'media-too-large', 'that file is too big to share', { maxMB: capMB });
      checkShareable(f.path, mime, f.size, cfg);
      r.size = f.size;       // the stored file is the truth, whatever the device said
      files.push({ hash: r.hash, path: f.path, ext: f.ext, size: f.size });
    }
    if (missing.length) { json(res, 409, { error: 'upload these files first', code: 'media-missing', missing }); return null; }
    return files;
  }
  function quotaOk(user, files, except = null) {
    if (!cfg.quotaMB) return true;
    const have = new Set();
    for (const it of store.all()) if (it.owner === user.id && it.id !== except && (it.status !== 'removed' && it.status !== 'withdrawn')) for (const h of it.media || []) have.add(h);
    const extra = files.filter(f => !have.has(f.hash)).reduce((n, f) => n + f.size, 0);
    return store.bytesOf(user.id) + extra <= cfg.quotaMB * MB;
  }
  const startStatus = type => (PERSONAL_TYPES.includes(type) || cfg.review ? 'pending' : 'live');

  const routes = {
    'GET /api/shared': guard('library.list', async (req, res, user) => {
      const q = new URL(req.url, 'http://x').searchParams;
      const type = q.get('type') || '';
      const words = cleanText(q.get('q') || '', 80).toLowerCase().split(' ').filter(Boolean);
      const langs = (q.get('lang') || '').split(',').map(s => s.trim()).filter(s => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(s));
      const sort = q.get('sort') === 'popular' ? 'popular' : 'new';
      const mineOnly = q.get('mine') === '1';
      const gym = q.get('gym') || '';
      // Tips about one exercise: the exercise sheet's "Tips from your gym".
      const exId = q.get('ex') || '';
      const cursor = Math.max(0, parseInt(q.get('cursor') || '0', 10) || 0);
      let rows = store.all().filter(it => {
        if (type && it.type !== type) return false;
        if (exId && (it.type !== 'tip' || it.payload?.exId !== exId)) return false;
        if (!cfg.types.includes(it.type) && it.owner !== user.id) return false;
        if (mineOnly ? it.owner !== user.id : (it.status !== 'live' && it.owner !== user.id)) return false;
        if (it.status === 'removed' && it.owner !== user.id) return false;
        if (gym && (it.gymId || '') !== (gym === 'server' ? '' : gym)) return false;
        if (langs.length && it.owner !== user.id && !langs.some(l => (it.lang || 'en').split('-')[0] === l.split('-')[0])) return false;
        if (!perms.can(user, 'library:read', { item: it }).ok) return false;
        if (words.length) { const hay = searchTextOf(it); if (!words.every(w => hay.includes(w))) return false; }
        return true;
      });
      rows.sort(sort === 'popular'
        ? (a, b) => (b.stats?.imports || 0) - (a.stats?.imports || 0) || b.createdAt - a.createdAt
        : (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
      const page = rows.slice(cursor, cursor + PAGE);
      json(res, 200, { items: page.map(it => forClient(it, user)), next: cursor + PAGE < rows.length ? String(cursor + PAGE) : null, total: rows.length });
    }),

    'GET /api/shared/{id}': guard('library.list', async (req, res, user) => {
      const it = itemOr404(req, res, user, 'library:read'); if (!it) return;
      json(res, 200, { item: forClient(it, user, { full: true }) });
    }),

    'POST /api/shared': guard('library.publish', async (req, res, user) => {
      const body = await readBody(req);
      const gymId = typeof body.gymId === 'string' && body.gymId ? body.gymId : null;
      const r = perms.can(user, 'library:publish', { gymId });
      if (!r.ok) return refuse(res, r);
      const type = String(body.type || '');
      if (!cfg.types.includes(type)) return json(res, 400, { error: 'that kind of item is not shared on this server', code: 'type-off' });
      const c = body.consent;
      if (!c || typeof c !== 'object' || c.own !== true) return json(res, 400, { error: 'tick that it is yours to share', code: 'consent-own' });
      if (!consentCurrent('library', c)) return json(res, 409, { error: 'the consent text changed, please read it again', code: 'consent-outdated', consent: currentConsent('library') });
      const payload = cleanPayload(type, body.payload);
      const mine = store.all().filter(it => it.owner === user.id && it.type === type && (it.status === 'live' || it.status === 'pending' || it.status === 'hidden'));
      if (type !== 'avatar' && mine.length >= cfg.perType) return json(res, 409, { error: 'you shared the most this server takes of these', code: 'too-many', max: cfg.perType });
      const files = checkMedia(res, user, type, payload); if (!files) return;
      if (!quotaOk(user, files)) return json(res, 413, { error: 'your space for shared things is full', code: 'quota', quotaMB: cfg.quotaMB });
      for (const f of files) store.put(f.hash, f.path, f.ext);
      const t = Date.now();
      const id = newItemId();
      const title = cleanText(body.title, TEXT.title) || cleanText(payload.name || payload.ex?.n || payload.exName || '', TEXT.title) || 'Untitled';
      const item = {
        id, type, gymId, owner: user.id, src: typeof body.src === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(body.src) ? body.src : null, title, desc: cleanText(body.desc, TEXT.desc, { lines: true }), lang: cleanLang(body.lang),
        payload, media: refsOf(payload), version: 1, rev: 1, status: startStatus(type), createdAt: t, updatedAt: t,
        consent: consentRecord({ kind: 'library', memberId: user.id, subjectId: id, lang: body.lang, now: t }),
        stats: { imports: 0 }, importers: [], reports: [], mod: null
      };
      // One profile picture per person: a new one replaces the one shared before.
      if (type === 'avatar') store.batch(items => { for (const o of items) if (o.owner === user.id && o.type === 'avatar' && o.status !== 'removed' && o.status !== 'withdrawn') { o.status = 'withdrawn'; o.updatedAt = t; } });
      store.add(item);
      try { log.append(user.id, { ev: 'library.publish', msg: `${type}: ${title}` }); } catch { /* the log is a record, not a gate */ }
      audit(req, 'shared.publish', { user, msg: `${type} ${id}${item.status === 'pending' ? ' (review)' : ''}` });
      json(res, 201, { id, status: item.status, item: forClient(item, user, { full: true }) });
    }),

    // A new title, description or version. If-Match (or `rev` in the body) is the rev the editor saw.
    'PATCH /api/shared/{id}': guard('library.edit', async (req, res, user) => {
      const body = await readBody(req);
      const it = itemOr404(req, res, user, 'library:edit'); if (!it) return;
      if (it.status === 'withdrawn') return json(res, 409, { error: 'that is not shared any more', code: 'withdrawn' });
      const want = Number(req.headers['if-match'] ?? body.rev);
      if (want !== it.rev) return json(res, 412, { error: 'someone changed it in the meantime', code: 'rev-mismatch', rev: it.rev });
      let next = null, files = [];
      if (body.payload !== undefined) {
        next = cleanPayload(it.type, body.payload);
        files = checkMedia(res, user, it.type, next); if (!files) return;
        if (!quotaOk(user, files, it.id)) return json(res, 413, { error: 'your space for shared things is full', code: 'quota', quotaMB: cfg.quotaMB });
        for (const f of files) store.put(f.hash, f.path, f.ext);
      }
      const t = Date.now();
      store.update(it.id, x => {
        if (typeof body.title === 'string') x.title = cleanText(body.title, TEXT.title) || x.title;
        if (typeof body.desc === 'string') x.desc = cleanText(body.desc, TEXT.desc, { lines: true });
        if (typeof body.lang === 'string') x.lang = cleanLang(body.lang);
        if (next) {
          x.payload = next; x.media = refsOf(next); x.version++;
          // A new version on a reviewed server is looked at again; a hidden one stays hidden.
          if (x.status === 'live' && startStatus(x.type) === 'pending') x.status = 'pending';
        }
        x.rev++; x.updatedAt = t;
      });
      audit(req, 'shared.edit', { user, msg: `${it.id} v${it.version}` });
      json(res, 200, { rev: it.rev, version: it.version, status: it.status, item: forClient(it, user, { full: true }) });
    }),

    // Stop sharing. Copies people took stay theirs.
    'DELETE /api/shared/{id}': guard('library.edit', async (req, res, user) => {
      await readBody(req);
      const it = itemOr404(req, res, user, 'library:edit'); if (!it) return;
      if (it.status !== 'withdrawn') {
        store.update(it.id, x => { x.status = 'withdrawn'; x.updatedAt = Date.now(); x.rev++; });
        try { log.append(user.id, { ev: 'library.withdraw', msg: `${it.type}: ${it.title}` }); } catch { /* record only */ }
        audit(req, 'shared.withdraw', { user, msg: it.id });
      }
      json(res, 200, { status: 'withdrawn' });
    }),

    'POST /api/shared/{id}/import': guard('library.import', async (req, res, user) => {
      await readBody(req);
      const it = itemOr404(req, res, user, 'library:import'); if (!it) return;
      // A face or a body is there to be looked at, never taken home.
      if (it.type === 'avatar' || PERSONAL_TYPES.includes(it.type)) return json(res, 403, { error: 'this one is only to look at', code: 'not-importable' });
      // The files go into the importer's own folder, against their own quota: from then on the
      // copy is theirs, and stays when the original stops being shared.
      const copied = [];
      for (const h of it.media || []) {
        if (store.blocked(h)) continue;
        const f = store.file(h);
        if (!f) continue;
        try { media.adopt(user.id, h, f.path, f.ext); copied.push(h); }
        catch (e) { if (e instanceof MediaError) return json(res, e.status, { error: e.message, code: e.code, ...e.extra }); throw e; }
      }
      if (it.owner !== user.id && !(it.importers || []).includes(user.id)) {
        store.update(it.id, x => { x.importers = [...(x.importers || []), user.id]; x.stats = { imports: (x.stats?.imports || 0) + 1 }; });
      }
      const owner = userById(it.owner);
      json(res, 200, {
        payload: it.payload, media: copied, type: it.type, title: it.title,
        origin: originFor({ kind: 'library', id: it.id, version: it.version, by: owner?.name || '', server: origin }),
        item: forClient(it, user, { full: true })
      });
    }),

    // The bytes of a file a visible item names: the preview before an import.
    'GET /api/shared/media/{hash}': guard('library.list', async (req, res, user) => {
      const h = req.mediaHash;
      if (!HASH_RE.test(h) || store.blocked(h)) return json(res, 404, { error: 'no such file', code: 'media-missing' });
      const seen = store.all().some(it => (it.media || []).includes(h) && it.status !== 'removed' && perms.can(user, 'library:read', { item: it }).ok
        && (it.status === 'live' || it.owner === user.id || isAdmin(user)));
      const f = seen ? store.file(h) : null;
      if (!f) return json(res, 404, { error: 'no such file', code: 'media-missing' });
      await sendFile(res, { path: f.path, ext: f.ext, mime: EXT_MIME[f.ext] }, h);
    }),

    'POST /api/shared/{id}/report': guard('library.report', async (req, res, user) => {
      const body = await readBody(req);
      const it = itemOr404(req, res, user, 'library:read'); if (!it) return;
      if (it.owner === user.id) return json(res, 403, { error: 'that one is yours', code: 'own-item' });
      if (it.status === 'removed' || it.status === 'withdrawn') return json(res, 404, { error: 'no such item', code: 'not-found' });
      const reason = REPORT_REASONS.includes(body.reason) ? body.reason : null;
      if (!reason) return json(res, 400, { error: 'pick a reason', code: 'bad-reason', reasons: REPORT_REASONS });
      if ((it.reports || []).some(r => r.by === user.id)) return json(res, 409, { error: 'you reported this already', code: 'already-reported' });
      const note = cleanText(body.note, TEXT.note, { lines: true });
      let hidden = false;
      store.update(it.id, x => {
        x.reports = [...(x.reports || []), { by: user.id, reason, note, at: Date.now() }];
        hidden = autoHide(x, cfg);
      });
      audit(req, 'shared.report', { user, msg: `${it.id} ${reason}` });
      if (hidden) audit(req, 'shared.autohide', { user, msg: `${it.id} ${reason}` });
      deps.onReport?.(it, reason);
      json(res, 200, { ok: true, status: it.status });
    }),

    ...moderationRoutes({ ...deps, forClient, guard }),
  };

  /** Account deleted: everything they shared stops being shared, and they leave every list. What
   *  they wrote and the files they shared go now, not after the withdraw grace (that is there for
   *  someone who may share it again, and they will not). Copies people took stay theirs. */
  function removeUser(uid) {
    const theirs = new Set();
    store.batch(items => {
      for (const it of items) {
        if (it.owner === uid) {
          if (it.status !== 'removed' && it.status !== 'withdrawn') it.status = 'withdrawn';
          for (const h of it.media || []) theirs.add(h);
          it.ownerGone = true; it.updatedAt = Date.now();
          // The hashes stay (they say nothing about anyone): an admin can still remove a reported
          // item, which blocks those bytes and takes the importers' copies.
          it.payload = {}; it.title = ''; it.desc = ''; it.src = null;
        }
        if ((it.importers || []).includes(uid)) it.importers = it.importers.filter(x => x !== uid);
        if ((it.reports || []).some(r => r.by === uid)) it.reports = it.reports.map(r => (r.by === uid ? { ...r, by: null } : r));
      }
    });
    // A file someone else shared too (the same bytes) stays for their item.
    const held = new Set();
    for (const it of store.all()) if (it.owner !== uid && it.status !== 'removed') for (const h of it.media || []) held.add(h);
    for (const h of theirs) if (!held.has(h)) store.drop(h);
  }
  return { routes, removeUser, forClient };
}

export const LIBRARY_ID_RE = ITEM_ID_RE;
