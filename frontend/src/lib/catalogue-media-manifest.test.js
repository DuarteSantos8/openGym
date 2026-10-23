import { describe, expect, it } from 'vitest'
import { catalogueAssetUrl, validateCatalogueManifest, validateMediaBaseUrl } from './catalogue-media-manifest.js'

const H = 'a'.repeat(64)
const fixture = () => ({ schemaVersion: 1, mode: 'slim', baseUrl: 'https://media.example/', catalogueRevision: H, mediaRevision: H,
  assets: ['clip', 'still'].map(kind => ({ assetId: `0001:${kind}:180x180:webp`, drawingId: '0001', kind, format: 'webp', width: 180, height: 180, bytes: 30,
    sha256: H, remotePath: `objects/${H}.webp`, bundledPath: kind === 'still' ? 'exercise-media/still/0001.webp' : null })) })

describe('packaged catalogue media manifest', () => {
  it('retains leading-zero identities and resolves a content-addressed URL', () => {
    const m = fixture(); expect(validateCatalogueManifest(m)).toBe(m)
    expect(catalogueAssetUrl(m, m.assets[0])).toBe(`https://media.example/objects/${H}.webp`)
  })
  it('rejects schema, duplicate drawing/kind, unsorted IDs and conflicting hashes', () => {
    const m = fixture(); m.schemaVersion = 2; expect(() => validateCatalogueManifest(m)).toThrow('schema')
    const dupe = fixture(); dupe.assets.push(dupe.assets[0]); expect(() => validateCatalogueManifest(dupe)).toThrow('duplicate')
    const sort = fixture(); sort.assets.reverse(); expect(() => validateCatalogueManifest(sort)).toThrow('unsorted')
    const conflict = fixture(); conflict.assets[1].bytes = 31; expect(() => validateCatalogueManifest(conflict)).toThrow('digest mapping')
  })
  it('rejects path traversal, absolute paths, wrong extension, size, missing counterpart and bundled mismatch', () => {
    for (const remotePath of ['../secret', '/objects/a.webp', 'https://other/a.webp', `objects/${H}.mp4`]) {
      const m = fixture(); m.assets[0].remotePath = remotePath; expect(() => validateCatalogueManifest(m)).toThrow('path')
    }
    const m = fixture(); m.assets[0].bytes = -1; expect(() => validateCatalogueManifest(m)).toThrow('size')
    const missing = fixture(); missing.assets.pop(); expect(() => validateCatalogueManifest(missing)).toThrow('incomplete')
    const bundled = fixture(); bundled.assets[1].bundledPath = '../still.webp'; expect(() => validateCatalogueManifest(bundled)).toThrow('bundled')
  })
  it('accepts no remote source in a full package and rejects credentials or non-HTTPS sources', () => {
    const m = fixture(); m.mode = 'full'; m.baseUrl = null; m.assets[0].bundledPath = 'exercise-media/clip/0001.webp'
    expect(validateCatalogueManifest(m)).toBe(m); expect(catalogueAssetUrl(m, m.assets[0])).toBeNull()
    for (const url of ['http://media.example/', 'https://u:p@media.example/', 'https://media.example/?token=x', 'https://media.example/%2fprivate'])
      expect(() => validateMediaBaseUrl(url)).toThrow()
  })
})
