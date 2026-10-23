// Shared by the build and the Android client. Never accept network-supplied manifests.
const HASH = /^[a-f0-9]{64}$/
const ID = /^\d{4,5}$/
const positive = n => Number.isSafeInteger(n) && n > 0

export function validateMediaBaseUrl(value, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error('slim media needs an approved HTTPS download source')
    return null
  }
  let url
  try { url = new URL(value) } catch { throw new Error('invalid media source') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /%2f|%5c|%2e/i.test(url.pathname))
    throw new Error('media source must be an HTTPS root without credentials, query or fragment')
  url.pathname = url.pathname.replace(/\/*$/, '/')
  return url.href
}

export function validateCatalogueManifest(value) {
  const bad = message => { throw new Error('invalid exercise media manifest: ' + message) }
  if (!value || value.schemaVersion !== 1) bad('unsupported schema')
  if (!['full', 'slim'].includes(value.mode)) bad('mode')
  if (!HASH.test(value.catalogueRevision || '') || !HASH.test(value.mediaRevision || '')) bad('revision')
  const base = validateMediaBaseUrl(value.baseUrl, { required: value.mode === 'slim' })
  if (value.baseUrl !== base) bad('source must be normalized')
  if (!Array.isArray(value.assets) || !value.assets.length) bad('assets')
  const ids = new Set(), drawings = new Set(), hashes = new Map()
  let previous = ''
  for (const a of value.assets) {
    if (!a || !ID.test(a.drawingId || '') || !['still', 'clip'].includes(a.kind) || !['webp', 'mp4'].includes(a.format)) bad('asset fields')
    if (a.kind === 'still' && a.format !== 'webp') bad('still format')
    if (!positive(a.width) || !positive(a.height) || !positive(a.bytes) || !HASH.test(a.sha256 || '')) bad('dimensions, size or digest')
    const id = `${a.drawingId}:${a.kind}:${a.width}x${a.height}:${a.format}`
    const drawing = a.drawingId + ':' + a.kind
    if (a.assetId !== id || ids.has(id) || drawings.has(drawing) || id < previous) bad('duplicate or unsorted identity')
    previous = id; ids.add(id); drawings.add(drawing)
    if (a.remotePath !== `objects/${a.sha256}.${a.format}`) bad('remote path')
    const expectedPath = `exercise-media/${a.kind}/${a.drawingId}.${a.format}`
    const bundled = a.kind === 'still' || value.mode === 'full'
    if (a.bundledPath !== (bundled ? expectedPath : null)) bad('bundled path/mode mismatch')
    const mapping = `${a.format}:${a.bytes}`
    if (hashes.has(a.sha256) && hashes.get(a.sha256) !== mapping) bad('conflicting digest mapping')
    hashes.set(a.sha256, mapping)
  }
  for (const key of drawings) {
    const [id, kind] = key.split(':')
    if (!drawings.has(id + ':' + (kind === 'still' ? 'clip' : 'still'))) bad('incomplete drawing')
  }
  return value
}

export function catalogueAssetUrl(manifest, asset) {
  const base = validateMediaBaseUrl(manifest.baseUrl)
  if (!base) return null
  if (asset.remotePath !== `objects/${asset.sha256}.${asset.format}` || !HASH.test(asset.sha256) || !['mp4', 'webp'].includes(asset.format))
    throw new Error('invalid media object path')
  return new URL(asset.remotePath, base).href
}
