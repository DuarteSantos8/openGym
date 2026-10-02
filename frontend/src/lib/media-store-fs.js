/* The phone's backend for lib/media-store.js: plain files in the app's own folder.
 *
 *   Library/opengym-media/<hash>.<playExt>   one file per photo, GIF or video
 *   Library/opengym-media/index.json          { hash: { mime, size, putAt, shownAt, pending, rejected } }
 *
 * Directory.Library is iOS's Library folder (kept in device backups, never shown in Files) and
 * Android's files directory. Android's cloud backup is told to leave the folder out
 * (res/xml/backup_rules.xml): Auto Backup skips an app's WHOLE backup once it passes 25 MB, and
 * that would take the state mirror down with the videos.
 *
 * Files are shown by their file URL through the WebView's local server — no copy into memory,
 * and a long video can seek. That server types a file by its extension and will not hand a
 * .mov to <video> as something it plays, so a MOV is stored as .mp4 (MEDIA_MIMES playExt).
 *
 * Crash safety: a file is written to <name>.part and renamed once complete, and the index is
 * written after the files it lists (1 s debounce, flushed when the app goes to the background).
 * At start the two are reconciled: an index entry without its file is dropped, and a file
 * without an entry is checked against its name's sha256 and kept as pending — the upload is
 * idempotent, and the server's /missing answer decides whether it is needed at all.
 *
 * Big files cross the native bridge as base64 in 3 MB pieces (writeFile, then appendFile), never
 * as one 50 MB string.
 */
import { MEDIA_MIMES } from './media-refs.js'
import { sniffKind } from './media-sniff.js'
import { sha256Hex } from './sha256.js'

const DIR = 'opengym-media'
const INDEX = DIR + '/index.json'
const CHUNK = 3 * 1024 * 1024   // a multiple of 3, so no piece but the last has base64 padding
const FILE_RE = /^([0-9a-f]{64})\.(jpg|png|webp|gif|mp4|webm)$/

/** Uint8Array → base64, in slices small enough for String.fromCharCode's argument limit. */
export function toBase64(u8) {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(s)
}

const fileName = (hash, mime) => hash + '.' + (MEDIA_MIMES[mime]?.playExt || 'bin')

export function fsBackend({
  load = () => import('@capacitor/filesystem'),
  core = () => import('@capacitor/core'),
  app = () => import('@capacitor/app'),
  fetchImpl = (...a) => globalThis.fetch(...a),
  hash = sha256Hex,
  debounceMs = 1000
} = {}) {
  let FS = null, Directory = null, Encoding = null, convert = s => s
  let recs = {}
  let writeTm = null
  let writing = Promise.resolve()
  const uris = new Map()

  const opts = path => ({ path, directory: Directory.Library })
  const uriOf = async name => {
    if (uris.has(name)) return uris.get(name)
    const { uri } = await FS.getUri(opts(DIR + '/' + name))
    const u = convert(uri)
    uris.set(name, u)
    return u
  }
  const readFileBlob = async name => {
    const r = await fetchImpl(await uriOf(name))
    if (!r.ok) throw new Error('read ' + r.status)
    return r.blob()
  }
  const saveIndex = () => {
    writing = writing.then(() => FS.writeFile({ ...opts(INDEX), data: JSON.stringify(recs), encoding: Encoding.UTF8, recursive: true })).catch(() => {})
    return writing
  }
  const scheduleIndex = () => {
    clearTimeout(writeTm)
    writeTm = setTimeout(() => { writeTm = null; saveIndex() }, debounceMs)
  }
  const flush = () => { if (writeTm) { clearTimeout(writeTm); writeTm = null; return saveIndex() } return writing }

  return {
    name: 'fs',
    persistent: true,
    flush,
    async open() {
      try {
        const m = await load()
        FS = m.Filesystem; Directory = m.Directory; Encoding = m.Encoding
        try { const c = await core(); if (c?.Capacitor?.convertFileSrc) convert = u => c.Capacitor.convertFileSrc(u) } catch { /* the raw URI then */ }
      } catch { return false }
      try { await FS.mkdir({ ...opts(DIR), recursive: true }) } catch { /* already there */ }
      try {
        const r = await FS.readFile({ ...opts(INDEX), encoding: Encoding.UTF8 })
        const parsed = JSON.parse(r.data)
        recs = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      } catch { recs = {} }
      let names = []
      try {
        const r = await FS.readdir(opts(DIR))
        names = (r.files || []).map(f => (typeof f === 'string' ? f : f?.name)).filter(Boolean)
      } catch { names = [] }
      const present = new Set(names)
      let changed = false
      // Entries whose file is gone: the file was never renamed into place, or was deleted.
      for (const [h, r] of Object.entries(recs)) {
        if (!r || !MEDIA_MIMES[r.mime] || !present.has(fileName(h, r.mime))) { delete recs[h]; changed = true }
      }
      for (const name of names) {
        if (name.endsWith('.part')) { FS.deleteFile(opts(DIR + '/' + name)).catch(() => {}); continue }
        const m = FILE_RE.exec(name)
        if (!m || recs[m[1]]) continue
        // A file the index never got to list (the app died within the debounce). Its name is
        // its hash; one whose bytes do not match is half a write and goes.
        try {
          const blob = await readFileBlob(name)
          const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer())
          const sniffed = sniffKind(head)
          if ((await hash(blob)) !== m[1] || !sniffed || !MEDIA_MIMES[sniffed.mime]) throw new Error('mismatch')
          recs[m[1]] = { hash: m[1], mime: sniffed.mime, size: blob.size, putAt: Date.now(), shownAt: 0, pending: true, rejected: false }
          changed = true
        } catch {
          FS.deleteFile(opts(DIR + '/' + name)).catch(() => {})
        }
      }
      if (changed) await saveIndex()
      app().then(({ App }) => App.addListener('appStateChange', ({ isActive }) => { if (!isActive) flush() })).catch(() => {})
      return true
    },
    async all() { return Object.entries(recs).map(([h, r]) => ({ ...r, hash: h })) },
    async getBlob(h) {
      const r = recs[h]
      if (!r) return null
      try { return await readFileBlob(fileName(h, r.mime)) } catch { return null }
    },
    async put(rec, blob) {
      const name = fileName(rec.hash, rec.mime)
      const part = DIR + '/' + name + '.part'
      for (let o = 0; o < blob.size || o === 0; o += CHUNK) {
        const data = toBase64(new Uint8Array(await blob.slice(o, o + CHUNK).arrayBuffer()))
        if (o === 0) await FS.writeFile({ ...opts(part), data, recursive: true })
        else await FS.appendFile({ ...opts(part), data })
        if (!blob.size) break
      }
      try { await FS.deleteFile(opts(DIR + '/' + name)) } catch { /* not there, as expected */ }
      await FS.rename({ from: part, to: DIR + '/' + name, directory: Directory.Library, toDirectory: Directory.Library })
      uris.delete(name)
      recs[rec.hash] = { ...rec }
      scheduleIndex()
    },
    async patch(h, fields) {
      if (!recs[h]) return
      recs[h] = { ...recs[h], ...fields }
      scheduleIndex()
    },
    async remove(h) {
      const r = recs[h]
      if (!r) return
      delete recs[h]
      const name = fileName(h, r.mime)
      uris.delete(name)
      // The file first: a crash in between leaves an index entry without its file, which the
      // next start drops. The other order would leave a file without an entry, which that start
      // would take for an unlisted new one and keep.
      try { await FS.deleteFile(opts(DIR + '/' + name)) } catch { /* already gone */ }
      scheduleIndex()
    },
    async clear() {
      recs = {}
      uris.clear()
      clearTimeout(writeTm)
      writeTm = null
      await writing
      try { await FS.rmdir({ ...opts(DIR), recursive: true }) } catch { /* nothing there */ }
      try { await FS.mkdir({ ...opts(DIR), recursive: true }) } catch { /* the next put makes it */ }
    },
    async fileUrl(h) {
      const r = recs[h]
      return r ? uriOf(fileName(h, r.mime)) : null
    }
  }
}
