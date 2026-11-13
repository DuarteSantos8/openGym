// @vitest-environment happy-dom

/* QA2 1.4.5: the phone Coach keeps its waiting proposal (lib/coach-device.js) on the device. It
   is a plan made from the signed-in account's log, so a sign-out drops it: the next account on a
   shared phone must not be offered the previous person's plan. How the Coach runs stays. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const coach = vi.hoisted(() => ({ saved: [] }))
vi.mock('../lib/mobile.js', async importOriginal => ({ ...(await importOriginal()), MOBILE: true }))
vi.mock('../lib/coach-device.js', async importOriginal => ({
  ...(await importOriginal()),
  saveCoachDevice: vi.fn(async patch => { coach.saved.push(patch); return { mode: 'byok', ...patch } }),
}))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(async () => ({ ok: true })), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => true }))

import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
beforeEach(() => { localStorage.clear(); coach.saved.length = 0; useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true }) })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('signing out on a phone drops the Coach’s waiting proposal', () => {
  it('the next account is not offered the previous person’s plan', async () => {
    useStore.getState().setUser({ id: 'u1', name: 'Olga' })
    await useStore.getState().signOut({ force: true })
    await new Promise(r => setTimeout(r, 0))
    expect(coach.saved).toContainEqual({ pending: null })
  })
})
