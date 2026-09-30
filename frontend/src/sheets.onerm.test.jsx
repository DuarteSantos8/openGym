// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { beginWorkout } from './sheets.jsx'
import { ruleOccurrence } from './lib/test-fixtures.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

const percentRoutine = { id: 'r1', name: 'Push', ex: [ruleOccurrence('0025', { patch: r => ({ ...r, parameters: { ...r.parameters, load: { mode: 'percent_1rm', percent: 70 } }, increment: { type: 'percentage_points', value: 2.5 } }) })] }
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
})
