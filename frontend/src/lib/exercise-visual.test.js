import { describe, it, expect } from 'vitest'
import { catalogueTwin } from './exercise-visual.js'
import { EXIDX } from './exercises.js'

describe('catalogueTwin', () => {
  it('finds the catalogue drawing of a custom exercise named like a catalogue one', () => {
    const twin = catalogueTwin({ id: 'c1', n: '3/4 Sit-up', custom: true })
    expect(twin).toBe(EXIDX['0001'])
    expect(twin.img).toBeTruthy()
  })
  it('reads a Hevy title (equipment in brackets) the way the import does', () => {
    const twin = catalogueTwin({ id: 'c2', n: 'Bench Press (Barbell)', custom: true })
    expect(twin?.img).toBeTruthy()
  })
  it('leaves a name the catalogue does not know without a picture', () => {
    expect(catalogueTwin({ id: 'c3', n: 'Zzqx Flurb Machine Thing', custom: true })).toBeNull()
  })
  it('never replaces an exercise that has its own photo, video or link', () => {
    expect(catalogueTwin({ id: 'c4', n: '3/4 Sit-up', custom: true, media: { kind: 'image', hash: 'a'.repeat(64), mime: 'image/webp', size: 10, width: 100, height: 100 } })).toBeNull()
    expect(catalogueTwin({ id: 'c5', n: '3/4 Sit-up', custom: true, url: 'https://example.com/clip' })).toBeNull()
  })
  it('is null for nothing', () => {
    expect(catalogueTwin(null)).toBeNull()
    expect(catalogueTwin({ id: 'c6' })).toBeNull()
  })
})

// The names a French Hevy export carries ("Développé couché (Barre)") against the catalogue's own
// French names, which spell the same lift another way.
describe('names in the language of the app', () => {
  it('folds accents, little words and plurals', async () => {
    const { foldedWords } = await import('./exercise-visual.js')
    expect(foldedWords('Développé couché (Barre)')).toEqual(['developpe', 'couche', 'barre'])
    expect(foldedWords('Élévations latérales aux haltères')).toEqual(['elevation', 'laterale', 'haltere'])
    expect(foldedWords('')).toEqual([])
  })

  it('finds the catalogue lift a French title means, any word order', async () => {
    const { matchInPack } = await import('./exercise-visual.js')
    const fr = (await import('../exercise-names/fr.js')).default
    expect(matchInPack('Développé couché (Barre)', fr)).toBe('0025')
    expect(matchInPack('Développé couché (Haltère)', fr)).toBe('0289')
    expect(matchInPack('Barre développé couché', fr)).toBe('0025')
    expect(matchInPack('Soulevé de terre (Barre)', fr)).toBe('0032')
    expect(matchInPack('Squat (Barre)', fr)).toBe('3593')
  })

  it('never guesses: a name nothing in the pack means gives null, so does an empty pack', async () => {
    const { matchInPack } = await import('./exercise-visual.js')
    const fr = (await import('../exercise-names/fr.js')).default
    expect(matchInPack('Zzqx flurb truc', fr)).toBeNull()
    expect(matchInPack('Développé couché (Barre)', null)).toBeNull()
    expect(matchInPack('', fr)).toBeNull()
  })

  it('prefers the plainer of two names that fold to the same words', async () => {
    const { matchInPack } = await import('./exercise-visual.js')
    const pack = { 3418: 'traction en L', 1000: 'traction' }
    expect(matchInPack('Tractions', pack)).toBe('1000')
  })
})
