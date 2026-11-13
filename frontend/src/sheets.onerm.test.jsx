// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { beginWorkout } from './sheets.jsx'
import { ruleOccurrence } from './lib/test-fixtures.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { estimate1RMRange } from './lib/onerm.js'
import { fmtNum } from './lib/format.js'

const percentRoutine = { id: 'r1', name: 'Push', ex: [ruleOccurrence('0025', { options: { load: { mode: 'percent_1rm', percent: 70 }, step: { type: 'percentage_points', value: 2.5 } } })] }
let root
let host

function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}
const setInputValue = (el, value) => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', routines: [percentRoutine], prescriptions: {}, oneRepMaxes: {}, progression: {} }, A: null }))
})

afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  root = null; host = null
})

describe('1RM prompt at session start', () => {
  it('asks for a missing 1RM once, then starts with the entered value', () => {
    beginWorkout(['r1'], null)
    expect(useStore.getState().A).toBe(null)
    mountTopSheet()
    act(() => { setInputValue(host.querySelector('input'), '100') })
    act(() => button('Save and start').click())
    const { S, A } = useStore.getState()
    expect(Object.values(S.oneRepMaxes)).toEqual([expect.objectContaining({ exerciseId: '0025', value: 100, source: 'manual' })])
    expect(A.entries[0].sets[0].w).toBe(70)
  })

  it('skipping starts the session with manually fillable loads', () => {
    beginWorkout(['r1'], null)
    mountTopSheet()
    act(() => button('Skip').click())
    expect(useStore.getState().A.entries[0].sets[0].w).toBeUndefined()
  })

  it('offers the low, central and high estimate from the log to fill the field with', () => {
    const exposure = { exposureId: 'e1', exerciseId: '0025', mode: 'reps', performance: { sets: [{ status: 'completed', role: 'work', resistance: { kind: 'external-load', value: 100, unit: 'kg' }, observations: [{ metric: 'repetitions', value: 8 }] }] } }
    useStore.setState(s => ({ S: { ...s.S, workouts: [{ id: 'w1', d: '2026-10-01', start: 1, end: 2, exposures: [exposure] }] } }))
    const { low, mid, high } = estimate1RMRange(100, 8)
    expect(low).toBeLessThan(high)
    beginWorkout(['r1'], null)
    mountTopSheet()
    expect([low, mid, high].every(v => button(`${v === low ? 'Low' : v === mid ? 'Central' : 'High'} ${fmtNum(v)}`))).toBe(true)
    act(() => button(`Low ${fmtNum(low)}`).click())
    expect(host.querySelector('input').value).toBe(String(low))
    act(() => button('Save and start').click())
    expect(Object.values(useStore.getState().S.oneRepMaxes)).toEqual([expect.objectContaining({ exerciseId: '0025', value: low, source: 'manual' })])
  })

  it('offers a single value, without a range, when the models agree', () => {
    const exposure = { exposureId: 'e1', exerciseId: '0025', mode: 'reps', performance: { sets: [{ status: 'completed', role: 'work', resistance: { kind: 'external-load', value: 100, unit: 'kg' }, observations: [{ metric: 'repetitions', value: 1 }] }] } }
    useStore.setState(s => ({ S: { ...s.S, workouts: [{ id: 'w1', d: '2026-10-01', start: 1, end: 2, exposures: [exposure] }] } }))
    beginWorkout(['r1'], null)
    mountTopSheet()
    expect(button('Use 100')).toBeTruthy()
    expect(button('Low 100')).toBeUndefined()
  })
})
