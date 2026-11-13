// @vitest-environment happy-dom

/* QA 1.4.5: the openNutrition link (lib/sister-nutrition.js) keeps what you ate in this browser.
   A sign-out left it there, so on a shared device the next account's Home, report and month story
   showed the previous person's meals. A sign-out now forgets the link, its cache and its token. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => ({ ok: true })), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: async () => true }))

import { DEF, useStore } from './useStore.js'
import { NUTRITION_KEY, TOKEN_KEY, loadLink, saveLink } from '../lib/sister-nutrition.js'
import { secureGet, secureSet } from '../lib/coach-secrets.js'

const clone = v => JSON.parse(JSON.stringify(v))
beforeEach(() => { localStorage.clear(); useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true }) })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('signing out forgets the openNutrition link', () => {
  it('no cached meals and no token are left for the next account', async () => {
    useStore.getState().setUser({ id: 'u1', name: 'Olga' })
    saveLink({ url: 'https://nutrition.example', days: { '2026-11-05': { kcal: 2100 } }, at: 1 })
    await secureSet(TOKEN_KEY, 'on_secret')
    expect(await secureGet(TOKEN_KEY)).toBe('on_secret')
    expect(loadLink()?.days['2026-11-05']).toBeTruthy()
    await useStore.getState().signOut({ force: true })
    await new Promise(r => setTimeout(r, 0))
    expect(loadLink()).toBeNull()
    expect(localStorage.getItem(NUTRITION_KEY)).toBeNull()
    expect(await secureGet(TOKEN_KEY)).toBeFalsy()
  })
})
