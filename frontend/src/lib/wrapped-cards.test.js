import { describe, expect, it } from 'vitest'
import { yearStats } from './wrapped.js'
import { wrappedCards, layoutWrappedCard, volumeParts, hoursOf, fmtCount, tileRows, comparisonLine } from './wrapped-cards.js'
import { FORMATS } from './card-draw.js'

const BENCH = '0025'
const SQUAT = '0043'
const set = (w, r, done = true) => ({ w, r, done })
function W(d, hhmm, min, entries, extra = {}) {
  const start = new Date(d + 'T' + hhmm + ':00').getTime()
  return { id: d + hhmm, d, start, end: start + min * 60000, name: 'Session', entries: entries.map(([id, sets]) => ({ id, target: { mode: 'reps' }, sets })), ...extra }
}
// A real-looking year: three sessions a week from February to November, records now and then.
function year(over = {}) {
  const ws = []
  const d = new Date('2026-02-02T12:00:00')
  let n = 0
  while (d.getFullYear() === 2026 && d.getMonth() < 11) {
    const iso = d.toISOString().slice(0, 10)
    ws.push(W(iso, '18:30', 55, [[BENCH, [set(60 + n * 0.1, 8), set(60, 8), set(60, 8)]], [SQUAT, [set(100, 5), set(100, 5)]]], n % 20 === 0 ? { prs: [BENCH] } : {}))
    d.setDate(d.getDate() + (n % 3 === 2 ? 3 : 2))
    n++
  }
  return { unit: 'kg', weekStart: 1, workouts: ws, bodyweight: [{ d: '2026-02-01', w: 84 }, { d: '2026-11-20', w: 81.2 }], ...over }
}
const measure = (text, weight, size) => String(text).length * size * 0.55

describe('wrappedCards', () => {
  it('tells a full year in order, from the hello to the summary', () => {
    const S = year()
    const cards = wrappedCards(yearStats(S, 2026), S)
    expect(cards.map(c => c.id)).toEqual(['intro', 'workouts', 'time', 'volume', 'streak', 'top', 'records', 'rhythm', 'month', 'body', 'personality', 'summary'])
    const by = id => cards.find(c => c.id === id)
    expect(by('intro').big).toBe('2026')
    expect(by('workouts').num).toBe(S.workouts.length)
    expect(by('volume').unit).toBe('t')
    expect(by('volume').lines[0]).toMatch(/^That is /)
    expect(by('top').big).toMatch(/bench press/i)
    expect(by('top').map).toBeTruthy()
    expect(by('rhythm').lines[0]).toMatch(/evening/)
    expect(by('body').title).toBe('Down since your first weigh-in of the year')
    expect(by('summary').tiles.map(t => t.label)).toEqual(['Workouts', 'Hours', 'Lifted in total', 'Longest streak', 'Records', 'Signature move', 'Training personality'])
  })

  it('leaves out what a year has nothing to say about', () => {
    // Two imported sessions without a clock, no records, no weigh-ins.
    const S = { unit: 'kg', workouts: ['2026-01-10', '2026-01-17'].map(d => ({ id: d, d, entries: [{ id: BENCH, sets: [set(50, 10)] }] })), bodyweight: [] }
    const ids = wrappedCards(yearStats(S, 2026), S).map(c => c.id)
    expect(ids).not.toContain('time')
    expect(ids).not.toContain('records')
    expect(ids).not.toContain('body')
    expect(ids).not.toContain('month')
    expect(ids[0]).toBe('intro')
    expect(ids.at(-1)).toBe('summary')
    expect(wrappedCards(null, S)).toEqual([])
  })

  it('never shames a body-weight change, and leaves it out when asked to', () => {
    const up = year({ bodyweight: [{ d: '2026-02-01', w: 70 }, { d: '2026-11-01', w: 74 }] })
    const body = wrappedCards(yearStats(up, 2026), up).find(c => c.id === 'body')
    expect(body.big).toBe('+4')
    expect(body.title).toBe('Up since your first weigh-in of the year')
    expect(body.lines.join(' ')).toMatch(/kept showing up/)
    expect(body.hideable).toBe(true)
    const steady = year({ bodyweight: [{ d: '2026-02-01', w: 70 }, { d: '2026-11-01', w: 70.2 }] })
    expect(wrappedCards(yearStats(steady, 2026), steady).find(c => c.id === 'body').title).toBe('Steady all year')
    const off = year({ wrappedBody: false })
    expect(wrappedCards(yearStats(off, 2026), off).some(c => c.id === 'body')).toBe(false)
  })

  it('writes a light year as a good one', () => {
    const S = { unit: 'kg', weekStart: 1, workouts: [W('2026-03-01', '10:00', 40, [[BENCH, [set(40, 8)]], [SQUAT, [set(40, 8)]]]), W('2026-09-01', '10:00', 40, [[SQUAT, [set(40, 8)]], [BENCH, [set(40, 8)]]])], bodyweight: [] }
    const cards = wrappedCards(yearStats(S, 2026), S)
    expect(cards.find(c => c.id === 'workouts').lines[0]).toMatch(/Every single one counted/)
    expect(cards.find(c => c.id === 'streak').lines.join(' ')).toMatch(/starts with one week/)
    expect(cards.find(c => c.id === 'personality').big).toBe('Steady and sure')
  })

  it('works in pounds', () => {
    const S = year({ unit: 'lb' })
    const vol = wrappedCards(yearStats(S, 2026), S).find(c => c.id === 'volume')
    expect(vol.unit).toBe('lb')
  })
})

describe('numbers', () => {
  it('shows a year’s total in tonnes, or compact pounds', () => {
    expect(volumeParts(950, 'kg')).toEqual({ value: '950', unit: 'kg' })
    expect(volumeParts(12345, 'kg')).toEqual({ value: '12.3', unit: 't' })
    expect(volumeParts(456789, 'kg')).toEqual({ value: '457', unit: 't' })
    expect(volumeParts(8000, 'lb')).toEqual({ value: '8,000', unit: 'lb' })
    expect(volumeParts(1234567, 'lb').unit).toBe('lb')
    expect(volumeParts(1234567, 'lb').value).toMatch(/^1\.2\s?m$/i)
  })
  it('rounds hours and counts the way people say them', () => {
    expect(hoursOf(5.25 * 3600000)).toBe(5.3)
    expect(hoursOf(123.6 * 3600000)).toBe(124)
    expect(fmtCount(3.1)).toBe('3.1')
    expect(fmtCount(3)).toBe('3')
    expect(fmtCount(1234)).toBe('1,234')
  })
  it('picks one or many of the thing', () => {
    expect(comparisonLine({ key: 'whale', count: 1 })).toBe('That is 1 blue whale. Lifted. By you.')
    expect(comparisonLine({ key: 'whale', count: 3.1 })).toBe('That is 3.1 blue whales. Lifted. By you.')
    expect(comparisonLine(null)).toBeNull()
  })
  it('puts the summary tiles two to a row, a wide one alone', () => {
    const rows = tileRows([{ a: 1 }, { a: 2 }, { a: 3 }, { wide: true }, { a: 4 }])
    expect(rows.map(r => r.map(t => t.a || 'wide'))).toEqual([[1, 2], [3, 4], ['wide']])
    expect(tileRows([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { wide: true }], 3).map(r => r.length)).toEqual([3, 1, 1])
  })
})

describe('layoutWrappedCard', () => {
  const S = year()
  const cards = wrappedCards(yearStats(S, 2026), S)
  const map = { aspect: 1280 / 727 }
  it('fits every card in both formats and both directions, logo last', () => {
    for (const card of cards) for (const format of ['story', 'square']) for (const rtl of [false, true]) {
      const layout = layoutWrappedCard(card, { measure, format, rtl, map, year: 2026 })
      expect(layout).toMatchObject(FORMATS[format])
      expect(layout.items.at(-1).kind).toBe('brand')
      for (const item of layout.items) {
        if (item.kind === 'text' && item.anchor !== 'center') {
          const w = measure(item.text, item.weight, item.size)
          const [l, r] = rtl ? [item.x - w, item.x] : [item.x, item.x + w]
          expect(l, `${card.id} ${format} ${item.text}`).toBeGreaterThanOrEqual(0)
          expect(r, `${card.id} ${format} ${item.text}`).toBeLessThanOrEqual(layout.width)
        }
        if (item.kind !== 'deco' && 'y' in item) expect(item.y + (item.h || 0), `${card.id} ${format} ${item.kind}`).toBeLessThanOrEqual(layout.height)
        // Nothing runs into the footer line.
        const sep = layout.items.find(i => i.kind === 'sep')
        if (['tile', 'map', 'barv'].includes(item.kind)) expect(item.y + item.h, `${card.id} ${format} ${item.kind}`).toBeLessThanOrEqual(sep.y)
      }
    }
  })
  it('puts the big number in, the year as a pill and the muscle map where there is one', () => {
    const vol = layoutWrappedCard(cards.find(c => c.id === 'volume'), { measure, year: 2026 })
    expect(vol.items.some(i => i.kind === 'pill' && i.text === '2026')).toBe(true)
    expect(vol.items.some(i => i.text === 't')).toBe(true)
    const top = layoutWrappedCard(cards.find(c => c.id === 'top'), { measure, map, year: 2026 })
    expect(top.items.filter(i => i.kind === 'map').map(i => i.view)).toEqual(['front', 'back'])
    const month = layoutWrappedCard(cards.find(c => c.id === 'month'), { measure, year: 2026 })
    expect(month.items.filter(i => i.kind === 'barv')).toHaveLength(12)
    const summary = layoutWrappedCard(cards.at(-1), { measure, year: 2026 })
    expect(summary.items.filter(i => i.kind === 'tile')).toHaveLength(7)
  })
})
