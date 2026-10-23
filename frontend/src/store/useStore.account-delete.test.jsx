// @vitest-environment happy-dom

/* Settings → "Delete my account" (useStore deleteAccount): the server removes the profile, then
   this device ends where a sign-out leaves it, with nothing kept aside for an account that no
   longer exists. Refused or unanswered, nothing here changes and the caller hears why. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast, stopRest, abandonWork } = vi.hoisted(() => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast, stopRest, abandonWork }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const workout = (id, d = '2026-09-01') => ({ id, d, start: 1, entries: [] })
const httpError = (status, data = {}) => Object.assign(new Error(data.error || 'HTTP ' + status), { status, data })
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const S0 = () => ({ ...clone(DEF), _ts: 100, workouts: [workout('w1')], active: { id: 'run', start: 5, entries: [] } })
// Kept changes of this account and of another one, as a forced sign-out leaves them, keyed by
// server (this page's origin) and account.
const ORIGIN = () => location.origin
const stash = () => ({
  [ORIGIN() + '|' + USER.id]: { server: ORIGIN(), uid: USER.id, name: 'One', at: 1, state: { ...clone(DEF), workouts: [workout('k1')] } },
  [ORIGIN() + '|user-2']: { server: ORIGIN(), uid: 'user-2', name: 'Two', at: 1, state: { ...clone(DEF), workouts: [workout('k2')] } },
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gym_owner', USER.id)
  localStorage.setItem('gym_stash', JSON.stringify(stash()))
  api.mockReset(); toast.mockReset(); stopRest.mockReset()
  useStore.setState({ S: S0(), user: USER, ready: true, sync: { ...fresh }, config: null })
})
afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})

describe('deleteAccount', () => {
  it('asks the server with the typed name and the owner’s proof, then signs this device out and keeps nothing of the account', async () => {
    api.mockResolvedValue({ ok: true })
    await useStore.getState().deleteAccount('One', { current: 'correct horse battery staple' })

    expect(api).toHaveBeenCalledWith('/api/account/delete', { method: 'POST', body: JSON.stringify({ name: 'One', current: 'correct horse battery staple' }) })
    const st = useStore.getState()
    expect(st.user).toBeNull()
    expect(st.S.workouts).toEqual([])
    expect(st.S.active).toBeFalsy()
    expect(stopRest).toHaveBeenCalled()
    // Its kept changes have no account to go back to; another account's stay.
    expect(Object.keys(JSON.parse(localStorage.getItem('gym_stash')))).toEqual([ORIGIN() + '|user-2'])
  })

  it('refused by the server: throws, and this device is left exactly as it was', async () => {
    api.mockRejectedValue(httpError(409, { error: 'the last admin cannot leave while other profiles remain', code: 'last-admin' }))
    await expect(useStore.getState().deleteAccount('One')).rejects.toMatchObject({ status: 409, data: { code: 'last-admin' } })

    const st = useStore.getState()
    expect(st.user).toEqual(USER)
    expect(st.S.workouts.map(w => w.id)).toEqual(['w1'])
    expect(st.S.active?.id).toBe('run')
    expect(stopRest).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('gym_stash'))).toEqual(stash())
  })
})
