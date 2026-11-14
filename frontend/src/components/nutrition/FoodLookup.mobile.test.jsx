// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
vi.mock('../../lib/mobile.js', async original => ({ ...await original(), MOBILE: true }))
vi.mock('../../lib/api.js', () => ({ api: vi.fn(), remoteAuth: vi.fn(() => null) }))
import { api } from '../../lib/api.js'
import { DEF, useStore } from '../../store/useStore.js'
import FoodLookup from './FoodLookup.jsx'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
test('standalone phone says a server is required even with stale signed-in capability state', async () => {
  useStore.setState({ S: { ...structuredClone(DEF), modules: { nutrition: true } }, user: { id: 'old-account' }, config: { foodLookup: { status: 'configured-unverified' } } })
  const host = document.createElement('div'), root = createRoot(host)
  try {
    await act(async () => root.render(<FoodLookup day="2026-11-14" />))
    expect(host.textContent).toContain('Connect this phone to a server to look up food.')
    expect(host.querySelector('form')).toBeNull()
    expect(api).not.toHaveBeenCalled()
  } finally { act(() => root.unmount()); useStore.setState({ user: null, ready: false }) }
})
