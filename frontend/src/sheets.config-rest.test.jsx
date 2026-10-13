// @vitest-environment happy-dom
import React, { act } from 'react'
import { editPlan, planPhase } from './lib/prescription/index.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { ruleOccurrence } from './lib/test-fixtures.js'

// v1.3.11: an exercise's own rest is set on the same wheel as the default rest timer, where 0:00
// means "no rest of its own" and the row says which default applies then.
const ex = EXDB.find(e => e.id === '0009')
const mounted = []
const occurrence = (restSeconds, extra = {}) => {
  const occ = ruleOccurrence(ex.id, { occurrenceId: 'o1', routineId: 'r1' })
  occ.rule = editPlan(occ.rule, { restSeconds: restSeconds })
  return { ...occ, ...extra }
}

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const restRow = host => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Rest for this exercise')
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()
const done = wheel => act(() => [...wheel.querySelectorAll('button')].find(b => b.textContent === 'Done').click())

describe('exercise settings: rest on the wheel', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', restSec: 120 } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('reads Default with the profile\'s rest when the exercise has none, and keeps it on Done at 0:00', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, occurrence(120, { restFromProfile: true }), onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('Default (2:00)')
    act(() => restRow(host).click())
    const wheel = render(useUI.getState().sheets.at(-1))
    expect(wheel.querySelector('h3').textContent).toBe('Rest for this exercise')
    expect(wheel.querySelector('.dw-read').textContent).toBe('Default (2:00)')
    // The copy names the wheel's 0:00, not a "0" the row never shows (QA 10-05).
    expect(wheel.textContent).toContain('0:00 means your default rest.')
    done(wheel)
    act(() => save(host))
    expect(onSave.mock.calls[0][0].restFromProfile).toBe(true)
  })

  it('shows an exercise\'s own rest as a time, and the wheel opens on it', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, occurrence(75), onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(restRow(host).querySelector('.lrow-v').textContent).toBe('1:15')
    act(() => restRow(host).click())
    const wheel = render(useUI.getState().sheets.at(-1))
    expect(wheel.querySelector('.dw-read').textContent).toBe('1:15')
    done(wheel)
    act(() => save(host))
    const saved = onSave.mock.calls[0][0]
    expect(planPhase(saved.rule).parameters.restSeconds).toBe(75)
    expect(saved.restFromProfile).toBeUndefined()
  })
})
