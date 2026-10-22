// @vitest-environment happy-dom

/* Heart rate read back from Apple Health onto a finished workout (w.hr): kept only when a fetch
   brings more samples than the workout already has, and stamped so sync and backups carry it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fetch: null }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
vi.mock('../lib/health-sync.js', () => ({
  initHealthSync: vi.fn(),
  syncHealth: vi.fn(async () => null),
  fetchHeartRate: (...a) => h.fetch(...a),
}))

import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const HOUR = 3600000
const hr = n => ({ avg: 130, max: 160, min: 90, n, s: [[0, 90], [60, 160]] })
const workout = (id, end, extra = {}) => ({ id, d: '2026-10-20', start: end - HOUR, end, entries: [], _ts: 5, ...extra })
const find = id => useStore.getState().S.workouts.find(w => w.id === id)

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ user: null, ready: true })
  h.fetch = vi.fn(async () => hr(10))
})
afterEach(() => { localStorage.clear() })

describe('attachHeartRate', () => {
  it('puts the summary on the workout and stamps it', async () => {
    const now = Date.now()
    useStore.setState({ S: { ...clone(DEF), workouts: [workout('w1', now)] } })
    await useStore.getState().attachHeartRate('w1')
    expect(h.fetch).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', start: now - HOUR, end: now }))
    expect(find('w1').hr).toEqual(hr(10))
    expect(find('w1')._ts).toBeGreaterThan(5)
  })

  it('changes nothing when Health has nothing, or no more than the workout already has', async () => {
    const now = Date.now()
    useStore.setState({ S: { ...clone(DEF), workouts: [workout('w1', now, { hr: hr(10) }), workout('w2', now)] } })
    const before = useStore.getState().S
    h.fetch = vi.fn(async () => hr(10))
    await useStore.getState().attachHeartRate('w1')
    h.fetch = vi.fn(async () => null)
    await useStore.getState().attachHeartRate('w2')
    expect(useStore.getState().S).toBe(before)
    h.fetch = vi.fn(async () => hr(25))
    await useStore.getState().attachHeartRate('w1')
    expect(find('w1').hr.n).toBe(25)
  })

  it('asks nothing for a workout it does not have', async () => {
    useStore.setState({ S: { ...clone(DEF), workouts: [] } })
    await useStore.getState().attachHeartRate('nope')
    expect(h.fetch).not.toHaveBeenCalled()
  })
})

describe('refreshLastHeartRate', () => {
  it('reads for the latest workout of the last day that has none yet', async () => {
    const now = Date.now()
    useStore.setState({ S: { ...clone(DEF), workouts: [
      workout('old', now - 30 * HOUR), workout('mid', now - 3 * HOUR), workout('last', now - HOUR), workout('open', 0, { end: undefined }),
    ] } })
    await useStore.getState().refreshLastHeartRate()
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.fetch.mock.calls[0][0].id).toBe('last')
    expect(find('last').hr).toEqual(hr(10))
  })

  it('leaves it alone once it has one, and a workout older than a day', async () => {
    const now = Date.now()
    useStore.setState({ S: { ...clone(DEF), workouts: [workout('old', now - 30 * HOUR), workout('last', now - HOUR, { hr: hr(3) })] } })
    await useStore.getState().refreshLastHeartRate()
    expect(h.fetch).not.toHaveBeenCalled()
  })
})
