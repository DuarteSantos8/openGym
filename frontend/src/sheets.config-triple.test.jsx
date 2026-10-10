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
import { bindUI } from './components/ui.jsx'

// Triple progression (issue #179) on the exercise's settings: picked like any rule, with the set
// ceiling next to the rep range.
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
const open = (cfg, onSave = vi.fn()) => {
  exConfigSheet(ex, migratedFixture({ unit: 'kg', routines: [{ id: 'r', ex: [{ id: ex.id, sets: 3, reps: 12, weight: 40, mode: 'reps', ...cfg }] }] }).routines[0].ex[0], onSave)
  return render(useUI.getState().sheets.at(-1))
}
const rowNamed = (host, title) => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const labels = host => [...host.querySelectorAll('.stp-l')].map(l => l.textContent)
const stepperValue = (host, label) => [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === label)?.querySelector('input')?.value
const save = host => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
const pickRule = (host, name) => {
  act(() => rowNamed(host, 'Progression').click())
  const picker = render(useUI.getState().sheets.at(-1))
  const options = [...picker.querySelectorAll('button.lrow')].map(el => el.querySelector('.lrow-t')?.textContent)
  const el = [...picker.querySelectorAll('button.lrow')].find(b => b.querySelector('.lrow-t')?.textContent === name)
  if (el) act(() => el.click())
  return options
}

describe('exercise settings: triple progression', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('picked as the rule, it shows its explanation, the rep range and where the sets stop', () => {
    const onSave = vi.fn()
    const host = open({}, onSave)
    expect(pickRule(host, 'Triple progression')).toContain('Triple progression')
    expect(host.textContent).toContain('Fill sets and reps up to the top of the range, then add weight.')
    expect(labels(host)).toEqual(expect.arrayContaining(['Sets from', 'Reps from', 'Reps to', 'Sets to']))
    expect(labels(host)).not.toContain('Reps')
    // Room for two more sets to begin with, the usual 3 to 5.
    expect(stepperValue(host, 'Sets to')).toBe('5')
    save(host)
    expect(onSave.mock.calls[0][0].rule.preset).toBe('triple')
    expect(planOptions(onSave.mock.calls[0][0].rule)).toMatchObject({ sets: { min: 3, max: 5 }, reps: { min: 8, max: 12 } })
  })

  it('reopens a saved triple plan with its numbers, and a ceiling at the sets is not written', () => {
    const onSave = vi.fn()
    const host = open({ prog: 'triple', sets: 4, setsMax: 4, reps: 12, repsMin: 8 }, onSave)
    expect(stepperValue(host, 'Sets to')).toBe('4')
    expect(stepperValue(host, 'Reps from')).toBe('8')
    save(host)
    expect(onSave.mock.calls[0][0].rule.preset).toBe('triple')
    expect(planOptions(onSave.mock.calls[0][0].rule)).toMatchObject({ sets: { min: 4, max: 4 }, reps: { min: 8, max: 12 } })
    expect('setsMax' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('is not offered on bodyweight work with nothing added, which climbs reps and sets already', () => {
    const host = open({ bodyweight: true, weight: 0 })
    expect(pickRule(host, 'nothing')).not.toContain('Triple progression')
  })

  it('a plan with another rule saves no set ceiling', () => {
    const onSave = vi.fn()
    const host = open({ prog: 'double', repsMin: 8, setsMax: 5 }, onSave)
    expect(labels(host)).not.toContain('Sets to')
    save(host)
    expect('setsMax' in onSave.mock.calls[0][0]).toBe(false)
  })
})
