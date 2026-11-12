// @vitest-environment happy-dom
// The Devices sheet: one row per link, a state word with its own glyph, "Last heard" only on a
// row that is down, one fix button per broken row, no numbers of milliseconds anywhere.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ rows: [], check: vi.fn(), go: vi.fn(), retry: vi.fn() }))
vi.mock('./useDeviceLink.js', () => ({ useDeviceLink: () => ({ rows: m.rows, overall: 'ok' }) }))
vi.mock('../lib/device-link-live.js', () => ({ checkLinks: (...a) => m.check(...a) }))
vi.mock('../lib/nav.js', () => ({ closeThenNav: (_c, to) => m.go(to) }))
vi.mock('./ServerSync.jsx', () => ({ syncNowWithToast: () => m.retry() }))

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
      row('server', 'server', 'offline', { warn: true, fix: 'server', lastHeard: Date.now() - 5 * 60e3 }),
      row('hr', 'hr', 'live', { bpm: 128 }),
    ])
    expect(host.textContent).toContain('Not answering')
    expect(host.textContent).toContain('Open openGym on your watch')
    expect(host.textContent).toContain('Offline')
    expect(host.textContent).toContain('Your changes wait on this phone')
    expect(host.querySelectorAll('button.dev-fix').length).toBe(2)
  })
  it('Last heard shows only on a row that is down', async () => {
    await render([row('watch', 'apple', 'live', { speed: 'fast', lastHeard: Date.now() })])
    expect(host.textContent).not.toContain('Last heard')
    expect(host.textContent).toContain('Fast')
    expect(host.querySelector('button.dev-fix')).toBeNull()
    await render([row('watch', 'wear', 'offline', { warn: true, fix: 'watchSettings', lastHeard: Date.now() - 4 * 60e3 })])
    expect(host.textContent).toContain('Last heard')
  })
  it('says when nothing is connected and offers Settings', async () => {
    await render([])
    expect(host.textContent).toContain('No devices connected')
    host.querySelector('button.dev-fix').click()
    expect(m.go).toHaveBeenCalledWith('/settings')
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
