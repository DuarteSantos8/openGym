import { describe, expect, it } from 'vitest'
import { CATALOGUE, EXIDX, drawingIdOf } from './exercises.js'
import { catalogueClipAsset, selectCatalogueAssets } from './catalogue-media-selection.js'

const both = CATALOGUE.find(ex => ex.fv)
const other = CATALOGUE.find(ex => ex.id !== both.id && !ex.fv && !ex.mv)
const asset = (drawingId, kind = 'clip') => ({ assetId: drawingId + ':' + kind, drawingId, kind })
const manifest = { assets: [asset(drawingIdOf(both, 'male')), asset(both.fv), asset(drawingIdOf(other, 'male')), asset(both.fv, 'still')] }
const select = (scope, state = {}, exerciseIds) => selectCatalogueAssets({ scope, state, exerciseIds, manifest })

describe('catalogue media selections', () => {
  it('snapshots every routine and active entry, deduplicating actual drawings', () => {
    const state = { routines: [{ ex: [{ id: both.id }, { id: 'missing' }] }, { ex: [{ id: both.id }] }], active: { entries: [{ id: other.id }] } }
    const before = structuredClone(state)
    expect(select('plan', state)).toEqual([drawingIdOf(both, 'male') + ':clip', drawingIdOf(other, 'male') + ':clip'].sort())
    expect(state).toEqual(before)
  })
  it('resolves aliases without writing back exercise IDs and honours explicit figure preference', () => {
    const alias = Object.getOwnPropertyNames(EXIDX).find(id => id !== both.id && EXIDX[id] === both)
    expect(alias).toBeTruthy()
    expect(select('exercise', { body: 'male', exFigure: 'female' }, [alias])).toEqual([both.fv + ':clip'])
  })
  it('selects favourites only and skips unknown/custom exercises', () => {
    expect(select('favourites', { favEx: [both.id, both.id, 'c-custom', 'unknown'], body: 'female' })).toEqual([both.fv + ':clip'])
    expect(catalogueClipAsset({ ...both, custom: true }, 'female', manifest)).toBeNull()
  })
  it('all means the chosen figure only, including unpaired drawings, and clips only', () => {
    const ids = select('all', { body: 'female' })
    expect(ids).toContain(both.fv + ':clip')
    expect(ids).toContain(drawingIdOf(other, 'female') + ':clip')
    expect(ids).not.toContain(drawingIdOf(both, 'male') + ':clip')
    expect(ids.every(id => id.endsWith(':clip'))).toBe(true)
    expect(select('favourites')).toEqual([])
    expect(select('unknown')).toEqual([])
  })
})
