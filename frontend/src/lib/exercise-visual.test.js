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
