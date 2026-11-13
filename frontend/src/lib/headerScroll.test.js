// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { headerProgress } from './headerScroll.js'

const T = 100

describe('headerProgress', () => {
  it('is all at rest at the top, and while pulled down past it', () => {
    for (const y of [0, -1, -80]) expect(headerProgress(y, T, false)).toEqual({ e: 0, t: 0, titleOpacity: 1 })
  })

  it('brings the edge in from T-28 to T-12 and the small title from T-16 to T', () => {
    expect(headerProgress(T - 28, T, false).e).toBe(0)
    expect(headerProgress(T - 20, T, false).e).toBeCloseTo(0.5)
    expect(headerProgress(T - 12, T, false).e).toBe(1)
    expect(headerProgress(T - 16, T, false).t).toBe(0)
    expect(headerProgress(T - 8, T, false).t).toBeCloseTo(0.5)
    expect(headerProgress(T, T, false)).toEqual({ e: 1, t: 1, titleOpacity: 0 })
    expect(headerProgress(T + 500, T, false)).toEqual({ e: 1, t: 1, titleOpacity: 0 })
  })

  it('only ever grows with the scroll position', () => {
    let prev = headerProgress(1, T, false)
    for (let y = 2; y < T + 40; y++) {
      const p = headerProgress(y, T, false)
      expect(p.e).toBeGreaterThanOrEqual(prev.e)
      expect(p.t).toBeGreaterThanOrEqual(prev.t)
      expect(p.titleOpacity).toBeLessThanOrEqual(prev.titleOpacity)
      prev = p
    }
  })

  it('with Reduce Motion jumps once, at T-8, edge and title together', () => {
    expect(headerProgress(T - 9, T, true)).toEqual({ e: 0, t: 0, titleOpacity: 1 })
    expect(headerProgress(T - 8, T, true)).toEqual({ e: 1, t: 1, titleOpacity: 0 })
    for (let y = -5; y < T + 40; y++) expect([0, 1]).toContain(headerProgress(y, T, true).e)
  })

  it('ignores a title that has not been measured', () => {
    expect(headerProgress(50, NaN, false).e).toBe(0)
  })
})

describe('pageY', () => {
  it('reads the pinned offset while an open sheet holds the body', async () => {
    const { pageY } = await import('./useHeaderScroll.js')
    const b = document.body.style
    b.position = 'fixed'; b.top = '-640px'
    expect(pageY()).toBe(640)
    b.position = b.top = ''
    expect(pageY()).toBe(window.scrollY)
  })
})
