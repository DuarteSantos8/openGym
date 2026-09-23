// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet } from './sheets.jsx'

// The big weight read-out (body weight, goal, top weight after an exercise) used to be text:
// the only ways to a number were the slider, ±0.1 and the ±0.5/±1 chips, so 72.3 → 85.7 was a
// drag you then corrected tap by tap. It is a field now. These pin the two things that make
// typing into it usable — a half-typed value is not clamped back at you, and the controls
// around it carry on from what you typed — plus the ceiling: the slider stops at 300 kg, a
// typed weight does not.
const mounted = []

function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function renderBw() {
  bwSheet()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  const input = host.querySelector('.bw-read input')
  const slider = host.querySelector('.sld')
  const button = label => [...host.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === label)
  return { host, input, slider, button }
}

describe('weight read-out is a typable field', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [] } }))
    document.body.innerHTML = ''
  })

  afterEach(() => {
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  })

  it('shows the current weight in a decimal field with the unit beside it', () => {
    const { input, host } = renderBw()
    expect(input).toBeTruthy()
    expect(input.value).toBe('70')
    expect(input.getAttribute('inputmode')).toBe('decimal')
    expect(input.getAttribute('aria-label')).toBe('Weight (kg)')
    expect(host.querySelector('.bw-read .u').textContent.trim()).toBe('kg')
  })

  it('keeps a half-typed value on screen instead of clamping it, and moves the slider with it', () => {
    const { input, slider } = renderBw()
    act(() => type(input, ''))
    expect(input.value).toBe('')

    act(() => type(input, '8'))
    expect(input.value).toBe('8')

    act(() => type(input, '82,5'))
    expect(input.value).toBe('82.5')
    expect(slider.getAttribute('aria-valuenow')).toBe('82.5')
  })

  it('steps on from the typed value and saves what ends up on screen', () => {
    const { input, button } = renderBw()
    act(() => type(input, '82.5'))
    act(() => button('plus 0.1').click())
    expect(input.value).toBe('82.6')

    act(() => button('Save').click())
    const bw = useStore.getState().S.bodyweight
    expect(bw).toHaveLength(1)
    expect(bw[0].w).toBe(82.6)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('lets a typed weight sit past the slider ceiling rather than cutting it off', () => {
    const { input, slider, button } = renderBw()
    act(() => type(input, '320'))
    expect(input.value).toBe('320')
    expect(slider.getAttribute('aria-valuenow')).toBe('300')

    act(() => button('Save').click())
    expect(useStore.getState().S.bodyweight[0].w).toBe(320)
  })

  it('still refuses to save an empty field', () => {
    const { input, button } = renderBw()
    act(() => type(input, ''))
    act(() => button('Save').click())
    expect(useStore.getState().S.bodyweight).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})
