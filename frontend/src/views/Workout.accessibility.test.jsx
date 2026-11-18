// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025', SQUAT = '0043'
let root, container

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null, countIn: null })
})
afterEach(() => {
  if (root) act(() => root.unmount())
  container?.remove()
  root = container = null
})

function mount({ allDone = false } = {}) {
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', workoutView: 'cards' })
  S.active = {
    id: 'a', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Push', bw: null,
    cur: 0, workoutView: 'cards', entries: [
      { id: BENCH, target: { mode: 'reps', sets: 3, reps: 8 }, sets: [
        { w: 60, r: 8, done: allDone }, { w: 60, r: 8, done: allDone }, { w: 60, r: 8, done: allDone },
      ] },
      { id: SQUAT, target: { mode: 'reps', sets: 2, reps: 5 }, sets: [
        { w: 100, r: 5, done: allDone }, { w: 100, r: 5, done: allDone },
      ] },
    ],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const primary = () => container.querySelector('.wk-primary-action')
const click = element => act(() => element.click())
const clearTimer = () => act(() => useUI.setState({ timer: null, work: null, countIn: null }))

describe('workout accessibility retrofit', () => {
  it('shows a clear screen title, workout name, auto-save status, position and Up next', () => {
    mount()
    expect(container.querySelector('h1')?.textContent).toBe('Workout')
    expect(container.querySelector('.whdr-name')?.textContent).toBe('Push')
    expect(container.querySelector('.whdr-mid .sub')?.textContent).toContain('Auto-save')
    expect(container.querySelector('.wk-position')?.textContent).toBe('Exercise 1 / 2')
    expect(container.querySelector('.upnext')?.textContent).toContain('Up next')
  })

  it('logs three sets, advances, logs the final exercise and opens Finish from one primary action', () => {
    mount()
    for (const label of ['Log set 1', 'Log set 2', 'Log set 3']) {
      expect(primary()?.textContent).toBe(label)
      click(primary())
      clearTimer()
    }
    expect(primary()?.textContent).toBe('Next')
    click(primary())
    expect(useStore.getState().S.active.cur).toBe(1)
    for (const label of ['Log set 1', 'Log set 2']) {
      expect(primary()?.textContent).toBe(label)
      click(primary())
      clearTimer()
    }
    expect(primary()?.textContent).toBe('Finish workout')
    act(() => useUI.getState().closeAll())
    click(primary())
    expect(useUI.getState().sheets.length).toBeGreaterThan(0)
  })

  it('keeps More visibly labelled and yields the primary action while a timer is active', () => {
    mount()
    const more = [...container.querySelectorAll('.wk-acts button')].at(-1)
    expect(more.textContent).toBe('More')
    expect(more.getAttribute('aria-label')).toBe('More')
    expect(primary()).not.toBeNull()
    act(() => useUI.setState({ timer: { endsAt: Date.now() + 30000 } }))
    expect(primary()).toBeNull()
    clearTimer()
    expect(primary()?.textContent).toBe('Log set 1')
  })

  it('does not render a duplicate bottom Finish once every set is done', () => {
    mount({ allDone: true })
    expect(primary()?.textContent).toBe('Finish workout')
    expect(container.querySelector('.wk-finish')).toBeNull()
    expect(container.querySelector('.whdr-finish')?.className).toContain('ghost')
  })
})
