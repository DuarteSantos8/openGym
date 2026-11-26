import { describe, it, expect } from 'vitest'
import { GLOSSARY, GUIDES, termById, guideById, searchGlossary } from './learn.js'

describe('Learn content', () => {
  it('gives every term an id of its own, a name and an explanation', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(40)
    expect(new Set(GLOSSARY.map(x => x.id)).size).toBe(GLOSSARY.length)
    for (const x of GLOSSARY) {
      expect(x.id, x.id).toMatch(/^[a-z0-9-]+$/)
      expect(x.term.trim().length, x.id).toBeGreaterThan(0)
      expect(x.def.trim().length, x.id).toBeGreaterThan(20)
      if (x.also) for (const a of x.also) expect(typeof a).toBe('string')
    }
  })

  it('explains the words a beginner meets on the workout screen', () => {
    for (const id of ['set', 'rep', 'rest', 'warm-up', 'rir', 'rpe', '1rm', 'pr', 'superset', 'deload', 'progressive-overload', 'failure', 'drop-set']) {
      expect(termById(id), id).toBeTruthy()
    }
  })

  it('gives every guide an id of its own, a title and something to read', () => {
    expect(new Set(GUIDES.map(x => x.id)).size).toBe(GUIDES.length)
    for (const g of GUIDES) {
      expect(g.id, g.id).toMatch(/^[a-z0-9-]+$/)
      expect(g.title && g.summary && g.icon, g.id).toBeTruthy()
      expect(g.blocks.length, g.id).toBeGreaterThan(0)
      for (const b of g.blocks) {
        expect(!!(b.p || b.list), g.id).toBe(true)
        if (b.list) { expect(Array.isArray(b.list)).toBe(true); expect(b.list.length).toBeGreaterThan(0) }
      }
      if (g.sources) for (const s of g.sources) expect(s.length).toBeGreaterThan(20)
    }
  })

  it('covers the basics the plan says the app must answer by itself', () => {
    for (const id of ['first-week', 'how-heavy', 'warm-up', 'progress', 'rest', 'food', 'gym-day-one', 'safety']) expect(guideById(id), id).toBeTruthy()
  })

  it('names a source wherever a guide gives a health number', () => {
    for (const id of ['food', 'rest', 'how-heavy']) expect(guideById(id).sources.length, id).toBeGreaterThan(0)
  })

  it('needs nothing from the network: no links anywhere in the text', () => {
    const text = JSON.stringify({ GLOSSARY, GUIDES })
    expect(text).not.toMatch(/https?:\/\//)
    expect(text).not.toMatch(/www\./)
  })

  it('makes no promise and no diagnosis', () => {
    const text = JSON.stringify({ GLOSSARY, GUIDES }).toLowerCase()
    for (const word of ['guarantee', 'cure', 'diagnos', 'treats ', 'heal ']) expect(text.includes(word), word).toBe(false)
  })

  it('returns null for what it does not have', () => {
    expect(termById('nope')).toBe(null)
    expect(guideById('nope')).toBe(null)
  })
})

describe('searchGlossary', () => {
  it('lists everything, by name, for an empty search', () => {
    const all = searchGlossary('')
    expect(all.length).toBe(GLOSSARY.length)
    const names = all.map(x => x.term.toLowerCase())
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('finds a term by its name, its other names and its explanation, in that order', () => {
    expect(searchGlossary('rir')[0].id).toBe('rir')
    expect(searchGlossary('reps in reserve')[0].id).toBe('rir')
    expect(searchGlossary('personal best')[0].id).toBe('pr')
    expect(searchGlossary('5x5')[0].id).toBe('5x5')
    const sets = searchGlossary('set').map(x => x.id)
    expect(sets[0]).toBe('set')
    expect(sets.indexOf('superset')).toBeGreaterThan(0)
    // "lighter week" appears only in an explanation or another name
    expect(searchGlossary('light week').map(x => x.id)).toContain('deload')
  })

  it('ignores case, accents and punctuation', () => {
    expect(searchGlossary('  WARM UP ')[0].id).toBe('warm-up')
    expect(searchGlossary('Push/Pull')[0].id).toBe('ppl')
  })

  it('finds nothing for nonsense', () => {
    expect(searchGlossary('zzzzqq')).toEqual([])
  })

  it('searches the words on screen as well as the English ones', () => {
    const say = s => (s === 'Set' ? 'Satz' : s)
    expect(searchGlossary('satz', say)[0].id).toBe('set')
    expect(searchGlossary('set', say)[0].id).toBe('set')
  })
})
