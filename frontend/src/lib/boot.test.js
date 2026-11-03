import { expect, it } from 'vitest'
import { bootWait } from './boot.js'

it('lets the logo finish building before it goes', () => {
  expect(bootWait(100, false)).toBe(600)
  expect(bootWait(720, false)).toBe(0)
})

it('waits for the bar to be back on the floor once it is moving', () => {
  expect(bootWait(750, false)).toBe(0)
  expect(bootWait(750 + 300, false)).toBe(950)
  expect(bootWait(750 + 1250 * 3 + 1200, false)).toBe(50)
})

it('goes at once with reduced motion or no timing to read', () => {
  expect(bootWait(300, true)).toBe(0)
  expect(bootWait(NaN, false)).toBe(0)
})
