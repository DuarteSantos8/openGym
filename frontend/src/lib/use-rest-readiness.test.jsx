// @vitest-environment happy-dom
// Rest by heart rate on the phone: the watch's readings during a rest, judged every second, and
// the first "ready" announced once (toast, buzz, the timer marked for the bar and the watch).
// WatchLinkPlugin.swift is played in memory as in watch-link.test.js; the two stores are small
// stand-ins holding what the hook reads.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { listeners: new Map(), vibrate: null }
})
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' }, Encoding: { UTF8: 'utf8' },
  Filesystem: { readFile: async () => { throw new Error('File does not exist') }, writeFile: async () => {} },
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'ios' },
  registerPlugin: () => ({
    status: async () => ({ supported: true, paired: true, appInstalled: true, reachable: true }),
    rest: async () => {}, clearRest: async () => {},
    addListener: async (event, cb) => {
      h.listeners.set(event, [...(h.listeners.get(event) || []), cb])
      return { remove() {} }
    },
  }),
}))
vi.mock('./sound.js', () => ({ vibrate: (...a) => h.vibrate(...a) }))
vi.mock('../store/useStore.js', async () => {
  const { create } = await import('zustand')
  return { useStore: create(() => ({ S: {} })) }
})
vi.mock('../store/useUI.js', async () => {
  const { create } = await import('zustand')
  const useUI = create(set => ({
    timer: null,
    toast: vi.fn(),
    setHrReady: vi.fn(on => set(s => ({ timer: s.timer && { ...s.timer, hrReady: on } }))),
  }))
  return { useUI }
})

import { useRestReadiness } from './use-rest-readiness.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const T0 = 1_790_000_000_000
const flush = () => new Promise(r => setTimeout(r, 0))
const bpm = n => act(() => (h.listeners.get('heartRate') || []).forEach(cb => cb({ bpm: n, t: Date.now() })))
const wait = sec => act(() => { vi.advanceTimersByTime(sec * 1000) })
const rest = (over = {}) => ({ left: 90, total: 90, endsAt: Date.now() + 90000, startedAt: Date.now(), forIdx: 0, ...over })
const ui = () => useUI.getState()

function Probe() {
  useRestReadiness()
  return null
}

let host, root
beforeEach(async () => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setInterval', 'clearInterval'] })
  h.vibrate = vi.fn()
  useStore.setState({ S: { hrReady: { on: true, bpm: 110, floorSec: 45 } } })
  useUI.setState({ timer: rest() })
  ui().toast.mockClear(); ui().setHrReady.mockClear()
  host = document.createElement('div')
  root = createRoot(host)
  act(() => root.render(<Probe />))
  await act(async () => { await flush(); await flush(); await flush() })
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

describe('useRestReadiness', () => {
  it('says ready once the heart rate is back under the target past the floor, and only once', () => {
    bpm(140)
    wait(20); bpm(120)
    wait(20); bpm(100)
    wait(4)
    expect(ui().setHrReady).not.toHaveBeenCalled()
    wait(1); bpm(98)
    wait(1)
    expect(ui().setHrReady).toHaveBeenCalledTimes(1)
    expect(ui().setHrReady).toHaveBeenCalledWith(true)
    expect(ui().toast).toHaveBeenCalledWith('Heart rate recovered: ready for the next set')
    expect(h.vibrate).toHaveBeenCalledTimes(1)
    expect(ui().timer.hrReady).toBe(true)
    wait(5); bpm(95); wait(5)
    expect(ui().setHrReady).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while a reading of the last seconds is over the target', () => {
    wait(43); bpm(100)
    wait(1); bpm(115)
    wait(4)
    expect(ui().setHrReady).not.toHaveBeenCalled()
  })

  it('does not buzz with vibration off', () => {
    act(() => useStore.setState({ S: { hrReady: { on: true, bpm: 110, floorSec: 45 }, vibrate: false } }))
    wait(46); bpm(100); wait(3); bpm(100); wait(3)
    expect(ui().setHrReady).toHaveBeenCalledTimes(1)
    expect(h.vibrate).not.toHaveBeenCalled()
  })

  it('does nothing while the setting is off', () => {
    act(() => useStore.setState({ S: { hrReady: { on: false, bpm: 110, floorSec: 45 } } }))
    wait(46); bpm(90); wait(2)
    expect(ui().setHrReady).not.toHaveBeenCalled()
  })

  it('judges nothing while the rest is paused or over, or for a switch-sides pause', () => {
    act(() => useUI.setState({ timer: { ...ui().timer, paused: true } }))
    wait(46); bpm(90); wait(2)
    act(() => useUI.setState({ timer: { ...ui().timer, paused: false, ready: true } }))
    bpm(90); wait(2)
    act(() => useUI.setState({ timer: rest({ kind: 'switch', startedAt: T0 }) }))
    bpm(90); wait(2)
    expect(ui().setHrReady).not.toHaveBeenCalled()
  })

  it('starts every rest with no readings', () => {
    wait(30); bpm(100)
    act(() => useUI.setState({ timer: rest({ startedAt: Date.now() - 50000 }) }))
    wait(1)
    expect(ui().setHrReady).not.toHaveBeenCalled()
    bpm(100); wait(3); bpm(100); wait(3)
    expect(ui().setHrReady).toHaveBeenCalledTimes(1)
  })

  it('uses its own target and floor', () => {
    act(() => useStore.setState({ S: { hrReady: { on: true, bpm: 95, floorSec: 60 } } }))
    wait(50); bpm(100); wait(12); bpm(100); wait(1)
    expect(ui().setHrReady).not.toHaveBeenCalled()
    bpm(94); wait(3); bpm(94); wait(3)
    expect(ui().setHrReady).toHaveBeenCalledTimes(1)
  })
})
