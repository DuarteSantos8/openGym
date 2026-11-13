// Your own streak flame and freeze (lib/streak-icons.js): what is accepted, and the tints worked
// out from the symbol's colour, readable on the card in both themes.
import { describe, expect, it } from 'vitest'
import { firstEmoji, iconChoice, inkFor, tintsFor, tintCss, contrast, dominantColor, sampleEmojiColor, pickValue, FLAME_CHOICES, FREEZE_CHOICES, FLAME_DEFAULT, FREEZE_DEFAULT } from './streak-icons.js'

describe('what counts as a choice', () => {
  it('takes the first emoji of what was typed, nothing from plain letters', () => {
    expect(firstEmoji('🌟 nice')).toBe('🌟')
    expect(firstEmoji('ab🚀')).toBe('🚀')
    expect(firstEmoji('❤️')).toBe('❤️')
    expect(firstEmoji('👍🏽')).toBe('👍🏽')
    expect(firstEmoji('hello')).toBe('')
    expect(firstEmoji('')).toBe('')
    expect(firstEmoji(null)).toBe('')
  })

  it('cleans a stored value and falls back to the default on anything odd', () => {
    expect(iconChoice({}, 'flame')).toBe(null)
    expect(iconChoice({ flameIcon: { k: 'icon', v: 'bolt' } }, 'flame')).toEqual({ k: 'icon', v: 'bolt', c: '#ffc93c' })
    // An icon from the other set, an unknown one, or the default itself: the default.
    expect(iconChoice({ flameIcon: { k: 'icon', v: 'gift' } }, 'flame')).toBe(null)
    expect(iconChoice({ freezeIcon: { k: 'icon', v: 'snowflake' } }, 'freeze')).toBe(null)
    expect(iconChoice({ flameIcon: { k: 'icon', v: 'nope' } }, 'flame')).toBe(null)
    expect(iconChoice({ flameIcon: { k: 'emoji', v: '🌟', c: '#F5C542' } }, 'flame')).toEqual({ k: 'emoji', v: '🌟', c: '#f5c542' })
    expect(iconChoice({ freezeIcon: { k: 'emoji', v: '🧊', c: 'blue' } }, 'freeze').c).toBe(FREEZE_DEFAULT)
    expect(iconChoice({ flameIcon: { k: 'emoji', v: 'abc' } }, 'flame')).toBe(null)
    expect(iconChoice({ flameIcon: 'bolt' }, 'flame')).toBe(null)
  })

  it('turns a pick into what is stored, the default into nothing', () => {
    expect(pickValue('flame', { k: 'icon', v: 'heart' })).toEqual({ k: 'icon', v: 'heart', c: '#ff375f' })
    expect(pickValue('flame', { k: 'icon', v: 'flame' })).toBe(null)
    expect(pickValue('freeze', { k: 'emoji', v: '🧊' }, () => '#88ccee')).toEqual({ k: 'emoji', v: '🧊', c: '#88ccee' })
    // No canvas to sample from: the default colour, so the tints stay sensible.
    expect(pickValue('flame', { k: 'emoji', v: '🌟' }, () => null).c).toBe(FLAME_DEFAULT)
    expect(pickValue('flame', null)).toBe(null)
  })
})

describe('tints from the colour', () => {
  const all = [...FLAME_CHOICES, ...FREEZE_CHOICES].map(c => c.c).concat(['#ffffff', '#000000', '#ffee00', '#1a1a80', '#777777'])
  it('keeps the ink at 3:1 or more on the card, in light and in dark', () => {
    for (const c of all) {
      expect(contrast(inkFor(c, 'light'), '#ffffff')).toBeGreaterThanOrEqual(3)
      expect(contrast(inkFor(c, 'dark'), '#1c1c1e')).toBeGreaterThanOrEqual(3)
    }
  })

  it('leaves a colour that already reads alone, and keeps its hue when it has to move', () => {
    expect(inkFor('#ff375f', 'dark')).toBe('#ff375f')
    const light = inkFor('#ffd60a', 'light')
    expect(light).not.toBe('#ffd60a')
    const [r, g, b] = [1, 3, 5].map(i => parseInt(light.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(b); expect(g).toBeGreaterThan(b)
  })

  it('gives a softer wash in light than in dark', () => {
    const t = tintsFor('#ff375f')
    expect(t.dark.soft).toMatch(/,0\.16\)$/)
    expect(t.light.soft).toMatch(/,0\.12\)$/)
  })

  it('writes nothing with both on the default, and per theme what was picked', () => {
    expect(tintCss({})).toBe('')
    const css = tintCss({ freezeIcon: { k: 'icon', v: 'heart' } })
    expect(css).toMatch(/:root:not\(\[data-theme="light"\]\)\{--frost:#[0-9a-f]{6};--frost-soft:rgba/)
    expect(css).toMatch(/:root\[data-theme="light"\]\{--frost:/)
    expect(css).not.toMatch(/--streak-ink/)
    expect(tintCss({ flameIcon: { k: 'icon', v: 'bolt' } })).toMatch(/--streak-ink:.*--flame-soft:/)
  })
})

describe('an emoji\'s colour', () => {
  const buf = pixels => new Uint8ClampedArray(pixels.flat())
  it('is the most common saturated colour, not the white or black bits', () => {
    const red = [230, 30, 40, 255], white = [255, 255, 255, 255], clear = [0, 0, 0, 0]
    const hex = dominantColor(buf([red, red, red, white, white, white, white, clear, clear]))
    expect(hex).toBe('#e61e28')
  })

  it('is grey for a grey emoji, and nothing for an empty canvas', () => {
    expect(dominantColor(buf([[120, 120, 120, 255], [140, 140, 140, 255]]))).toBe('#828282')
    expect(dominantColor(buf([[0, 0, 0, 0]]))).toBe(null)
  })

  it('is sampled from a canvas, and null without one', () => {
    const ctx = { clearRect () {}, fillText () {}, getImageData: () => ({ data: buf([[20, 120, 230, 255], [20, 120, 230, 255]]) }) }
    expect(sampleEmojiColor('🧊', () => ({ getContext: () => ctx }))).toBe('#1478e6')
    expect(sampleEmojiColor('🧊', () => null)).toBe(null)
    expect(sampleEmojiColor('🧊', () => ({ getContext: () => { throw new Error('no') } }))).toBe(null)
    expect(sampleEmojiColor('abc')).toBe(null)
  })
})
