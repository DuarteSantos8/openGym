// #885, #900: several muscles at once (AND by default), and groups that open into their muscles.
import { describe, expect, it } from 'vitest'
import { MUSCLE_GROUPS, groupTerm, matchesTerms, toggleTerm, shownMuscles, termsWeight } from './muscle-filter.js'
import { MUSCLES, musclesOf } from './muscles.js'
import { EXDB } from './exercises.js'
import de from '../locales/de.js'
import ru from '../locales/ru.js'

describe('the muscle filter', () => {
  it('groups cover every muscle the map draws, each once', () => {
    const all = MUSCLE_GROUPS.flatMap(g => g.muscles)
    expect([...all].sort()).toEqual([...MUSCLES].sort())
  })
  it('a group is named as a body part, never as the way back (Rücken, not Zurück)', () => {
    for (const pack of [de, ru]) {
      for (const g of MUSCLE_GROUPS) expect(pack[g.name], g.name).toBeTruthy()
      const back = MUSCLE_GROUPS.find(g => g.id === 'back')
      expect(pack[back.name]).not.toBe(pack.Back)
    }
    expect(de['Back muscles']).toBe('Rücken')
  })
  it('AND needs every muscle, OR any, a group any of its own', () => {
    const w = { quadriceps: 1, gluteal: 0.5 }
    expect(matchesTerms(w, ['quadriceps', 'hamstring'])).toBe(false)
    expect(matchesTerms(w, ['quadriceps', 'hamstring'], 'any')).toBe(true)
    expect(matchesTerms(w, ['quadriceps', 'gluteal'])).toBe(true)
    expect(matchesTerms(w, [groupTerm('legs')])).toBe(true)
    expect(matchesTerms(w, [groupTerm('legs'), 'abs'])).toBe(false)
    expect(matchesTerms(w, [])).toBe(false)
  })
  it('finds real exercises for quads and hamstrings together, fewer than for either', () => {
    const quads = EXDB.filter(e => matchesTerms(musclesOf(e), ['quadriceps']))
    const both = EXDB.filter(e => matchesTerms(musclesOf(e), ['quadriceps', 'hamstring']))
    expect(both.length).toBeGreaterThan(0)
    expect(both.length).toBeLessThan(quads.length)
  })
  it('a group gives way to a muscle of its own and takes its muscles off when chosen', () => {
    expect(toggleTerm(['biceps'], 'biceps')).toEqual([])
    expect(toggleTerm(['biceps', 'abs'], groupTerm('arms'))).toEqual(['abs', groupTerm('arms')])
    expect(toggleTerm([groupTerm('arms')], 'triceps')).toEqual(['triceps'])
    expect(shownMuscles([groupTerm('core'), 'biceps'])).toEqual(['biceps', 'abs', 'obliques'])
    expect(termsWeight({ abs: 0.5, obliques: 1 }, [groupTerm('core')])).toBe(1)
  })
})
