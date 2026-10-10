// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, setsLine } from './sheets.jsx'
import { migratedFixture } from './lib/test-fixtures.js'
import { planOptions } from './lib/prescription/index.js'
import { bindUI } from './components/ui.jsx'

// Sets to failure: "Last set to failure" on the exercise's settings, written only when on.
const ex = EXDB.find(e => e.id === '0009')
const mounted = []

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const open = (cfg, onSave) => {
  exConfigSheet(ex, migratedFixture({ unit: 'kg', routines: [{ id: 'r', ex: [{ id: ex.id, sets: 3, reps: 5, weight: 40, mode: 'reps', ...cfg }] }] }).routines[0].ex[0], onSave)
  return render(useUI.getState().sheets.at(-1))
}
const rowNamed = (host, title) => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const save = host => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())

describe('exercise settings: last set to failure', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('is off by default and saves nothing then', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    expect(rowNamed(host, 'Last set to failure').querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false')
    save(host)
    expect('lastToFailure' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('switched on, it saves the flag and says what it does', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    act(() => rowNamed(host, 'Last set to failure').querySelector('[role="switch"]').click())
    expect(host.textContent).toContain('counts as all-out effort unless you rate it')
    save(host)
    expect(onSave.mock.calls[0][0].lastToFailure).toBe(true)
  })

  it('comes on with Greyskull, whose last set is an AMRAP, unless it was already decided', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    act(() => rowNamed(host, 'Progression').click())
    const picker = render(useUI.getState().sheets.at(-1))
    act(() => [...picker.querySelectorAll('button.lrow')].find(el => el.querySelector('.lrow-t')?.textContent === 'Greyskull LP').click())
    expect(rowNamed(host, 'Last set to failure').querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
    save(host)
    expect(onSave.mock.calls[0][0]).toMatchObject({ rule: { preset: 'greyskull' }, lastToFailure: true })
  })

  it('is not offered on a pyramid, which has its own Max set', () => {
    const host = open({ pyramid: [12, 8, 0] })
    expect(rowNamed(host, 'Last set to failure')).toBeUndefined()
  })

  it('the finish summary line marks a failure set', () => {
    expect(setsLine([{ w: 60, r: 5 }, { w: 60, r: 9, f: true }], 'kg')).toBe('60 kg × 5, 9 F')
    expect(setsLine([{ w: 60, r: 5 }, { w: 65, r: 4, f: true }], 'kg')).toBe('60×5 · 65×4 F')
  })
})
