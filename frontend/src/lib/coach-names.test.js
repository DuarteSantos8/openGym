import { afterEach, describe, expect, it } from 'vitest'
import { exName, exTitle, changeTitle } from './coach.js'
import { insightsFor } from './coach-insights.js'
import { EXIDX } from './exercises.js'
import { _setLangState } from './i18n-core.js'
import de from '../exercise-names/de.js'
import es from '../exercise-names/es.js'

// The Coach's plan, swaps and review read the English catalogue field directly and showed English
// names in every language. They go through the same name pack as the rest of the app now.
describe('Coach exercise names', () => {
  const id = '0025'
  afterEach(() => _setLangState('en', {}, null, null))

  it('keeps English as it was', () => {
    expect(EXIDX[id].n).toBe('barbell bench press')
    expect(exName(id)).toBe('barbell bench press')
    expect(exTitle(id)).toBe('Barbell Bench Press')
  })

  it('uses a lower-case pack and title-cases it', () => {
    _setLangState('es', {}, null, es)
    expect(exTitle(id)).toBe('Press De Banca Con Barra (Barbell Bench Press)')
  })

  it('leaves a cased pack as it is written', () => {
    _setLangState('de', {}, null, de, false)
    expect(exTitle(id)).toBe('Bankdrücken mit Langhantel')
  })

  it('names both sides of a swap in the active language', () => {
    _setLangState('de', {}, null, de, false)
    const other = Object.keys(de).find(k => k !== id && EXIDX[k])
    const c = { type: 'swap-exercise', target: { exId: id }, after: { id: other } }
    expect(changeTitle(c, {})).toContain('Bankdrücken mit Langhantel')
    expect(changeTitle(c, {})).toContain(exTitle(other))
    expect(changeTitle(c, {})).not.toContain(EXIDX[other].n)
  })

  it('still names an unknown id', () => {
    expect(exTitle('no-such-id')).toBe('Unknown Exercise')
  })

  it('names the lifts under a review card in the active language', () => {
    _setLangState('de', {}, null, de, false)
    const set = (w, r) => ({ done: true, w, r })
    const day = d => new Date(d + 'T10:00:00').getTime()
    const S = { unit: 'kg', workouts: ['2026-08-03', '2026-08-10'].map((d, i) => ({ id: 'w' + i, d, start: day(d), end: day(d) + 3e6, entries: [{ id, sets: [set(60 + i * 5, 10)] }] })) }
    const lift = insightsFor(S, { from: '2026-08-01', to: '2026-08-15' }).strength.find(x => x.id === id)
    expect(lift.name).toBe('Bankdrücken mit Langhantel')
  })
})
