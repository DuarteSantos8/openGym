// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), restOver: vi.fn(), vibrate: vi.fn() }))

let host, root, originalS

beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  useStore.setState({ S: { ...originalS, sound: false, timedSetOvertime: true } })
  useUI.setState({ timer: null, work: null, timerFlashId: 0 })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.render(null))
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useStore.setState({ S: originalS })
  host.remove()
  vi.useRealTimers()
})

const mount = () => act(() => root.render(<RestTimer />))

describe('RestTimer Ready and overtime display', () => {
  it('keeps Ready and its Dismiss action across a remount', () => {
    act(() => useUI.getState().startRest(1, 4))
    act(() => vi.advanceTimersByTime(1000))
    mount()

    expect(host.querySelector('#timer .t').textContent).toBe('Ready')
    expect(host.querySelector('#timer .t').getAttribute('role')).toBe('status')
    expect(host.querySelector('#timer .skip').textContent).toBe('Dismiss')
    expect(useUI.getState().timer.forIdx).toBe(4)

    act(() => root.render(null))
    expect(host.querySelector('#timer')).toBeNull()
    mount()
    expect(host.querySelector('#timer .t').textContent).toBe('Ready')
    act(() => host.querySelector('#timer .skip').click())
    expect(useUI.getState().timer).toBeNull()
  })

  it('shows a plus clock and an empty bar during opted-in overtime', () => {
    act(() => useUI.getState().startWork(2, 'Hold', vi.fn()))
    mount()
    act(() => vi.advanceTimersByTime(5000))

    expect(host.querySelector('#timer .t').textContent).toBe('+0:03')
    expect(host.querySelector('#timer .bar i').style.width).toBe('0%')
  })
})

// Pause sits between +15 and Skip (#193): it holds the rest where it is and says so, and the
// same button carries on from there. A rest that is over has nothing left to hold.
describe('RestTimer pause and resume', () => {
  const pause = () => host.querySelector('#timer .pause')

  it('pauses the countdown, shows it held, and resumes from the same second', () => {
    act(() => useUI.getState().startRest(90, 0))
    mount()
    act(() => vi.advanceTimersByTime(10000))
    expect(host.querySelector('#timer .t').textContent).toBe('1:20')
    expect(pause().getAttribute('aria-label')).toBe('Pause')

    act(() => pause().click())
    expect(host.querySelector('#timer').classList.contains('paused')).toBe(true)
    expect(pause().getAttribute('aria-label')).toBe('Resume')
    expect(pause().getAttribute('aria-pressed')).toBe('true')
    act(() => vi.advanceTimersByTime(60000))
    expect(host.querySelector('#timer .t').textContent).toBe('1:20')

    act(() => pause().click())
    expect(host.querySelector('#timer').classList.contains('paused')).toBe(false)
    act(() => vi.advanceTimersByTime(20000))
    expect(host.querySelector('#timer .t').textContent).toBe('1:00')
  })

  it('offers no pause once the rest is Ready, and none on the timed hold', () => {
    act(() => useUI.getState().startRest(1))
    mount()
    act(() => vi.advanceTimersByTime(1000))
    expect(host.querySelector('#timer .t').textContent).toBe('Ready')
    expect(pause()).toBeNull()

    act(() => useUI.getState().startWork(30, 'Hold', vi.fn()))
    expect(host.querySelector('#timer.working')).not.toBeNull()
    expect(pause()).toBeNull()
  })
})
