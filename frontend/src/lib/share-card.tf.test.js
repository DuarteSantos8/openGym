// TestFlight 11-08: the logo on a photo card (see-through, a line over it), the colours one can
// pick, and "On the card" being honest about what fits together.
import { describe, expect, it, vi } from 'vitest'
import { shareCardModel, layoutShareCard, shownElements, sharePalette, customPalette, drawShareCard, SHARE_FORMAT_IDS } from './share-card.js'
import { brandBadgeBox, BRAND } from './card-draw.js'

const measure = (text, weight, size) => String(text).length * size * 0.5
const S = (w, r) => ({ w, r, done: true })
const levels = { chest: 1, back: 0.6 }
function model(n = 6, extra = {}, plain = false) {
  const entries = Array.from({ length: n }, (_, i) => ({ id: 'x' + i, target: { mode: 'reps' }, sets: [S(50 + i, 8), S(50 + i, 8)] }))
  const w = { id: 'w', d: '2026-11-05', start: 0, end: 72 * 60000, name: 'Push and pull day', prs: plain ? [] : ['x0'], entries, ...(plain ? {} : { hr: { avg: 128, max: 160 } }) }
  return { ...shareCardModel(w, { unit: 'kg', nameOf: e => 'Exercise ' + e.id, streak: plain ? 0 : 4 }), levels: plain ? null : levels, ...extra }
}
// Rough boxes of everything drawn, to check nothing sits on the logo.
function boxOf(it) {
  if (it.kind === 'text') return { x: Math.min(it.x, it.x + 1), y: it.y - it.size, w: 10, h: it.size * 1.2, top: it.y - it.size, bottom: it.y + it.size * 0.25 }
  if (it.kind === 'map' || it.kind === 'tile') return { top: it.y, bottom: it.y + it.h }
  if (it.kind === 'sep') return { top: it.y, bottom: it.y + 2 }
  if (['trophy', 'flame', 'heart'].includes(it.kind)) return { top: it.y, bottom: it.y + it.size }
  return null
}

describe('the logo on a photo card', () => {
  for (const format of SHARE_FORMAT_IDS) {
    it(`${format}: sits on its badge and nothing overlaps it, everything switched on`, () => {
      const L = layoutShareCard(model(8), { template: 'photo', format, show: shownElements(), measure, map: { aspect: 1.76 }, photo: true })
      const brand = L.items.find(i => i.kind === 'brand')
      expect(brand.badge).toBe(true)
      const b = brandBadgeBox(brand.x, brand.y, brand.size)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y + b.h).toBeLessThanOrEqual(L.height)
      for (const it of L.items) {
        const o = boxOf(it)
        if (!o) continue
        expect(o.bottom <= b.y || o.top >= b.y + b.h, `${it.kind} ${it.text || ''} overlaps the logo`).toBe(true)
      }
    })
  }
  it('the badge is painted solid in the brand ink, never left out on a photo', () => {
    const L = layoutShareCard(model(2, {}, true), { template: 'photo', format: 'story', show: shownElements(), measure, photo: true })
    const fills = []
    const ctx = new Proxy({}, {
      get: (o, k) => (k in o ? o[k] : k === 'measureText' ? () => ({ width: 100 }) : k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}),
      set: (o, k, v) => { if (k === 'fillStyle') fills.push(v); o[k] = v; return true },
    })
    drawShareCard(ctx, L, sharePalette('photo', 'dark'), {})
    expect(fills.map(String).map(x => x.toLowerCase())).toContain(BRAND.ink)
  })
})

describe('what fits on the card', () => {
  it('a story shows the muscle map and the exercises together', () => {
    const L = layoutShareCard(model(6), { template: 'classic', format: 'story', show: shownElements(), measure, map: { aspect: 1.76 } })
    expect(L.items.some(i => i.kind === 'map')).toBe(true)
    expect(L.items.some(i => i.kind === 'text' && /Exercise x0/i.test(i.text))).toBe(true)
    expect(L.left).toEqual([])
  })
  it('lifts on a story keep the map too', () => {
    const L = layoutShareCard(model(8), { template: 'lifts', format: 'story', show: shownElements(), measure, map: { aspect: 1.76 } })
    expect(L.items.some(i => i.kind === 'map')).toBe(true)
    expect(L.left).toEqual([])
  })
  it('what does not fit is named, so the sheet can say it', () => {
    const L = layoutShareCard(model(6), { template: 'classic', format: 'square', show: shownElements(), measure, map: { aspect: 1.76 } })
    const drawn = { map: L.items.some(i => i.kind === 'map'), exercises: L.items.some(i => i.kind === 'text' && /Exercise x0/i.test(i.text)) }
    for (const id of L.left) expect(drawn[id]).toBe(false)
    for (const [id, on] of Object.entries(drawn)) if (!on) expect(L.left).toContain(id)
  })
})

describe('colours of ones own', () => {
  const base = sharePalette('classic', 'dark', '#30d158')
  it('see-through has no background and the logo goes on its badge', () => {
    const p = customPalette(base, { template: 'classic', bg: 'clear' }, '#30d158')
    expect(p.bg).toBeNull()
    expect(p.clear).toBe(true)
  })
  it('a white background turns the type black; a picked type colour wins', () => {
    expect(customPalette(base, { bg: 'white' }).label).toBe('#000000')
    expect(customPalette(base, { bg: '#123456', ink: '#ffcc00' }).label).toBe('#ffcc00')
  })
  it('a highlight too close to the paper falls back to the type colour', () => {
    const p = customPalette(base, { bg: 'white', hi: 'white' })
    expect(p.acc).toBe(p.label)
  })
  it('a photo keeps its photo whatever background is picked', () => {
    const p = customPalette(sharePalette('photo', 'dark'), { template: 'photo', bg: 'white' })
    expect(p.bg).toBe('#000000')
  })
})
