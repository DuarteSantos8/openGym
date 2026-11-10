// @vitest-environment happy-dom
// Settings → Modules on the phone app with a Garmin on the watch link (docs/GARMIN.md): switching
// Watch off asks once, as it does for an Apple Watch, a Wear OS or a Zepp watch, and says the watch
// stays paired. Without one it just switches.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOn } from '../lib/modules.js'
import { writeGarminLink } from '../lib/watch-settings.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, confirms: [] }
  state.snapshot = () => ({
    S: state.S, user: null, config: null, coachLocal: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../sheets.jsx', () => ({ confirmSheet: opts => mocks.confirms.push(opts) }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ connections: [] })) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../lib/health-sync.js', () => ({ loadHealth: async () => null }))

import ModulesPage from './Modules.jsx'

let host, root
beforeEach(() => {
  localStorage.clear()
  mocks.S = { unit: 'kg', workouts: [] }
  mocks.confirms = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<ModulesPage />))
const sw = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title).querySelector('[role="switch"]')

describe('the Watch module with a Garmin', () => {
  it('asks once before Watch goes off while a Garmin is paired, and pauses on yes', async () => {
    writeGarminLink(true)
    mount()
    act(() => sw('Watch').click())
    expect(isOn(mocks.S, 'watch')).toBe(true)
    expect(mocks.confirms).toHaveLength(1)
    expect(mocks.confirms[0].title).toBe('Switch off Watch?')
    const box = document.createElement('div')
    const r2 = createRoot(box)
    act(() => r2.render(<>{mocks.confirms[0].message}</>))
    expect(box.textContent).toBe('Your watch stops getting workouts while Watch is off. It stays paired.')
    act(() => r2.unmount())
    act(() => mocks.confirms[0].onConfirm())
    expect(isOn(mocks.S, 'watch')).toBe(false)
    // back on needs no question
    mount()
    act(() => sw('Watch').click())
    expect(isOn(mocks.S, 'watch')).toBe(true)
    expect(mocks.confirms).toHaveLength(1)
  })

  it('switches straight off with no watch at all', () => {
    mount()
    act(() => sw('Watch').click())
    expect(mocks.confirms).toHaveLength(0)
    expect(isOn(mocks.S, 'watch')).toBe(false)
  })
})
