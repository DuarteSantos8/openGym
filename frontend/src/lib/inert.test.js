// @vitest-environment happy-dom
// lib/inert.js: counted holds, and the last release puts back what the element was.
import { describe, expect, it } from 'vitest'
import { holdInert } from './inert.js'

describe('holdInert', () => {
  it('stays inert until the last hold lets go', () => {
    const e = document.createElement('div')
    const a = holdInert([e]), b = holdInert([e])
    a(); expect(e.inert).toBe(true)
    b(); expect(e.inert).toBe(false)
  })

  // CodeRabbit on #1045: an element already inert (a swipe preview's page) stays inert after a dialog.
  it('puts back an inert that was there before', () => {
    const e = document.createElement('div')
    e.inert = true
    holdInert([e])()
    expect(e.inert).toBe(true)
  })
})
