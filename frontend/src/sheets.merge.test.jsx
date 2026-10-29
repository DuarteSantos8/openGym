// @vitest-environment happy-dom
// #656: an exercise's details offer Merge into…, which picks the target, says what moves, merges,
// and the toast's Undo puts it all back.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { registerCustom, EXIDX } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { exerciseDetailSheet } from './sheets.jsx'

bindUI(useUI)
const BENCH = '0025'
const mounted = []
const S = () => useStore.getState().S
const renderTop = () => {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const custom = { id: 'cfn', n: 'Bench Press (Barbell)', bp: 'chest', eq: 'barbell', custom: true }
const workout = { id: 'w1', d: '2026-09-01', start: 1, name: 'Push', prs: [], entries: [{ id: 'cfn', target: { mode: 'reps' }, sets: [{ w: 70, r: 8, done: true }] }] }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  useStore.setState({ S: { ...structuredClone(DEF), customEx: [custom], workouts: [workout], routines: [{ id: 'r1', name: 'Push', ex: [{ id: 'cfn', sets: 3, reps: 8 }] }] }, user: null })
  registerCustom([custom])
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }); registerCustom([]) })

describe('Merge into… (#656)', () => {
  it('moves the history after a preview, and Undo brings it back', () => {
    exerciseDetailSheet(custom)
    const detail = renderTop()
    act(() => button(detail, 'Merge into…').click())
    // the picker: find the catalogue bench press and pick it
    const picker = renderTop()
    const input = picker.querySelector('input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'barbell bench press')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const row = [...picker.querySelectorAll('.item')].find(el => el.textContent.toLowerCase().includes(EXIDX[BENCH].n.toLowerCase()))
    act(() => row.click())
    const confirm = renderTop()
    expect(confirm.textContent).toContain('1 workout, 1 routine move to')
    expect(confirm.textContent).toContain('Then “Bench Press (Barbell)” is deleted.')
    act(() => button(confirm, 'Merge').click())
    expect(S().workouts[0].entries[0].id).toBe(BENCH)
    expect(S().routines[0].ex[0].id).toBe(BENCH)
    expect(S().customEx).toEqual([])
    expect(useUI.getState().toastMsg).toMatch(/^Merged into/)
    act(() => useUI.getState().runToastAction())
    expect(S().workouts[0].entries[0].id).toBe('cfn')
    expect(S().customEx.map(c => c.id)).toEqual(['cfn'])
    expect(S().exMerged.cfn.into).toBe(null)
  })

  it('is not offered for a catalogue exercise you never used', () => {
    exerciseDetailSheet(EXIDX['0043'])
    expect(button(renderTop(), 'Merge into…')).toBeUndefined()
  })

  it('sits at the end of the sheet with Delete, Delete last (1.4.5 features pass)', () => {
    exerciseDetailSheet(custom)
    const detail = renderTop()
    const all = [...detail.querySelectorAll('button')]
    const merge = button(detail, 'Merge into…'), del = button(detail, 'Delete exercise')
    expect(merge.closest('.ex-del')).not.toBeNull()
    expect(all.indexOf(merge)).toBeGreaterThan(all.indexOf(button(detail, 'Edit')))
    expect(all.indexOf(del)).toBe(all.length - 1)
    expect(all.indexOf(merge)).toBe(all.length - 2)
    expect(merge.classList.contains('danger')).toBe(false)
  })
})
