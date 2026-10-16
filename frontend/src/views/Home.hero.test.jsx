// @vitest-environment happy-dom
// Home's hero and the action row's first slot in each training state (ux-redesign-tabs §1.1):
// planned (Start), done (Workout), rest (Workout), running (Resume), an open edit (Edit), a past
// day (Log workout); and the hero's ⋯ with "Choose a different workout" — the way to the Start
// screen when a plan already owns today, since Start goes straight into it — and "Change this
// day".
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { fmtDate, isoOf, todayISO } from '../lib/format.js'
import { dayOverrideSheet, logPastWorkoutSheet, menuSheet, startFlow, workoutDetailSheet } from '../sheets.jsx'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname: '/home' }) }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(), menuSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
  workoutDetailSheet: vi.fn(), logPastWorkoutSheet: vi.fn(),
}))

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }, { id: '0047' }] }]
const TODAY = todayISO()
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d) })()
const EVERY_DAY = { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  useDiarySelection.getState().reset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

// The weigh-in is off, so Start's own weigh-in sheet (and its way to the Start screen) never opens.
const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, routines, dayPlan: {}, workouts: [], active: null, weighIn: false, queue: null, scheduleMode: null, week: EVERY_DAY, ...over },
  user: null,
}))
const mount = () => act(() => root.render(<Home />))
const hero = () => ({
  eyebrow: host.querySelector('.hero-e')?.textContent ?? null,
  title: host.querySelector('.hero-t').textContent,
  caption: host.querySelector('.hero-c')?.textContent ?? null,
})
const first = () => host.querySelector('.act-b')
const tap = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
// The ⋯ menu's items, as menuSheet was handed them.
const menu = () => {
  tap(host.querySelector('.hero-more'))
  return menuSheet.mock.calls.at(-1)[0].items.filter(Boolean)
}

describe('Home — the hero and the first action', () => {
  it('a planned day: the routine and its exercises; Start starts it', () => {
    setS(); mount()
    expect(hero()).toEqual({ eyebrow: null, title: 'Push', caption: '2 exercises' })
    expect(first().textContent).toBe('Start')
    tap(first())
    expect(startFlow).toHaveBeenCalledWith(['r1'])
  })

  it('a day changed in the plan says so', () => {
    setS({ week: {}, dayPlan: { [TODAY]: 'r1' } }); mount()
    expect(hero().caption).toBe('2 exercises · rescheduled')
  })

  it('the ⋯ offers a different workout without starting anything, and changing the day', () => {
    setS(); mount()
    const items = menu()
    expect(items.map(i => i.label)).toEqual(['Choose a different workout', 'Change this day'])
    items[0].onClick()
    expect(nav).toHaveBeenCalledWith('/train/workout')
    expect(startFlow).not.toHaveBeenCalled()
    items[1].onClick()
    expect(dayOverrideSheet).toHaveBeenCalledWith(TODAY)
  })

  it('a rest day: when the next session is, and Workout opens the Start screen', () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    setS({ week: { [tomorrow.getDay()]: ['r1'] } }); mount()
    expect(hero().title).toBe('Rest day')
    expect(hero().caption).toMatch(/^Next session: \w+, Push$/)
    expect(first().textContent).toBe('Workout')
    tap(first())
    expect(nav).toHaveBeenCalledWith('/train/workout')
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('a rest day names every routine of the next session, as This week does', () => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
    const pull = { id: 'r2', name: 'Pull', emoji: null, ex: [{ id: '0025' }] }
    setS({ routines: [...routines, pull], week: { [tomorrow.getDay()]: ['r1', 'r2'] } }); mount()
    expect(hero().caption).toMatch(/^Next session: \w+, Push \+ Pull$/)
    expect(host.querySelector('.item-lg .ss').textContent).toMatch(/Next session: \w+, Push \+ Pull/)
  })

  it('the ⋯ comes after the heading in reading order', () => {
    setS(); mount()
    const title = host.querySelector('.hero-t'), more = host.querySelector('.hero-more')
    expect(title.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('done: the session with its time and PRs, the way to it, and Workout for another', () => {
    const start = Date.now() - 60 * 60000
    const w = { id: 'w1', d: TODAY, start, end: start + 52 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push', prs: ['a', 'b'], entries: [] }
    setS({ workouts: [w] }); mount()
    expect(hero()).toEqual({ eyebrow: 'Done', title: 'Push', caption: '52 min · 2 PRs' })
    tap(host.querySelector('.hero-l'))
    expect(workoutDetailSheet).toHaveBeenCalledWith(w)
    expect(first().textContent).toBe('Workout')
  })

  it('running: the session and its clock; Resume goes back to it, and the ⋯ has no different workout', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    expect(hero().eyebrow).toBe('In progress')
    expect(hero().title).toBe('Push')
    expect(hero().caption).toMatch(/^\d+:\d{2}$/)
    expect(first().textContent).toBe('Resume')
    tap(first())
    expect(nav).toHaveBeenCalledWith('/train/workout')
    expect(menu().map(i => i.label)).toEqual(['Change this day'])
  })

  it('reads an open editor on a saved workout as an edit, not as a session in progress', () => {
    setS({ active: { id: 'w', name: 'Push', start: 1000, cur: 0, entries: [], editingWorkoutId: 'w' } }); mount()
    expect(hero()).toEqual({ eyebrow: null, title: 'Push', caption: 'Editing a saved workout' })
    expect(first().textContent).toBe('Edit')
    tap(first())
    expect(nav).toHaveBeenCalledWith('/train/workout')
  })

  it('a past day planned and not logged: Log workout opens it with that day\'s plan', () => {
    setS(); act(() => useDiarySelection.getState().setDate(yesterday)); mount()
    expect(hero()).toEqual({ eyebrow: fmtDate(yesterday, true), title: 'Push', caption: 'Planned, not logged' })
    expect(first().textContent).toBe('Log workout')
    tap(first())
    expect(logPastWorkoutSheet).toHaveBeenCalledWith({ iso: yesterday, routineIds: ['r1'] })
    menu()[0].onClick()
    expect(dayOverrideSheet).toHaveBeenCalledWith(yesterday)
  })

  it('a past day with workouts: each opens, and Log workout adds another to that day', () => {
    const at = h => new Date(yesterday + `T${h}:00:00`).getTime()
    const a = { id: 'a', d: yesterday, start: at(8), end: at(9), routineIds: ['r1'], name: 'Push', entries: [] }
    const b = { id: 'b', d: yesterday, start: at(18), end: at(19), routineIds: [], name: 'Freestyle', entries: [] }
    setS({ workouts: [a, b] }); act(() => useDiarySelection.getState().setDate(yesterday)); mount()
    expect(hero().title).toBe('2 workouts')
    tap(host.querySelector('.hero-l'))
    const items = menuSheet.mock.calls.at(-1)[0].items
    expect(items.map(i => i.label)).toEqual(['Push', 'Freestyle'])
    items[1].onClick()
    expect(workoutDetailSheet).toHaveBeenCalledWith(b)
    tap(first())
    expect(logPastWorkoutSheet).toHaveBeenCalledWith({ iso: yesterday })
  })

  it('a workout with no name still has a label in the See workouts menu', () => {
    const at = h => new Date(yesterday + `T${h}:00:00`).getTime()
    const a = { id: 'a', d: yesterday, start: at(8), end: at(9), routineIds: [], name: '', entries: [] }
    const b = { id: 'b', d: yesterday, start: at(18), end: at(19), routineIds: [], name: 'Push', entries: [] }
    setS({ workouts: [a, b] }); act(() => useDiarySelection.getState().setDate(yesterday)); mount()
    tap(host.querySelector('.hero-l'))
    expect(menuSheet.mock.calls.at(-1)[0].items.map(i => i.label)).toEqual(['Workout', 'Push'])
  })

  it('a session in progress keeps the first slot on a past day too', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } })
    act(() => useDiarySelection.getState().setDate(yesterday)); mount()
    expect(first().textContent).toBe('Resume')
  })
})

describe('Home — This week', () => {
  it('with no routines, welcomes with a starter plan or your own', () => {
    setS({ routines: [], week: {} }); mount()
    expect(host.textContent).toContain('Welcome!')
    const pill = label => [...host.querySelectorAll('.empty-acts button')].find(b => b.textContent === label)
    expect(pill('Load starter plan')).toBeTruthy()
    tap(pill('Build my own plan'))
    expect(nav).toHaveBeenCalledWith('/train/routines')
  })

  it('done against planned with the streak, opening Training', () => {
    const now = Date.now()
    setS({ workouts: [{ id: 'w', d: TODAY, start: now - 3600000, end: now, routineIds: ['r1'], routineId: 'r1', name: 'Push', entries: [] }] }); mount()
    expect(host.querySelector('.item-lg .tt').textContent).toBe('1 of 7 this week')
    expect(host.querySelector('.item-lg .ss').textContent).toMatch(/^1 week streak · Next session: \w+, Push · 1 workout total$/)
    tap(host.querySelector('.item-lg'))
    expect(nav).toHaveBeenCalledWith('/train')
    tap([...host.querySelectorAll('.sec-h-l')].find(b => b.textContent === 'View plan'))
    expect(nav).toHaveBeenCalledTimes(2)
  })

  it('routines with nothing scheduled say so, with the way to schedule them', () => {
    setS({ week: {} }); mount()
    expect(host.querySelector('.item-lg .tt').textContent).toBe('1 routine')
    expect(host.querySelector('.item-lg .ss').textContent).toBe('Not scheduled')
    tap(host.querySelector('.media-link'))
    expect(nav).toHaveBeenCalledWith('/train/schedule')
  })

  it('with nothing scheduled it still counts the sessions done this week and in all', () => {
    const now = Date.now()
    const w = (id, d) => ({ id, d, start: now - 3600000, end: now, routineIds: [], name: 'Freestyle', entries: [] })
    const old = '2020-01-06'
    setS({ week: {}, workouts: [w('a', old), w('b', TODAY)] }); mount()
    expect(host.querySelector('.item-lg .ss').textContent).toBe('Not scheduled · 1 this week · 2 workouts total')
  })

})
