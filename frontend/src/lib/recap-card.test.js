import { describe, expect, test } from 'vitest'
import { drawRecapCard } from './recap-card.js'
import { cardPalette } from './card-draw.js'

// A canvas context that only records what was written.
function fakeCtx() {
  const texts = []
  const noop = () => {}
  return {
    texts,
    fillText: t => texts.push(String(t)), measureText: t => ({ width: String(t).length * 10 }),
    fillRect: noop, beginPath: noop, moveTo: noop, arcTo: noop, closePath: noop, fill: noop, save: noop, restore: noop, translate: noop, scale: noop,
  }
}

describe('the recap picture', () => {
  test('carries the title, the dates, the four tiles, the top muscle and the brand', () => {
    const ctx = fakeCtx()
    drawRecapCard(ctx, { title: 'Your week', dates: '19–25 Oct', tiles: [{ label: 'workouts', value: '4' }, { label: 'Volume', value: '12,300 kg' }, { label: 'new bests', value: '2' }, { label: 'weeks in a row', value: '6' }], top: 'Most work: Chest, 14 sets' },
      { width: 1080, height: 1920, colors: cardPalette('dark') })
    expect(ctx.texts).toEqual(expect.arrayContaining(['Your week', '19–25 Oct', '4', 'workouts', '12,300 kg', 'Volume', '2', '6', 'Most work: Chest, 14 sets', 'open', 'Gym']))
  })

  test('a long volume shrinks to stay inside its tile (#1102)', () => {
    // Width follows the font size here, like a real canvas: 0.6 of the size per character.
    const ctx = fakeCtx()
    const drawn = []
    ctx.font = ''
    ctx.measureText = t => ({ width: String(t).length * parseInt(ctx.font.match(/(\d+)px/)[1], 10) * 0.6 })
    ctx.fillText = (t, x) => drawn.push({ t: String(t), x, w: ctx.measureText(t).width })
    drawRecapCard(ctx, { title: 'Your week', dates: 'Mon 2 Nov – Sun 8 Nov', tiles: [{ label: 'workouts', value: '4' }, { label: 'Volume', value: '40,282.3 kg' }, { label: 'new bests', value: '6' }, { label: 'weeks in a row', value: '8' }], top: 'Most work: Shoulders, 16.4 sets' },
      { width: 1080, height: 1080, colors: cardPalette('dark') })
    const volume = drawn.find(d => d.t === '40,282.3 kg')
    // The right tile's inner edge: tile left + tile width - its 44 px padding.
    const tw = (1080 - 160 - 28) / 2
    expect(volume.x + volume.w).toBeLessThanOrEqual(80 + tw + 28 + tw - 44)
    // All four numbers keep one size.
    expect(drawn.find(d => d.t === '4').w).toBeCloseTo(volume.w / 11, 5)
  })
})
