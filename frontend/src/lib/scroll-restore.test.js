import { describe, expect, it } from 'vitest'
import { scrollAction } from './scroll-restore.js'

describe('the scroll on a route change', () => {
  it('a fresh load and a forward navigation start at the top', () => {
    expect(scrollAction({ first: true, samePath: false, navType: 'POP', tabSwitch: false })).toBe('top')
    expect(scrollAction({ first: false, samePath: false, navType: 'PUSH', tabSwitch: false })).toBe('top')
    expect(scrollAction({ first: false, samePath: false, navType: 'REPLACE', tabSwitch: false })).toBe('top')
  })

  it('back to a page restores where it was', () => {
    expect(scrollAction({ first: false, samePath: false, navType: 'POP', tabSwitch: false })).toBe('restore')
  })

  it('a sheet unwinding its entry leaves the page alone', () => {
    expect(scrollAction({ first: false, samePath: true, navType: 'POP', tabSwitch: false })).toBe('keep')
  })

  it('arriving in another tab restores its page, though the router calls it a push', () => {
    expect(scrollAction({ first: false, samePath: false, navType: 'PUSH', tabSwitch: true })).toBe('restore')
    expect(scrollAction({ first: false, samePath: false, navType: 'REPLACE', tabSwitch: true })).toBe('restore')
  })
})
