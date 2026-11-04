// @vitest-environment happy-dom
import React, { act } from 'react'
import { editPlan } from './lib/prescription/index.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { exOr } from './lib/exercises.js'
import { ruleOccurrence } from './lib/test-fixtures.js'

// #322: "Per side" on a timed hold means the whole hold once per side, so the planned sets double.
const PLANK = '0089'
const mounted = []

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const holdOccurrence = extra => {
  const occ = ruleOccurrence(PLANK, { preset: 'autoregulated', occurrenceId: 'o1', routineId: 'r1' })
  occ.rule = editPlan(occ.rule, { sets: { min: 3, max: 3 }, durationSeconds: { min: 30, max: 60 }, reps: { min: 1, max: 1 } })
  return { ...occ, ...extra }
}
const sideRow = host => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Per side')
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()

describe('exercise settings: per side on a timed hold', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('offers it on a hold, saying what it does to the sets, and saves the flag', () => {
    const onSave = vi.fn()
    exConfigSheet(exOr(PLANK), holdOccurrence(), onSave)
    const host = render(useUI.getState().sheets.at(-1))
    expect(sideRow(host).textContent).toContain('For side planks, single-arm holds and the like.')
    act(() => sideRow(host).querySelector('[role=switch]').click())
    expect(sideRow(host).textContent).toContain('3 sets become 6: one on each side, 30s held every time.')
    act(() => save(host))
    expect(onSave.mock.calls[0][0].side).toBe(true)
  })

  it('keeps a hold that was per side per side, and lets it go', () => {
    const onSave = vi.fn()
    exConfigSheet(exOr(PLANK), holdOccurrence({ side: true }), onSave)
    const host = render(useUI.getState().sheets.at(-1))
    act(() => sideRow(host).querySelector('[role=switch]').click())
    act(() => save(host))
    expect(onSave.mock.calls[0][0].side).toBeUndefined()
  })
})
