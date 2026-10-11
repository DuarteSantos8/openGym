// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/remote.js', async importOriginal => ({ ...await importOriginal(), connect: vi.fn(), loadRemote: vi.fn(), chooseLocal: vi.fn(), forgetRemote: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => ({ latestBodyMass: nativeRead }) }))
const { nativeRead } = vi.hoisted(() => ({ nativeRead: vi.fn() }))

import { api } from '../lib/api.js'
import { connect } from '../lib/remote.js'
import { replaceDailyWeight } from '../lib/health-weight.js'
import { mergeBodyweight } from '../lib/sync-merge.js'
import { convertStateUnit } from '../lib/units.js'
import { DEF, useStore } from './useStore.js'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  nativeRead.mockReset()
  api.mockReset().mockResolvedValue({})
  useStore.setState({ S: structuredClone(DEF), ready: true })
  useStore.getState().setUser({ id: 'one' })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('does not import in local-only mode before pairing with an older populated account', async () => {
  useStore.getState().setUser(null)
  useStore.getState().setGuest(true)
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 80, measuredAt: Date.now() })
  await useStore.getState().syncHealthWeight()
  expect.soft(nativeRead).not.toHaveBeenCalled()
  expect.soft(useStore.getState().S.bodyweight).toEqual([])
  // Local-only mode saves its own copy; what matters is that no Health weight is in it.
  expect.soft(JSON.parse(localStorage.getItem('gym_state_v1'))?.bodyweight ?? []).toEqual([])

  const remote = { ...structuredClone(DEF), _ts: 1, workouts: [{ id: 'saved-workout', entries: [] }], routines: [{ id: 'saved-routine', ex: [] }] }
  connect.mockResolvedValue({ id: 'paired-user' })
  api.mockImplementation(path => Promise.resolve(path === '/api/data' ? { state: remote } : {}))
  await useStore.getState().connectToServer('https://gym.example', 'code')
  expect(useStore.getState().S.workouts).toEqual(remote.workouts)
  expect(useStore.getState().S.routines).toEqual(remote.routines)
  expect(api.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
})

it('saves the latest Apple weight in the profile unit through existing persistence and push', async () => {
  const measuredAt = new Date(2026, 8, 8, 7).getTime()
  useStore.setState({ S: { ...structuredClone(DEF), unit: 'lb', bodyweight: [{ d: '2026-09-01', w: 170, t: 1 }], active: { bw: 160 } } })
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 80, measuredAt })
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().S.bodyweight).toEqual([{ d: '2026-09-01', w: 170, t: 1 }, { d: '2026-09-08', w: 176.4, t: Date.now(), src: 'apple-health', m: measuredAt }])
  expect(useStore.getState().S.active.bw).toBe(160)
  expect(JSON.parse(localStorage.getItem('gym_state_v1')).bodyweight).toEqual(useStore.getState().S.bodyweight)
  await vi.advanceTimersByTimeAsync(1500)
  expect(api).toHaveBeenCalledWith('/api/data', expect.objectContaining({ method: 'PUT' }))
  expect(useStore.getState().healthWeightStatus).toBe('available')
})

it('replaying a sample does not persist or schedule another push', async () => {
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 80, measuredAt: new Date(2026, 8, 8, 7).getTime() })
  await useStore.getState().syncHealthWeight()
  await vi.advanceTimersByTimeAsync(1500)
  const saved = useStore.getState().S
  api.mockClear()
  await useStore.getState().syncHealthWeight()
  await vi.advanceTimersByTimeAsync(1500)
  expect(useStore.getState().S).toBe(saved)
  expect(api).not.toHaveBeenCalled()
})

it('a Health reading replaces a guess typed later the same day, and wins the next merge', async () => {
  vi.setSystemTime(new Date(2026, 9, 6, 21))
  const measuredAt = new Date(2026, 9, 6, 9).getTime()
  const typed = { d: '2026-10-06', w: 231.3, t: new Date(2026, 9, 6, 12).getTime() }
  useStore.setState({ S: { ...structuredClone(DEF), unit: 'lb', bodyweight: [typed] } })
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 104.2, measuredAt })
  await useStore.getState().syncHealthWeight()
  const [entry] = useStore.getState().S.bodyweight
  expect(entry).toEqual({ d: '2026-10-06', w: 229.7, t: Date.now(), src: 'apple-health', m: measuredAt })
  expect(mergeBodyweight([typed], [entry])).toEqual([entry])
})

it('keeps a correction typed after the Health reading, until a newer reading arrives', async () => {
  vi.setSystemTime(new Date(2026, 9, 6, 10))
  const measuredAt = new Date(2026, 9, 6, 9).getTime()
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 104.2, measuredAt })
  await useStore.getState().syncHealthWeight()
  useStore.getState().update(s => { s.bodyweight = replaceDailyWeight(s.bodyweight, { d: '2026-10-06', w: 105, t: Date.now() + 1 }) })
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().S.bodyweight).toEqual([{ d: '2026-10-06', w: 105, t: Date.now() + 1, m: measuredAt }])

  const later = new Date(2026, 9, 6, 20).getTime()
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 103, measuredAt: later })
  await useStore.getState().syncHealthWeight()
  // The store stamps a replaced weigh-in later than the one it replaces, so it also wins the merge.
  expect(useStore.getState().S.bodyweight).toEqual([{ d: '2026-10-06', w: 103, t: expect.any(Number), src: 'apple-health', m: later }])
  expect(useStore.getState().S.bodyweight[0].t).toBeGreaterThan(Date.now() + 1)
})

it('re-applies a reading saved by an earlier build that kept no source', async () => {
  const measuredAt = new Date(2026, 9, 6, 9).getTime()
  useStore.setState({ S: { ...structuredClone(DEF), bodyweight: [{ d: '2026-10-06', w: 104.2, t: measuredAt }] } })
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 104.2, measuredAt })
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().S.bodyweight[0]).toMatchObject({ src: 'apple-health', m: measuredAt })
})

it('a unit switch keeps the source and the measured time', async () => {
  const measuredAt = new Date(2026, 9, 6, 9).getTime()
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 100, measuredAt })
  await useStore.getState().syncHealthWeight()
  expect(convertStateUnit(useStore.getState().S, 'lb').bodyweight[0]).toMatchObject({ src: 'apple-health', m: measuredAt })
})

it('waits for restore before reading Health', async () => {
  useStore.setState({ ready: false })
  await useStore.getState().syncHealthWeight()
  expect(nativeRead).not.toHaveBeenCalled()
  expect(useStore.getState().S.bodyweight).toEqual([])
})

it('coalesces foreground reads and discards a result after sign-out', async () => {
  let finish
  nativeRead.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const first = useStore.getState().syncHealthWeight()
  const second = useStore.getState().syncHealthWeight()
  expect(nativeRead).toHaveBeenCalledTimes(1)
  useStore.getState().setUser(null)
  finish({ status: 'available', kilograms: 80, measuredAt: Date.now() })
  await Promise.all([first, second])
  expect(useStore.getState().S.bodyweight).toEqual([])
  expect(useStore.getState().healthWeightStatus).toBe('pending')
})

it.each([
  { status: 'unsupported' },
  { status: 'no-readable-data' },
  { status: 'available', kilograms: -1, measuredAt: Date.now() },
  { status: 'available', kilograms: 80, measuredAt: 'bad-date' },
])('keeps manual fallback and history for $status without a usable sample', async sample => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  nativeRead.mockResolvedValue(sample)
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().S.bodyweight).toEqual([])
  expect(useStore.getState().healthWeightStatus).not.toBe('available')
  expect(warning).toHaveBeenCalled()
  warning.mockRestore()
})

it('reports native failure and leaves manual fallback usable', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  nativeRead.mockRejectedValue(new Error('Read failed'))
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().healthWeightStatus).toBe('failed')
  expect(useStore.getState().S.bodyweight).toEqual([])
  expect(warning).toHaveBeenCalled()
  warning.mockRestore()
})

it('waits for paired account restore before allowing an import', async () => {
  let restore
  connect.mockResolvedValue({ id: 'two' })
  api.mockImplementation(path => path === '/api/data' ? new Promise(resolve => { restore = resolve }) : Promise.resolve({}))
  const pairing = useStore.getState().connectToServer('https://gym.example', 'code')
  await vi.waitFor(() => expect(restore).toBeTypeOf('function'))
  expect(useStore.getState().ready).toBe(false)
  await useStore.getState().syncHealthWeight()
  expect(nativeRead).not.toHaveBeenCalled()
  restore({ state: { bodyweight: [{ d: '2026-09-01', w: 70, t: 1 }] } })
  await pairing
  expect(useStore.getState().ready).toBe(true)
  expect(useStore.getState().S.bodyweight).toEqual([{ d: '2026-09-01', w: 70, t: 1 }])
})

it('discards an old account read as soon as pairing begins', async () => {
  let finishRead, finishPair
  nativeRead.mockImplementation(() => new Promise(resolve => { finishRead = resolve }))
  connect.mockImplementation(() => new Promise(resolve => { finishPair = resolve }))
  const reading = useStore.getState().syncHealthWeight()
  const pairing = useStore.getState().connectToServer('https://gym.example', 'code')
  finishRead({ status: 'available', kilograms: 80, measuredAt: Date.now() })
  await reading
  expect(useStore.getState().S.bodyweight).toEqual([])
  expect(useStore.getState().ready).toBe(false)
  api.mockResolvedValue({ state: null })
  finishPair({ id: 'two' })
  await pairing
})

it.each(['signOut', 'signOutAll'])('discards an in-flight read when %s begins', async method => {
  let finishRead, finishLogout
  nativeRead.mockImplementation(() => new Promise(resolve => { finishRead = resolve }))
  api.mockImplementation(path => path.startsWith('/api/logout') ? new Promise(resolve => { finishLogout = resolve }) : Promise.resolve({}))
  const reading = useStore.getState().syncHealthWeight()
  const logout = useStore.getState()[method]()
  await vi.waitFor(() => expect(finishLogout).toBeTypeOf('function'))
  finishRead({ status: 'available', kilograms: 80, measuredAt: Date.now() })
  await reading
  expect(useStore.getState().S.bodyweight).toEqual([])
  await useStore.getState().syncHealthWeight()
  expect(nativeRead).toHaveBeenCalledTimes(1)
  finishLogout({})
  await logout
  expect(useStore.getState().user).toBeNull()
})

// A weigh-in is the weight before the day's workout.
const at = (h, m = 0) => new Date(2026, 9, 6, h, m).getTime()
const workout = { id: 'w1', d: '2026-10-06', start: at(12), end: at(13), entries: [] }
const typedAtNoon = { d: '2026-10-06', w: 105, t: at(11, 55) }

it('keeps the pre-workout weigh-in when the Health reading was taken after the workout began', async () => {
  vi.setSystemTime(at(21))
  useStore.setState({ S: { ...structuredClone(DEF), bodyweight: [typedAtNoon], workouts: [workout] } })
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 104.2, measuredAt: at(20) })
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().S.bodyweight).toEqual([typedAtNoon])
  expect(useStore.getState().healthWeightStatus).toBe('available')
})

it('a Health reading from before the workout still replaces the day\'s guess', async () => {
  vi.setSystemTime(at(21))
  useStore.setState({ S: { ...structuredClone(DEF), bodyweight: [typedAtNoon], workouts: [workout] } })
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 104.2, measuredAt: at(9) })
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().S.bodyweight).toEqual([{ d: '2026-10-06', w: 104.2, t: Date.now(), src: 'apple-health', m: at(9) }])
})

it('saves a post-workout reading when the day has no weigh-in yet', async () => {
  vi.setSystemTime(at(21))
  useStore.setState({ S: { ...structuredClone(DEF), workouts: [workout] } })
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 104.2, measuredAt: at(20) })
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().S.bodyweight).toEqual([{ d: '2026-10-06', w: 104.2, t: Date.now(), src: 'apple-health', m: at(20) }])
})

it('a running workout counts too', async () => {
  vi.setSystemTime(at(13))
  useStore.setState({ S: { ...structuredClone(DEF), bodyweight: [typedAtNoon], active: { id: 'a1', d: '2026-10-06', start: at(12), entries: [] } } })
  nativeRead.mockResolvedValue({ status: 'available', kilograms: 104.2, measuredAt: at(12, 30) })
  await useStore.getState().syncHealthWeight()
  expect(useStore.getState().S.bodyweight).toEqual([typedAtNoon])
})
