// @vitest-environment happy-dom
// A weigh-in more than 15 % off the last one asks before it is saved: 7.8 for 78 is a slip, not a
// diet (thanks @lodepav, whose #1514 had the idea). Fix it goes back to the number; Save as typed
// keeps it. An edit and a first weigh-in never ask.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet } from './sheets.jsx'
import { allReadings } from './lib/weigh-ins.js'

const mounted = []
const type = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function top() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const readings = () => allReadings(useStore.getState().S.bodyweight).map(r => r.w)
const logAs = value => {
  bwSheet()
  const host = top()
  act(() => type(host.querySelector('.bw-read input'), value))
  act(() => { button(host, 'Save').click() })
  return host
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [{ d: '2026-01-05', w: 78 }], targetW: null } }))
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('weigh-in typo check', () => {
  it('asks about 7.8 after 78, and Fix it saves nothing', () => {
    logAs('7.8')
    expect(readings()).toEqual([78])
    const ask = top()
    expect(ask.textContent).toContain('7.8 kg is more than 15% off your last weigh-in, 78 kg.')
    act(() => { button(ask, 'Fix it').click() })
    expect(readings()).toEqual([78])
    // back on the weigh-in sheet, the number still there to correct
    expect(useUI.getState().sheets.length).toBe(1)
  })

  it('Save as typed keeps it', () => {
    logAs('62')
    const ask = top()
    act(() => { button(ask, 'Save as typed').click() })
    expect(readings()).toEqual([78, 62])
    expect(useUI.getState().sheets.length).toBe(0)
  })

  it('saves an ordinary change without asking', () => {
    logAs('76.4')
    expect(readings()).toEqual([78, 76.4])
    expect(useUI.getState().sheets.length).toBe(0)
  })

  it('never asks on the first weigh-in', () => {
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [] } }))
    logAs('120')
    expect(readings()).toEqual([120])
  })
})
