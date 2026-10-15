// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import * as healthWeight from './health-weight.js'

const { addListener, remove } = vi.hoisted(() => ({ addListener: vi.fn(), remove: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => ({}) }))
vi.mock('@capacitor/app', () => ({ App: { addListener } }))
afterEach(() => vi.clearAllMocks())

it('keeps measurement time separate from save time when converting pounds', () => {
  expect(healthWeight.buildHealthWeighIn({ kilograms: 80, measuredAt: 1000, source: 'apple-health' }, 'lb', 2000))
    .toMatchObject({ w: 176.4, t: 2000, m: 1000, src: 'apple-health' })
})
it.each([NaN, Infinity, -1, 0])('refuses invalid native weight %s', kilograms => {
  expect(() => healthWeight.buildHealthWeighIn({ kilograms, measuredAt: 1000 }, 'kg')).toThrow()
})
it('recognizes readings at or after a same-day workout began', () => {
  const state = { workouts: [{ d: '2026-10-15', start: 100 }], active: null }
  expect(healthWeight.wasTakenAfterWorkout(state, { d: '2026-10-15', m: 100 })).toBe(true)
  expect(healthWeight.wasTakenAfterWorkout(state, { d: '2026-10-15', m: 99 })).toBe(false)
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
