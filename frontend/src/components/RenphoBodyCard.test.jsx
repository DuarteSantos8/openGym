// @vitest-environment happy-dom
// Body measurements' RENPHO card: what the server sums up (GET /api/renpho/summary), read-only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ api: vi.fn(), user: { id: 'u1' } }))
vi.mock('../lib/api.js', () => ({ api: m.api }))
vi.mock('../lib/demo.js', () => ({ DEMO: false }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ user: m.user }) }))

import RenphoBodyCard from './RenphoBodyCard.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); m.user = { id: 'u1' }; m.api.mockReset() })
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = async props => { await act(async () => { root.render(<RenphoBodyCard unit="kg" {...props} />) }); await act(async () => {}) }
const DAY = 86400000
const t = Date.UTC(2026, 10, 10, 8)

describe('the RENPHO card', () => {
  it('shows the latest of each kind with its change over a month, and the segmental analysis', async () => {
    m.api.mockResolvedValue({ connected: true, t, items: [
      { type: 'bodyFat', v: 21.4, t, change: -1.2 },
      { type: 'muscleMass', v: 35.6, t, change: 0 },
      { type: 'segMuscleLeftArm', v: 3.1, t, change: null }, { type: 'segMuscleRightArm', v: 3.3, t, change: null },
    ] })
    await mount()
    expect(m.api).toHaveBeenCalledWith('/api/renpho/summary')
    const cells = [...host.querySelectorAll('.hc-body-cell')].map(c => c.textContent)
    expect(cells[0]).toContain('Body fat')
    expect(cells[0]).toContain('21.4 %')
    expect(cells[0]).toContain('−1.2 % in a month')
    expect(cells[1]).toContain('35.6 kg')
    expect(cells[1]).not.toContain('in a month')
    expect(host.textContent).toContain('From RENPHO')
    expect(host.querySelector('.seg-analysis')).not.toBeNull()
    expect(host.textContent).toContain('Segmental analysis')
  })

  it('nothing without a connection, without readings, signed out, or when the server does not answer', async () => {
    m.api.mockResolvedValue({ connected: false, items: [], t: null })
    await mount()
    expect(host.innerHTML).toBe('')
    m.api.mockResolvedValue({ connected: true, items: [], t: null })
    act(() => root.render(null)); await mount()
    expect(host.innerHTML).toBe('')
    m.api.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }))
    act(() => root.render(null)); await mount()
    expect(host.innerHTML).toBe('')
    m.user = null
    m.api.mockReset()
    act(() => root.render(null)); await mount()
    expect(m.api).not.toHaveBeenCalled()
    expect(host.innerHTML).toBe('')
  })
})
