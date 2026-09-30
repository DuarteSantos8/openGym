// @vitest-environment happy-dom
// A coach week (S.queue) runs by order, not by weekday, so Home swaps the seven dots for a
// progress row. Covered here: one chip per session in slot order with its state word, a tap on
// an undone chip starting that routine alone, a done chip staying inert, the status line's
// states, the today row still answering through the same helper, and a session pinned to a day
// (S.dayPlan[iso] = queue routine id) wearing its day on the chip and yielding the light.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { startFlow } from '../sheets.jsx'
import { todayISO, isoOf, fmtDate } from '../lib/format.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '',
}))

const routines = [
  { id: 'd1', name: 'US W1 D1', emoji: null, ex: [{ id: '0025' }] },
  { id: 'd2', name: 'US W1 D2', emoji: null, ex: [{ id: '0025' }] },
  { id: 'd3', name: 'US W1 D3', emoji: null, ex: [{ id: '0025' }] },
  { id: 'own', name: 'Core', emoji: null, ex: [{ id: '0025' }] },
]
// Home reads the clock, so the queue is pinned relative to the real today: applied three days
// ago, active since the day before yesterday, its logged session on a day that is not today.
const SINCE = Date.now() - 3 * 86400000
const daysFromToday = n => { const d = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const queue = (over = {}) => ({ ids: ['d1', 'd2', 'd3'], since: SINCE, startsOn: daysFromToday(-2), label: 'US W1', ...over })
const logged = id => {
  const start = SINCE + 3600000
  return { id: 'w-' + id, d: isoOf(new Date(start)), start, end: start + 3600000, routineIds: [id], routineId: id, name: routines.find(r => r.id === id).name, entries: [] }
}

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  startFlow.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, routines, week: {}, dayPlan: {}, workouts: [], active: null, queue: queue(), ...over }, user: null,
}))
const mount = () => act(() => root.render(<Home />))
const chips = () => [...host.querySelectorAll('.queue .chip')]
const chipTexts = () => chips().map(c => c.textContent)
const status = () => host.querySelector('.queue .queue-status')?.textContent
const todayTitle = () => host.querySelector('.today-row .ttl')?.textContent
const card = () => [...host.querySelectorAll('.card .muted.small')].map(e => e.textContent).find(x => x.includes('this week'))

describe('Home — coach week progress row', () => {
  it('replaces the weekday dots with one chip per session, in slot order, and lights the first', () => {
    setS()
    mount()
    expect(host.querySelector('.week')).toBeNull()
    expect(host.querySelectorAll('.wday').length).toBe(0)
    expect(host.querySelector('.queue .row .small').textContent).toBe('US W1')
    expect(chipTexts()).toEqual(['US W1 D1Up next', 'US W1 D2Later', 'US W1 D3Later'])
    expect(chips()[0].className).toBe('chip on')
    expect(status()).toBe('Next: US W1 D1, today')
    expect(todayTitle()).toBe('US W1 D1')
  })

  it('a finished workout on a routine marks its chip done and moves the light on', () => {
    setS({ workouts: [logged('d1')] })
    mount()
    expect(chipTexts()).toEqual(['US W1 D1Done', 'US W1 D2Up next', 'US W1 D3Later'])
    expect(chips()[0].disabled).toBe(true)
    expect(chips()[1].className).toBe('chip on')
    expect(host.querySelectorAll('.queue .row .small')[1].textContent).toBe('1 / 3')
    expect(status()).toBe('Next: US W1 D2, today')
    expect(todayTitle()).toBe('US W1 D2')
  })

  it('tapping an undone chip starts that routine alone, in any order; a done chip does nothing', () => {
    setS({ workouts: [logged('d1')] })
    mount()
    act(() => { chips()[2].click() })
    expect(startFlow).toHaveBeenCalledTimes(1)
    expect(startFlow).toHaveBeenCalledWith(['d3'])
    act(() => { chips()[0].click() })
    expect(startFlow).toHaveBeenCalledTimes(1)
  })

  it('a session in progress wins over a chip tap, as on the today row', () => {
    setS({ active: { id: 'a', name: 'US W1 D1', start: Date.now(), cur: 0, entries: [], routineIds: ['d1'] } })
    mount()
    act(() => { chips()[1].click() })
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('before startsOn it says when the week starts, and the today row points at that day', () => {
    const startsOn = daysFromToday(2)
    setS({ queue: queue({ startsOn }) })
    mount()
    expect(status()).toBe('Next week starts ' + fmtDate(startsOn, true))
    expect(chipTexts()[0]).toBe('US W1 D1Up next')
    expect(todayTitle()).toBe('Rest day')
    expect(host.querySelector('.today-row .ss').textContent).toMatch(/^Next session: \w+, US W1 D1$/)
  })

  it('a complete week says so, every chip is inert, and the day goes back to the weekday plan', () => {
    setS({ workouts: [logged('d1'), logged('d2'), logged('d3')], week: { [new Date().getDay()]: ['own'] } })
    mount()
    expect(status()).toBe('Week complete, ask the coach')
    expect(chips().every(c => c.disabled)).toBe(true)
    expect(host.querySelectorAll('.queue .row .small')[1].textContent).toBe('3 / 3')
    expect(todayTitle()).toBe('Core')
  })

  it('own routines on the weekday ride along beside the queue session', () => {
    setS({ week: { [new Date().getDay()]: ['own'] } })
    mount()
    expect(todayTitle()).toBe('US W1 D1 + Core')
    expect(chipTexts().length).toBe(3)
  })

  it('a rest override for today wins on the today row, and the status line stops saying "today"', () => {
    setS({ dayPlan: { [todayISO()]: 'rest' } })
    mount()
    expect(todayTitle()).toBe('Rest day')
    expect(status()).toBe('Next: US W1 D1')
    expect(chips()[0].className).toContain('on')
  })

  it('a malformed queue from another client shows the weekday dots, never an empty card', () => {
    setS({ queue: { ids: 'd1' }, week: { [new Date().getDay()]: ['own'] } })
    mount()
    expect(host.querySelector('.queue')).toBeNull()
    expect(host.querySelectorAll('.week .wday').length).toBe(7)
    expect(todayTitle()).toBe('Core')
  })

  it('the streak card counts the coach sessions done, wherever in the calendar they fell', () => {
    // Ran long: the queue applied ten days ago and D1 logged the day after — never in this
    // calendar week, whichever weekday today is, so a calendar-week count would show 0 / 3.
    const since = Date.now() - 10 * 86400000, start = since + 3600000
    setS({ queue: queue({ since, startsOn: daysFromToday(-9) }), workouts: [{ ...logged('d1'), d: isoOf(new Date(start)), start, end: start + 3600000 }] })
    mount()
    expect(card()).toMatch(/^1 \/ 3 this week · 1 workout total$/)
  })

  it('the streak card counts your own day beside the coach week, planned and done', () => {
    const now = Date.now()
    const core = { id: 'w-own', d: todayISO(), start: now - 3600000, end: now, routineIds: ['own'], routineId: 'own', name: 'Core', entries: [] }
    setS({ week: { [new Date().getDay()]: ['own'] }, workouts: [logged('d1'), core] })
    mount()
    expect(card()).toMatch(/^2 \/ 4 this week · 2 workouts total$/)
    expect(host.querySelectorAll('.queue .row .small')[1].textContent).toBe('1 / 3')
  })

  it('without a queue the weekday dots are back', () => {
    setS({ queue: null })
    mount()
    expect(host.querySelector('.queue')).toBeNull()
    expect(host.querySelectorAll('.wday').length).toBe(7)
  })
})

describe('Home — a session pinned to a day', () => {
  it('a fulfilled pin — pinned to today, done on an earlier day — reads as no override on the today row', () => {
    setS({ dayPlan: { [todayISO()]: 'd1' }, workouts: [logged('d1')] })
    mount()
    expect(chipTexts()).toEqual(['US W1 D1Done', 'US W1 D2Up next', 'US W1 D3Later'])
    expect(status()).toBe('Next: US W1 D2, today')
    expect(todayTitle()).toBe('US W1 D2')
  })

  it('a session pinned ahead wears its day, is not lit, and the light moves to the next floating one', () => {
    const on = daysFromToday(2)
    setS({ dayPlan: { [on]: 'd1' } })
    mount()
    expect(chipTexts()).toEqual(['US W1 D1' + fmtDate(on, true), 'US W1 D2Up next', 'US W1 D3Later'])
    expect(chips()[0].className).toBe('chip')
    expect(chips()[0].disabled).toBe(false)
    expect(chips()[1].className).toBe('chip on')
    expect(status()).toBe('Next: US W1 D2, today')
    expect(todayTitle()).toBe('US W1 D2')
  })

  it('a session pinned to today is the day\'s session, ahead of the floating order', () => {
    setS({ dayPlan: { [todayISO()]: 'd3' } })
    mount()
    expect(chipTexts()).toEqual(['US W1 D1Later', 'US W1 D2Later', 'US W1 D3Up next'])
    expect(chips()[2].className).toBe('chip on')
    expect(status()).toBe('Next: US W1 D3, today')
    // Home reads any per-date override on today as a reschedule — a pin is one.
    expect(todayTitle()).toBe('US W1 D3 · rescheduled')
  })

  it('every session pinned ahead: no chip is lit, the line names the soonest with its day, today rests', () => {
    const d1 = daysFromToday(1), d2 = daysFromToday(3), d3 = daysFromToday(2)
    setS({ dayPlan: { [d1]: 'd1', [d2]: 'd2', [d3]: 'd3' } })
    mount()
    expect(chipTexts()).toEqual(['US W1 D1' + fmtDate(d1, true), 'US W1 D2' + fmtDate(d2, true), 'US W1 D3' + fmtDate(d3, true)])
    expect(chips().some(c => c.className.includes('on'))).toBe(false)
    expect(chips().every(c => !c.disabled)).toBe(true)
    expect(status()).toBe('Next: US W1 D1 · ' + fmtDate(d1, true))
    expect(todayTitle()).toBe('Rest day')
    // Soonest by date, not first in slot order.
    act(() => setS({ dayPlan: { [daysFromToday(3)]: 'd1', [daysFromToday(1)]: 'd2', [daysFromToday(2)]: 'd3' } }))
    expect(status()).toBe('Next: US W1 D2 · ' + fmtDate(daysFromToday(1), true))
  })

  it('tapping a pinned chip starts that routine alone, today', () => {
    setS({ dayPlan: { [daysFromToday(2)]: 'd1' } })
    mount()
    act(() => { chips()[0].click() })
    expect(startFlow).toHaveBeenCalledTimes(1)
    expect(startFlow).toHaveBeenCalledWith(['d1'])
  })
})
