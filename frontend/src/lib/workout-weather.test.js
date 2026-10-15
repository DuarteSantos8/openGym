// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ authorizeWeather: vi.fn(), captureWeather: vi.fn(), cancelWeather: vi.fn(),
  available: vi.fn(), authorize: vi.fn(), readWeights: vi.fn(), writeWorkouts: vi.fn() }))
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => native }))
let weather, health, store, now
const sample = () => ({ celsius: 22, humidity: 61, observedAt: now })
const finish = () => {
  const active = store.getState().S.active
  const workout = { id: active.id, start: active.start, end: now + 1000 }
  store.getState().S.workouts.push(workout); store.getState().S.active = null
  return workout
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear()
  now = Date.now()
  const state = { user: { id: 'a' }, sync: { server: 'https://one.example' },
    S: { active: { id: 'current', start: now - 10000 }, workouts: [], bodyweight: [], unit: 'kg' } }
  store = { getState: () => state }
  native.authorizeWeather.mockResolvedValue({})
  native.captureWeather.mockResolvedValue(sample())
  native.cancelWeather.mockResolvedValue({})
  native.available.mockResolvedValue({ available: true }); native.authorize.mockResolvedValue({})
  native.readWeights.mockResolvedValue({ weights: [] })
  native.writeWorkouts.mockImplementation(async ({ workouts }) => ({ written: workouts.length }))
  weather = await import('./workout-weather.js')
  health = await import('./apple-health.js')
})
it('does not request location until consent, and captures once across repeated workout updates', async () => {
  weather.captureWorkoutWeather(store)
  expect(native.captureWeather).not.toHaveBeenCalled()
  await weather.enableWorkoutWeather(store)
  for (let i = 0; i < 5; i++) weather.captureWorkoutWeather(store)
  const workout = finish(); await weather.waitForWorkoutWeather(store)
  expect(native.authorizeWeather).toHaveBeenCalledOnce()
  expect(native.captureWeather).toHaveBeenCalledOnce()
  expect(native.captureWeather).toHaveBeenCalledWith({ start: workout.start })
  expect(weather.weatherForWorkout(store, workout)).toEqual(sample())
})
it('exports weather at the first save even if the session finishes during the request, and never stores coordinates in the profile/cache', async () => {
  let complete
  native.captureWeather.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  await health.enableAppleHealth(store); await weather.enableWorkoutWeather(store)
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  finish(); const syncing = health.syncAppleHealth(store)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(native.writeWorkouts).not.toHaveBeenCalled()
  complete({ ...sample(), latitude: 999, longitude: 999 })
  await syncing
  expect(native.writeWorkouts.mock.calls[0][0].workouts[0].weather).toEqual(sample())
  expect(JSON.stringify(store.getState().S)).not.toContain('celsius')
  expect(localStorage.getItem('opengym_workout_weather_result')).not.toContain('latitude')
})
it('keeps existing weather when the next session starts before Health synchronization', async () => {
  await weather.enableWorkoutWeather(store)
  const first = finish(); await weather.waitForWorkoutWeather(store)
  store.getState().S.active = { id: 'next', start: now - 5000 }
  weather.captureWorkoutWeather(store)
  finish(); await weather.waitForWorkoutWeather(store)
  expect(weather.weatherForWorkout(store, first)).toEqual(sample())
})
it('retries a failed capture on foreground activation without duplicating a successful weather request', async () => {
  native.captureWeather.mockRejectedValueOnce(new Error('location unavailable'))
  await weather.enableWorkoutWeather(store)
  await vi.waitFor(() => expect(native.captureWeather).toHaveBeenCalledOnce())
  await new Promise(resolve => setTimeout(resolve, 0))
  weather.captureWorkoutWeather(store, true, true)
  const workout = finish(); await weather.waitForWorkoutWeather(store)
  expect(weather.weatherForWorkout(store, workout)).toEqual(sample())
  store.getState().S.active = { id: workout.id, start: workout.start }
  weather.captureWorkoutWeather(store, true, true)
  expect(native.captureWeather).toHaveBeenCalledTimes(2)
})
it('never attributes a current sample to another workout, start time, account or server', async () => {
  await weather.enableWorkoutWeather(store)
  const workout = finish(); await weather.waitForWorkoutWeather(store)
  expect(weather.weatherForWorkout(store, { ...workout, id: 'old' })).toBeNull()
  expect(weather.weatherForWorkout(store, { ...workout, start: workout.start - 1 })).toBeNull()
  store.getState().sync.server = 'https://two.example'
  expect(weather.weatherForWorkout(store, workout)).toBeNull()
  store.getState().sync.server = 'https://one.example'; store.getState().user.id = 'b'
  expect(weather.weatherForWorkout(store, workout)).toBeNull()
})
it('ignores a late callback after disabling weather and preserves workout export after network failure', async () => {
  let complete
  native.captureWeather.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  await health.enableAppleHealth(store); await weather.enableWorkoutWeather(store)
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
  const workout = finish(); weather.disableWorkoutWeather(); complete(sample())
  await health.syncAppleHealth(store)
  expect(weather.weatherForWorkout(store, workout)).toBeNull()
  expect(localStorage.getItem('opengym_workout_weather_result')).toBeNull()
  expect(native.writeWorkouts.mock.calls[0][0].workouts[0]).not.toHaveProperty('weather')
  store.getState().S.active = { id: 'offline', start: now - 5000 }
  native.captureWeather.mockRejectedValueOnce(new Error('offline'))
  await weather.enableWorkoutWeather(store); finish(); await health.syncAppleHealth(store)
  expect(native.writeWorkouts.mock.calls.at(-1)[0].workouts[0]).not.toHaveProperty('weather')
})
it.each([{ backfill: true }, { editingWorkoutId: 'old' }, { start: Date.now() - 21600001 }])('does not look up weather for backfills, edits or stale sessions: %j', async extra => {
  Object.assign(store.getState().S.active, extra)
  await weather.enableWorkoutWeather(store)
  expect(native.captureWeather).not.toHaveBeenCalled()
})
it.each([{ celsius: NaN }, { humidity: 101 }, { observedAt: 1 }])('rejects invalid/out-of-interval weather: %j', async extra => {
  native.captureWeather.mockResolvedValueOnce({ ...sample(), ...extra })
  await weather.enableWorkoutWeather(store)
  const workout = finish(); await weather.waitForWorkoutWeather(store)
  expect(weather.weatherForWorkout(store, workout)).toBeNull()
})

it('does not restore consent after it was disabled during the authorization prompt', async () => {
  let finishPermission
  native.authorizeWeather.mockImplementationOnce(() => new Promise(resolve => { finishPermission = resolve }))
  const enabling = weather.enableWorkoutWeather(store)
  await vi.waitFor(() => expect(finishPermission).toBeTypeOf('function'))
  weather.disableWorkoutWeather(); finishPermission({}); await enabling
  expect(weather.workoutWeatherEnabled(store)).toBe(false)
  expect(native.captureWeather).not.toHaveBeenCalled()
})
