// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { logPastWorkoutSheet } from './sheets.jsx'
import { todayISO } from './lib/format.js'

const mounted = []
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('log a past workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, active: null, routines: [], workouts: [{ id: 'old', d: todayISO(), start: 1, end: 2, name: 'Old', entries: [], prs: [] }] } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('refuses while a workout is running', () => {
    const toast = vi.fn()
    useUI.setState({ toast })
    useStore.setState(s => ({ S: { ...s.S, active: { id: 'a', entries: [] } } }))
    logPastWorkoutSheet()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith('Finish the current workout first.')
  })

  it('asks what to do when the day already has a workout', () => {
    logPastWorkoutSheet()
    const host = mountTopSheet()
    expect(host.querySelector('h3').textContent).toBe('Log a past workout')
    act(() => { type(host.querySelector('input[type=date]'), todayISO()) })
    act(() => { button(host, 'Continue').click() })
    const prompt = mountTopSheet()
    expect(prompt.textContent).toContain('There is already a workout on that day.')
    expect(['Replace', 'Add as second workout', 'Cancel'].map(t => !!button(prompt, t))).toEqual([true, true, true])
    expect(useStore.getState().S.active).toBeNull()
  })

  it('starts a backfilled session straight away on a free day', () => {
    logPastWorkoutSheet()
    const host = mountTopSheet()
    act(() => { type(host.querySelector('input[type=date]'), '2020-01-02') })
    act(() => { button(host, 'Continue').click() })
    const A = useStore.getState().S.active
    expect(A.d).toBe('2020-01-02')
    expect(new Date(A.start).getHours()).toBe(18)
    expect(A.backfill).toEqual({ durationMin: 60, replaceId: null })
  })
})
