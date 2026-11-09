/* The shared library on disk (docs/dev/SHARED-LIBRARY-API.md, "Storage"):
 *
 *   DATA_DIR/shared/items.json      every item, written durably, a .bak copy of each save
 *   DATA_DIR/shared/media/          the files of shared items, <sha256>.<ext>, apart from uploads/
 *   DATA_DIR/shared/blocklist.json  hashes that are never shared, served or copied again
 *
 * Plus the hashes of every built-in catalogue file (catalogue-hashes.json, made by
 * scripts/catalogue/media-hashes.mjs from the bytes alone), which join the blocklist in memory:
 * the licensed exercise media can never be shared, not even as a 1:1 copy someone uploaded.
 *
 * A file the size of a few thousand items is read once and kept in memory; every write goes
 * through durable.js, so a host reset never leaves half a library. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../durable.js';
import { HASH_RE } from '../media.js';

const DAY = 86400000;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export const ITEM_ID_RE = /^s_[a-z2-7]{16}$/;
export const newItemId = () => 's_' + [...crypto.randomBytes(16)].map(x => B32[x & 31]).join('');
const FILE_RE = /^([0-9a-f]{64})\.(jpg|png|webp|gif|mp4|mov|webm|wav)$/;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CATALOGUE_HASHES_FILE = path.join(HERE, 'catalogue-hashes.json');

/** The catalogue's media hashes as a Set; an image without the file (an old build) has none. */
export function loadCatalogueHashes(file = CATALOGUE_HASHES_FILE) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set((Array.isArray(doc.hashes) ? doc.hashes : []).filter(h => typeof h === 'string' && HASH_RE.test(h)));
  } catch { return new Set(); }
}

export function createLibraryStore({ dir, now = Date.now, catalogue = loadCatalogueHashes(), log = console } = {}) {
  const itemsFile = path.join(dir, 'items.json');
  const blockFile = path.join(dir, 'blocklist.json');
  const mediaDir = path.join(dir, 'media');
  const ensure = p => { fs.mkdirSync(p, { recursive: true, mode: 0o700 }); try { fs.chmodSync(p, 0o700); } catch { /* host says no */ } };

  function readJson(file, empty) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return empty(); throw e; }
    try { return JSON.parse(raw); } catch (err) {
      // The same rule as db.json: a damaged file is kept aside and its last good copy used.
      try { fs.copyFileSync(file, `${file}.unreadable-${now()}`); } catch { /* best effort */ }
      log.error(`${path.basename(file)} cannot be read (${err.message}); trying the .bak copy`);
      try { return JSON.parse(fs.readFileSync(file + '.bak', 'utf8')); } catch { return empty(); }
    }
  }
  let doc = readJson(itemsFile, () => ({ v: 1, items: [] }));
  if (!Array.isArray(doc.items)) doc = { v: 1, items: [] };
  let block = readJson(blockFile, () => ({ v: 1, hashes: {} }));
  if (!block.hashes || typeof block.hashes !== 'object') block = { v: 1, hashes: {} };
  const byId = new Map(doc.items.map(i => [i.id, i]));

  function save() {
    ensure(dir);
    const text = JSON.stringify(doc);
    atomicWrite(itemsFile, text, 0o600);
    try { atomicWrite(itemsFile + '.bak', text, 0o600); } catch (e) { log.error('items.json.bak could not be written', e.message); }
  }
  function saveBlock() { ensure(dir); atomicWrite(blockFile, JSON.stringify(block), 0o600); }

  // The shared folder's files, from one readdir, kept current by every write.
  const files = new Map();   // hash -> { ext, size }
  try {
    for (const d of fs.readdirSync(mediaDir, { withFileTypes: true })) {
      const m = FILE_RE.exec(d.name);
      if (!m || !d.isFile()) continue;
      try { const size = fs.statSync(path.join(mediaDir, d.name)).size; if (size) files.set(m[1], { ext: m[2], size }); } catch { /* raced */ }
    }
  } catch { /* nothing shared yet */ }

  const pathOf = (hash, ext) => path.join(mediaDir, `${hash}.${ext}`);

  return {
    dir, mediaDir,
    all: () => doc.items,
    get: id => byId.get(id) || null,
    add(item) { doc.items.push(item); byId.set(item.id, item); save(); return item; },
    /** Applies `fn(item)` and saves. */
    update(id, fn) {
      const it = byId.get(id);
      if (!it) return null;
      fn(it);
      save();
      return it;
    },
    /** Many changes, one write. */
    batch(fn) { const r = fn(doc.items); save(); return r; },

    blocked: hash => catalogue.has(hash) || !!block.hashes[hash],
    fromCatalogue: hash => catalogue.has(hash),
    catalogueCount: () => catalogue.size,
    blockHashes(hashes, why) {
      let n = 0;
      for (const h of hashes) if (HASH_RE.test(h) && !block.hashes[h]) { block.hashes[h] = { at: now(), why: String(why || '').slice(0, 40) }; n++; }
      if (n) saveBlock();
      return n;
    },

    /** { path, ext, size } of a shared file, or null. */
    file(hash) {
      const f = files.get(hash);
      if (!f) return null;
      const p = pathOf(hash, f.ext);
      try { const st = fs.statSync(p); if (!st.size) return null; return { path: p, ext: f.ext, size: st.size }; }
      catch { files.delete(hash); return null; }
    },
    /** Copies a file from someone's uploads into the shared folder: a hard link when the two are
     *  on one filesystem (no extra bytes), a copy otherwise. Idempotent per hash. */
    put(hash, src, ext) {
      if (files.has(hash) && this.file(hash)) return;
      ensure(mediaDir);
      const dst = pathOf(hash, ext);
      const tmp = dst + '.tmp-' + process.pid;
      try { fs.unlinkSync(tmp); } catch { /* none */ }
      try { fs.linkSync(src, tmp); } catch { fs.copyFileSync(src, tmp); }
      fs.renameSync(tmp, dst);
      files.set(hash, { ext, size: fs.statSync(dst).size });
    },
    drop(hash) {
      const f = files.get(hash);
      if (!f) return false;
      files.delete(hash);
      try { fs.unlinkSync(pathOf(hash, f.ext)); } catch { /* gone */ }
      return true;
    },
    /** Bytes of the files a person's items name (removed ones excepted), each file once. */
    bytesOf(owner) {
      const seen = new Set();
      let n = 0;
      for (const it of doc.items) {
        if (it.owner !== owner || it.status === 'removed' || it.status === 'withdrawn') continue;
        for (const h of it.media || []) if (!seen.has(h)) { seen.add(h); n += files.get(h)?.size || 0; }
      }
      return n;
    },
    /** The shared folder's own GC: a file goes when no live, pending or hidden item names it, and
     *  no item withdrawn within the grace either (someone may share it again tomorrow). */
    sweep({ graceDays = 14 } = {}) {
      const keep = new Set();
      const cut = now() - graceDays * DAY;
      for (const it of doc.items) {
        const holds = it.status === 'live' || it.status === 'pending' || it.status === 'hidden' || (it.status === 'withdrawn' && (it.updatedAt || 0) >= cut);
        if (holds) for (const h of it.media || []) keep.add(h);
      }
      let removed = 0;
      for (const h of [...files.keys()]) if (!keep.has(h) && this.drop(h)) removed++;
      return { removed };
    }
  };
}
