import { describe, expect, it } from 'vitest'
import { scrubMove } from './scrubby-input.js'

describe('scrub distance consumption', () => {
  const next = (v, d) => Math.max(0, Math.min(10, v + d))
  it('keeps fractional movement for the next event and reverses exactly', () => {
    expect(scrubMove(100, 83, 5, next)).toEqual({ value: 5, y: 100 })
    const up = scrubMove(100, 63, 5, next)
    expect(up).toEqual({ value: 7, y: 64 })
    expect(scrubMove(up.y, 100, up.value, next)).toEqual({ value: 5, y: 100 })
  })
  it('does not accumulate unreachable steps at a limit', () => {
    const end = scrubMove(100, -800, 10, next)
    expect(end).toEqual({ value: 10, y: -800 })
    expect(scrubMove(end.y, -782, end.value, next).value).toBe(9)
  })
})
