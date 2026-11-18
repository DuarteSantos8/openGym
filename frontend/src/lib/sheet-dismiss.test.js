import { describe, expect, it } from 'vitest'
import { dismissesOnRelease, scrolledAboveTop, projectPx, MIN_PULL } from './sheet-dismiss.js'

// #897: scrolling an exercise's how-to back up closed its sheet.
describe('a pulled sheet closes only when it is really thrown away (#897)', () => {
  const height = 700
  it('a short pull or a short flick springs back', () => {
    expect(dismissesOnRelease({ delta: 40, vy: 0.8, height })).toBe(false)   // was a close
    expect(dismissesOnRelease({ delta: 95, vy: 0, height })).toBe(false)     // was a close at 90
    expect(dismissesOnRelease({ delta: MIN_PULL - 1, vy: 3, height })).toBe(false)
  })
  it('a long slow pull, or a real flick, closes', () => {
    expect(dismissesOnRelease({ delta: 300, vy: 0, height })).toBe(true)
    expect(dismissesOnRelease({ delta: 80, vy: 0.6, height })).toBe(true)
  })
  it('a pull moving back up at release stays, however far it went', () => {
    expect(dismissesOnRelease({ delta: 400, vy: -0.2, height })).toBe(false)
  })
  it('a small sheet still needs a real pull', () => {
    expect(dismissesOnRelease({ delta: 100, vy: 0, height: 200 })).toBe(false)
    expect(dismissesOnRelease({ delta: 170, vy: 0, height: 200 })).toBe(true)
  })
  it('projects like a scroll view', () => {
    expect(projectPx(1)).toBeCloseTo(499, 0)
  })
})

describe('a pull inside something scrolled', () => {
  it('belongs to that scroll', () => {
    const sheet = { nodeType: 1, scrollTop: 0, parentNode: null }
    const box = { nodeType: 1, scrollTop: 30, parentNode: sheet }
    const text = { nodeType: 1, scrollTop: 0, parentNode: box }
    expect(scrolledAboveTop(text, sheet)).toBe(true)
    box.scrollTop = 0
    expect(scrolledAboveTop(text, sheet)).toBe(false)
    sheet.scrollTop = 5
    expect(scrolledAboveTop(text, sheet)).toBe(true)
  })
})
