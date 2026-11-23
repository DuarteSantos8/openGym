// @vitest-environment happy-dom
// A new weigh-in far off the last asks before it is saved (lib/weigh-in-check.js), as a likely
// typo asks at the tick; editing a weigh-in never asks.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
function openTop() {
  const s = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(s.render(() => useUI.getState().closeSheet(s.id))))
  return host
}
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const btn = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const weights = () => useStore.getState().S.bodyweight.map(b => b.w)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  const st = clone(DEF)
  Object.assign(st, { unit: 'kg', bodyweight: [{ d: '2026-11-01', w: 70 }], targetW: null })
  useStore.setState({ S: st, user: null })
  document.body.innerHTML = ''
})
afterEach(() => act(() => { mounted.splice(0).forEach(r => r.unmount()) }))

describe('a weigh-in far off the last', () => {
  it('asks first: Fix it saves nothing and keeps the sheet, Save saves as typed', () => {
    act(() => bwSheet())
    const sheet = openTop()
    act(() => type(sheet.querySelector('.bw-read input'), '82.6'))
    act(() => btn(sheet, 'Save').click())
    const ask = openTop()
    expect(ask.textContent).toContain('82.6 kg is 18% off your last weigh-in, 70 kg. Save it?')
    expect(weights()).toEqual([70])
    act(() => btn(ask, 'Fix it').click())
    expect(weights()).toEqual([70])
    expect(useUI.getState().sheets).toHaveLength(1)   // the weigh-in, to correct
    act(() => btn(sheet, 'Save').click())
    const again = openTop()
    act(() => btn(again, 'Save').click())
    expect(weights()).toContain(82.6)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('in lb, says lb', () => {
    useStore.setState(s => ({ S: { ...s.S, unit: 'lb', bodyweight: [{ d: '2026-11-01', w: 160 }] } }))
    act(() => bwSheet())
    const sheet = openTop()
    act(() => type(sheet.querySelector('.bw-read input'), '200'))
    act(() => btn(sheet, 'Save').click())
    expect(openTop().textContent).toContain('200 lb is 25% off your last weigh-in, 160 lb. Save it?')
  })

  it('a usual change saves at once', () => {
    act(() => bwSheet())
    const sheet = openTop()
    act(() => type(sheet.querySelector('.bw-read input'), '71'))
    act(() => btn(sheet, 'Save').click())
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(weights()).toContain(71)
  })

  it('editing a weigh-in never asks, however far off', () => {
    act(() => bwSheet({ edit: { d: '2026-11-01', id: '0' } }))
    const sheet = openTop()
    act(() => type(sheet.querySelector('.bw-read input'), '95'))
    act(() => btn(sheet, 'Save').click())
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(weights()).toEqual([95])
  })
})
