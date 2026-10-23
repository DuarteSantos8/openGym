import { describe, expect, it } from 'vitest'
import { buildPacks, drawingsFor, packManifest } from '../../../scripts/media/make-pack-manifests.mjs'
import { EXDB } from './exercises-data.js'
import { PACK_QUALITIES, packId, packDrawingId, clipSources } from './anim-quality.js'
import { gifSrc } from './exercises.js'

/* The asset packs scripts/media/make-pack-manifests.mjs writes, from the catalogue's names alone:
   every exercise the app shows resolves inside its figure's pack, at every quality. */
const { packs, summary } = buildPacks(EXDB)
const byId = Object.fromEntries(packs.map(p => [p.id, p]))

describe('the packs', () => {
  it('one per quality and figure', () => {
    expect(packs.map(p => p.id).sort()).toEqual(PACK_QUALITIES.flatMap(px => [packId(px, 'female'), packId(px, 'male')]).sort())
    expect(Object.keys(summary.packs)).toHaveLength(10)
  })
  it('every catalogue exercise is in its figure’s pack, at every quality', () => {
    for (const px of PACK_QUALITIES) {
      for (const figure of ['male', 'female']) {
        const ids = new Set(byId[packId(px, figure)].ids)
        for (const ex of EXDB) expect(ids.has(packDrawingId(ex, figure)), `${ex.id} ${figure} ${px}`).toBe(true)
      }
    }
  })
  it('exercises drawn once are in both packs; a twin only in its own figure’s', () => {
    const male = new Set(drawingsFor(EXDB, 'male')), female = new Set(drawingsFor(EXDB, 'female'))
    let once = 0, twins = 0
    for (const ex of EXDB) {
      if (!ex.fv && !ex.mv) { once++; expect(male.has(ex.id) && female.has(ex.id), ex.id).toBe(true) }
      if (ex.fv) { twins++; expect(female.has(ex.fv)).toBe(true); expect(male.has(ex.fv), ex.fv + ' is a female drawing').toBe(false) }
    }
    expect(once).toBeGreaterThan(4000)
    expect(twins).toBeGreaterThan(900)
    expect(summary.sharedPerQuality).toBe([...male].filter(id => female.has(id)).length)
  })
  it('the app’s path into an installed pack is the manifest’s destination for that drawing', () => {
    const p = byId['anim-720-female']
    const dest = new Set(p.manifest.fileSelectors.map(s => s.fileDestination))
    const base = 'http://localhost/_capacitor_file_/x'
    for (const ex of EXDB.slice(0, 500)) {
      const src = clipSources({ ex, figure: 'female', choice: 720, installed: { [p.id]: base + '/anim-720-female' }, builtin: gifSrc(ex, 'female') }).sources[0]
      expect(dest.has(src.slice(base.length + 1)), ex.id).toBe(true)
    }
  })
})

describe('the manifest', () => {
  it('is what ba-package takes: no userInfo, on demand, iOS, sources per quality', () => {
    const m = packManifest(720, 'male', ['0001', '0002'])
    expect(m).toEqual({
      assetPackID: 'anim-720-male',
      downloadPolicy: { onDemand: {} },
      fileSelectors: [
        { fileSource: '720/0001.webp', fileDestination: 'anim-720-male/0001.webp' },
        { fileSource: '720/0002.webp', fileDestination: 'anim-720-male/0002.webp' },
      ],
      platforms: ['iOS'],
    })
    expect(packManifest(720, 'male', ['0001'], 'clip').fileSelectors[0].fileDestination).toBe('clip/0001.webp')
  })
  it('lists each file once per pack, and names files only by drawing id', () => {
    for (const p of packs) {
      expect(new Set(p.ids).size).toBe(p.ids.length)
      expect(p.ids.every(id => /^\d{4,5}$/.test(id)), p.id).toBe(true)
      expect(p.manifest.fileSelectors).toHaveLength(p.ids.length)
    }
  })
})
