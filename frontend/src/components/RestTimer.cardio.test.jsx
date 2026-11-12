// @vitest-environment happy-dom
// The bar of a running cardio segment: the clock, then what to set the machine to and what comes next.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

let host, root
beforeEach(() => {
  vi.useFakeTimers()
  useUI.setState({ timer: null, work: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.render(null))
  useUI.getState().stopWork()
  host.remove()
  vi.useRealTimers()
})

describe('the work bar on a cardio segment', () => {
  it('shows the speed and grade to set, and the next segment', () => {
    act(() => useUI.getState().startWork(180, 'Walking · segment 1 of 3', vi.fn(), null, { detail: '5 km/h · 4% incline', next: 'Next: 3 min @ 5.4 km/h' }))
    act(() => root.render(<RestTimer />))
    const bar = host.querySelector('#timer.working')
    expect(bar.querySelector('.t').textContent).toBe('3:00')
    expect(bar.querySelector('.lbl.cardio-now').textContent).toBe('5 km/h · 4% incline')
    expect(bar.querySelector('.lbl.cardio-next').textContent).toBe('Next: 3 min @ 5.4 km/h')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(bar.querySelector('.t').textContent).toBe('2:00')
  })

  it('a plain hold shows neither line', () => {
    act(() => useUI.getState().startWork(30, 'Plank', vi.fn()))
    act(() => root.render(<RestTimer />))
    expect(host.querySelector('.lbl.cardio-now')).toBeNull()
    expect(host.querySelector('.lbl.cardio-next')).toBeNull()
  })
})
