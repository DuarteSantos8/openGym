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
})
