import { describe, expect, it } from 'vitest'
import {
  shareCardModel, layoutShareCard, shownElements, workoutHr, bestSetLabel, photoRect, panBy, zoomTo, shadeFor,
  sharePalette, joinLines, SHARE_FORMATS, SHARE_TEMPLATES, SHARE_ELEMENTS, MAX_LIFTS,
} from './share-card.js'

// A fake measure stands in for the canvas, as in workout-card.test.js: every character is half
// its font size wide.
const measure = (text, weight, size) => String(text).length * size * 0.5
const S = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const names = { a: 'Bench press', b: 'Cable row', c: 'Pull-up', d: 'Plank', e: 'Treadmill' }
const nameOf = e => names[e.id] || e.id
const workout = (over = {}) => ({
  id: 'w', d: '2026-11-05', start: 0, end: 72 * 60000, name: 'Push and pull', prs: ['a'],
  entries: [
    { id: 'a', target: { mode: 'reps' }, sets: [S(60, 8, { phase: 'warmup' }), S(100, 5), S(102.5, 3), S(110, 1, { done: false })] },
    { id: 'b', target: { mode: 'reps' }, sets: [S(70, 10), S(75, 8)] },
    { id: 'c', target: { mode: 'reps', bodyweight: true }, sets: [S(0, 12), S(0, 9)] },
    { id: 'd', target: { mode: 'time' }, sets: [{ sec: 45, done: true }, { sec: 75, done: true }] },
  ],
  ...over,
})
const texts = layout => layout.items.filter(i => i.kind === 'text').map(i => i.text)
const allOn = shownElements()

describe('shareCardModel', () => {
  it('lists every exercise with its work sets, best set and record', () => {
    const m = shareCardModel(workout(), { unit: 'kg', nameOf })
    expect(m.lifts.map(l => [l.name, l.sets, l.best, l.pr])).toEqual([
      ['Bench Press', 2, '100 kg × 5', true],
      ['Cable Row', 2, '75 kg × 8', false],
      ['Pull-Up', 2, '12 reps', false],
      ['Plank', 2, expect.stringMatching(/1:15|75/), false],
    ])
    expect(m.stats.map(s => s.id)).toEqual(['duration', 'volume', 'sets', 'prs'])
    expect(m.stats.find(s => s.id === 'sets').value).toBe('8')
  })

  it('takes the heart rate of the session, or of its sets when the session has none', () => {
    expect(workoutHr({ hr: { avg: 130, max: 170 } })).toEqual({ avg: 130, max: 170 })
    expect(workoutHr({ entries: [{ sets: [{ hr: { avg: 120, max: 140 } }, { hr: { avg: 140, max: 160 } }, { hr: { avg: 999, max: 999 } }] }] })).toEqual({ avg: 130, max: 160 })
    expect(workoutHr({ entries: [] })).toBeNull()
    const m = shareCardModel(workout({ hr: { avg: 128, max: 171 } }), { unit: 'kg', nameOf })
    expect(m.stats.at(-1)).toMatchObject({ id: 'hr', value: '128 bpm', icon: 'heart' })
  })

  it('counts a lift done twice in one session once', () => {
    const w = workout()
    w.entries.push({ id: 'a', target: { mode: 'reps' }, sets: [S(80, 10)] })
    const m = shareCardModel(w, { unit: 'kg', nameOf })
    expect(m.lifts.filter(l => l.id === 'a')).toHaveLength(1)
    expect(m.lifts[0].sets).toBe(3)
  })
})

describe('bestSetLabel', () => {
  it('writes added weight on a body-weight lift and nothing for an unfinished one', () => {
    expect(bestSetLabel({ id: 'c', target: { mode: 'reps', bodyweight: true }, sets: [S(10, 6), S(0, 12)] }, { unit: 'lb' })).toBe('+10 lb × 6')
    expect(bestSetLabel({ id: 'a', target: { mode: 'reps' }, sets: [S(100, 5, { done: false })] })).toBeNull()
  })
})

describe('layoutShareCard', () => {
  const m = shareCardModel(workout({ hr: { avg: 128, max: 171 } }), { unit: 'kg', nameOf, streak: 6 })
  m.levels = { chest: 4, triceps: 2 }

  for (const template of SHARE_TEMPLATES) {
    for (const format of Object.keys(SHARE_FORMATS)) {
      it(`${template} ${format}: keeps everything inside the card and the safe area`, () => {
        const L = layoutShareCard(m, { template, format, show: allOn, measure, map: { aspect: 2 } })
        const F = SHARE_FORMATS[format]
        expect(L.width).toBe(1080)
        if (template === 'sticker') { expect(L.transparent).toBe(true); expect(L.height).toBeLessThan(F.height) } else expect(L.height).toBe(F.height)
        for (const i of L.items.filter(x => x.kind === 'text')) {
          expect(i.x).toBeGreaterThanOrEqual(0)
          expect(i.x).toBeLessThanOrEqual(1080)
          if (template !== 'sticker') {
            expect(i.y - i.size).toBeGreaterThanOrEqual(F.top - 1)
            expect(i.y).toBeLessThanOrEqual(F.height - F.bottom + 1)
          }
        }
      })
    }
  }

  it('paints the page edge to edge: no rounded card on a background any more', () => {
    const L = layoutShareCard(m, { template: 'classic', format: 'story', show: allOn, measure })
    expect(L.items[0]).toEqual({ kind: 'bg', w: 1080, h: 1920 })
    const P = layoutShareCard(m, { template: 'photo', format: 'story', show: allOn, measure, photo: true })
    expect(P.items[0]).toMatchObject({ kind: 'photo', x: 0, y: 0, w: 1080, h: 1920 })
  })

  it('leaves out what is switched off', () => {
    const hidden = ['title', 'date', 'volume', 'hr', 'logo', 'streak', 'exercises']
    const L = layoutShareCard(m, { template: 'classic', format: 'story', show: shownElements(hidden), measure })
    const s = texts(L)
    expect(s).not.toContain('Push and pull')
    expect(s).not.toContain('Volume')
    expect(s).not.toContain('128 bpm')
    expect(s.some(x => /week streak/.test(x))).toBe(false)
    expect(L.items.some(i => i.kind === 'brand')).toBe(false)
    expect(s).toContain('Duration')
    // No list: the record shows in its own block.
    expect(s).toContain('New personal records')
  })

  it('shows the best set per exercise on Lifts, at most MAX_LIFTS rows', () => {
    const big = workout()
    for (let i = 0; i < 12; i++) big.entries.push({ id: 'x' + i, target: { mode: 'reps' }, sets: [S(20 + i, 10)] })
    const model = shareCardModel(big, { unit: 'kg', nameOf })
    const L = layoutShareCard(model, { template: 'lifts', format: 'story', show: shownElements(['map']), measure })
    const s = texts(L)
    expect(s).toContain('100 kg × 5')
    expect(L.items.filter(i => i.kind === 'text' && i.anchor === 'end').length).toBeLessThanOrEqual(MAX_LIFTS)
    expect(s.some(x => /^and \d+ more$/.test(x))).toBe(true)
    expect(L.items.some(i => i.kind === 'trophy')).toBe(true)
  })

  it('gives Classic the muscle map when there is room, and drops it when switched off', () => {
    const on = layoutShareCard(m, { template: 'classic', format: 'story', show: allOn, measure, map: { aspect: 2 } })
    expect(on.items.filter(i => i.kind === 'map')).toHaveLength(2)
    const off = layoutShareCard(m, { template: 'classic', format: 'story', show: shownElements(['map']), measure, map: { aspect: 2 } })
    expect(off.items.some(i => i.kind === 'map')).toBe(false)
  })

  it('mirrors for a right-to-left language', () => {
    const L = layoutShareCard(m, { template: 'lifts', format: 'story', show: allOn, measure, rtl: true })
    expect(L.rtl).toBe(true)
    const title = L.items.find(i => i.kind === 'text' && i.text === 'Push and pull')
    expect(title.x).toBe(1080 - 96)
  })

  it('knows every element it offers a switch for', () => {
    expect(Object.keys(allOn)).toEqual(SHARE_ELEMENTS)
    expect(shownElements(['hr', 'nope']).hr).toBe(false)
  })
})

describe('photo placement', () => {
  it('covers the card and keeps the pan inside the photo', () => {
    const r = photoRect(1000, 1000, 1080, 1920)
    expect(r.h).toBeCloseTo(1920)
    expect(r.x).toBeCloseTo(-(1920 - 1080) / 2)
    const left = photoRect(1000, 1000, 1080, 1920, { x: -1 })
    expect(left.x).toBeCloseTo(0)
    const right = photoRect(1000, 1000, 1080, 1920, { x: 1 })
    expect(right.x + right.w).toBeCloseTo(1080)
  })
  it('follows a drag and stops at the edge, zoom clamped', () => {
    let p = { x: 0, y: 0, zoom: 1 }
    p = panBy(p, 100, 0, 1000, 1000, 1080, 1920)
    expect(p.x).toBeLessThan(0)                // dragged right: the left part comes into view
    expect(p.y).toBe(0)                        // no room to move up or down at zoom 1
    p = panBy(p, 1e6, 0, 1000, 1000, 1080, 1920)
    expect(p.x).toBe(-1)
    expect(photoRect(1000, 1000, 1080, 1920, p).x).toBeCloseTo(0)
    expect(zoomTo(p, 99).zoom).toBe(4)
    expect(zoomTo(p, 0.2).zoom).toBe(1)
  })
  it('darkens a bright photo more than a dark one', () => {
    const px = v => new Uint8ClampedArray(Array.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 255 : v)))
    expect(shadeFor(px(250))).toBeGreaterThan(shadeFor(px(10)))
  })
})

describe('sharePalette', () => {
  it('picks readable type for the accent look', () => {
    expect(sharePalette('classic', 'accent', '#ffd60a').label).toBe('#000000')
    expect(sharePalette('classic', 'accent', '#0a46c8').label).toBe('#ffffff')
    expect(sharePalette('sticker', 'dark').bg).toBeNull()
  })
})

describe('joinLines', () => {
  it('breaks between names, never inside one', () => {
    const lines = joinLines(['Bench press', 'Cable row', 'Pull-up', 'Plank'], 200, s => s.length * 10, 2)
    expect(lines.length).toBeLessThanOrEqual(2)
    expect(lines[0].startsWith('Bench press')).toBe(true)
    expect(lines.every(l => !l.startsWith('·'))).toBe(true)
  })
})
