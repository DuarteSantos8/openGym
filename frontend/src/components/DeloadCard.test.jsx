// @vitest-environment happy-dom
// Deload weeks on Home (lib/deload-cycle.js): this week's, next week's, and the suggestion.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../lib/format.js', async orig => ({ ...(await orig()), todayISO: () => '2026-11-04' }))
const { DeloadCard } = await import('./DeloadCard.jsx')

let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = S => { mocks.S = S; act(() => root.render(<DeloadCard S={S} />)) }
const press = label => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label)).click())

describe('DeloadCard', () => {
  it('says nothing without a deload or a reason for one', () => {
    mount({ weekStart: 1, workouts: [] })
    expect(host.innerHTML).toBe('')
  })
  it('shows this week as a deload, and Not this week takes it out', () => {
    mount({ weekStart: 1, workouts: [], deloadCycle: { every: 4, from: '2026-10-12' } })
    expect(host.querySelector('[data-deload]').dataset.deload).toBe('now')
    press('Not this week')
    expect(mocks.S.deloadCycle.skip).toEqual(['2026-11-02'])
  })
  it('shows next week coming, and pushes it back a week', () => {
    mount({ weekStart: 1, workouts: [], deloadCycle: { every: 4, from: '2026-10-19' } })
    expect(host.querySelector('[data-deload]').dataset.deload).toBe('next')
    press('Push it back a week')
    expect(mocks.S.deloadCycle.shift).toEqual(['2026-11-09'])
  })
})
