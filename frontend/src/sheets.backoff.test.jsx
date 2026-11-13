// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { migratedFixture } from './lib/test-fixtures.js'
import { planOptions } from './lib/prescription/index.js'
import { exLine } from './lib/history.js'

// Back-off sets (lib/backoff.js): a switch under the progression Step, saved as `backoff: true`.
const ex = EXDB.find(e => e.id === '0025')          // barbell bench press
const assisted = EXDB.find(e => e.id === '0009')    // assisted chest dip: less load is harder
const mounted = []

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const backoffRow = host => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Back-off sets')
const toggle = host => backoffRow(host).querySelector('button, [role=switch], input[type=checkbox]').click()
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()
const open = (cfg, onSave) => {
  exConfigSheet(ex, migratedFixture({ unit: 'kg', routines: [{ id: 'r', ex: [{ id: ex.id, sets: 3, reps: 6, weight: 26, mode: 'reps', inc: 2, ...cfg }] }] }).routines[0].ex[0], onSave)
  return render(useUI.getState().sheets.at(-1))
}

describe('exercise settings: back-off sets', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('is off by default and saves no field, so the plan keeps its shape', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    expect(backoffRow(host)).toBeTruthy()
    expect(host.textContent).toContain('All sets at the same weight.')
    act(() => save(host))
    expect('backoff' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('switched on, previews the sets and saves the flag', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    act(() => toggle(host))
    expect(host.textContent).toContain('Sets open at 26 → 24 → 22 kg.')
    act(() => save(host))
    const saved = onSave.mock.calls[0][0]
    expect(saved.backoff).toBe(true)
    expect(planOptions(saved.rule).step.value).toBe(2)
    expect(planOptions(saved.rule)).toMatchObject({ sets: { min: 3, max: 3 }, reps: { min: 6, max: 6 }, load: { mode: 'absolute', value: 26 } })
  })

  it('switched off again, drops the flag', () => {
    const onSave = vi.fn()
    const host = open({ backoff: true }, onSave)
    act(() => toggle(host))
    act(() => save(host))
    expect('backoff' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('is not offered on an assistance machine', () => {
    exConfigSheet(assisted, { sets: 3, reps: 6, weight: 30, mode: 'reps' }, vi.fn())
    expect(backoffRow(render(useUI.getState().sheets.at(-1)))).toBeUndefined()
  })

  it('is not offered for pyramid sets', () => {
    const host = open({ pyramid: [12, 10, 8] }, vi.fn())
    expect(backoffRow(host)).toBeUndefined()
  })
})
