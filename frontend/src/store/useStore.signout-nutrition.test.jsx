// @vitest-environment happy-dom

/* QA 1.4.5: the openNutrition link (lib/sister-nutrition.js) keeps what you ate in this browser.
   A sign-out left it there, so on a shared device the next account's Home, report and month story
   showed the previous person's meals. A sign-out now forgets the link, its cache and its token. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => ({ ok: true })), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => true }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { NUTRITION_KEY, TOKEN_KEY, link, loadLink, onNutritionChange, refresh, unlink } from '../lib/sister-nutrition.js'
import { secureGet, secureSet } from '../lib/coach-secrets.js'

const clone = v => JSON.parse(JSON.stringify(v))
beforeEach(() => { localStorage.clear(); useStore.getState().setUser(null); useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true }) })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

const first = { id: 'profile-a', name: 'A' }
const second = { id: 'profile-b', name: 'B' }
const day = '2026-11-05'
const synthetic = 'on_' + 'q'.repeat(32)
const responseFor = kcal => ({ ok: true, json: async () => ({
  schema: 'opennutrition.summary.v1', days: [{ date: day, kcal }],
}) })
const pair = (kcal = 2100, fetchFn = async () => responseFor(kcal)) =>
  link('https://nutrition.example', synthetic, { now: Date.parse(day + 'T12:00:00Z'), fetchFn })

async function verifyUnpaired() {
  expect(loadLink()).toBeNull()
  const fetchFn = vi.fn()
  expect(await refresh({ force: true, fetchFn })).toBeNull()
  expect(fetchFn).not.toHaveBeenCalled()
}

describe('nutrition stays private across account transitions', () => {
  it('forgets a signed-out account pairing, including its cached meals', async () => {
    useStore.getState().setUser(first)
    await pair()
    expect(loadLink().days[day].kcal).toBe(2100)
    await useStore.getState().signOut({ force: true })
    await verifyUnpaired()
    useStore.getState().setUser(first)
    await verifyUnpaired()
  })

  it('leaves an unowned legacy link unclaimed by the next account', async () => {
    localStorage.setItem(NUTRITION_KEY, JSON.stringify({ url: 'https://nutrition.example', days: { [day]: { kcal: 2100 } } }))
    await secureSet(TOKEN_KEY, synthetic)
    await verifyUnpaired()
    useStore.getState().setUser(second)
    await verifyUnpaired()
    expect(localStorage.getItem(NUTRITION_KEY)).toBeNull()
    await vi.waitFor(async () => expect(Boolean(await secureGet(TOKEN_KEY))).toBe(false))
  })

  it('does not expose a prior account after its session expires at boot', async () => {
    useStore.getState().setUser(first)
    await pair()
    expect(loadLink().days[day].kcal).toBe(2100)
    api.mockImplementation(async path => {
      if (path === '/api/me') throw Object.assign(new Error('session expired'), { status: 401 })
      return {}
    })
    useStore.setState({ ready: false, config: null })
    await useStore.getState().boot()
    expect(useStore.getState().user).toBeNull()
    await verifyUnpaired()
    useStore.getState().setUser(second)
    await verifyUnpaired()
    useStore.getState().setUser(first)
    const fetchFn = vi.fn(async () => responseFor(2110))
    expect((await refresh({ force: true, fetchFn })).days[day].kcal).toBe(2110)
    expect(fetchFn.mock.calls[0][1].headers.Authorization === 'Bearer ' + synthetic).toBe(true)
  })

  it('rejects a delayed nutrition link without replacing the next profile pairing', async () => {
    useStore.getState().setUser(first)
    const started = Promise.withResolvers()
    const response = Promise.withResolvers()
    const pending = pair(2100, async () => { started.resolve(); return response.promise })
    await started.promise
    await useStore.getState().signOut({ force: true })
    useStore.getState().setUser(second)
    await verifyUnpaired()
    const next = await pair(1800)
    response.resolve(responseFor(2100))
    await expect(pending).rejects.toMatchObject({ code: 'failed' })
    expect(loadLink().pairId).toBe(next.pairId)
    expect(loadLink().days[day].kcal).toBe(1800)
  })

  it('discards stale refresh results, including errors, and preserves the guest pairing', async () => {
    const guest = await pair(1700)
    useStore.getState().setUser(first)
    await verifyUnpaired()
    await pair(2100)
    for (const success of [true, false]) {
      const started = Promise.withResolvers()
      const response = Promise.withResolvers()
      const pending = refresh({ force: true, fetchFn: async () => { started.resolve(); return response.promise } })
      await started.promise
      useStore.getState().setUser(second)
      await pair(1800)
      response.resolve(success ? responseFor(9000) : { ok: false, status: 403 })
      expect(await pending).toBeNull()
      expect(loadLink().days[day].kcal).toBe(1800)
      expect(loadLink().error).toBeNull()
      useStore.getState().setUser(first)
      expect(loadLink().days[day].kcal).toBe(2100)
    }
    await useStore.getState().signOut({ force: true })
    expect(loadLink()?.pairId).toBe(guest.pairId)
  })

  it('opens the returning profile only after the boot identity check', async () => {
    useStore.getState().setUser(first)
    await pair()
    for (const online of [false, true]) {
      const started = Promise.withResolvers()
      const response = Promise.withResolvers()
      api.mockImplementation(async path => {
        if (path === '/api/me') { started.resolve(); return response.promise }
        return {}
      })
      useStore.setState({ ready: false, config: null })
      const boot = useStore.getState().boot()
      await started.promise
      await verifyUnpaired()
      if (online) response.resolve({ user: first })
      else response.reject(new TypeError('offline'))
      await boot
      expect(loadLink().days[day].kcal).toBe(2100)
      const fetchFn = vi.fn(async () => responseFor(2100))
      await refresh({ force: true, fetchFn })
      expect(fetchFn.mock.calls.length).toBe(online ? 1 : 0)
    }
  })

  it.each([200, 401])('ignores a late boot identity response (%i) after a profile switch', async status => {
    useStore.getState().setUser(first)
    await pair()
    const started = Promise.withResolvers(), reply = Promise.withResolvers()
    api.mockImplementation(async path => {
      if (path === '/api/me') { started.resolve(); return reply.promise }
      return {}
    })
    const boot = useStore.getState().boot()
    await started.promise
    useStore.getState().setUser(second)
    const next = await pair(1800)
    if (status === 200) reply.resolve({ user: first })
    else reply.reject(Object.assign(new Error('expired'), { status }))
    await boot
    expect(useStore.getState().user?.id).toBe(second.id)
    expect(loadLink()?.pairId).toBe(next.pairId)
  })

  it('manually refreshes an offline boot only after reconfirming the same account', async () => {
    useStore.getState().setUser(first)
    await pair()
    const fetchFn = vi.fn(async () => responseFor(2310))
    api.mockImplementation(async path => {
      if (path === '/api/me') throw new TypeError('offline')
      return {}
    })
    await useStore.getState().boot()
    expect((await refresh({ force: true, fetchFn })).error).toBe('unreachable')
    expect(fetchFn).not.toHaveBeenCalled()
    api.mockImplementation(async () => ({ user: first }))
    expect((await refresh({ force: true, fetchFn })).days[day].kcal).toBe(2310)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a delayed account logout leaves the newly signed-in profile and pairing alone', async () => {
    const started = Promise.withResolvers()
    const response = Promise.withResolvers()
    api.mockImplementation(async path => {
      if (path === '/api/logout') { started.resolve(); return response.promise }
      return {}
    })
    useStore.getState().setUser(first)
    await pair()
    const logout = useStore.getState().signOut({ force: true })
    await started.promise
    useStore.getState().setUser(second)
    const next = await pair(1800)
    response.resolve({})
    await logout
    expect(useStore.getState().user?.id).toBe(second.id)
    expect(loadLink()?.pairId).toBe(next.pairId)
  })

  it('keeps the new profile paired when an earlier unlink confirmation arrives', async () => {
    useStore.getState().setUser(first)
    const previous = await pair()
    useStore.getState().setUser(second)
    const next = await pair(1800)
    expect(await unlink(previous.pairId)).toBe(false)
    expect(loadLink()?.pairId).toBe(next.pairId)
  })

  it('hides a mounted view immediately on another tab taking ownership', async () => {
    useStore.getState().setUser(first)
    await pair()
    const listener = vi.fn()
    const unsubscribe = onNutritionChange(listener)
    try {
      localStorage.setItem('gym_owner', second.id)
      window.dispatchEvent(new StorageEvent('storage', { key: 'gym_owner', newValue: second.id }))
      expect(listener).toHaveBeenLastCalledWith(null)
      await verifyUnpaired()
    } finally { unsubscribe() }
  })
})
