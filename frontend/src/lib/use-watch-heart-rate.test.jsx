// @vitest-environment happy-dom
// The workout header's live heart rate: re-rendered when the watch sends a reading or changes
// state, and again as a reading goes stale with nothing new coming in.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { value: { bpm: null, running: false }, subs: new Set() }
})
vi.mock('./watch-link.js', () => ({
  watchHeartRate: () => h.value,
  subscribeWatchHeartRate: cb => { h.subs.add(cb); return () => h.subs.delete(cb) },
}))

import { useWatchHeartRate } from './use-watch-heart-rate.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Probe() {
  const { bpm, running } = useWatchHeartRate()
  return <span>{running ? 'on' : 'off'} {bpm ?? '-'}</span>
}

let container, root
beforeEach(() => {
  vi.useFakeTimers()
  h.value = { bpm: null, running: false }
  container = document.createElement('div')
  root = createRoot(container)
  act(() => root.render(<Probe />))
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

describe('useWatchHeartRate', () => {
  it('follows what the watch sends', () => {
    expect(container.textContent).toBe('off -')
    h.value = { bpm: 128, running: true }
    act(() => h.subs.forEach(cb => cb()))
    expect(container.textContent).toBe('on 128')
  })
  it('drops a stale reading without a new event', () => {
    h.value = { bpm: 128, running: true }
    act(() => h.subs.forEach(cb => cb()))
    h.value = { bpm: null, running: true }
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.textContent).toBe('on -')
  })
  it('lets go of the subscription when the screen goes', () => {
    act(() => root.unmount())
    expect(h.subs.size).toBe(0)
    root = createRoot(container)
  })
})
