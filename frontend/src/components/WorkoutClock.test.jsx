// @vitest-environment happy-dom
// The workout header's clock (#1078): the Timer starts a new countdown on the rest timer at the
// time it last ran, ending a rest that is running; the Stopwatch only counts.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

import { HeaderStopwatch, workoutClockSheet } from './WorkoutClock.jsx'
import { useUI, bindAuto, restoreRest, REST_KEY } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { useStopwatch } from '../store/useStopwatch.js'
import { applyRestLeft } from './RestTimer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS
const mount = el => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(el))
}
const open = () => {
  workoutClockSheet()
  const sheet = useUI.getState().sheets.at(-1)
  mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const unmount = () => { if (root) act(() => root.unmount()); host?.remove(); root = host = null }
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const tab = text => [...host.querySelectorAll('.seg button')].find(b => b.textContent === text)

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 })
  localStorage.clear()
  originalS = useStore.getState().S
  const { timerSec: _t, ...S } = originalS
  useStore.setState({ S: { ...S, sound: false, restSec: 120, active: { id: 'w1', start: 1000, entries: [] } } })
  useUI.setState({ sheets: [], timer: null, work: null })
  useStopwatch.setState({ w: { session: null, since: null, acc: 0 } })
})
afterEach(() => {
  unmount()
  useUI.getState().stopRest()
  useUI.getState().stopCountIn()
  useUI.setState({ sheets: [], work: null })
  useStore.setState({ S: originalS })
  vi.useRealTimers()
})

describe('workout Timer', () => {
  it('opens at the rest from Settings, and starting it ends a running rest for a countdown of its own', () => {
    act(() => useUI.getState().startRest(30, 2, { rest: 'work' }))
    open()
    expect(host.querySelector('.seg button.on').textContent).toBe('Timer')
    expect(host.querySelector('.wclock-ring')).toBeNull()   // a rest after a set keeps the wheel
    expect(host.querySelector('.dw-read').textContent).toBe('2:00')
    act(() => btn('Start timer').click())
    const tm = useUI.getState().timer
    expect(tm).toMatchObject({ left: 120, total: 120, clock: true })
    expect(tm.forIdx).toBeUndefined()
    expect(tm.rk).toBeUndefined()
    expect(useStore.getState().S.timerSec).toBe(120)
    expect(useStore.getState().S.edited.timerSec).toBeGreaterThan(0)   // syncs as a plain setting
    expect(host.querySelector('.wclock-t').textContent).toBe('2:00')
    expect(btn('Skip')).toBeTruthy()
  })

  it('opens next time at the time it last ran, and the ring counts down and moves by 15', () => {
    useStore.setState(st => ({ S: { ...st.S, timerSec: 45 } }))
    open()
    expect(host.querySelector('.dw-read').textContent).toBe('45s')
    act(() => btn('Start timer').click())
    act(() => vi.advanceTimersByTime(5000))
    expect(host.querySelector('.wclock-t').textContent).toBe('0:40')
    act(() => btn('+15').click())
    expect(host.querySelector('.wclock-t').textContent).toBe('0:55')
    act(() => btn('Skip').click())
    expect(useUI.getState().timer).toBeNull()
    expect(host.querySelector('.wclock-ring')).toBeNull()
  })

  it('the mark stays through ticks, pause, resume, ±15 and the notification, and goes when it runs out', () => {
    useStore.setState(st => ({ S: { ...st.S, timerSec: 60 } }))
    open()
    act(() => btn('Start timer').click())
    const ui = () => useUI.getState()
    act(() => vi.advanceTimersByTime(3000))
    expect(ui().timer.clock).toBe(true)
    act(() => ui().pauseRest()); expect(ui().timer.clock).toBe(true)
    act(() => ui().resumeRest()); expect(ui().timer.clock).toBe(true)
    act(() => ui().addRest(-15)); expect(ui().timer.clock).toBe(true)
    act(() => ui().followNativeRest({ endsAt: Date.now() + 20_000, left: 20, total: 60, paused: false }))
    expect(ui().timer.clock).toBe(true)
    act(() => vi.advanceTimersByTime(21_000))
    expect(ui().timer.ready).toBe(true)
    expect(host.querySelector('.wclock-ring')).toBeNull()   // over: back to the wheel
  })

  it('does not start while a hold runs, so the hold is not ended and logged', () => {
    const work = { left: 20, total: 30, endsAt: Date.now() + 20_000 }
    useUI.setState({ work })
    open()
    expect(btn('Start timer').disabled).toBe(true)
    act(() => btn('Start timer').click())
    expect(useUI.getState().timer).toBeNull()
    expect(useUI.getState().work).toBe(work)
  })

  it('never leads into a hold that starts by itself', () => {
    const startHold = vi.fn()
    const unbind = bindAuto({ peek: () => ({ idx: 0, i: 1, id: 'plank', plan: 30, label: 'Plank' }), forecast: () => [], focus: vi.fn(), startHold, stop: vi.fn() })
    try {
      useStore.setState(st => ({ S: { ...st.S, timerSec: 20 } }))
      open()
      act(() => btn('Start timer').click())
      expect(useUI.getState().timer.autoNext).toBeUndefined()
      act(() => vi.advanceTimersByTime(21_000))
      expect(useUI.getState().countIn).toBeFalsy()
      expect(useUI.getState().timer).toMatchObject({ ready: true, clock: true })
      act(() => useUI.getState().stopRest())
      act(() => btn('Start timer').click())
      act(() => useUI.getState().skipRest())   // the rest bar's or the notification's Skip
      expect(useUI.getState().countIn).toBeFalsy()
      expect(startHold).not.toHaveBeenCalled()
    } finally { unbind() }
  })

  it('started again from its Ready (+15, the wheel, a watch), it still leads into no hold', () => {
    const startHold = vi.fn()
    const unbind = bindAuto({ peek: () => ({ idx: 0, i: 1, id: 'plank', plan: 30, label: 'Plank' }), forecast: () => [], focus: vi.fn(), startHold, stop: vi.fn() })
    try {
      useStore.setState(st => ({ S: { ...st.S, timerSec: 20 } }))
      open()
      act(() => btn('Start timer').click())
      act(() => vi.advanceTimersByTime(21_000))
      expect(useUI.getState().timer.ready).toBe(true)
      act(() => useUI.getState().addRest(15))
      expect(useUI.getState().timer).toMatchObject({ clock: true, total: 15 })
      expect(useUI.getState().timer.autoNext).toBeUndefined()
      act(() => vi.advanceTimersByTime(16_000))
      expect(useUI.getState().countIn).toBeFalsy()
      expect(useUI.getState().timer.ready).toBe(true)
      act(() => applyRestLeft(10, 0))   // the rest bar's wheel on Ready
      expect(useUI.getState().timer.clock).toBe(true)
      act(() => vi.advanceTimersByTime(11_000))
      act(() => useUI.getState().alignRest(Date.now() + 10_000))   // a watch's +15 on Ready
      expect(useUI.getState().timer.clock).toBe(true)
      act(() => vi.advanceTimersByTime(11_000))
      expect(useUI.getState().countIn).toBeFalsy()
      expect(startHold).not.toHaveBeenCalled()
    } finally { unbind() }
  })

  it('stays the Timer\'s countdown across a reload', () => {
    useStore.setState(st => ({ S: { ...st.S, timerSec: 60 } }))
    open()
    act(() => btn('Start timer').click())
    const saved = localStorage.getItem(REST_KEY)
    expect(JSON.parse(saved).clock).toBe(true)
    act(() => useUI.getState().stopRest())   // the page gone: nothing in memory
    localStorage.setItem(REST_KEY, saved)
    act(() => { expect(restoreRest()).toBe(true) })
    expect(useUI.getState().timer).toMatchObject({ clock: true, total: 60 })
  })
})

describe('workout Stopwatch', () => {
  it('starts, stops, resumes and resets, and the sheet opens on it while it has time', () => {
    open()
    act(() => tab('Stopwatch').click())
    expect(host.querySelector('.wclock-sw').textContent).toBe('0:00.0')
    expect(btn('Reset').disabled).toBe(true)
    act(() => btn('Start').click())
    act(() => vi.advanceTimersByTime(4200))
    expect(host.querySelector('.wclock-sw').textContent).toBe('0:04.2')
    act(() => btn('Stop').click())
    expect(btn('Resume')).toBeTruthy()
    unmount()
    open()
    expect(host.querySelector('.seg button.on').textContent).toBe('Stopwatch')
    expect(host.querySelector('.wclock-sw').textContent).toBe('0:04.2')
    act(() => btn('Reset').click())
    expect(host.querySelector('.wclock-sw').textContent).toBe('0:00.0')
    expect(JSON.parse(localStorage.getItem('gym_stopwatch_v1'))).toMatchObject({ session: 'w1', acc: 0, since: null })
    expect(useUI.getState().timer).toBeNull()   // nothing of it touches the rest timer
  })

  it('a new workout starts it from zero', () => {
    useStopwatch.setState({ w: { session: 'old', since: null, acc: 9000 } })
    open()
    expect(host.querySelector('.seg button.on').textContent).toBe('Timer')
    act(() => tab('Stopwatch').click())
    expect(host.querySelector('.wclock-sw').textContent).toBe('0:00.0')
  })

  it('the header shows a running stopwatch of this workout only', () => {
    useStopwatch.setState({ w: { session: 'w1', since: Date.now() - 65_000, acc: 0 } })
    mount(<HeaderStopwatch session="w1" />)
    expect(host.textContent).toBe('Stopwatch 1:05')   // "Stopwatch" is for screen readers (.vh)
    act(() => vi.advanceTimersByTime(1000))
    expect(host.textContent).toBe('Stopwatch 1:06')
    act(() => root.render(<HeaderStopwatch session="w2" />))
    expect(host.textContent).toBe('')
    useStopwatch.setState({ w: { session: 'w1', since: null, acc: 5000 } })
    act(() => root.render(<HeaderStopwatch session="w1" />))
    expect(host.textContent).toBe('')   // stopped: only the icon
  })
})
