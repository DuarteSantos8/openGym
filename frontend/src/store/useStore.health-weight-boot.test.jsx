// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ available: vi.fn(), authorize: vi.fn(), readWeights: vi.fn(), writeWeights: vi.fn() }))
vi.mock('../lib/mobile.js', async original => ({ ...await original(), MOBILE: true }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => native }))
import { DEF, useStore } from './useStore.js'
import { enableAppleHealth, disableAppleHealth, syncAppleHealth } from '../lib/apple-health.js'
beforeEach(() => {
  localStorage.clear(); disableAppleHealth(); vi.clearAllMocks()
  native.available.mockResolvedValue({ available: true }); native.authorize.mockResolvedValue({})
  native.writeWeights.mockResolvedValue({ written: 0 })
  useStore.setState({ S: structuredClone(DEF), ready: false, user: { id: 'one' } })
})
it('does not read into the profile until boot restoration is complete', async () => {
  await enableAppleHealth(useStore); await syncAppleHealth(useStore)
  expect(native.readWeights).not.toHaveBeenCalled()
})
it('leaves manual entry usable and reports native read failures', async () => {
  useStore.setState({ ready: true })
  native.readWeights.mockRejectedValueOnce(new Error('native failure'))
  await enableAppleHealth(useStore)
  await expect(syncAppleHealth(useStore)).rejects.toThrow('native failure')
  expect(useStore.getState().healthWeightStatus).toBe('failed')
  expect(useStore.getState().S.bodyweight).toEqual([])
})
