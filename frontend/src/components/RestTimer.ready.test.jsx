// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

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
