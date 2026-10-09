// The instance catalogue is separate from private profile documents. Only the routes
// guarded by requireAdmin write it; published media is copied out of the owner's uploads
// so private-media garbage collection cannot remove another person's exercise picture.
import fs from 'node:fs';
import path from 'node:path';
import { MediaError, HASH_RE } from './media.js';

const MIME_KIND = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'image/gif': 'gif', 'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video' };
const bad = message => { throw new MediaError(400, 'bad-request', { error: message }); };
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const list = v => [...new Set((Array.isArray(v) ? v : []).filter(x => typeof x === 'string')
  .map(x => text(x, 80)).filter(Boolean))].slice(0, 64);
const refs = e => e?.media ? [e.media, ...(e.media.poster ? [e.media.poster] : [])] : [];

export function createSharedExercises({ data, media, atomicWrite }) {
  const file = path.join(data, 'shared-exercises.json');
  const folder = path.join(data, 'shared-exercise-media');
  let rows = [];
  let revision = 0;
  // A missing catalogue is the normal first boot. A corrupt one must not be silently
  // replaced with an empty catalogue by the next save.
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(saved.exercises)) throw new Error('invalid shared exercise catalogue');
    rows = saved.exercises;
    revision = Math.max(saved.revision || 0, ...rows.map(row => row.serverRevision || 0));
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid catalogue revision');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let files = new Map();
  const reindex = () => {
    files = new Map();
    for (const row of rows) for (const ref of refs(row)) {
      if (HASH_RE.test(ref.hash || '')) files.set(ref.hash, ref);
    }
  };
  reindex();
  const commit = next => {
    atomicWrite(file, JSON.stringify({ exercises: next, revision: revision + 1 }, null, 2));
    rows = next;
    revision += 1;
    reindex();
  };
  const sharedFile = hash => {
    const ref = files.get(hash);
    if (!ref || !/^[a-z0-9]+$/.test(ref.ext || '')) return null;
    const filename = path.join(folder, `${hash}.${ref.ext}`);
    try {
      const stat = fs.statSync(filename);
      return stat.isFile() ? { path: filename, mime: ref.mime, ext: ref.ext, size: stat.size } : null;
    } catch { return null; }
  };
  function cleanMedia(raw, uid, poster = false) {
    if (!raw || typeof raw !== 'object' || !HASH_RE.test(raw.hash || '')) bad('Invalid exercise media');
    const source = media?.file(uid, raw.hash) || sharedFile(raw.hash);
    if (!source) bad('Upload the exercise media before sharing it');
    const kind = MIME_KIND[source.mime];
    if (!kind || (poster && !['image/jpeg', 'image/webp'].includes(source.mime))) bad('Invalid exercise media type');
    for (const key of ['width', 'height']) {
      if (!Number.isInteger(raw[key]) || raw[key] < 1 || raw[key] > 16384) bad('Invalid exercise media dimensions');
    }
    const ref = { hash: raw.hash, mime: source.mime, size: source.size, width: raw.width, height: raw.height, ext: source.ext };
    if (!poster) {
      ref.kind = kind;
      if (Number.isFinite(raw.dur) && raw.dur >= 0 && raw.dur <= 3600) ref.dur = raw.dur;
      if (typeof raw.codec === 'string') ref.codec = text(raw.codec, 16);
      if (Number.isFinite(raw.at)) ref.at = raw.at;
      if (raw.poster) ref.poster = cleanMedia(raw.poster, uid, true);
    }
    fs.mkdirSync(folder, { recursive: true });
    const destination = path.join(folder, `${ref.hash}.${ref.ext}`);
    if (source.path !== destination) {
      const temporary = destination + '.tmp';
      fs.copyFileSync(source.path, temporary);
      fs.renameSync(temporary, destination);
    }
    return ref;
  }
  return {
    list: () => rows,
    file: sharedFile,
    put(raw, admin, baseRevision) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('Exercise required');
      if (typeof raw.id !== 'string' || !/^(?:c[a-zA-Z0-9_-]{1,95}|im[a-zA-Z0-9_-]{1,94})$/.test(raw.id)) bad('Invalid custom exercise id');
      const previous = rows.find(e => e.id === raw.id);
      if (previous && previous.serverRevision !== baseRevision) {
        throw new MediaError(409, 'shared-exercise-conflict', { error: 'This exercise changed. Reopen it before saving.' });
      }
      if (!previous && baseRevision != null) {
        throw new MediaError(409, 'shared-exercise-conflict', { error: 'This exercise was withdrawn. Reopen it before saving.' });
      }
      if (!previous && rows.length >= 1000) bad('The server catalogue is full');
      const n = text(raw.n, 200), bp = text(raw.bp, 80), eq = text(raw.eq, 80);
      if (!n || !bp || !eq) bad('Name, body part and equipment are required');
      if (rows.some(e => e.id !== raw.id && e.n.toLocaleLowerCase() === n.toLocaleLowerCase())) {
        throw new MediaError(409, 'shared-exercise-duplicate', { error: 'An exercise with this name is already shared.' });
      }
      const row = { id: raw.id, n, bp, eq, desc: text(raw.desc, 1000), tg: text(raw.tg, 80),
        primaries: list(raw.primaries), secondaries: list(raw.secondaries), muscleGroups: list(raw.muscleGroups),
        sm: list(raw.sm), custom: true, serverShared: true,
        publisherId: previous?.publisherId || admin.id, serverRevision: revision + 1,
        _ts: Date.now() };
      for (const key of ['bodyweight', 'loaded', 'assisted']) if (typeof raw[key] === 'boolean') row[key] = raw[key];
      if (raw.url) {
        let url;
        try { url = new URL(raw.url); } catch { bad('Invalid exercise link'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) bad('Invalid exercise link');
        row.url = url.href;
      }
      if (raw.media) row.media = cleanMedia(raw.media, admin.id);
      commit([...rows.filter(e => e.id !== row.id), row]);
      return row;
    },
    remove(id, baseRevision) {
      if (typeof id !== 'string' || !/^(?:c[a-zA-Z0-9_-]{1,95}|im[a-zA-Z0-9_-]{1,94})$/.test(id)) bad('Invalid custom exercise id');
      const row = rows.find(e => e.id === id);
      if (row && row.serverRevision !== baseRevision) {
        throw new MediaError(409, 'shared-exercise-conflict', { error: 'This exercise changed. Reopen it before saving.' });
      }
      if (row) commit(rows.filter(e => e.id !== id));
    }
  };
}
