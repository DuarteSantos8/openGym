// @vitest-environment happy-dom
/* A gym reminder place linked to an equipment profile switches the active gym (#808): on arrival,
   a check-in sticker, a workout started there. Only with location allowed already, never asked. */
import { describe, expect, it, vi } from 'vitest'
import { equipAt, normGym } from './gym-reminder.js'
import { applyAutoGym, autoGymHere } from './gym-auto.js'
import { syncGymInventory } from './gym-inventory.js'
import { dumbbellsOf } from './dumbbells.js'
import { EXDB } from './exercises-data.js'

const CURL = EXDB.find(e => e.eq === 'dumbbell' && /curl/.test(e.n)).id
const HOME = { lat: 47.5, lng: 8.5 }
const BIG = { lat: 47.6, lng: 8.6 }
const config = (over = {}) => ({
  on: true,
  gyms: [
    { id: 'p1', name: 'Garage', ...HOME, radius: 100, text: '', equip: 'home', ...over.home },
    { id: 'p2', name: 'Fitness park', ...BIG, radius: 120, text: '', equip: 'big', ...over.big },
  ],
})
const state = () => syncGymInventory({
  unit: 'kg',
  dumbbells: { kg: { weights: [5, 10], _ts: 1 } },
  equipProfiles: [{ id: 'home', name: 'Home gym', equipment: [] }, { id: 'big', name: 'Big gym', equipment: [], dumbbells: { kg: { weights: [8, 12, 16], _ts: 2 } } }],
  activeEquipId: 'home',
}, null, 10)
// The store as far as these helpers use it.
const storeOf = S0 => {
  let S = S0
  return { getState: () => ({ S, update: fn => { const d = JSON.parse(JSON.stringify(S)); fn(d); S = syncGymInventory(d, S) } }) }
}
const near = p => ({ lat: p.lat + 0.0003, lng: p.lng, accuracy: 15 })   // about 33 m away

describe('which place the phone is at', () => {
  it('keeps the link through the save', () => {
    expect(normGym({ ...HOME, equip: 'home' }).equip).toBe('home')
    expect('equip' in normGym({ ...HOME, equip: '' })).toBe(false)
  })
  it('the nearest linked place whose radius holds the spot', () => {
    const S = state()
    expect(equipAt(config(), near(BIG), S)).toBe('big')
    expect(equipAt(config(), near(HOME), S)).toBe('home')
    expect(equipAt(config(), { lat: 47.55, lng: 8.55 }, S)).toBe(null)
  })
  it('a place set to “Don’t switch”, or linked to a gym since deleted, switches nothing', () => {
    const S = state()
    expect(equipAt(config({ big: { equip: '' } }), near(BIG), S)).toBe(null)
    expect(equipAt(config({ big: { equip: 'gone' } }), near(BIG), S)).toBe(null)
  })
})

describe('switching on arrival', () => {
  const deps = (S, over = {}) => ({
    mobile: true, store: storeOf(S), load: async () => ({ config: config() }),
    permissions: async () => ({ location: 'granted' }), locate: async () => near(BIG), toast: vi.fn(), ...over,
  })

  it('switches to the place’s gym with a toast', async () => {
    const d = deps(state())
    expect(await autoGymHere(d)).toBe(true)
    const S = d.store.getState().S
    expect(S.activeEquipId).toBe('big')
    expect(dumbbellsOf(S)).toEqual([8, 12, 16])
    expect(d.toast).toHaveBeenCalledWith('Using Big gym equipment')
  })

  it('never asks for location: not allowed means nothing happens', async () => {
    const locate = vi.fn(async () => near(BIG))
    const d = deps(state(), { permissions: async () => ({ location: 'prompt' }), locate })
    expect(await autoGymHere(d)).toBe(false)
    expect(locate).not.toHaveBeenCalled()
    expect(d.store.getState().S.activeEquipId).toBe('home')
  })

  it('nothing on the web, without gyms, or with no place linked', async () => {
    expect(await autoGymHere(deps(state(), { mobile: false }))).toBe(false)
    expect(await autoGymHere(deps({ unit: 'kg', equipProfiles: [] }))).toBe(false)
    const d = deps(state(), { load: async () => ({ config: config({ home: { equip: '' }, big: { equip: '' } }) }) })
    expect(await autoGymHere(d)).toBe(false)
  })

  it('already there: no switch, no toast', async () => {
    const d = deps(state(), { locate: async () => near(HOME) })
    expect(await autoGymHere(d)).toBe(false)
    expect(d.toast).not.toHaveBeenCalled()
  })

  it('a workout just started moves onto the new gym’s dumbbells; one under way is left alone', async () => {
    const S = state()
    S.active = { id: 'a', start: 1, entries: [{ id: CURL, target: { sets: 2, reps: 10, weight: 10 }, sets: [{ w: 10, r: 10 }, { w: 10, r: 10 }] }] }
    const d = deps(S)
    expect(await autoGymHere(d)).toBe(true)
    expect(d.store.getState().S.active.entries[0].sets.map(s => s.w)).toEqual([8, 8])
    expect(d.store.getState().S.active.gym).toEqual({ id: 'big', name: 'Big gym' })

    const busy = state()
    busy.active = { id: 'b', start: 1, entries: [{ id: CURL, target: {}, sets: [{ w: 10, r: 10, done: true }, { w: 10, r: 10 }] }] }
    const toast = vi.fn()
    expect(applyAutoGym('big', { store: storeOf(busy), toast })).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })
})
