// @vitest-environment happy-dom
// 1.4.5: the app takes on the logo's green (#a3e635). A profile started from nothing wears it; a
// profile that already exists keeps exactly the accent it had, whichever way its copy reaches the
// app: the browser's saved copy, the phone's file mirror, a server pull, a sign-in, a backup, a
// merge with another device, an older app on the other end. The rule is the one weighIn and
// gifSize already follow: DEF (what every loaded copy is laid over) keeps the old green, only
// freshState writes the new one into the copy it makes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { DEF, freshState, restartedState, restoredStateFor, useStore } from '../store/useStore.js'
import { ACCENTS, ACCENT_INK, ACCENT_NAMES } from './format.js'
import { NEW_ACCENT, DEFAULT_ACCENT, accentKey, accentValue, accentPair, sanitizeAccent, contrast } from './accent.js'
import { mergeStates } from './sync-merge.js'
import { watchAccent } from './watch-sync.js'
import { garminLook } from './garmin-snapshot.js'

const clone = v => JSON.parse(JSON.stringify(v))
const blank = () => ({ workouts: [], routines: [], bodyweight: [], customEx: [] })
const KEY = 'gym_state_v1'

describe('the two defaults', () => {
  it('a new profile gets the brand green, everything that never picked keeps the old one', () => {
    expect(NEW_ACCENT).toBe('brand')
    expect(DEFAULT_ACCENT).toBe('lime')
    expect(ACCENTS.brand).toBe('#a3e635')
    expect(ACCENTS.lime).toBe('#30d158')
    expect(DEF.accent).toBe('lime')
  })
  it('the brand green comes first in the picker, the old one stays as Classic green', () => {
    expect(Object.keys(ACCENTS)[0]).toBe('brand')
    expect(Object.keys(ACCENTS)[1]).toBe('lime')
    expect(ACCENT_NAMES.brand).toBe('openGym green')
    expect(ACCENT_NAMES.lime).toBe('Classic green')
    expect(Object.keys(ACCENT_NAMES)).toEqual(Object.keys(ACCENTS))
    expect(Object.keys(ACCENT_INK)).toEqual(Object.keys(ACCENTS))
  })
})

describe('a fresh install (no data at all)', () => {
  it('freshState and a start over wear the brand green', () => {
    expect(freshState().accent).toBe('brand')
    expect(accentValue(freshState())).toBe('brand')
    expect(restartedState({ lang: 'de', accent: 'sky' }).accent).toBe('brand')
  })
})

describe('a copy saved on this device before 1.4.5', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  afterEach(() => localStorage.clear())
  const boot = async () => (await import('../store/useStore.js')).useStore.getState().S

  it('nothing saved: the brand green', async () => {
    expect((await boot()).accent).toBe('brand')
  })
  it('saved without an accent (from before accents existed): the old green', async () => {
    localStorage.setItem(KEY, JSON.stringify({ unit: 'kg', workouts: [{ id: 'w1' }], routines: [] }))
    const S = await boot()
    expect(S.accent).toBe('lime')
    expect(accentKey(S)).toBe('lime')
  })
  it('saved on the old default ("lime", never picked): the old green', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...clone(DEF), accent: 'lime' }))
    expect((await boot()).accent).toBe('lime')
  })
  it('a picked preset or an own colour stays as it was', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...clone(DEF), accent: 'sky' }))
    expect((await boot()).accent).toBe('sky')
    vi.resetModules()
    localStorage.setItem(KEY, JSON.stringify({ ...clone(DEF), accent: 'custom', accentCustom: '#FF00AA' }))
    const S = await boot()
    expect(accentValue(S)).toBe('#ff00aa')
  })
  it('an empty saved object (storage that held only {}) is a profile, not a fresh install', async () => {
    localStorage.setItem(KEY, '{}')
    expect((await boot()).accent).toBe('lime')
  })
  it('junk in the accent field draws the old green, as it did before', async () => {
    localStorage.setItem(KEY, JSON.stringify({ accent: '"><x>' }))
    expect((await boot()).accent).toBe('lime')
  })
})

describe('a copy that arrives from elsewhere', () => {
  it('a server pull of a profile with no accent field: the old green', () => {
    const S = restoredStateFor(freshState(), { workouts: [{ id: 'w1' }], routines: [] })
    expect(S.accent).toBe('lime')
  })
  it('a server pull of a profile on the old default, a picked one, or the brand green: as it is', () => {
    expect(restoredStateFor(freshState(), { accent: 'lime' }).accent).toBe('lime')
    expect(restoredStateFor(freshState(), { accent: 'violet' }).accent).toBe('violet')
    expect(restoredStateFor(freshState(), { accent: 'brand' }).accent).toBe('brand')
    expect(accentValue(restoredStateFor(freshState(), { accent: 'custom', accentCustom: '#123456' }))).toBe('#123456')
  })
  it('signing in to an existing account on a new phone: the account’s accent wins over the fresh one', () => {
    const fresh = freshState()
    const server = { ...clone(DEF), _ts: 10, accent: 'lime', workouts: [{ id: 'w1', d: '2026-10-01', entries: [] }] }
    // a guest copy with a workout of its own merges in under the server's settings
    const local = { ...fresh, _ts: 20, workouts: [{ id: 'w2', d: '2026-11-01', entries: [] }] }
    expect(mergeStates(server, local, { prefer: 'a' }).accent).toBe('lime')
    // the same with a server copy that never had the field
    const old = { ...server }; delete old.accent
    expect(Object.assign(clone(DEF), mergeStates(old, local, { prefer: 'a' })).accent).not.toBe('brand')
  })
  it('a backup or a server document laid over DEF without the field: the old green', () => {
    const backup = { unit: 'kg', workouts: [{ id: 'w1' }] }
    expect(sanitizeAccent(Object.assign(clone(DEF), backup)).accent).toBe('lime')
    expect(sanitizeAccent(Object.assign(clone(DEF), { ...backup, accent: 'brand' })).accent).toBe('brand')
  })
  it('two devices of one profile that never picked: both stay on the old green', () => {
    const a = { ...clone(DEF), _ts: 10 }, b = { ...clone(DEF), _ts: 20 }
    expect(mergeStates(a, b).accent).toBe('lime')
  })
  it('an older app on the other end reads "brand" as a key it does not know and draws its own default', () => {
    const OLD = { lime: '#30d158', sky: '#0a84ff' }
    const S = { accent: 'brand' }
    expect(OLD[S.accent] ? S.accent : 'lime').toBe('lime')
    // and its next save carries the key on untouched, so this app still shows the brand green
    expect(accentKey({ ...S, _ts: 2 })).toBe('brand')
  })
})

describe('a backup imported on this device', () => {
  afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })
  it('a backup from before 1.4.5 keeps its old green, a fresh one its brand green', () => {
    useStore.setState({ S: freshState(), user: null, ready: true })
    useStore.getState().importBackup({ unit: 'kg', workouts: [{ id: 'w1', d: '2026-09-01', entries: [] }], routines: [] })
    expect(useStore.getState().S.accent).toBe('lime')
    useStore.getState().importBackup({ ...freshState(), workouts: [{ id: 'w2', d: '2026-09-02', entries: [] }] })
    expect(useStore.getState().S.accent).toBe('brand')
  })
})

describe('another account on this device', () => {
  afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })
  it('starts its new profile on the brand green, and the account’s own copy brings its accent', () => {
    localStorage.setItem('gym_owner', 'user-1')
    useStore.setState({ S: { ...clone(DEF), accent: 'pink', workouts: [{ id: 'w1', d: '2026-09-01', entries: [] }] }, user: { id: 'user-1' } })
    useStore.getState().setUser({ id: 'user-2', name: 'Two' })
    expect(useStore.getState().S.accent).toBe('brand')
    expect(restoredStateFor(useStore.getState().S, { workouts: [{ id: 'w9' }] }).accent).toBe('lime')
  })
})

describe('the brand green everywhere it is drawn', () => {
  it('carries the brand’s near-black, readable well past the 4.5:1 text bar', () => {
    expect(accentPair('brand')).toEqual({ accent: '#a3e635', ink: '#0c0e12' })
    expect(contrast('#a3e635', '#0c0e12')).toBeGreaterThan(12)
  })
  it('goes to the watches as it is, with its ink', () => {
    expect(watchAccent({ accent: 'brand' })).toEqual({ accent: '#a3e635', onAccent: '#0c0e12' })
    expect(watchAccent({ accent: 'lime' })).toEqual({ accent: '#30d158', onAccent: '#000000' })
    expect(garminLook(watchAccent({ accent: 'brand' }))).toMatchObject({ accent: '#a3e635', onAccent: '#0c0e12' })
  })
  it('the ink of every preset reads at 3:1 (button text, large) or better on its swatch', () => {
    for (const [k, c] of Object.entries(ACCENTS)) expect(contrast(c, ACCENT_INK[k]), k).toBeGreaterThanOrEqual(3)
  })
})
