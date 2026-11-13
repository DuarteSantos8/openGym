// @vitest-environment happy-dom
// A machine's own weight stack (issue #688): the editor under Plate loading writes the weights a
// machine really has for that exercise, stamped, the way lib/dumbbells.js stackOf reads them.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { barWeightSheet } from './sheets.jsx'

const FLY = '0596'      // lever seated fly
const SQUAT = '0043'    // barbell
const DIP = '0009'      // assisted chest dip

const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const S = () => useStore.getState().S
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (input, v) => act(() => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const field = (host, label) => host.querySelector(`input[aria-label="${label}"]`)

describe('weight stack editor', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('fills an even stack, takes the odd weight added, and a tap takes one off', () => {
    act(() => barWeightSheet(FLY, { id: FLY }))
    const host = mountTopSheet()
    expect(host.textContent).toContain('Weight stack')
    expect(host.textContent).toContain('No list yet')
    type(field(host, 'Weight stack: First (kg)'), '5')
    type(field(host, 'Weight stack: Step (kg)'), '6.8')
    type(field(host, 'How many'), '4')
    act(() => button(host, 'Fill in').click())
    expect(S().stackWeights[FLY]).toMatchObject({ unit: 'kg', weights: [5, 11.8, 18.6, 25.4], _ts: expect.any(Number) })
    type(field(host, 'Weight stack: Weight (kg)'), '11.3')
    act(() => button(host, 'Add').click())
    expect(S().stackWeights[FLY].weights).toEqual([5, 11.3, 11.8, 18.6, 25.4])
    act(() => host.querySelector('[aria-label="Remove 11.8 kg"]').click())
    expect(S().stackWeights[FLY].weights).toEqual([5, 11.3, 18.6, 25.4])
    act(() => button(host, 'Clear the list').click())
    expect(S().stackWeights[FLY]).toEqual({ _ts: expect.any(Number) })
  })

  it('takes a pasted list, and the quick fill adds a second run once there is a list (#926)', () => {
    act(() => barWeightSheet(FLY, { id: FLY }))
    const host = mountTopSheet()
    act(() => button(host, 'Add several at once').click())
    const area = host.querySelector('textarea[aria-label="Weights (kg)"]')
    act(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      set.call(area, '5\n11.3\n18.1, 25')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => button(host, 'Add all').click())
    expect(S().stackWeights[FLY].weights).toEqual([5, 11.3, 18.1, 25])
    expect(host.querySelector('textarea')).toBeNull()
    expect(button(host, 'Fill in')).toBeUndefined()
    type(field(host, 'Weight stack: First (kg)'), '30')
    type(field(host, 'Weight stack: Step (kg)'), '5')
    type(field(host, 'How many'), '3')
    act(() => button(host, 'Add these').click())
    expect(S().stackWeights[FLY].weights).toEqual([5, 11.3, 18.1, 25, 30, 35, 40])
  })

  it('is not offered on a barbell or an assistance machine', () => {
    act(() => barWeightSheet(SQUAT, { id: SQUAT }))
    expect(mountTopSheet().textContent).not.toContain('Weight stack')
    act(() => barWeightSheet(DIP, { id: DIP }))
    expect(mountTopSheet().textContent).not.toContain('Weight stack')
  })
})
