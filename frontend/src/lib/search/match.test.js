import { describe, expect, it } from 'vitest'
import { fold, matchRecord, merge, nearest, queryWords, rangesIn, SCORE, segments } from './match.js'
import { parseDateQuery } from './date-words.js'

const m = (q, rec) => matchRecord(queryWords(q), typeof rec === 'string' ? { title: rec } : rec)

describe('the shared matcher', () => {
  it('folds accents and case', () => {
    expect(fold('Thème Crème Fraîche')).toBe('theme creme fraiche')
    expect(m('creme', 'Crème fraîche').ranges).toEqual([[0, 5]])
  })

  it('ranks a whole word over a word start over a substring over a typo over an alias over a secondary field', () => {
    expect(m('press', 'Bench press').score).toBeGreaterThan(m('pre', 'Bench press').score)
    expect(m('pre', 'Bench press').score).toBeGreaterThan(m('ench', 'Bench press').score)
    expect(m('ench', 'Bench press').score).toBeGreaterThan(m('bensh', 'Bench press').score)
    expect(m('bensh', 'Bench press').score).toBeGreaterThan(m('dark', { title: 'Theme', aliases: ['dark mode'] }).score)
    expect(m('dark', { title: 'Theme', aliases: ['dark mode'] }).score).toBeGreaterThan(m('baker', { title: 'Bread', secondary: ['Baker'] }).score)
    expect(SCORE.word).toBeGreaterThan(SCORE.prefix)
  })

  it('allows no typo under four letters, one up to six, two from seven (the exercise rule)', () => {
    expect(m('tme', 'Theme')).toBeNull()
    expect(m('thme', 'Theme')).not.toBeNull()
    expect(m('measurment', 'Measurements')).not.toBeNull()
    expect(m('xyzzy', 'Theme')).toBeNull()
  })

  it('needs every word to land somewhere', () => {
    expect(m('weight unit', 'Weight unit')).not.toBeNull()
    expect(m('weight banana', 'Weight unit')).toBeNull()
  })

  it('says when the title is the query, or starts with it on a word boundary', () => {
    expect(m('history', 'History')).toMatchObject({ exact: true })
    expect(m('body', 'Body measurements')).toMatchObject({ exact: false, wordPrefix: true })
    expect(m('bod', 'Body measurements')).toMatchObject({ wordPrefix: false })
  })

  it('maps ranges back onto the title as written, and splits it into plain segments', () => {
    expect(rangesIn('Crème brûlée', ['brulee'])).toEqual([[6, 12]])
    expect(segments('Chicken bowl', [[0, 7]])).toEqual([{ text: 'Chicken', match: true }, { text: ' bowl', match: false }])
    expect(merge([[3, 5], [0, 2], [2, 4]])).toEqual([[0, 5]])
  })

  it('finds what was meant', () => {
    expect(nearest('chiken bowl', ['Chicken bowl', 'Rice'])).toBe('Chicken bowl')
    expect(nearest('abc', ['abd'])).toBeNull()
  })
})

describe('date words', () => {
  const today = '2026-10-15' // a Thursday
  it('reads today, yesterday and weekdays as the latest one up to today', () => {
    expect(parseDateQuery('yesterday', { today })).toMatchObject({ from: '2026-10-14', to: '2026-10-14', rest: [] })
    expect(parseDateQuery('tuesday', { today })).toMatchObject({ from: '2026-10-13' })
    expect(parseDateQuery('thu', { today })).toMatchObject({ from: '2026-10-15' })
    expect(parseDateQuery('friday', { today })).toMatchObject({ from: '2026-10-09' })
  })

  it('reads a day of a month either way round, and a month alone', () => {
    expect(parseDateQuery('13 oct', { today })).toMatchObject({ from: '2026-10-13', to: '2026-10-13' })
    expect(parseDateQuery('oct 13', { today })).toMatchObject({ from: '2026-10-13' })
    expect(parseDateQuery('20 oct', { today })).toMatchObject({ from: '2025-10-20' })
    expect(parseDateQuery('september', { today })).toMatchObject({ from: '2026-09-01', to: '2026-09-30', at: 'month' })
  })

  it('reads last week and this week from the week start, and keeps the other words', () => {
    expect(parseDateQuery('chicken last week', { today, weekStart: 1 })).toMatchObject({ from: '2026-10-05', to: '2026-10-11', rest: ['chicken'] })
    expect(parseDateQuery('this week', { today, weekStart: 0 })).toMatchObject({ from: '2026-10-11', to: today })
    expect(parseDateQuery('chicken', { today })).toBeNull()
  })
})
