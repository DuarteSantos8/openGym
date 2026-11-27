// @vitest-environment happy-dom
// The screen is let go after 15 quiet minutes, and only then: rests and holds, a set, a tap and
// opening the app all keep it. Before this, a workout left unfinished held the screen on for
// ~50 min (45 min + the forgotten-workout grace), for ever with "Never", and on the web for ever.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QUIET_MS, quietAt, useQuiet } from './wakelock-quiet.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const MIN = 60 * 1000
const T0 = 1_800_000_000_000

describe('quietAt', () => {
  it('counts 15 min from the start, a reopen or a tap, whichever is last', () => {
    expect(quietAt({ start: T0 })).toBe(T0 + QUIET_MS)
    expect(quietAt({ start: T0, reopenedAt: T0 + 5 * MIN })).toBe(T0 + 5 * MIN + QUIET_MS)
    expect(quietAt({ start: T0, reopenedAt: T0 + 5 * MIN }, { touchAt: T0 + 9 * MIN })).toBe(T0 + 9 * MIN + QUIET_MS)
  })
  it('never while a rest or a hold is counting down', () => {
    expect(quietAt({ start: T0 }, { resting: true })).toBe(0)
  })
})

describe('useQuiet', () => {
  let quiet, root
  const Probe = ({ A, resting }) => { quiet = useQuiet(A, resting); return null }
  const show = props => act(async () => root.render(<Probe {...props} />))
  const wait = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); root = createRoot(document.createElement('div')) })
  afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })

  it('turns on after 15 quiet minutes, off again on a tap', async () => {
    await show({ A: { id: 'a', start: T0 }, resting: false })
    await wait(14 * MIN); expect(quiet).toBe(false)
    await wait(1 * MIN); expect(quiet).toBe(true)
    await act(async () => { document.dispatchEvent(new Event('pointerdown')) })
    expect(quiet).toBe(false)
    await wait(14 * MIN); expect(quiet).toBe(false)
    await wait(1 * MIN); expect(quiet).toBe(true)
  })

  it('counts typing as a touch', async () => {
    await show({ A: { id: 'a', start: T0 }, resting: false })
    await wait(14 * MIN)
    await act(async () => { document.dispatchEvent(new Event('input')) })
    await wait(14 * MIN); expect(quiet).toBe(false)
    await wait(1 * MIN); expect(quiet).toBe(true)
  })

  it('stays off through a long rest, and counts 15 min from when it ends', async () => {
    const A = { id: 'a', start: T0 }
    await show({ A, resting: true })
    await wait(40 * MIN); expect(quiet).toBe(false)
    await show({ A, resting: false })
    expect(quiet).toBe(false)
    await wait(14 * MIN); expect(quiet).toBe(false)
    await wait(1 * MIN); expect(quiet).toBe(true)
  })

  it('a rest starting after the quiet spell takes the screen back', async () => {
    const A = { id: 'a', start: T0 }
    await show({ A, resting: false }); await wait(20 * MIN); expect(quiet).toBe(true)
    await show({ A, resting: true }); expect(quiet).toBe(false)
  })

  it('is off with no workout', async () => {
    await show({ A: null, resting: false }); await wait(60 * MIN); expect(quiet).toBe(false)
  })
})
