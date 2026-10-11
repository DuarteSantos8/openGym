// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

const { nativeRead } = vi.hoisted(() => ({ nativeRead: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...await importOriginal(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('../lib/remote.js', () => ({ loadRemote: vi.fn(), forgetRemote: vi.fn(), connect: vi.fn(), chooseLocal: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true, initReminderSync: vi.fn(), nativeLoad: vi.fn(), nativeSave: vi.fn(), onAppActive: vi.fn(), syncReminder: vi.fn(), writeAutoBackup: vi.fn() }))
vi.mock('../lib/coach-device.js', () => ({ loadCoachDevice: vi.fn(), saveCoachDevice: vi.fn(), coachDeviceSettings: () => null }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => ({ latestBodyMass: nativeRead }) }))

import { api } from '../lib/api.js'
import { loadRemote, forgetRemote } from '../lib/remote.js'
import { DEF, useStore } from './useStore.js'

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); localStorage.clear() })

it('keeps a paired account whose token the server refuses, and still imports its Health weight', async () => {
  vi.useFakeTimers()
  localStorage.clear()
  useStore.setState({ S: structuredClone(DEF), ready: false })
  useStore.getState().setUser({ id: 'previous-user' })
  loadRemote.mockResolvedValue({ mode: 'remote', base: 'https://gym.example', token: 'revoked', user: { id: 'previous-user' } })
  api.mockRejectedValue(Object.assign(new Error('Session expired'), { status: 401 }))
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 80, measuredAt: Date.now() })

  await useStore.getState().boot()
  // The pairing and the account stay; the screens say the server refuses this phone. Pairing
  // again merges what the phone kept, the imported weigh-in included.
  expect(useStore.getState().user).toEqual({ id: 'previous-user' })
  expect(useStore.getState().isGuest()).toBe(false)
  expect(forgetRemote).not.toHaveBeenCalled()
  expect(useStore.getState().sync.status).toBe('auth')
  await useStore.getState().syncHealthWeight()
  expect(nativeRead).toHaveBeenCalledTimes(1)
  expect(useStore.getState().S.bodyweight).toMatchObject([{ w: 80 }])
  expect(useStore.getState().healthWeightStatus).toBe('available')
})
