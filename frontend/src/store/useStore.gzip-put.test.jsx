// @vitest-environment happy-dom

/* The sync push asks api() for a gzipped body only when the server's GET /api/config says it takes
   one (`gzip_body`); an older server, or a config not read yet, gets the plain body it always did.
   The 409 retry asks the same way. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => o)
const signedIn = config => {
  const S = { ...clone(DEF), _ts: 100 }
  localStorage.setItem('gym_sync', JSON.stringify({ rev: 3, ts: S._ts }))
  useStore.setState({ S, config, user: { id: 'u1' }, ready: true, sync: { offline: false, pending: false, lastSynced: 0 } })
}

beforeEach(() => { localStorage.clear(); api.mockReset() })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false, config: null }) })

describe('sync push gzip', () => {
  it('asks for gzip when the server says gzip_body, the 409 retry too', async () => {
    signedIn({ gzip_body: true })
    api.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, data: { state: { ...clone(DEF), _ts: 50, _rev: 4 }, rev: 4 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    await useStore.getState().pushState()
    expect(puts().map(o => o.gzip)).toEqual([true, true])
  })

  it('sends plain to a server that does not say it, or before the config is read', async () => {
    for (const config of [{ allow_guest: false }, null]) {
      api.mockReset()
      signedIn(config)
      api.mockResolvedValueOnce({ ok: true, rev: 4 })
      await useStore.getState().pushState()
      expect(puts()).toHaveLength(1)
      expect(puts()[0].gzip).toBeFalsy()
    }
  })
})
