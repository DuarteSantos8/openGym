// @vitest-environment happy-dom
// The Body weight metric on Home names its change with a sign, so a screen reader hears the direction.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))
let host, root
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const name = bodyweight => {
  useStore.setState(s => ({ S: { ...s.S, routines: [], workouts: [], bodyweight, dayPlan: {}, week: {}, active: null, unit: 'kg' }, user: null }))
  act(() => root.render(<Home />))
  return host.querySelector('.metric[role="group"]')?.getAttribute('aria-label')
}
describe('Home body weight metric', () => {
  it('a decrease reads with a minus sign', () => {
    expect(name([{ d: '2026-11-01', w: 83 }, { d: '2026-11-08', w: 82.4 }])).toBe('Body weight: 82.4 kg \u22120.6')
  })
  it('an increase reads with a plus sign', () => {
    expect(name([{ d: '2026-11-01', w: 82 }, { d: '2026-11-08', w: 82.5 }])).toBe('Body weight: 82.5 kg +0.5')
  })
  it('no change says nothing about direction', () => {
    expect(name([{ d: '2026-11-01', w: 82 }, { d: '2026-11-08', w: 82 }])).toBe('Body weight: 82 kg')
  })
})
