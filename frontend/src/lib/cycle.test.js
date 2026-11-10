import { describe, it, expect } from 'vitest'
import { addDays, diffDays, cleanDay, periods, stats, forecast, phaseOn, kindOn, monthGrid, symptomsByPhase, sharedView } from './cycle.js'

// Periods starting 2026-07-01, 07-29, 08-26 (28 days), five flow days each.
const flowDays = starts => Object.fromEntries(starts.flatMap(s => [0, 1, 2, 3, 4].map(i => [addDays(s, i), { flow: 2 }])))
const days = flowDays(['2026-07-01', '2026-07-29', '2026-08-26'])

describe('cycle', () => {
  it('does date maths on calendar days', () => {
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01')
    expect(diffDays('2026-11-10', '2026-10-31')).toBe(10)
  })
  it('cleans a day and drops empty ones', () => {
    expect(cleanDay({ flow: 2, sym: ['tender', 'nope', 'tender'], mood: ['low'], note: ' hi ', junk: 1 })).toEqual({ flow: 2, sym: ['tender'], mood: ['low'], note: 'hi' })
    expect(cleanDay({ flow: 0, sym: [], note: '  ' })).toBe(null)
    expect(cleanDay('x')).toBe(null)
  })
  it('groups flow days into periods, tolerating a gap day', () => {
    expect(periods(days).map(p => [p.start, p.len])).toEqual([['2026-07-01', 5], ['2026-07-29', 5], ['2026-08-26', 5]])
    expect(periods({ '2026-07-01': { flow: 1 }, '2026-07-03': { flow: 1 } })).toHaveLength(1)
    expect(periods({ '2026-07-01': { flow: 1 }, '2026-07-09': { flow: 1 } })).toHaveLength(2)
  })
  it('averages cycles and ignores implausible ones', () => {
    expect(stats(days)).toMatchObject({ cycle: 28, period: 5, count: 3, min: 28, max: 28, spread: 0 })
    expect(stats({})).toMatchObject({ cycle: 28, period: 5, known: false })
    expect(stats(flowDays(['2026-07-01', '2026-07-05'])).cycle).toBe(28)
  })
  it('forecasts the next periods with ovulation 14 days before and a six-day fertile window', () => {
    const [n] = forecast(days)
    expect(n.start).toBe('2026-09-23')
    expect(n.to).toBe('2026-09-27')
    expect(n.ovulation).toBe('2026-09-09')
    expect(n.fertile).toEqual({ from: '2026-09-04', to: '2026-09-10' })
    expect(forecast({})).toEqual([])
  })
  it('names the phase of a day', () => {
    expect(phaseOn(days, '2026-08-27')).toMatchObject({ phase: 'menstrual', day: 2 })
    expect(phaseOn(days, '2026-08-31')).toMatchObject({ phase: 'follicular', fertile: false })
    expect(phaseOn(days, '2026-09-05')).toMatchObject({ phase: 'follicular', fertile: true })
    expect(phaseOn(days, '2026-09-09')).toMatchObject({ phase: 'ovulation', fertile: true })
    expect(phaseOn(days, '2026-09-15')).toMatchObject({ phase: 'luteal' })
    expect(phaseOn(days, '2026-09-25')).toMatchObject({ phase: 'luteal', late: 3 })
    expect(phaseOn(days, '2026-06-01')).toBe(null)
  })
  it('colours calendar cells', () => {
    expect(kindOn(days, '2026-08-26')).toBe('period')
    expect(kindOn(days, '2026-09-24')).toBe('predicted')
    expect(kindOn(days, '2026-09-09')).toBe('ovulation')
    expect(kindOn(days, '2026-09-06')).toBe('fertile')
    expect(kindOn(days, '2026-09-15')).toBe(null)
  })
  it('lays a month out in weeks', () => {
    const g = monthGrid(2026, 10, 1) // November 2026 starts on a Sunday
    expect(g[0].indexOf('2026-11-01')).toBe(6)
    expect(g.every(w => w.length === 7)).toBe(true)
    expect(g.flat().filter(Boolean)).toHaveLength(30)
  })
  it('counts the symptoms of each phase', () => {
    const d = { ...days, '2026-09-15': { sym: ['tender', 'bloating'] }, '2026-09-16': { sym: ['tender'] }, '2026-08-27': { sym: ['cramps'] } }
    const by = symptomsByPhase(d)
    expect(by.luteal[0]).toEqual(['tender', 2])
    expect(by.menstrual).toEqual([['cramps', 1]])
  })
  it('shares only what the level allows', () => {
    expect(sharedView(days, '2026-09-15', 'phase')).toEqual({ phase: 'luteal', day: 21 })
    expect(sharedView(days, '2026-09-15', 'period').next).toEqual({ from: '2026-09-23', to: '2026-09-23' })
    expect(sharedView(days, '2026-09-15', 'everything')).toEqual({})
    expect(sharedView({}, '2026-09-15', 'phase')).toEqual({})
  })
})
