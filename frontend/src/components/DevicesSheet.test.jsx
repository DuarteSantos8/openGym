// @vitest-environment happy-dom
// The Devices sheet: one row per link, a state word with its own glyph, "Last heard" only on a
// row that is down, one fix button per broken row, no numbers of milliseconds anywhere.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ rows: [], check: vi.fn(), go: vi.fn(), retry: vi.fn(), pair: vi.fn(), connect: vi.fn(), signin: vi.fn() }))
vi.mock('./useDeviceLink.js', () => ({ useDeviceLink: () => ({ rows: m.rows, overall: 'ok' }) }))
vi.mock('../lib/device-link-live.js', () => ({ checkLinks: (...a) => m.check(...a) }))
vi.mock('../lib/nav.js', () => ({ closeThenNav: (_c, to) => m.go(to) }))
vi.mock('./ServerSync.jsx', () => ({
  syncNowWithToast: () => m.retry(), pairAgain: () => m.pair(), connectServer: () => m.connect(), signInAgain: () => m.signin(),
  actionLabel: v => ({ retry: 'Try again', pair: 'Pair again', signin: 'Sign in', connect: 'Connect' })[v.action] || null,
}))

import { DevicesSheet } from './DevicesSheet.jsx'

const row = (id, kind, state, over = {}) => ({ id, kind, state, speed: null, lastHeard: null, warn: false, fix: null, ...over })
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.useFakeTimers(); m.check.mockClear() })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const render = async rows => { m.rows = rows; await act(async () => { root.render(<DevicesSheet close={() => {}} />) }) }

describe('DevicesSheet', () => {
  it('names each state in words and gives a broken row one fix button', async () => {
    await render([
      row('watch', 'apple', 'notAnswering', { warn: true, fix: 'watchSettings' }),
      row('server', 'server', 'offline', { warn: true, fix: 'server', action: 'retry', pending: true, lastHeard: Date.now() - 5 * 60e3 }),
      row('hr', 'hr', 'live', { bpm: 128 }),
    ])
    expect(host.textContent).toContain('Not answering')
    expect(host.textContent).toContain('Open openGym on your watch')
    expect(host.textContent).toContain('Offline')
    expect(host.textContent).toContain('Your changes wait on this phone')
    expect(host.querySelectorAll('button.dev-fix').length).toBe(2)
  })
  it('says changes wait only when some are pending', async () => {
    await render([row('server', 'server', 'offline', { warn: true, fix: 'server', action: 'retry' })])
    expect(host.textContent).not.toContain('Your changes wait on this phone')
  })
  it('Last heard shows only on a row that is down', async () => {
    await render([row('watch', 'apple', 'live', { speed: 'fast', lastHeard: Date.now() })])
    expect(host.textContent).not.toContain('Last heard')
    expect(host.textContent).toContain('Fast')
    expect(host.querySelector('button.dev-fix')).toBeNull()
    await render([row('watch', 'wear', 'offline', { warn: true, fix: 'watchSettings', lastHeard: Date.now() - 4 * 60e3 })])
    expect(host.textContent).toContain('Last heard')
  })
  it('says what a Zepp watch syncs', async () => {
    await render([row('zepp', 'zepp', 'live')])
    expect(host.textContent).toContain('Sets, rest timer, heart rate per set')
  })
  it('names the device that measures the heart rate when iOS gives one', async () => {
    await render([row('hr', 'hr', 'live', { bpm: 120, device: 'AirPods Pro' })])
    expect(host.textContent).toContain('AirPods Pro')
    expect(host.textContent).not.toContain('Heart rate')
    await render([row('hr', 'hr', 'live', { bpm: 120 })])
    expect(host.textContent).toContain('Heart rate')
  })
  it('says when nothing is connected and offers Settings', async () => {
    await render([])
    expect(host.textContent).toContain('No devices connected')
    host.querySelector('button.dev-fix').click()
    expect(m.go).toHaveBeenCalledWith('/settings')
  })
  it.each([['retry', 'Try again', 'retry'], ['pair', 'Pair again', 'pair'], ['signin', 'Sign in', 'signin'], ['connect', 'Connect', 'connect']])('the server fix for %s says %s and runs it', async (action, label, fn) => {
    m[fn].mockClear()
    await render([row('server', 'server', 'offline', { warn: true, fix: 'server', action })])
    const b = host.querySelector('button.dev-fix')
    expect(b.textContent).toBe(label)
    await act(async () => { b.click() })
    expect(m[fn]).toHaveBeenCalled()
  })
  it('names Not found, Slow and heart rate', async () => {
    await render([row('watch', 'apple', 'notFound', { reason: 'unpaired', warn: true, fix: 'watchSettings' }), row('watch2', 'wear', 'live', { speed: 'slow' }), row('hr', 'hr', 'live', { bpm: 99 })])
    for (const w of ['Not found', 'Pair your watch', 'Slow', '99 bpm']) expect(host.textContent).toContain(w)
  })
  it('never prints milliseconds', async () => {
    await render([row('watch', 'apple', 'live', { speed: 'slow' }), row('server', 'server', 'ok')])
    expect(host.textContent).not.toMatch(/\d\s*ms/)
  })
  it('looks at the links while open, every 5 s', async () => {
    await render([])
    expect(m.check).toHaveBeenCalledWith({ ping: true })
    m.check.mockClear()
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(m.check).toHaveBeenCalledTimes(1)
  })
})
