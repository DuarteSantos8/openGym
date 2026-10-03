// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'gym_state_v1'
const ACTIVE_KEY = 'gym_active_v1'

// A fresh module per test: the store reads localStorage at creation time.
const freshStore = async () => {
  vi.resetModules()
  return (await import('./useStore.js')).useStore
}
const session = (over = {}) => ({ id: 'a1', d: '2026-09-22', start: 1, name: 'Push', entries: [{ id: 'bench', sets: [{ w: 60, r: 8 }] }], cur: 0, ...over })

beforeEach(() => { localStorage.clear() })

describe('the active session lives in its own key (A29, A30, A34)', () => {
  it('boots A from gym_active_v1 and leaves it out of S', async () => {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(session()))
    const useStore = await freshStore()
    expect(useStore.getState().A.id).toBe('a1')
    expect(useStore.getState().S.active).toBeUndefined()
  })
  it('boots A as null when the key is absent or unparseable', async () => {
    let useStore = await freshStore()
    expect(useStore.getState().A).toBe(null)
    localStorage.setItem(ACTIVE_KEY, 'not json')
    useStore = await freshStore()
    expect(useStore.getState().A).toBe(null)
  })
  it('moves a pre-split active session out of gym_state_v1 at boot, idempotently (A34)', async () => {
    localStorage.setItem(KEY, JSON.stringify({ engineSchemaVersion: 2, workouts: [], routines: [], active: session(), _ts: 5 }))
    let useStore = await freshStore()
    expect(useStore.getState().A.id).toBe('a1')
    expect(JSON.parse(localStorage.getItem(KEY)).active).toBeUndefined()
    expect(JSON.parse(localStorage.getItem(ACTIVE_KEY)).id).toBe('a1')
    // Second boot: nothing to move, nothing lost.
    useStore = await freshStore()
    expect(useStore.getState().A.id).toBe('a1')
    expect(JSON.parse(localStorage.getItem(KEY)).active).toBeUndefined()
  })
  it('never clobbers a newer local session with a stale one from the profile', async () => {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(session({ id: 'newer' })))
    localStorage.setItem(KEY, JSON.stringify({ engineSchemaVersion: 2, workouts: [], routines: [], active: session({ id: 'stale' }), _ts: 5 }))
    const useStore = await freshStore()
    expect(useStore.getState().A.id).toBe('newer')
    expect(JSON.parse(localStorage.getItem(KEY)).active).toBeUndefined()
  })
})

describe('updateActive (A29, A30)', () => {
  it('writes only gym_active_v1 and leaves gym_state_v1 and _ts untouched', async () => {
    const useStore = await freshStore()
    useStore.getState().update(s => { s.unit = 'kg' })          // establish a profile and a _ts
    const profileBefore = localStorage.getItem(KEY)
    const tsBefore = useStore.getState().S._ts

    useStore.getState().setActive(session())
    useStore.getState().updateActive(A => { A.entries[0].sets[0].done = true })

    expect(useStore.getState().A.entries[0].sets[0].done).toBe(true)
    expect(JSON.parse(localStorage.getItem(ACTIVE_KEY)).entries[0].sets[0].done).toBe(true)
    expect(localStorage.getItem(KEY)).toBe(profileBefore)
    expect(useStore.getState().S._ts).toBe(tsBefore)
  })
  it('arms no push', async () => {
    vi.useFakeTimers()
    const useStore = await freshStore()
    const spy = vi.spyOn(useStore.getState(), 'pushState')
    useStore.getState().setActive(session())
    useStore.getState().updateActive(A => { A.entries[0].sets[0].done = true })
    vi.advanceTimersByTime(5_000)
    expect(spy).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
  it('performs zero serializations of the profile across a rapid sequence (A30)', async () => {
    const useStore = await freshStore()
    useStore.getState().setActive(session())
    // Spying on the localStorage INSTANCE rather than Storage.prototype: happy-dom's Storage is a
    // Proxy that binds a method onto the instance the first time it's touched (ClassMethodBinder),
    // so a prototype spy set up after the setActive() call above would silently miss every call.
    const setItem = vi.spyOn(localStorage, 'setItem')
    for (let i = 0; i < 20; i++) useStore.getState().updateActive(A => { A.entries[0].sets[0].r = i })
    const keys = setItem.mock.calls.map(c => c[0])
    expect(keys.every(k => k === ACTIVE_KEY)).toBe(true)
    expect(keys).toHaveLength(20)
    setItem.mockRestore()
  })
  it('is a no-op with no active session', async () => {
    const useStore = await freshStore()
    expect(() => useStore.getState().updateActive(A => { A.x = 1 })).not.toThrow()
    expect(useStore.getState().A).toBe(null)
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(null)
  })
  it('writes synchronously, so an OS kill immediately after loses nothing', async () => {
    const useStore = await freshStore()
    useStore.getState().setActive(session())
    useStore.getState().updateActive(A => { A.note = 'felt strong' })
    expect(JSON.parse(localStorage.getItem(ACTIVE_KEY)).note).toBe('felt strong')
  })
})

describe('setActive / clearActive (A32)', () => {
  it('setActive replaces A and writes the key', async () => {
    const useStore = await freshStore()
    useStore.getState().setActive(session())
    expect(useStore.getState().A.id).toBe('a1')
    expect(JSON.parse(localStorage.getItem(ACTIVE_KEY)).id).toBe('a1')
  })
  it('clearActive clears A and the key and leaves S untouched (A32)', async () => {
    const useStore = await freshStore()
    useStore.getState().update(s => { s.unit = 'kg' })
    const profileBefore = localStorage.getItem(KEY)
    const tsBefore = useStore.getState().S._ts
    useStore.getState().setActive(session())
    useStore.getState().clearActive()
    expect(useStore.getState().A).toBe(null)
    expect(localStorage.getItem(ACTIVE_KEY)).toBe(null)
    expect(localStorage.getItem(KEY)).toBe(profileBefore)
    expect(useStore.getState().S._ts).toBe(tsBefore)
  })
})

describe('the profile no longer carries a session (A33)', () => {
  it('DEF has no active field', async () => {
    const { DEF } = await import('./useStore.js')
    expect('active' in DEF).toBe(false)
  })
  it('a persisted profile never contains one', async () => {
    const useStore = await freshStore()
    useStore.getState().setActive(session())
    useStore.getState().update(s => { s.unit = 'lb' })
    expect(JSON.parse(localStorage.getItem(KEY)).active).toBeUndefined()
  })
  it('the debounces are unchanged: 1500 ms push, 800 ms native mirror (A35)', async () => {
    // Not `new URL('./useStore.js', import.meta.url)`: under the happy-dom environment,
    // import.meta.url resolves against the fake page origin (http:), not the real file path.
    const [fs, path] = await Promise.all([import('node:fs'), import('node:path')])
    const src = fs.readFileSync(path.join(process.cwd(), 'src/store/useStore.js'), 'utf8')
    expect(src).toMatch(/get\(\)\.pushState\(\), 1500\)/)
    expect(src).toMatch(/\}, 800\)/)
    expect(src).not.toMatch(/, 500\)/)
  })
})
