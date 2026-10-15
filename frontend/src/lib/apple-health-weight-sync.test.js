// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ available: vi.fn(), authorize: vi.fn(), readWeights: vi.fn(), writeWeights: vi.fn(), writeWorkouts: vi.fn() }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => native }))
import { enableAppleHealth, disableAppleHealth, syncAppleHealth } from './apple-health.js'
import { replaceDailyWeight } from './health-weight.js'
import { mergeBodyweight, mergeStates } from './sync-merge.js'
import { convertStateUnit } from './units.js'
const date = '2026-10-07', time = new Date(2026, 9, 7, 12).getTime()
let store, state
const reading = (kg = 80, timestamp = time) => ({ date, kg, timestamp })
beforeEach(async () => {
  localStorage.clear(); disableAppleHealth(); vi.clearAllMocks()
  state = { user: { id: 'one' }, sync: { server: 'https://one.example' }, S: { unit: 'kg', bodyweight: [], workouts: [] }, update: fn => fn(state.S) }
  store = { getState: () => state }
  native.available.mockResolvedValue({ available: true }); native.authorize.mockResolvedValue({})
  native.readWeights.mockResolvedValue({ weights: [reading()] })
  native.writeWeights.mockResolvedValue({ written: 1 }); native.writeWorkouts.mockResolvedValue({ written: 0 })
  await enableAppleHealth(store)
})
it('keeps a typed correction after re-reading the same measurement and converting units', async () => {
  await syncAppleHealth(store)
  state.S.bodyweight = replaceDailyWeight(state.S.bodyweight, { d: date, w: 79, t: Date.now() })
  state.S = convertStateUnit(state.S, 'lb')
  await syncAppleHealth(store)
  expect(state.S.bodyweight[0]).toMatchObject({ w: 174.2, m: time })
  expect(state.S.bodyweight[0]).not.toHaveProperty('src')
})
it('protects a correction on another device which had not yet seen the Health metadata', async () => {
  state.S.bodyweight = mergeBodyweight([{ d: date, w: 79, t: time + 2000 }], [{ d: date, w: 80, t: time + 10000, src: 'apple-health', m: time }])
  await syncAppleHealth(store)
  expect(state.S.bodyweight[0].w).toBe(79)
})
it.each(['active', 'workouts'])('preserves the pre-workout weight after the %s workout began', async field => {
  state.S.bodyweight = [{ d: date, w: 79, t: time - 2000 }]
  const workout = { d: date, start: time - 1000 }
  state.S[field] = field === 'active' ? workout : [workout]
  await syncAppleHealth(store)
  expect(state.S.bodyweight[0].w).toBe(79)
})
it('compares measurement times for imported weights and does not export them back', async () => {
  await syncAppleHealth(store)
  native.readWeights.mockResolvedValue({ weights: [reading(81, time + 1000)] })
  await syncAppleHealth(store)
  expect(state.S.bodyweight[0]).toMatchObject({ w: 81, m: time + 1000 })
  expect(native.writeWeights).not.toHaveBeenCalled()
})
it('does not resurrect a deleted daily weight from an old Health sample', async () => {
  state.S.deleted = { bodyweight: { [date]: time + 1000 } }
  await syncAppleHealth(store)
  expect(state.S.bodyweight).toEqual([])
})
it('drops a native result after sync is disabled while the read is pending', async () => {
  let finish
  native.readWeights.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = syncAppleHealth(store)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  disableAppleHealth(); finish({ weights: [reading()] }); await pending
  expect(state.S.bodyweight).toEqual([])
  expect(native.writeWeights).not.toHaveBeenCalled()
})

it('merges a delayed import with an earlier manual correction in either order and preserves its consumed marker', () => {
  const manual = { unit: 'kg', bodyweight: [{ d: date, w: 79, t: time + 2000 }] }
  const health = { unit: 'kg', bodyweight: [{ d: date, w: 80, t: time + 10000, src: 'apple-health', m: time }] }
  for (const [a, b] of [[manual, health], [health, manual]]) {
    const merged = mergeStates(a, b)
    expect(merged.bodyweight).toEqual([{ d: date, w: 79, t: time + 2000, m: time }])
    expect(mergeStates(merged, health).bodyweight).toEqual(merged.bodyweight)
  }
})
it('prefers a newer Health measurement even if the older one was imported later on another device', () => {
  const older = { d: date, w: 80, t: time + 10000, src: 'apple-health', m: time }
  const newer = { d: date, w: 81, t: time + 5000, src: 'apple-health', m: time + 1000 }
  expect(mergeBodyweight([older], [newer])).toEqual([newer])
  expect(mergeBodyweight([newer], [older])).toEqual([newer])
})
