// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIDX } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, setCoefficientSheet } from './sheets.jsx'

const mounted = []
function renderLatest() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const save = host => act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click())

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
})
afterEach(() => act(() => mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() })))

describe('set coefficient controls', () => {
  it.each([
    ['0025', { sets: 3, reps: 10, weight: 40 }],
    ['0025', { sets: 3, mode: 'time', sec: 30 }],
    ['2138', { sets: 1, min: 20, speed: 8 }],
  ])('saves and reopens the coefficient for %s in every exercise mode', (id, cfg) => {
    const onSave = vi.fn()
    exConfigSheet(EXIDX[id], { ...cfg, setCoefficient: 0.3 }, onSave)
    const host = renderLatest()
    const more = host.querySelector('[aria-label="Increase Set coefficient"]')
    expect(more).toBeTruthy()
    act(() => more.click())
    save(host)
    expect(onSave.mock.calls[0][0].setCoefficient).toBe(0.4)
    exConfigSheet(EXIDX[id], onSave.mock.calls[0][0], vi.fn())
    expect(renderLatest().querySelector('[aria-label="Increase Set coefficient"]').parentElement.querySelector('input').value).toBe('0.4')
  })

  it('omits the default from a saved routine and preserves an explicit zero', () => {
    for (const value of [1, 0]) {
      const onSave = vi.fn()
      exConfigSheet(EXIDX['0025'], { sets: 3, reps: 10, weight: 40, setCoefficient: value }, onSave)
      save(renderLatest())
      expect(onSave.mock.calls[0][0].setCoefficient).toBe(value === 1 ? undefined : 0)
    }
  })

  it('lets a set override a fractional exercise default back to one', () => {
    const pick = vi.fn()
    setCoefficientSheet(0.9, pick)
    const host = renderLatest()
    act(() => host.querySelector('[aria-label="Increase Set coefficient"]').click())
    save(host)
    expect(pick).toHaveBeenCalledWith(1)
  })
})
