// @vitest-environment happy-dom
// What a dumbbell weight means (issue #474), where it is picked: the exercise's own default on its
// detail sheet (S.dbLoad, stamped), a routine slot's own choice on the exercise settings
// (cfg.dbLoad, written only when it differs from the exercise's default).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from './lib/exercises.js'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet, exerciseDetailSheet } from './sheets.jsx'
import { withDbLoad } from './lib/dumbbells.js'

const BENCH = EXIDX['0289']   // dumbbell bench press
const SQUAT = EXIDX['0043']   // barbell
const mounted = []
function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const S = () => useStore.getState().S
const segButton = (host, text) => [...host.querySelectorAll('.seg button')].find(b => b.textContent.trim() === text)
const openMeaning = host => act(() => [...host.querySelectorAll('.disc .lrow')].find(r => r.textContent.startsWith('Weight means')).click())
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('weight means', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('the detail sheet sets the exercise default, stamped, and shows As entered until then', () => {
    exerciseDetailSheet(BENCH)
    const host = render(useUI.getState().sheets.at(-1))
    expect(host.textContent).toContain('Weight means')
    expect(segButton(host, 'As entered').classList.contains('on')).toBe(true)
    expect(host.textContent).toContain('Counted as you type it, the way it always was.')
    act(() => segButton(host, 'Each').click())
    expect(S().dbLoad[BENCH.id]).toEqual({ mode: 'each', _ts: expect.any(Number) })
    expect(host.textContent).toContain('Volume counts both.')
    act(() => segButton(host, 'As entered').click())
    expect(S().dbLoad[BENCH.id]).toEqual({ mode: null, _ts: expect.any(Number) })
  })

  it('is not offered for a barbell', () => {
    exerciseDetailSheet(SQUAT)
    const host = render(useUI.getState().sheets.at(-1))
    expect(host.textContent).not.toContain('Weight means')
  })

  it('a routine slot saves its own pick and nothing when it follows the exercise', () => {
    const onSave = vi.fn()
    exConfigSheet(BENCH, { sets: 3, reps: 10, weight: 20, mode: 'reps' }, onSave)
    let host = render(useUI.getState().sheets.at(-1))
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('dbLoad')

    exConfigSheet(BENCH, { sets: 3, reps: 10, weight: 20, mode: 'reps' }, onSave)
    host = render(useUI.getState().sheets.at(-1))
    openMeaning(host)
    act(() => segButton(host, 'Both').click())
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[1][0].dbLoad).toBe('total')
  })

  it('a slot whose exercise means per bell can still say as entered, and repeating the default drops the key', () => {
    useStore.setState(s => ({ S: { ...s.S, dbLoad: withDbLoad({}, BENCH.id, 'each', 1) } }))
    const onSave = vi.fn()
    // A session target stamped with the exercise's own meaning is not the slot's choice.
    exConfigSheet(BENCH, { sets: 3, reps: 10, weight: 20, mode: 'reps', dbLoad: 'each' }, onSave)
    let host = render(useUI.getState().sheets.at(-1))
    openMeaning(host)
    expect(segButton(host, 'Each').classList.contains('on')).toBe(true)
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('dbLoad')

    exConfigSheet(BENCH, { sets: 3, reps: 10, weight: 20, mode: 'reps' }, onSave)
    host = render(useUI.getState().sheets.at(-1))
    openMeaning(host)
    act(() => segButton(host, 'As entered').click())
    act(() => button(host, 'Save').click())
    expect(onSave.mock.calls[1][0].dbLoad).toBe('as')
  })
})
