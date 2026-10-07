/* Backups that carry the photos and videos of custom exercises and of logged workouts.
 *
 * "Export backup (JSON)" stays what it always was: the state, with each exercise's small
 * reference to its file and never the file. "Export with photos & videos" writes a store-only zip
 * (lib/zip.js) instead:
 *
 *   opengym-backup.json      the very same JSON
 *   media/<sha256>.<ext>     every photo, GIF, video and poster the state refers to
 *   README.txt               what this is and how to bring it back
 *
 * "Import backup" takes either. From a zip, only files the backup's state refers to are taken,
 * and each one only after its type, its size cap and its sha256 agree with its name; they go into
 * the local store as pending, and the usual sync sends them to the server once the imported state
 * is pushed. A file that fails a check is skipped, and its exercise shows the fallback tile until
 * someone adds the picture again.
 *
 * A backup file is someone else's data as much as a plan file is: the imported state's media refs
 * and links go through the same gates as everywhere else (sanitizeCustomMedia).
 */
import { zipStore, readZip, looksLikeZip } from './zip.js'
import { referencedFiles, normalizeMediaRef, workoutMediaOf, cleanUrl, MEDIA_MIMES } from './media-refs.js'
import { sniffKind } from './media-sniff.js'
import { sha256Hex } from './sha256.js'
import { mediaStore } from './media-store.js'
import { DEFAULT_LIMITS, MB } from './media-limits.js'
import { t } from './i18n-core.js'

export const BACKUP_JSON = 'opengym-backup.json'
const MEDIA_ENTRY = /^media\/([0-9a-f]{64})\.(jpg|png|webp|gif|mp4|mov|webm)$/

const README = `openGym backup with photos and videos
=====================================

opengym-backup.json  your data - the same file "Export backup (JSON)" writes.
media/               the photos, GIFs and videos of your own exercises and of your
                     workouts, each named by its SHA-256, plus the small previews
                     shown in lists.

To bring it back: openGym -> Settings -> Data & backup -> Import backup, and pick this .zip as it is.
Do not unpack and re-zip it: the app reads zips that are stored, not compressed.
`

/** The media refs and links of an imported state — each custom exercise's picture and link, each
 *  logged workout's photos and videos — kept only where they pass the same checks as anywhere
 *  else (a workout's list also deduplicated, but not capped: workoutMediaOf caps what shows);
 *  the rest of the state is left as it is. Mutates and returns it. */
export function sanitizeCustomMedia(state) {
  for (const c of Array.isArray(state?.customEx) ? state.customEx : []) {
    if (!c || typeof c !== 'object') continue
    if ('media' in c) { const m = normalizeMediaRef(c.media); if (m) c.media = m; else delete c.media }
    if ('url' in c) { const u = cleanUrl(c.url); if (u) c.url = u; else delete c.url }
  }
  for (const w of Array.isArray(state?.workouts) ? state.workouts : []) {
    if (!w || typeof w !== 'object' || !('media' in w)) continue
    // Every ref that passes, not only the ones shown: a file with more than the cap keeps them
    // all, and the workout shows the first WORKOUT_MEDIA_MAX as it would anywhere else.
    const list = workoutMediaOf(w, Infinity)
    if (list.length) w.media = list; else delete w.media
  }
  return state
}

/**
 * The zip for "Export with photos & videos": { blob, included, missing }. Each file comes from the
 * local store, or — signed in — is fetched into it first (`fetchOne`, lib/media-sync.js
 * fetchToStore). `missing` counts those that could not be had; the export goes ahead without them.
 */
export async function exportBackupZip(S, { media = mediaStore, fetchOne = null, now } = {}) {
  const entries = [{ name: BACKUP_JSON, blob: new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }) }]
  let missing = 0
  for (const f of referencedFiles(S)) {
    let rec = await media.get(f.hash)
    if (!rec && fetchOne) {
      try { await fetchOne(f.hash, f); rec = await media.get(f.hash) } catch { /* counted below */ }
    }
    if (!rec || !MEDIA_MIMES[rec.mime]) { missing++; continue }
    entries.push({ name: `media/${f.hash}.${MEDIA_MIMES[rec.mime].ext}`, blob: rec.blob })
  }
  entries.push({ name: 'README.txt', blob: new Blob([README], { type: 'text/plain' }) })
  const blob = await zipStore(entries, now ? { now } : undefined)
  return { blob, included: entries.length - 2, missing }
}

const isBackup = d => !!d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.workouts) && Array.isArray(d.routines)

const notBackup = () => Object.assign(new Error('not an openGym backup'), { code: 'not-backup' })

/**
 * What to tell someone whose pick did not import, in their language. The thrown messages are for
 * a developer ('not-zip', a JSON.parse complaint) and used to be toasted as they were.
 */
export function backupImportError(e) {
  if (e?.code === 'compressed') return t('That zip was repacked. Import the original backup file.')
  if (e?.code === 'not-backup' || e?.code === 'not-zip' || e?.code === 'encrypted' || e instanceof SyntaxError) return t('That file isn’t an openGym backup.')
  return t('Couldn’t read that file.')
}

/**
 * Reads a picked backup, .json or .zip (told apart by its first bytes, not its name):
 * { state, files: [{ hash, entry }], zip }. `files` are the zip's media entries the state refers
 * to, not yet checked or stored — storeBackupMedia does that, once the import is confirmed.
 * Throws on anything that is not an openGym backup.
 */
export async function readBackupFile(file) {
  let state, files = []
  const zip = await looksLikeZip(file)
  if (zip) {
    const entries = await readZip(file)
    const json = entries.find(e => e.name === BACKUP_JSON)
    if (!json) throw notBackup()
    state = JSON.parse(await json.blob.text())
    if (!isBackup(state)) throw notBackup()
    const wanted = new Set(referencedFiles(state).map(f => f.hash))
    const seen = new Set()
    for (const e of entries) {
      const m = MEDIA_ENTRY.exec(e.name)
      if (!m || !wanted.has(m[1]) || seen.has(m[1])) continue
      seen.add(m[1])
      files.push({ hash: m[1], entry: e })
    }
  } else {
    state = JSON.parse(await file.text())
    if (!isBackup(state)) throw notBackup()
  }
  return { state: sanitizeCustomMedia(state), files, zip }
}

/**
 * Checks and keeps a backup's media files: each must sniff as a stored type, stay under that
 * kind's cap, and hash to its name. Kept as pending — the server has not seen them from this
 * device. Resolves { stored, skipped }.
 */
export async function storeBackupMedia(files, { media = mediaStore, limits = DEFAULT_LIMITS } = {}) {
  let stored = 0, skipped = 0
  const cap = { image: limits.imageMB, gif: limits.gifMB, video: limits.videoMB }
  for (const { hash, entry } of files) {
    try {
      const head = new Uint8Array(await entry.blob.slice(0, 64).arrayBuffer())
      const s = sniffKind(head)
      if (!s || !MEDIA_MIMES[s.mime] || entry.size > (cap[s.kind] || 0) * MB) throw new Error('refused')
      const bytes = new Uint8Array(await entry.blob.arrayBuffer())
      if ((await sha256Hex(bytes)) !== hash) throw new Error('tampered')
      await media.put(hash, new Blob([bytes], { type: s.mime }), { mime: s.mime, pending: true })
      stored++
    } catch { skipped++ }
  }
  return { stored, skipped }
}
