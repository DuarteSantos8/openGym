// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import * as healthWeight from './health-weight.js'

const { addListener, remove } = vi.hoisted(() => ({ addListener: vi.fn(), remove: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => ({}) }))
vi.mock('@capacitor/app', () => ({ App: { addListener } }))
afterEach(() => vi.clearAllMocks())

it('reads at startup and foreground, then removes listeners when the account view ends', async () => {
  let onState
  addListener.mockImplementation(async (event, callback) => { onState = callback; return { remove } })
  const read = vi.fn()
  const stop = healthWeight.initHealthWeightSync(read)
  expect(read).toHaveBeenCalledTimes(1)
  await Promise.resolve()
  onState({ isActive: false })
  expect(read).toHaveBeenCalledTimes(1)
  onState({ isActive: true })
  expect(read).toHaveBeenCalledTimes(2)
  stop()
  expect(remove).toHaveBeenCalledTimes(1)
})

it('replaceDailyWeight returns a new sorted list and leaves the one passed in untouched', () => {
  const weighIns = Object.freeze([Object.freeze({ d: '2026-10-07', w: 81, t: 2 }), Object.freeze({ d: '2026-10-06', w: 80, t: 1, src: 'apple-health', m: 5 })])
  const typed = { d: '2026-10-06', w: 79, t: 3 }
  expect(healthWeight.replaceDailyWeight(weighIns, typed)).toEqual([{ d: '2026-10-06', w: 79, t: 3, m: 5 }, { d: '2026-10-07', w: 81, t: 2 }])
  expect(weighIns).toHaveLength(2)
  expect(typed).toEqual({ d: '2026-10-06', w: 79, t: 3 })
})

it('getSourceLabel names a known store, calls a typed weigh-in Manual, and has no name for an unknown id', () => {
  expect(healthWeight.getSourceLabel('apple-health')).toBe('Apple Health')
  expect(healthWeight.getSourceLabel(undefined)).toBe('Manual')
  expect(healthWeight.getSourceLabel('some-future-store')).toBeNull()
})

it('every health store has a platform, an id and a label, and no two share a platform or an id', () => {
  const stores = healthWeight.HEALTH_STORES
  expect(stores.length).toBeGreaterThan(0)
  for (const store of stores) {
    expect(Object.keys(store).sort()).toEqual(['getLabel', 'id', 'platform'])
    expect(store.platform).toEqual(expect.stringMatching(/^[a-z]+$/))
    expect(store.id).toEqual(expect.stringMatching(/^[a-z]+(-[a-z]+)*$/))
    expect(store.getLabel()).toEqual(expect.stringMatching(/\S/))
  }
  expect(new Set(stores.map(store => store.platform)).size).toBe(stores.length)
  expect(new Set(stores.map(store => store.id)).size).toBe(stores.length)
})
