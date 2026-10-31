// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { isSimple } from './simple.js'
import { DEF } from '../store/useStore.js'

describe('simple mode', () => {
  it('is on for a profile that says so, and off when it is switched off', () => {
    expect(isSimple({ ...DEF, simple: true })).toBe(true)
    expect(isSimple({ ...DEF, simple: false })).toBe(false)
  })

  it('is the default of a normal build; the test suite builds with the full app (VITE_FULL_UI)', () => {
    expect(DEF.simple).toBe(import.meta.env.VITE_FULL_UI !== '1')
  })

  it('reads a state built without the key as the full app', () => {
    expect(isSimple({})).toBe(false)
    expect(isSimple(null)).toBe(false)
    expect(isSimple(undefined)).toBe(false)
  })
})
