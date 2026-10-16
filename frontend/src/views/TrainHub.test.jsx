// @vitest-environment happy-dom
// The Training tab's root (ux-redesign-tabs §2, §4.1): the month and week, the hero in each
// session state, the action row and its settings-driven last slot, Your plan (the week's
// sessions, or the coach week's or rotation's progress row), Routines (the first three, ▶ to
// start, See all, Freestyle) and More. Every action runs the flow the rest of the app runs.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { fmtDate, isoOf, startOfWeek, todayISO, weekStartOf } from '../lib/format.js'
import { calendarSheet, dayOverrideSheet, logPastWorkoutSheet, menuSheet, starterPlanSheet, startFlow, workoutDetailSheet } from '../sheets.jsx'
import TrainHub from './TrainHub.jsx'

const nav = vi.fn()
const coach = vi.hoisted(() => ({ on: false }))
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname: '/train' }) }))
vi.mock('../lib/coach.js', () => ({ coachAvailable: () => coach.on }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayOverrideSheet: vi.fn(), menuSheet: vi.fn(), calendarSheet: vi.fn(), startFlow: vi.fn(),
  workoutDetailSheet: vi.fn(), logPastWorkoutSheet: vi.fn(),
}))

const r = (id, name, n = 2) => ({ id, name, emoji: null, ex: Array.from({ length: n }, (_, i) => ({ id: String(i) })) })
const routines = [r('r1', 'Push'), r('r2', 'Pull'), r('r3', 'Legs'), r('r4', 'Arms')]
const TODAY = todayISO()
const wd = new Date(TODAY + 'T12:00:00').getDay()
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoOf(d) })()

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  coach.on = false
  useDiarySelection.getState().reset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, routines, dayPlan: {}, workouts: [], active: null, queue: null, rotation: null, scheduleMode: null, checkIn: false, week: { [wd]: ['r1'] }, ...over },
  user: null,
}))
const mount = () => act(() => root.render(<TrainHub />))
const tap = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const hero = () => ({
  eyebrow: host.querySelector('.hero-e')?.textContent ?? null,
  title: host.querySelector('.hero-t').textContent,
  caption: host.querySelector('.hero-c')?.textContent ?? null,
})
const actions = () => [...host.querySelectorAll('.act-b')].map(b => b.textContent)
const action = label => [...host.querySelectorAll('.act-b')].find(b => b.textContent === label)
const first = () => host.querySelector('.act-b')
const section = title => [...host.querySelectorAll('.tab-sec')].find(s => s.querySelector('.sec-h-t')?.textContent === title)
const link = (title, label) => [...section(title).querySelectorAll('.sec-h-l')].find(b => b.textContent === label)
const planRows = () => [...section('Your plan').querySelectorAll('.lrow')]
const media = () => [...section('Routines').querySelectorAll('.item-lg')]
const row = title => [...host.querySelectorAll('.lrow')].find(x => x.querySelector('.lrow-t').textContent === title)
const at = (iso, h, extra = {}) => {
  const start = new Date(iso + `T${String(h).padStart(2, '0')}:00:00`).getTime()
  return { id: 'w' + iso + h, d: iso, start, end: start + 3600000, routineIds: ['r1'], routineId: 'r1', name: 'Push', entries: [], ...extra }
}
const menu = () => {
  tap(host.querySelector('.hero-more'))
  return menuSheet.mock.calls.at(-1)[0].items.filter(Boolean)
}

describe('Training — the root', () => {
  it('top to bottom: month and week, hero, action row, Your plan, Routines, More; no tiles', () => {
    setS(); mount()
    expect(host.querySelector('.month-bar')).toBeTruthy()
    expect(host.querySelectorAll('.wk-d')).toHaveLength(7)
    expect(host.querySelector('.hero')).toBeTruthy()
    expect([...host.querySelectorAll('.sec-h-t')].map(h => h.textContent)).toEqual(['Your plan', 'Routines', 'More'])
    expect(host.querySelector('.hub-tile, .today-row')).toBeNull()
    expect(host.textContent).not.toContain('Start a different workout')
  })

  it('the week strip marks the planned day', () => {
    setS(); mount()
    const day = [...host.querySelectorAll('.wk-d')].find(b => b.getAttribute('aria-current') === 'date')
    expect(day.querySelector('.wk-dot.plan')).toBeTruthy()
  })
})

describe('Training — the hero and the first action', () => {
  it('planned: the routine and its exercises; Start starts it', () => {
    setS(); mount()
    expect(hero()).toEqual({ eyebrow: null, title: 'Push', caption: '2 exercises' })
    expect(first().textContent).toBe('Start')
    tap(first())
    expect(startFlow).toHaveBeenCalledWith(['r1'])
  })

  it('the ⋯ holds a different workout and changing the day', () => {
    setS(); mount()
    const items = menu()
    expect(items.map(i => i.label)).toEqual(['Choose a different workout', 'Change this day'])
    items[0].onClick()
    expect(nav).toHaveBeenCalledWith('/train/workout')
    items[1].onClick()
    expect(dayOverrideSheet).toHaveBeenCalledWith(TODAY)
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('done: the session, the way to it, and Workout for another', () => {
    const w = at(TODAY, 0, { prs: ['a'] })
    setS({ workouts: [w] }); mount()
    expect(hero()).toEqual({ eyebrow: 'Done', title: 'Push', caption: '1h 0m · 1 PR' })
    tap(host.querySelector('.hero-l'))
    expect(workoutDetailSheet).toHaveBeenCalledWith(w)
    expect(first().textContent).toBe('Workout')
    tap(first())
    expect(nav).toHaveBeenCalledWith('/train/workout')
  })

  it('rest: Rest day, and Workout opens the Start screen', () => {
    setS({ week: {} }); mount()
    expect(hero().title).toBe('Rest day')
    expect(first().textContent).toBe('Workout')
    tap(first())
    expect(nav).toHaveBeenCalledWith('/train/workout')
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('running: the session with its clock; Resume goes back to it', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    expect(hero().eyebrow).toBe('In progress')
    expect(hero().caption).toMatch(/^\d+:\d{2}$/)
    expect(first().textContent).toBe('Resume')
    tap(first())
    expect(nav).toHaveBeenCalledWith('/train/workout')
    expect(menu().map(i => i.label)).toEqual(['Change this day'])
  })

  it('an open editor on a saved workout reads as an edit', () => {
    setS({ active: { id: 'w', name: 'Push', start: 1000, cur: 0, entries: [], editingWorkoutId: 'w' } }); mount()
    expect(hero().caption).toBe('Editing a saved workout')
    expect(first().textContent).toBe('Edit')
  })

  it('a past date: what was planned, and Log workout for that day with its plan', () => {
    setS({ week: { [new Date(yesterday + 'T12:00:00').getDay()]: ['r1'] } })
    act(() => useDiarySelection.getState().setDate(yesterday)); mount()
    expect(hero()).toEqual({ eyebrow: fmtDate(yesterday, true), title: 'Push', caption: 'Planned, not logged' })
    expect(first().textContent).toBe('Log workout')
    tap(first())
    expect(logPastWorkoutSheet).toHaveBeenCalledWith({ iso: yesterday, routineIds: ['r1'] })
  })

  it('a past rest day: Log workout for that day', () => {
    setS({ week: {} }); act(() => useDiarySelection.getState().setDate(yesterday)); mount()
    expect(hero().title).toBe('Rest day')
    tap(first())
    expect(logPastWorkoutSheet).toHaveBeenCalledWith({ iso: yesterday })
  })
})

describe('Training — the action row', () => {
  it('History and Exercises open their pages; with neither check-in nor coach the row has three', () => {
    setS(); mount()
    expect(actions()).toEqual(['Start', 'History', 'Exercises'])
    tap(action('History'))
    expect(nav).toHaveBeenCalledWith('/train/history')
    tap(action('Exercises'))
    expect(nav).toHaveBeenCalledWith('/train/exercises')
  })

  it('check-in on: Check in is the last slot, and Coach keeps a row under More', () => {
    coach.on = true
    setS({ checkIn: true }); mount()
    expect(actions()).toEqual(['Start', 'History', 'Exercises', 'Check in'])
    tap(action('Check in'))
    expect(nav).toHaveBeenCalledWith('/train/checkin')
    tap(row('Coach'))
    expect(nav).toHaveBeenCalledWith('/train/coach')
  })

  it('check-in off and coach on: Coach is the last slot, not a row', () => {
    coach.on = true
    setS(); mount()
    expect(actions()).toEqual(['Start', 'History', 'Exercises', 'Coach'])
    tap(action('Coach'))
    expect(nav).toHaveBeenCalledWith('/train/coach')
    expect(row('Coach')).toBeUndefined()
  })
})

describe('Training — Your plan', () => {
  it('this week\'s sessions a row a day; a trained day opens its workout, another changes the day; Edit opens Schedule', () => {
    setS()
    const start = isoOf(startOfWeek(TODAY, weekStartOf(useStore.getState().S)))
    const day = n => { const d = new Date(start + 'T12:00:00'); d.setDate(d.getDate() + n); return d }
    const [a, b] = [day(0), day(6)]
    const w = at(isoOf(a), 9)
    setS({ week: { [a.getDay()]: ['r1'], [b.getDay()]: ['r2', 'r3'] }, workouts: [w] }); mount()
    const rows = planRows()
    expect(rows.map(x => x.querySelector('.lrow-t').textContent)).toEqual(['Push', 'Pull + Legs'])
    expect(rows[0].querySelector('.lrow-k')).toBeTruthy()
    expect(rows[0].querySelector('.lrow-s').textContent).toContain('Done')
    expect(rows[1].querySelector('.lrow-s').textContent).not.toContain('Done')
    tap(rows[0])
    expect(workoutDetailSheet).toHaveBeenCalledWith(w)
    tap(rows[1])
    expect(dayOverrideSheet).toHaveBeenCalledWith(isoOf(b))
    tap(link('Your plan', 'Edit'))
    expect(nav).toHaveBeenCalledWith('/train/schedule')
  })

  it('nothing planned this week says so', () => {
    setS({ week: {} }); mount()
    expect(planRows()).toHaveLength(0)
    expect(section('Your plan').querySelector('.inote').textContent).toBe('Nothing planned this week')
  })

  it('a coach week shows its progress row, whose chip starts that session', () => {
    setS({ queue: { ids: ['r2'], since: Date.now() - 86400000, startsOn: TODAY, label: 'US W1' } }); mount()
    const q = section('Your plan').querySelector('.queue')
    expect(q.textContent).toContain('US W1')
    tap(q.querySelector('.chip'))
    expect(startFlow).toHaveBeenCalledWith(['r2'])
  })

  it('a chip with a session in progress goes back to it', () => {
    setS({ queue: { ids: ['r2'], since: Date.now() - 86400000, startsOn: TODAY, label: 'US W1' }, active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    tap(section('Your plan').querySelector('.chip'))
    expect(startFlow).not.toHaveBeenCalled()
    expect(nav).toHaveBeenCalledWith('/train/workout')
  })

  it('rotation chosen with nothing built yet points to Plan', () => {
    setS({ scheduleMode: 'rotation', week: {} }); mount()
    expect(section('Your plan').querySelector('.inote').textContent).toBe('No rotation yet. Add routines to it in Plan.')
    expect(section('Your plan').querySelector('.queue')).toBeNull()
  })
})

describe('Training — Routines', () => {
  it('the first three, each opening its editor and starting from ▶; then Freestyle; See all opens Routines', () => {
    setS(); mount()
    const rows = media()
    expect(rows.map(x => x.querySelector('.tt').textContent)).toEqual(['Push', 'Pull', 'Legs', 'Freestyle'])
    expect(rows[0].querySelector('.lineart').dataset.scene).toBe('routine')
    tap(rows[1].querySelector('.item-open'))
    expect(nav).toHaveBeenCalledWith('/train/routines/r2')
    tap(rows[1].querySelector('.media-play'))
    expect(startFlow).toHaveBeenCalledWith(['r2'])
    expect(rows[1].querySelector('.media-play').getAttribute('aria-label')).toBe('Start Pull')
    tap(rows[3].querySelector('.media-play'))
    expect(startFlow).toHaveBeenLastCalledWith([])
    tap(link('Routines', 'See all'))
    expect(nav).toHaveBeenCalledWith('/train/routines')
  })

  it('today\'s routine is lit in its art; one no weekday holds is muted', () => {
    setS(); mount()
    const [push, pull] = media()
    expect(push.querySelector('.il-lit')).toBeTruthy()
    expect(pull.querySelector('.il-lit')).toBeNull()
    expect(pull.querySelector('.il-d.il-mute')).toBeTruthy()
    expect(push.querySelector('.il-d.il-mute')).toBeNull()
  })

  it('a rotation or a coach week schedules its routines too: not muted', () => {
    setS({ week: {}, scheduleMode: 'rotation', rotation: { id: 'rot', sequence: ['r2'] } }); mount()
    const [push, pull] = media()
    expect(pull.querySelector('.il-d.il-mute')).toBeNull()
    expect(push.querySelector('.il-d.il-mute')).toBeTruthy()
    act(() => root.unmount()); root = createRoot(host)
    setS({ week: {}, queue: { ids: ['r1'], since: Date.now() - 86400000, startsOn: TODAY, label: 'US W1' } }); mount()
    const [push2, pull2] = media()
    expect(push2.querySelector('.il-d.il-mute')).toBeNull()
    expect(pull2.querySelector('.il-d.il-mute')).toBeTruthy()
  })

  it('▶ on a routine with no exercises opens it to add some instead of starting an empty session', () => {
    setS({ routines: [r('e1', 'Empty', 0), ...routines] }); mount()
    const play = media()[0].querySelector('.media-play')
    expect(play.getAttribute('aria-label')).toBe('Add exercise, Empty')
    tap(play)
    expect(startFlow).not.toHaveBeenCalled()
    expect(nav).toHaveBeenCalledWith('/train/routines/e1')
  })

  it('with a session in progress, ▶ goes back to it instead of starting another', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount()
    tap(media()[0].querySelector('.media-play'))
    expect(startFlow).not.toHaveBeenCalled()
    expect(nav).toHaveBeenCalledWith('/train/workout')
  })

  it('no routines: no plan to show, a welcome with a starter plan, and Freestyle still there', () => {
    setS({ routines: [], week: {} }); mount()
    expect(section('Your plan')).toBeUndefined()
    const pill = label => [...section('Routines').querySelectorAll('.empty-acts button')].find(b => b.textContent === label)
    tap(pill('Load starter plan'))
    expect(starterPlanSheet).toHaveBeenCalled()
    expect(media().map(x => x.querySelector('.tt').textContent)).toEqual(['Freestyle'])
  })
})

// The Home review fixes live in code both tabs share; Training has to show them too.
describe('Training — the shared Home fixes', () => {
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoOf(d) })()

  it('a rest day names every routine of the next session', () => {
    setS({ week: { [new Date(tomorrow + 'T12:00:00').getDay()]: ['r1', 'r2'] } }); mount()
    expect(hero().caption).toMatch(/^Next session: \w+, Push \+ Pull$/)
  })

  it('the ⋯ comes after the heading in reading order', () => {
    setS(); mount()
    const title = host.querySelector('.hero-t'), more = host.querySelector('.hero-more')
    expect(title.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a workout with no name still has a label in the See workouts menu', () => {
    const a = at(yesterday, 8, { name: '' })
    const b = at(yesterday, 18, { name: 'Pull' })
    setS({ workouts: [a, b], week: {} })
    act(() => useDiarySelection.getState().setDate(yesterday)); mount()
    tap(host.querySelector('.hero-l'))
    expect(menuSheet.mock.calls.at(-1)[0].items.map(i => i.label)).toEqual(['Workout', 'Pull'])
  })

  it('the hero sits in a TabSection like every other block', () => {
    setS(); mount()
    expect(host.querySelector('.hero').closest('.tab-sec')).toBeTruthy()
  })

  it('a day to come in the calendar opens "change this day" for it, announced, without moving the date', () => {
    setS(); mount()
    tap(host.querySelector('.month-bar-l'))
    const opts = calendarSheet.mock.calls.at(-1)[1]
    expect(opts.onFuture).toBeTypeOf('function')
    act(() => opts.onFuture(tomorrow))
    expect(dayOverrideSheet).toHaveBeenCalledWith(tomorrow)
    expect(host.querySelector('[role="status"].sr-only').textContent).toBe('Change this day, ' + fmtDate(tomorrow, true))
    expect(useDiarySelection.getState().day()).toBe(TODAY)
  })
})

describe('Training — More', () => {
  it('Equipment and Training settings open their pages', () => {
    setS(); mount()
    tap(row('Equipment'))
    expect(nav).toHaveBeenCalledWith('/me/equipment')
    tap(row('Training settings'))
    expect(nav).toHaveBeenCalledWith('/me/workout')
  })
})
