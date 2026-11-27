// @vitest-environment happy-dom
// "Add to my plan" on an exercise's page (#1466): tick one routine or several, then one settings
// sheet, and the same sets, reps and weight land in each.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { addToRoutineSheet } from './sheets.jsx'
import { setNav } from './lib/nav.js'
import { EXDB } from './lib/exercises.js'

const mounted = []
const ex = EXDB.find(e => e.bp !== 'cardio')
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const row = (host, name) => [...host.querySelectorAll('.item')].find(r => r.querySelector('.tt')?.textContent === name)
const routine = (id, name) => ({ id, name, emoji: null, ex: [] })

describe('Add to my plan, several routines at once', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    setNav(() => {})
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState(s => ({ S: { ...s.S, workouts: [], active: null, routines: [routine('a', 'Push'), routine('b', 'Pull'), routine('c', 'Legs')] } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('ticks routines, asks for the sets once and adds the same slot to each', () => {
    addToRoutineSheet(ex)
    const host = renderTop()
    expect(button(host, 'Next').disabled).toBe(true)
    act(() => { row(host, 'Legs').click() })
    act(() => { row(host, 'Push').click() })
    expect(row(host, 'Legs').getAttribute('aria-checked')).toBe('true')
    expect(row(host, 'Pull').getAttribute('aria-checked')).toBe('false')
    act(() => { button(host, 'Next').click() })
    // the picker closed, the one settings sheet is up
    expect(useUI.getState().sheets.length).toBe(1)
    const cfgHost = renderTop()
    act(() => { button(cfgHost, 'Add to routine').click() })
    const rs = useStore.getState().S.routines
    expect(rs.map(r => r.ex.map(x => x.id))).toEqual([[ex.id], [], [ex.id]])
    expect(rs[0].ex[0]).toEqual(rs[2].ex[0])
    expect(useUI.getState().toastMsg).toContain('Push, Legs')
  })

  it('a second tap unticks a routine', () => {
    addToRoutineSheet(ex)
    const host = renderTop()
    act(() => { row(host, 'Pull').click() })
    act(() => { row(host, 'Pull').click() })
    expect(button(host, 'Next').disabled).toBe(true)
  })
})
