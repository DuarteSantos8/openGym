// @vitest-environment happy-dom
// The dumbbell inventory sheet (Settings → Equipment → Dumbbells, issue #376) writes the list of
// bells for the profile's unit, stamped, the way lib/dumbbells.js reads it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { dumbbellInventorySheet } from './sheets.jsx'

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
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(text))
const chips = host => [...host.querySelectorAll('.chip')].map(c => c.textContent.trim())

describe('dumbbell inventory sheet', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('starts empty, fills the usual rack, and a tap takes a bell off', () => {
    act(() => dumbbellInventorySheet())
    const host = mountTopSheet()
    expect(host.textContent).toContain('No list yet')
    act(() => button(host, 'Fill in 2 to 50 kg, every 2').click())
    expect(S().dumbbells.kg.weights).toHaveLength(25)
    expect(S().dumbbells.kg._ts).toEqual(expect.any(Number))
    expect(chips(host)[0]).toBe('2')
    act(() => host.querySelector('[aria-label="Remove 2 kg"]').click())
    expect(S().dumbbells.kg.weights[0]).toBe(4)
    act(() => button(host, 'Clear the list').click())
    expect(S().dumbbells.kg.weights).toEqual([])
  })

  it('adds a typed weight in order and keeps the other unit alone', () => {
    useStore.setState(s => ({ S: { ...s.S, dumbbells: { kg: { weights: [3, 9], _ts: 1 }, lb: { weights: [10], _ts: 1 } } } }))
    act(() => dumbbellInventorySheet())
    const host = mountTopSheet()
    const input = host.querySelector('input')
    act(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(input, '6')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => button(host, 'Add').click())
    expect(S().dumbbells.kg.weights).toEqual([3, 6, 9])
    expect(S().dumbbells.lb).toEqual({ weights: [10], _ts: 1 })
  })

  it('offers the lb rack to a lb profile', () => {
    useStore.setState(s => ({ S: { ...s.S, unit: 'lb' } }))
    act(() => dumbbellInventorySheet())
    const host = mountTopSheet()
    act(() => button(host, 'Fill in 5 to 100 lb, every 5').click())
    expect(S().dumbbells.lb.weights.slice(0, 3)).toEqual([5, 10, 15])
  })
})
