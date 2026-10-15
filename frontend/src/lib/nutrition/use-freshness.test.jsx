// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToday } from './use-freshness.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Today() {
  return <span>{useToday()}</span>
}

describe('useToday', () => {
  afterEach(() => vi.useRealTimers())

  it('moves on at midnight without anything else happening', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 9, 15, 23, 59, 30))
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => { root.render(<Today />) })
    expect(host.textContent).toBe('2026-10-15')
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(host.textContent).toBe('2026-10-15')
    await act(async () => { vi.advanceTimersByTime(20_000) })
    expect(host.textContent).toBe('2026-10-16')
    await act(async () => { root.unmount() })
  })

  it('reads the date again when the page comes back to the front', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => { root.render(<Today />) })
    vi.setSystemTime(new Date(2026, 9, 17, 8))
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(host.textContent).toBe('2026-10-17')
    await act(async () => { root.unmount() })
  })
})
