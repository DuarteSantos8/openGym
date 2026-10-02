// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

// The exercise settings' number fields with a floor (a drop-set's drops and weight drop, a
// rest-pause's reps and rest) or a range (the Epley deload) were clamped on every keystroke, like
// the workout duration was: an emptied field snapped back to its minimum and the digits typed next
// landed after it, so a weight drop retyped as 20 read 520 and a deload typed as 80 read 95.
const ex = EXDB.find(e => e.id === '0009')   // a weighted machine exercise: Epley deload applies
const mounted = []

function renderConfig(cfg) {
  const onSave = vi.fn()
  exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', ...cfg }, onSave)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
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

  it('lets the deload percentage be retyped, held to 50–95 on leaving the field', () => {
    const { host, onSave } = renderConfig({ prog: 'linear' })
    const deload = field(host, 'Deload 1RM (%)')
    expect(deload.value).toBe('90')
    act(() => type(deload, ''))
    expect(deload.value).toBe('')
    act(() => type(deload, '8'))
    expect(deload.value).toBe('8')
    act(() => type(deload, '80'))
    expect(deload.value).toBe('80')
    act(() => leave(deload))
    expect(deload.value).toBe('80')
    act(() => type(deload, '99'))
    act(() => leave(deload))
    expect(deload.value).toBe('95')
    act(() => type(deload, '85'))
    act(() => save(host))
    expect(onSave.mock.calls[0][0].deloadFactor).toBe(0.85)
  })
})

// QA 1.3.9: a timed bodyweight hold showed "Weight (kg)" and "Added (kg)", two fields bound to
// the same value, under a Bodyweight row that said to "just log the reps".
describe('exercise settings: a timed bodyweight hold', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })
  const labels = host => [...host.querySelectorAll('.stp-l')].map(l => l.textContent)

  it('has one weight field, the added load, and talks about the hold', () => {
    const { host } = renderConfig({ mode: 'time', sec: 45, weight: 0, bodyweight: true })
    expect(labels(host)).not.toContain('Weight (kg)')
    expect(labels(host).filter(l => l === 'Added (kg)')).toHaveLength(1)
    expect(host.textContent).toContain('No weight to enter — just time the hold.')
    expect(host.textContent).not.toContain('just log the reps')
  })

  it('keeps the one weight field on a loaded hold', () => {
    const { host } = renderConfig({ mode: 'time', sec: 45, weight: 10, bodyweight: false })
    expect(labels(host)).toContain('Weight (kg)')
    expect(labels(host)).not.toContain('Added (kg)')
  })
})
