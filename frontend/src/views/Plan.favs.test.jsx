// @vitest-environment happy-dom
// Favourite routines (#327): the starred ones lead Plan's routine list under Favourites, once each.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan, { PLAN_VIEW_KEY as KEY } from './Plan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, week: {}, dayPlan: {},
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [] }, { id: 'r2', name: 'Pull', emoji: null, ex: [], fav: true, folder: 'Block A' }, { id: 'r3', name: 'Legs', emoji: null, ex: [] }],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => { localStorage.setItem(KEY, 'routines'); act(() => root.render(<Plan />)) }

describe('Plan: favourite routines', () => {
  it('lists the starred routine first under Favourites, and not again in its folder', () => {
    mount()
    const favs = host.querySelector('[data-favs]')
    expect(favs).toBeTruthy()
    expect(favs.textContent).toContain('Pull')
    const names = [...host.querySelectorAll('.plan-routine .tt')].map(n => n.textContent)
    expect(names.filter(n => n === 'Pull')).toHaveLength(1)
    expect(names.indexOf('Pull')).toBeLessThan(names.indexOf('Push'))
    expect(host.textContent).not.toContain('Block A')
  })
})
