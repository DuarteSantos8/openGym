// @vitest-environment happy-dom
// MonthBar, WeekStrip and WeekDots: the date navigation Home, Training and Nutrition share.
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarSheet } from '../sheets.jsx'
import { SUNDAY } from '../lib/format.js'
import { MonthBar, WeekDots, WeekStrip } from './date-nav.jsx'

vi.mock('../sheets.jsx', () => ({ calendarSheet: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Thursday 15 October 2026; its Monday-first week runs 12–18.
const TODAY = '2026-10-15'
let host, root
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(TODAY + 'T09:00:00'))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
  document.documentElement.dir = ''
})

const render = el => act(() => root.render(el))
const $ = s => host.querySelector(s)
const $$ = s => [...host.querySelectorAll(s)]
const days = () => $$('.wk-d')
const nums = () => days().map(d => d.querySelector('.wk-num').textContent)
function pointer(target, type, x, y = 0) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { clientX: { value: x }, clientY: { value: y }, pointerId: { value: 1 } })
  act(() => target.dispatchEvent(e))
}
const key = (target, k) => act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

function Strip({ date: initial = TODAY, onSelect, ...props }) {
  const [date, setDate] = useState(initial)
  return <WeekStrip {...props} date={date} onSelect={iso => { onSelect?.(iso); setDate(iso) }} />
}

describe('MonthBar', () => {
  it('names the month and opens the calendar on it, handing back the day picked', () => {
    const onPickDate = vi.fn()
    render(<MonthBar date="2026-09-30" onPickDate={onPickDate} onToday={() => {}} />)
    const label = $('.month-bar-l')
    expect(label.textContent).toMatch(/September 2026/)
    expect(label.getAttribute('aria-haspopup')).toBe('dialog')
    act(() => label.click())
    expect(calendarSheet).toHaveBeenCalledWith('2026-09-30', { onPick: onPickDate })
  })

  it('offers Today on another day and keeps its place hidden on today', () => {
    const onToday = vi.fn()
    render(<MonthBar date="2026-10-01" onPickDate={() => {}} onToday={onToday} />)
    expect($('.month-bar-today').classList.contains('off')).toBe(false)
    act(() => $('.month-bar-today').click())
    expect(onToday).toHaveBeenCalled()
    render(<MonthBar date={TODAY} onPickDate={() => {}} onToday={onToday} />)
    // hidden, not removed: the label never moves
    expect($('.month-bar-today').classList.contains('off')).toBe(true)
  })
})

describe('WeekStrip', () => {
  it('shows the week around the date, from the week start the profile uses', () => {
    render(<Strip />)
    expect(nums()).toEqual(['12', '13', '14', '15', '16', '17', '18'])
    act(() => root.unmount())
    root = createRoot(host)
    render(<Strip weekStart={SUNDAY} />)
    expect(nums()).toEqual(['11', '12', '13', '14', '15', '16', '17'])
  })

  it('is a group of pressed buttons, today marked as the current date, each named in full', () => {
    render(<Strip date="2026-10-14" marks={{ '2026-10-14': 'done', '2026-10-16': 'plan' }} />)
    expect($('.wk-strip').getAttribute('role')).toBe('group')
    const [, , wed, thu, fri] = days()
    expect(wed.getAttribute('aria-pressed')).toBe('true')
    expect(wed.classList.contains('sel')).toBe(true)
    expect(thu.getAttribute('aria-current')).toBe('date')
    expect(thu.classList.contains('today')).toBe(true)
    expect(wed.getAttribute('aria-label')).toBe('Wednesday 14 October, Workout done')
    expect(fri.getAttribute('aria-label')).toBe('Friday 16 October, Planned')
    expect(fri.querySelector('.wk-dot').className).toBe('wk-dot plan')
  })

  it('throws in development on a mark it has no dot for', () => {
    expect(() => render(<Strip marks={{ [TODAY]: 'rest' }} />)).toThrow(/WeekStrip: marks="rest"/)
  })

  it('selects a tapped day, and none after maxDate', () => {
    const onSelect = vi.fn()
    render(<Strip onSelect={onSelect} maxDate={TODAY} />)
    act(() => days()[1].click())
    expect(onSelect).toHaveBeenCalledWith('2026-10-13')
    expect(days()[1].getAttribute('aria-pressed')).toBe('true')
    expect(days()[4].disabled).toBe(true)
    expect(days()[3].disabled).toBe(false)
  })

  it('changes the week on a horizontal swipe without changing the date', () => {
    const onSelect = vi.fn()
    render(<Strip onSelect={onSelect} />)
    const strip = $('.wk-strip')
    pointer(strip, 'pointerdown', 200)
    pointer(strip, 'pointerup', 100)
    expect(nums()).toEqual(['19', '20', '21', '22', '23', '24', '25'])
    expect($('.wk-days').classList.contains('from-next')).toBe(true)
    // the click the swipe ends with is not a pick
    act(() => days()[0].click())
    expect(onSelect).not.toHaveBeenCalled()
    pointer(strip, 'pointerdown', 100)
    pointer(strip, 'pointerup', 260)
    pointer(strip, 'pointerdown', 100)
    pointer(strip, 'pointerup', 260)
    expect(nums()).toEqual(['5', '6', '7', '8', '9', '10', '11'])
    // a short or vertical drag is a scroll, not a swipe
    pointer(strip, 'pointerdown', 100, 0)
    pointer(strip, 'pointerup', 130, 0)
    pointer(strip, 'pointerdown', 100, 0)
    pointer(strip, 'pointerup', 160, 200)
    expect(nums()[0]).toBe('5')
  })

  it('does not swipe past the week maxDate is in, and mirrors the swipe right to left', () => {
    render(<Strip maxDate={TODAY} />)
    pointer($('.wk-strip'), 'pointerdown', 200)
    pointer($('.wk-strip'), 'pointerup', 100)
    expect(nums()[0]).toBe('12')
    document.documentElement.dir = 'rtl'
    pointer($('.wk-strip'), 'pointerdown', 200)
    pointer($('.wk-strip'), 'pointerup', 100)
    expect(nums()[0]).toBe('5')
  })

  it('walks the days with the arrow keys, into the next or previous week past either end', () => {
    render(<Strip />)
    act(() => days()[6].focus())
    key(days()[6], 'ArrowRight')
    expect(nums()[0]).toBe('19')
    expect(document.activeElement).toBe(days()[0])
    key(days()[0], 'ArrowLeft')
    expect(nums()[0]).toBe('12')
    expect(document.activeElement).toBe(days()[6])
    key(days()[6], 'ArrowLeft')
    expect(document.activeElement).toBe(days()[5])
  })

  it('brings the week of a date picked elsewhere (the calendar) back', () => {
    render(<WeekStrip date={TODAY} onSelect={() => {}} />)
    render(<WeekStrip date="2026-09-02" onSelect={() => {}} />)
    expect(nums()).toEqual(['31', '1', '2', '3', '4', '5', '6'])
    expect($('.wk-days').classList.contains('from-prev')).toBe(true)
  })
})

describe('WeekDots', () => {
  const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
    .map((iso, i) => ({ iso, done: i === 0 || i === 3 }))

  it('is one image, named by the count, a dot a day', () => {
    render(<WeekDots days={week} />)
    expect($('.wk-dots').getAttribute('role')).toBe('img')
    expect($('.wk-dots').getAttribute('aria-label')).toBe('Trained on 2 of 7 days')
    expect($$('.wk-dots-d.done')).toHaveLength(2)
    expect($$('.wk-dots-d')).toHaveLength(7)
  })

  it('takes a sentence of its own', () => {
    render(<WeekDots days={week} label="2 workouts this week" />)
    expect($('.wk-dots').getAttribute('aria-label')).toBe('2 workouts this week')
  })
})
