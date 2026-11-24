// @vitest-environment happy-dom

/* The sync push asks api() for a gzipped body only when the server's GET /api/config says
   `gzip_body` (#1489). An older server, or a config not read yet, gets the plain body it always
   did. A server that refuses the gzipped body anyway (an old server behind a stale config reads
   the bytes as JSON) gets the same push plain at once, and plain from then on. */
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
const refusal = (status, error) => Object.assign(new Error(error), { status, data: { error } })

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

  it('an old server (no gzip_body, or no config yet) gets the plain body', async () => {
    for (const config of [{ allow_guest: false }, null]) {
      api.mockReset()
      signedIn(config)
      api.mockResolvedValueOnce({ ok: true, rev: 4 })
      await useStore.getState().pushState()
      expect(puts()).toHaveLength(1)
      expect(puts()[0].gzip).toBeFalsy()
    }
  })

  it('a refusal that is not about the encoding is not retried plain', async () => {
    signedIn({ gzip_body: true })
    api.mockRejectedValueOnce(refusal(400, 'invalid state'))
    await useStore.getState().pushState()
    expect(puts().map(o => o.gzip)).toEqual([true])
  })

  // Last on purpose: after it this store sends plain for the rest of the run.
  it('a server that reads the gzip as bad JSON gets the push plain, and plain after that', async () => {
    signedIn({ gzip_body: true })
    api.mockRejectedValueOnce(refusal(400, 'invalid json'))
    api.mockResolvedValueOnce({ ok: true, rev: 4 })
    await useStore.getState().pushState()
    expect(puts().map(o => !!o.gzip)).toEqual([true, false])
    expect(JSON.parse(puts()[1].body).baseRev).toBe(3)

    api.mockReset()
    signedIn({ gzip_body: true })
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    await useStore.getState().pushState()
    expect(puts().map(o => !!o.gzip)).toEqual([false])
  })
})
