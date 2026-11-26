import { afterEach, describe, expect, test } from 'vitest'
import { PACKS, MOMENTS, STYLE_IDS, cueStyleOf, linesFor, pickLine, setOwnLines, startOwnFrom, ownLines, hasOwnLines, _resetPicks, LINES_MAX, sampleLine, CUE_LEVELS, cueLevelOf, LEVEL_COPY, NEWS } from './voice-styles.js'
import { t } from './i18n-core.js'

afterEach(() => _resetPicks())

describe('the style packs', () => {
  test('every pack has every moment, and lines with personality but no em dashes', () => {
    for (const [id, pack] of Object.entries(PACKS)) {
      expect(STYLE_IDS).toContain(id)
      for (const m of MOMENTS) {
        expect(Array.isArray(pack[m])).toBe(true)
        for (const l of pack[m]) { expect(l).not.toMatch(/—/); expect(l.length).toBeLessThan(80) }
        if (id !== 'plain') expect(pack[m].length).toBeGreaterThanOrEqual(2)
      }
    }
  })
  test('the hype man shouts', () => {
    for (const m of MOMENTS) for (const l of PACKS.hype[m]) expect(l).toBe(l.toUpperCase())
  })
  test('an unknown style is just the facts', () => {
    expect(cueStyleOf({ cueStyle: 'hogan' })).toBe('plain')
    expect(linesFor({}, 'restOver')).toEqual(['Rest is over'])
    expect(sampleLine({ cueStyle: 'calm' })).toBe(PACKS.calm.restOver[0])
  })
})

describe('picking a line', () => {
  test('never the same twice in a row when there is a choice', () => {
    const S = { cueStyle: 'deadpan' }
    let last = ''
    for (let k = 0; k < 20; k++) { const l = pickLine(S, 'record', () => 0); expect(l).not.toBe(last); last = l }
  })
  test('nothing to say is an empty line', () => {
    expect(pickLine({ cueStyle: 'plain' }, 'record')).toBe('')
    expect(pickLine({ cueStyle: 'own' }, 'record')).toBe('')
  })
})

describe('own lines', () => {
  test('the first edit starts from the pack on screen, every moment', () => {
    const s = { cueStyle: 'hype' }
    setOwnLines(s, 'restOver', ['YOU CAN DO IT, MATE!', '   ', 'x'.repeat(300)])
    expect(s.cueStyle).toBe('own')
    expect(s.cueLines.restOver[0]).toBe('YOU CAN DO IT, MATE!')
    expect(s.cueLines.restOver).toHaveLength(2)
    expect(s.cueLines.restOver[1]).toHaveLength(120)
    expect(s.cueLines.record).toEqual(PACKS.hype.record)
    setOwnLines(s, 'record', ['Wow'])
    expect(s.cueLines.restOver[0]).toBe('YOU CAN DO IT, MATE!')
    expect(hasOwnLines(s)).toBe(true)
  })
  test('at most LINES_MAX per moment, rubbish ignored', () => {
    expect(ownLines({ cueLines: { tenLeft: Array.from({ length: 20 }, (_, i) => 'l' + i) } }, 'tenLeft')).toHaveLength(LINES_MAX)
    expect(ownLines({ cueLines: 'nope' }, 'tenLeft')).toEqual([])
    const s = {}
    setOwnLines(s, 'kazoo', ['x'])
    expect(s).toEqual({})
  })
  test('start over from a pack', () => {
    const s = { cueStyle: 'own', cueLines: { record: ['mine'] } }
    startOwnFrom(s, 'calm')
    expect(s.cueLines.record).toEqual(PACKS.calm.record)
    expect(s.cueStyle).toBe('own')
  })
})

describe('the levels', () => {
  test('a profile with no level, or an unknown one, says one line per rest', () => {
    expect(cueLevelOf({})).toBe('rest')
    expect(cueLevelOf({ cueLevel: 'loud' })).toBe('rest')
    expect(cueLevelOf(undefined)).toBe('rest')
    for (const l of CUE_LEVELS) expect(cueLevelOf({ cueLevel: l })).toBe(l)
  })
  test('every level has a name and a description', () => {
    expect(CUE_LEVELS).toEqual(['end', 'rest', 'every'])
    for (const l of CUE_LEVELS) { expect(LEVEL_COPY[l]).toHaveLength(2); expect(LEVEL_COPY[l].join()).not.toMatch(/—/) }
  })
})

describe('the lines that know the numbers', () => {
  test('each goes through t() and keeps its placeholders', () => {
    expect(t(NEWS.intro, '60 kg', '8 reps')).toBe('Last time, 60 kg for 8 reps.')
    expect(t(NEWS.beatLast, 2)).toBe('2 more than last time.')
    expect(t(NEWS.last, 'Squat')).toBe('Last set of Squat.')
    expect(t(NEWS.record, 'Squat')).toBe('That’s a new best on Squat.')
    expect(t(NEWS.closer, '45 minutes')).toBe('Done in 45 minutes.')
    for (const l of Object.values(NEWS)) expect(l).not.toMatch(/—/)
  })
  test('every line and level text has a translation, with its placeholders, in every pack', () => {
    const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
    const sources = [...Object.values(NEWS), ...Object.values(LEVEL_COPY).flat()]
    const holes = s => (s.match(/\{\d\}/g) || []).sort().join()
    expect(Object.keys(packs).length).toBe(26)
    for (const [file, pack] of Object.entries(packs)) {
      for (const src of sources) {
        expect(String(pack[src] || '').trim(), `${file}: ${src}`).not.toBe('')
        expect(holes(pack[src]), `${file}: ${src}`).toBe(holes(src))
      }
    }
  })
})
