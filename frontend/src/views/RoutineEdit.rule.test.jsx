// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '../lib/exercises.js'
import { validatePlanRule } from '../lib/prescription/index.js'
import { ruleOccurrence } from '../lib/test-fixtures.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exConfigSheet } from '../sheets.jsx'

const ex = EXDB.find(e => e.id === '0009')
const routine = { id: 'routine', ex: [] }
let root
let host

function render(existing, onSave = vi.fn()) {
  exConfigSheet(ex, existing, onSave, null, routine)
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return onSave
}
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const increase = label => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === label).querySelector('[aria-label="Increase"]')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
})

afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  root = null; host = null
})

describe('occurrence rule editor', () => {
  it('saves a new occurrence with a valid default rule', () => {
    const onSave = render(null)
    act(() => button('Add to routine').click())
    const saved = onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ exerciseId: ex.id, rule: { exerciseId: ex.id, routineId: 'routine', revision: 1 } })
    expect(validatePlanRule(saved.rule).ok).toBe(true)
  })

  it('keeps the revision when nothing changed and bumps it when the reps range is edited', () => {
    const existing = ruleOccurrence(ex.id, { occurrenceId: 'occ', routineId: 'routine', preset: 'double' })
    const unchanged = render(existing)
    act(() => button('Save').click())
    expect(unchanged.mock.calls[0][0]).toMatchObject({ occurrenceId: 'occ', rule: { preset: 'double', revision: 1 } })
    act(() => root.unmount()); host.remove()

    const onSave = render(existing)
    act(() => increase('Reps to').click())
    act(() => button('Save').click())
    const saved = onSave.mock.calls[0][0]
    expect(saved.occurrenceId).toBe('occ')
    expect(saved.rule.parameters.reps.max).toBe(existing.rule.parameters.reps.max + 1)
    expect(saved.rule.revision).toBe(2)
    expect(validatePlanRule(saved.rule).ok).toBe(true)
  })
})
