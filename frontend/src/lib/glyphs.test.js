import { describe, it, expect } from 'vitest'
import { GLYPHS, GLYPH_GROUPS } from './glyphs.js'
import { ICON_NAMES } from '../components/Icon.jsx'

const OLD = ['figureStrength', 'arm', 'abs', 'legs', 'pullup', 'dumbbell', 'barbell', 'kettlebell', 'plate', 'machine',
  'figureRun', 'bike', 'swim', 'boxing', 'timer', 'stretch', 'moon', 'heart', 'flame', 'bolt']

describe('routine glyphs', () => {
  it('offers 28 glyphs in three groups', () => {
    expect(GLYPHS).toHaveLength(28)
    expect(new Set(GLYPHS).size).toBe(28)
    expect(GLYPH_GROUPS.map(g => g.key)).toEqual(['Split', 'Kit', 'Session'])
  })
  it('keeps every glyph the old picker offered', () => {
    for (const k of OLD) expect(GLYPHS).toContain(k)
  })
  it('draws every glyph', () => {
    for (const k of GLYPHS) expect(ICON_NAMES).toContain(k)
  })
})
