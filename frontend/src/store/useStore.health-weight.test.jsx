// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ available: vi.fn(), authorize: vi.fn(), readWeights: vi.fn(), writeWeights: vi.fn(), writeWorkouts: vi.fn() }))
vi.mock('../lib/mobile.js', async original => ({ ...await original(), MOBILE: true }))
vi.mock('../lib/api.js', async original => ({ ...await original(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('../lib/remote.js', async original => ({ ...await original(), connect: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => native }))
import { api } from '../lib/api.js'
import { connect } from '../lib/remote.js'
import { DEF, useStore } from './useStore.js'
import { enableAppleHealth, disableAppleHealth, syncAppleHealth } from '../lib/apple-health.js'
const date = '2026-10-15', timestamp = new Date(2026, 9, 15, 7).getTime()
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); disableAppleHealth(); vi.clearAllMocks()
  api.mockResolvedValue({}); connect.mockReset()
  native.available.mockResolvedValue({ available: true }); native.authorize.mockResolvedValue({})
  native.readWeights.mockResolvedValue({ weights: [{ date, timestamp, kg: 80 }] })
  native.writeWeights.mockResolvedValue({ written: 0 }); native.writeWorkouts.mockResolvedValue({ written: 0 })
  useStore.setState({ S: structuredClone(DEF), ready: true, needsMobileOnboarding: false })
  useStore.getState().setUser({ id: 'one' })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
it('does not read before explicit consent, including local-only mode', async () => {
  await syncAppleHealth(useStore)
  useStore.getState().setUser(null)
  await syncAppleHealth(useStore)
  expect(native.readWeights).not.toHaveBeenCalled()
})
it('uses the normal store persistence with provenance and measurement time', async () => {
  await enableAppleHealth(useStore); await syncAppleHealth(useStore)
  expect(useStore.getState().S.bodyweight[0]).toMatchObject({ d: date, w: 80, src: 'apple-health', m: timestamp })
  expect(JSON.parse(localStorage.getItem('gym_state_v1')).bodyweight[0].m).toBe(timestamp)
})
it('drops an in-flight result on account changes even if the original account returns', async () => {
  await enableAppleHealth(useStore)
  let finish
  native.readWeights.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = syncAppleHealth(useStore)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  useStore.getState().setUser({ id: 'two' }); useStore.getState().setUser({ id: 'one' })
  finish({ weights: [{ date, timestamp, kg: 80 }] }); await pending
  expect(useStore.getState().S.bodyweight).toEqual([])
})
it('pauses imports during pairing and discards a read from before the pairing', async () => {
  await enableAppleHealth(useStore)
  let finishRead, finishPair
  native.readWeights.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
  const pending = syncAppleHealth(useStore)
  await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
  connect.mockImplementationOnce(() => new Promise(resolve => { finishPair = resolve }))
  const pairing = useStore.getState().connectToServer('https://gym.example', 'code')
  expect(useStore.getState().ready).toBe(false)
  finishRead({ weights: [{ date, timestamp, kg: 80 }] }); await pending
  expect(useStore.getState().S.bodyweight).toEqual([])
  await syncAppleHealth(useStore); expect(native.readWeights).toHaveBeenCalledOnce()
  finishPair({ id: 'one' }); await pairing
  expect(useStore.getState().ready).toBe(true)
})
