// @vitest-environment happy-dom
// The Training hub's today row (components/TodayCard.jsx), read through lib/training-day.js as
// Home's hero is: Start / Resume with its clock / Edit / Done / Rest day, one tap, and the coach
// week's progress row or the rotation's empty state above it. The week strip is Home's now.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { dayOverrideSheet, startFlow } from '../sheets.jsx'
import TrainHub from './TrainHub.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname: '/train' }) }))
vi.mock('../sheets.jsx', () => ({ dayOverrideSheet: vi.fn(), startFlow: vi.fn() }))

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]
const TODAY = todayISO()
const wd = new Date(TODAY + 'T12:00:00').getDay()

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, routines, dayPlan: {}, workouts: [], active: null, queue: null, rotation: null, scheduleMode: null, week: { [wd]: ['r1'] }, ...over },
  user: null,
}))
const mount = () => act(() => root.render(<TrainHub />))
const row = () => host.querySelector('.today-row')
const title = () => row().querySelector('.ttl').textContent
const tag = () => row().querySelector('.tag')?.textContent
const tap = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('Training hub — today', () => {
  it('a planned day offers Start and starts it in one tap', () => {
    setS(); mount()
    expect(title()).toBe('Push')
    expect(tag()).toBe('Start')
    // The week strip is Home's.
    expect(host.querySelector('.week, .wday, .wk-strip')).toBeNull()
    tap(row())
    expect(startFlow).toHaveBeenCalledWith(['r1'])
  })

  it('a running session reads as in progress, with its clock, and the row resumes it', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    expect(title()).toBe('Push (in progress)')
    expect(tag()).toMatch(/^Resume · \d+:\d{2}/)
    tap(row())
    expect(nav).toHaveBeenCalledWith('/train/workout')
  })

  it('an open editor on a saved workout reads as an edit', () => {
    setS({ active: { id: 'w', name: 'Push', start: 1000, cur: 0, entries: [], editingWorkoutId: 'w' } }); mount()
    expect(title()).toBe('Push')
    expect(tag()).toBe('Edit')
  })

  it('the planned routine done today reads as done', () => {
    const now = Date.now()
    setS({ workouts: [{ id: 'w', d: TODAY, start: now - 3600000, end: now, routineIds: ['r1'], routineId: 'r1', name: 'Push', entries: [] }] }); mount()
    expect(title()).toBe('Push (done)')
    expect(tag()).toBe('Done')
  })

  it('a rest day opens "change this day" for today', () => {
    setS({ week: {} }); mount()
    expect(title()).toBe('Rest day')
    tap(row())
    expect(dayOverrideSheet).toHaveBeenCalledWith(TODAY)
  })

  it('Rotation chosen with nothing built yet offers to set it up', () => {
    setS({ scheduleMode: 'rotation', week: {} }); mount()
    expect(host.textContent).toContain('No rotation yet')
    expect(host.querySelector('.queue')).toBeNull()
  })

  it('a coach week shows its progress row above the today row', () => {
    setS({ queue: { ids: ['r1'], since: Date.now() - 86400000, startsOn: TODAY, label: 'US W1' } }); mount()
    expect(host.querySelector('.queue .row .small').textContent).toBe('US W1')
    expect(title()).toBe('Push')
  })
})
