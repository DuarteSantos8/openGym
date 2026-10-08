// @vitest-environment happy-dom
// v1.3.11: "Weigh in before workouts" starts off for a profile created from nothing. A profile
// that already exists keeps what it had: one saved with the switch on stays on, and one saved
// before the setting existed (no key) still reads as on through DEF and `!== false`.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { freshState, DEF, restoredStateFor, restartedState, useStore } from './useStore.js'

describe('weigh-in default', () => {
  it('a fresh profile starts with the weigh-in off', () => {
    expect(freshState().weighIn).toBe(false)
  })

  it('DEF keeps it on, so an existing profile without the key is not changed under it', () => {
    expect(DEF.weighIn).toBe(true)
    const old = { workouts: [{ id: 'w1' }], routines: [] }         // written before the setting existed
    const S = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, old)
    expect(S.weighIn).toBe(true)
    const off = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, { ...old, weighIn: false })
    expect(off.weighIn).toBe(false)
  })
})

describe('exercise animations default', () => {
  it('a fresh profile starts with Small animations, the thumbnail on the workout screen', () => {
    expect(freshState().gifSize).toBe('mini')
  })

  it('DEF keeps Full, so an existing profile without the key is not changed under it', () => {
    expect(DEF.gifSize).toBe('full')
    const S = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, { workouts: [{ id: 'w1' }], routines: [] })
    expect(S.gifSize).toBe('full')
  })
})

// A reset, or another account signing in on this device, starts a new profile: the same new
// defaults as a first run, in the language already on screen, and the reset keeps its stamps.
describe('starting over', () => {
  const old = () => ({ ...JSON.parse(JSON.stringify(DEF)), lang: 'de', weighIn: true, gifSize: 'full', resetAt: 5, resetIds: { workouts: ['w-old'] }, workouts: [{ id: 'w1', d: '2026-09-01', entries: [] }] })
  afterEach(() => { localStorage.clear(); useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null, ready: false }) })

  it('Reset everything gives weigh-in off and small animations, in the same language', async () => {
    useStore.setState({ S: old(), user: null })
    await useStore.getState().resetEverything()
    const S = useStore.getState().S
    expect(S.weighIn).toBe(false)
    expect(S.gifSize).toBe('mini')
    expect(S.lang).toBe('de')
    expect(S.langAuto).toBe(false)
    expect(S.workouts).toEqual([])
    expect(S.resetAt).toBeGreaterThan(5)
    expect(S.resetIds.workouts).toEqual(expect.arrayContaining(['w-old', 'w1']))
  })

  it('restartedState keeps a language nobody picked yet marked as such', () => {
    expect(restartedState({ lang: 'ar', langAuto: true })).toMatchObject({ lang: 'ar', langAuto: true, weighIn: false, gifSize: 'mini' })
  })

  it('another account signing in on this device starts from the same new profile', () => {
    localStorage.setItem('gym_owner', 'user-1')
    useStore.setState({ S: old(), user: { id: 'user-1' } })
    useStore.getState().setUser({ id: 'user-2', name: 'Two' })
    const S = useStore.getState().S
    expect(S.workouts).toEqual([])
    expect(S.weighIn).toBe(false)
    expect(S.gifSize).toBe('mini')
    expect(S.lang).toBe('de')
  })
})
