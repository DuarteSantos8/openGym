// @vitest-environment happy-dom
// P3 on a whole screen: the weigh-in sheet in German reads 82,5 in the field, on the chips
// beside it and in the button names, and still saves the number 82.5.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bwSheet } from './sheets.jsx'

const mounted = []
const type = (el, value) => {
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
  return { host, input: host.querySelector('.bw-read input'), chips: () => [...host.querySelectorAll('.chips .chip')].map(c => c.textContent) }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [], targetW: null } }))
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  _setLangState('en', null, null, null)
})

describe('weigh-in sheet separators', () => {
  it.each([['en', '.'], ['de', ','], ['ru', ','], ['fr', ','], ['ar', '.']])('%s: field, chips and slider agree on "%s"', (lang, sep) => {
    _setLangState(lang, {}, null, null)
    const { host, input, chips } = renderBw()
    act(() => type(input, ''))
    for (const k of '82.5') act(() => type(input, input.value + k))
    expect(input.value).toBe('82' + sep + '5')
    expect(chips()).toEqual(['−1', '−0' + sep + '5', '+0' + sep + '5', '+1'])
    // The slider reports the plain number: what is stored is 82.5 in every language.
    expect(host.querySelector('.sld').getAttribute('aria-valuenow')).toBe('82.5')
    act(() => [...host.querySelectorAll('.chips .chip')][2].click())
    expect(input.value).toBe('83')
    act(() => [...host.querySelectorAll('.bw-pm')][1].click())
    expect(input.value).toBe('83' + sep + '1')
  })
})
