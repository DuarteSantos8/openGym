// @vitest-environment happy-dom
// Holding Start: the disc gets .holding after START_HOLDING_MS (never on a quick tap), and loses it
// on release, cancel, leave and when the picker opens.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar, { START_HOLDING_MS, START_HOLD_MS } from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => ({ pathname: '/home' }),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, onPick
const start = () => host.querySelector('#tabbar button.start')
const fire = (type) => act(() => { start().dispatchEvent(new Event(type, { bubbles: true })) })
const wait = ms => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 1, name: 'test' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  onPick = vi.fn()
  act(() => root.render(<TabBar onStart={() => {}} onPick={onPick} />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('Start hold feedback', () => {
  it('a quick tap never sees .holding', () => {
    fire('pointerdown')
    wait(START_HOLDING_MS - 1)
    expect(start().classList.contains('holding')).toBe(false)
    fire('pointerup')
    wait(START_HOLD_MS)
    expect(start().classList.contains('holding')).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('adds .holding after the delay and drops it on release, leave (pointerout) and cancel', () => {
    for (const end of ['pointerup', 'pointerout', 'pointercancel']) {
      fire('pointerdown')
      wait(START_HOLDING_MS)
      expect(start().classList.contains('holding')).toBe(true)
      fire(end)
      expect(start().classList.contains('holding')).toBe(false)
    }
  })

  it('drops it when the picker opens', () => {
    fire('pointerdown')
    wait(START_HOLDING_MS)
    expect(start().classList.contains('holding')).toBe(true)
    wait(START_HOLD_MS - START_HOLDING_MS)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(start().classList.contains('holding')).toBe(false)
  })

  it('unmounting mid-hold cancels both timers', () => {
    fire('pointerdown')
    wait(START_HOLDING_MS - 1)
    act(() => root.unmount())
    wait(START_HOLD_MS)
    expect(onPick).not.toHaveBeenCalled()
    root = createRoot(host) // afterEach unmounts again
  })

  it('does not show it while a workout is running (the hold cannot open the picker)', () => {
    act(() => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0 } }, false) })
    fire('pointerdown')
    wait(START_HOLD_MS)
    expect(start().classList.contains('holding')).toBe(false)
  })
})
