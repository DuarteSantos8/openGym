#!/usr/bin/env node
// Describes actual inputs; it does not publish them or grant distribution permission.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { validateCatalogueManifest, validateMediaBaseUrl } from '../../frontend/src/lib/catalogue-media-manifest.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const stable = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)

export function mediaDimensions(b, format) {
  if (format === 'webp') {
    if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP' || b.readUInt32LE(4) + 8 !== b.length) return null
    const chunk = b.toString('ascii', 12, 16)
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 } }
    if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 }
    return null
  }
  if (format !== 'mp4' || b.length < 12 || b.toString('ascii', 4, 8) !== 'ftyp') return null
  let best = null
  // Walk container boundaries; do not mistake the byte string 'tkhd' in a payload for a track.
  const boxes = (start, end, depth = 0) => {
    if (depth > 8) return
    for (let i = start; i + 8 <= end;) {
      let length = b.readUInt32BE(i), header = 8
      const type = b.toString('ascii', i + 4, i + 8)
      if (length === 1) { if (i + 16 > end) return; const n = b.readBigUInt64BE(i + 8); if (n > BigInt(Number.MAX_SAFE_INTEGER)) return; length = Number(n); header = 16 }
      if (length === 0) length = end - i
      if (length < header || i + length > end) return
      if (type === 'tkhd') {
        const at = i + header, version = b[at], needed = version === 1 ? 96 : version === 0 ? 84 : 0
        if (needed && at + needed <= i + length) {
          const width = b.readUInt32BE(at + needed - 8) / 65536, height = b.readUInt32BE(at + needed - 4) / 65536
          if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && (!best || width * height > best.width * best.height)) best = { width, height }
        }
      } else if (['moov', 'trak', 'mdia'].includes(type)) boxes(i + header, i + length, depth + 1)
      i += length
    }
  }
  boxes(0, b.length)
  return best
}

export function readCatalogue(directory = path.join(ROOT, 'catalogue/exercises')) {
  return fs.readdirSync(directory).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(directory, f), 'utf8')))
}

export function buildMediaManifest({ stillDir = path.join(ROOT, 'catalogue/media/still'), clipDir = process.env.APP_MEDIA_DIR || path.join(ROOT, 'catalogue/media/clip'), catalogue = readCatalogue(), mode = process.env.APP_MEDIA_MODE || 'full', baseUrl = process.env.APP_MEDIA_BASE_URL || null, clipFormat = process.env.VITE_CLIP_EXT === 'webp' ? 'webp' : 'mp4' } = {}) {
  if (!['full', 'slim'].includes(mode)) throw new Error('APP_MEDIA_MODE must be full or slim')
  baseUrl = validateMediaBaseUrl(baseUrl, { required: mode === 'slim' })
  if (!['webp', 'mp4'].includes(clipFormat)) throw new Error('invalid clip format')
  const expected = new Set()
  const catalogueIds = new Set()
  for (const ex of catalogue) {
    if (!/^\d{4,5}$/.test(ex.id || '')) throw new Error('invalid catalogue drawing ID')
    if (catalogueIds.has(ex.id)) throw new Error('duplicate catalogue drawing ID: ' + ex.id)
    catalogueIds.add(ex.id)
    expected.add(ex.id)
    for (const id of [ex.femaleVariant, ex.maleVariant]) {
      if (!id) continue
      if (!/^\d{4,5}$/.test(id)) throw new Error('invalid catalogue variant ID')
      expected.add(id)
    }
  }
  const assets = []
  for (const [kind, dir, format] of [['still', stillDir, 'webp'], ['clip', clipDir, clipFormat]]) {
    const entries = fs.readdirSync(dir).filter(f => f.endsWith('.' + format)).sort()
    const found = new Set()
    for (const name of entries) {
      const m = /^(\d{4,5})\.(webp|mp4)$/.exec(name)
      if (!m || !expected.has(m[1])) throw new Error(`unexpected ${kind} file: ${name}`)
      if (fs.lstatSync(path.join(dir, name)).isSymbolicLink()) throw new Error(`symlink media input: ${name}`)
      const b = fs.readFileSync(path.join(dir, name)), size = mediaDimensions(b, format)
      if (!size || !size.width || !size.height) throw new Error(`invalid ${format} media: ${name}`)
      const sha256 = hash(b), drawingId = m[1]
      found.add(drawingId)
      assets.push({ assetId: `${drawingId}:${kind}:${size.width}x${size.height}:${format}`, drawingId, kind, format, ...size,
        bytes: b.length, sha256, remotePath: `objects/${sha256}.${format}`, bundledPath: kind === 'still' || mode === 'full' ? `exercise-media/${kind}/${name}` : null })
    }
    for (const id of expected) if (!found.has(id)) throw new Error(`missing ${kind} drawing: ${id}`)
  }
  assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0)
  return validateCatalogueManifest({ schemaVersion: 1, mode, baseUrl, catalogueRevision: hash(stable([...catalogue].sort((a, b) => a.id < b.id ? -1 : 1))),
    mediaRevision: hash(stable(assets.map(({ bundledPath, ...a }) => a))), assets })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = buildMediaManifest()
    if (!process.argv[2]) throw new Error('usage: build-media-manifest.mjs <manifest output>')
    fs.mkdirSync(path.dirname(path.resolve(process.argv[2])), { recursive: true })
    fs.writeFileSync(process.argv[2], JSON.stringify(manifest) + '\n')
    console.log(`media manifest: ${manifest.assets.length} assets, ${manifest.mode}`)
  } catch (err) {
    let message = err.message
    if (process.env.APP_MEDIA_DIR) message = message.split(process.env.APP_MEDIA_DIR).join('[private media input]')
    console.error(message); process.exitCode = 1
  }
}
