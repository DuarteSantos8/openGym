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

// The exercise settings' number fields with a floor (a drop-set's drops and weight drop, a
// rest-pause's reps and rest) or a range (the Epley deload) were clamped on every keystroke, like
// the workout duration was: an emptied field snapped back to its minimum and the digits typed next
// landed after it, so a weight drop retyped as 20 read 520 and a deload typed as 80 read 95.
const ex = EXDB.find(e => e.id === '0009')   // a weighted machine exercise
const mounted = []

function renderConfig(cfg) {
  const onSave = vi.fn()
  exConfigSheet(ex, { ...ruleOccurrence(ex.id), ...cfg }, onSave)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  // The intensifier fields sit in a disclosure that starts shut.
  act(() => [...host.querySelectorAll('.disc .lrow, .disc button, .disc [role=button]')].find(e => e.textContent.startsWith('Intensifier'))?.click())
  return { host, onSave }
}
// The last field so labelled: "Rest (s)" is also the exercise's own rest, further up the sheet.
const field = (host, label) => [...host.querySelectorAll('.stp-w')].filter(w => w.querySelector('.stp-l')?.textContent === label).at(-1).querySelector('input.num')
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const leave = el => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
const save = host => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click()

describe('exercise settings: typing into a field with a minimum', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('lets a drop-set field be emptied and retyped, and saves what was typed', () => {
    const { host, onSave } = renderConfig({ intensifier: { type: 'dropset', count: 2, pct: 10 } })
    const pct = field(host, 'Weight drop (%)')
    act(() => type(pct, ''))
    expect(pct.value).toBe('')
    act(() => type(pct, '20'))
    expect(pct.value).toBe('20')
    const drops = field(host, 'Drops')
    act(() => type(drops, ''))
    act(() => type(drops, '3'))
    expect(drops.value).toBe('3')
    act(() => save(host))
    expect(onSave.mock.calls[0][0].intensifier).toEqual({ type: 'dropset', count: 3, pct: 20 })
  })

  it('holds a field left below its minimum to it, on leaving it or on saving straight from it', () => {
    const { host, onSave } = renderConfig({ intensifier: { type: 'restpause', totalReps: 8, restSec: 15 } })
    const rest = field(host, 'Rest (s)')
    act(() => type(rest, '2'))
    expect(rest.value).toBe('2')
    act(() => leave(rest))
    expect(rest.value).toBe('5')
    act(() => type(field(host, 'Rest-pause reps'), ''))   // saved without leaving the field
    act(() => save(host))
    expect(onSave.mock.calls[0][0].intensifier).toEqual({ type: 'restpause', totalReps: 1, restSec: 5 })
  })
})

// Issue #60 on the engine: "Reps per side" is saved on the occurrence and rounds the reps up to even.
describe('exercise settings: reps per side', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('saves the flag and an even rep target, and drops it again when switched off', () => {
    const base = ruleOccurrence(ex.id)
    const { host, onSave } = renderConfig({ rule: editPlan(base.rule, { reps: { min: 9, max: 9 } }) })
    const toggle = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Reps per side')).querySelector('[role=switch]').click()
    act(toggle)
    act(() => save(host))
    expect(onSave.mock.calls[0][0]).toMatchObject({ side: true }); expect(planPhase(onSave.mock.calls[0][0].rule).parameters).toMatchObject({ reps: { min: 10, max: 10 } })
    const again = renderConfig({ side: true })
    act(() => [...again.host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Reps per side')).querySelector('[role=switch]').click())
    act(() => save(again.host))
    expect('side' in again.onSave.mock.calls[0][0]).toBe(false)
  })
})

// Main's Bodyweight switch and Plate loading section, on the engine's occurrence.
describe('exercise settings: bodyweight and plate loading', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', loadKind: {}, barWeights: {} } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })
  const bwSwitch = host => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Bodyweight')).querySelector('[role=switch]')

  it('saves the override, drops the load where the preset runs without one, and keeps it where it steps it', () => {
    const manual = ruleOccurrence(ex.id, { preset: 'autoregulated', options: { load: { mode: 'absolute', value: 40, unit: 'kg' } } })
    const one = renderConfig(manual)
    expect(bwSwitch(one.host).getAttribute('aria-checked')).toBe('false')
    act(() => bwSwitch(one.host).click())
    act(() => save(one.host))
    expect(one.onSave.mock.calls[0][0]).toMatchObject({ bodyweight: true }); expect(planPhase(one.onSave.mock.calls[0][0].rule).parameters).toMatchObject({ load: { mode: 'empty' } })

    const two = renderConfig({})   // linear: the load is what it steps, so it stays as added weight
    act(() => bwSwitch(two.host).click())
    act(() => save(two.host))
    expect(two.onSave.mock.calls[0][0]).toMatchObject({ bodyweight: true }); expect(planPhase(two.onSave.mock.calls[0][0].rule).parameters).toMatchObject({ load: { mode: 'absolute' } })

    const three = renderConfig({ bodyweight: true })   // switched back to what the catalogue says: no override
    act(() => bwSwitch(three.host).click())
    act(() => save(three.host))
    expect('bodyweight' in three.onSave.mock.calls[0][0]).toBe(false)
  })

  it('sets how the exercise is loaded, for every plan it is in', () => {
    const { host } = renderConfig({})
    const plates = [...host.querySelectorAll('.disc .lrow, .disc button, .disc [role=button]')].find(e => e.textContent.startsWith('Plate loading'))
    expect(plates.textContent).toContain('Off')   // a leverage machine has no plate math by default
    act(() => plates.click())
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Per side').click())
    expect(useStore.getState().S.loadKind[ex.id]).toMatchObject({ kind: 'pairs' })
  })
})
