// @vitest-environment happy-dom
// "All done?" for a workout left running: asked once a quiet spell, never over another sheet or
// during a rest, and Finish goes through the usual finishWorkout.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ S: {}, ui: { sheets: [], timer: null, work: null, countIn: null }, menuSheet: vi.fn(), finishWorkout: vi.fn() }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => ({ S: m.S }) } }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => m.ui } }))
vi.mock('../sheets.jsx', () => ({ menuSheet: m.menuSheet, finishWorkout: m.finishWorkout }))

const { default: ForgottenWorkout } = await import('./ForgottenWorkout.jsx')

const NOW = 1_800_000_000_000
let root
const mount = () => { const host = document.createElement('div'); root = createRoot(host); act(() => root.render(<ForgottenWorkout />)) }

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  localStorage.clear()
  m.menuSheet.mockClear(); m.finishWorkout.mockClear()
  m.ui = { sheets: [], timer: null, work: null, countIn: null }
  m.S = { active: { start: NOW - 3600e3, entries: [{ id: '0043', sets: [{ w: 60, r: 8, done: true, at: NOW - 30 * 60000 }] }] } }
})
afterEach(() => { act(() => root.unmount()); vi.useRealTimers() })

describe('ForgottenWorkout', () => {
  it('asks once, and Finish runs the usual finish', () => {
    mount()
    act(() => vi.advanceTimersByTime(3000))
    expect(m.menuSheet).toHaveBeenCalledTimes(1)
    const { title, subtitle, items } = m.menuSheet.mock.calls[0][0]
    expect(title).toBe('All done?')
    expect(subtitle).toBe('Nothing logged for 30 min.')
    items.find(i => i.label === 'Finish workout').onClick()
    expect(m.finishWorkout).toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(60000 * 5))
    expect(m.menuSheet).toHaveBeenCalledTimes(1)
  })
  it('waits while another sheet is open or a rest is running', () => {
    m.ui.sheets = [{ id: 'x' }]
    mount()
    act(() => vi.advanceTimersByTime(3000))
    m.ui.sheets = []; m.ui.timer = { left: 60 }
    act(() => vi.advanceTimersByTime(60000))
    expect(m.menuSheet).not.toHaveBeenCalled()
    m.ui.timer = null
    act(() => vi.advanceTimersByTime(60000))
    expect(m.menuSheet).toHaveBeenCalledTimes(1)
  })
})
