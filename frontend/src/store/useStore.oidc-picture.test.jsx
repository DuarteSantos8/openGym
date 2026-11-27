// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), apiBlob: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { startProviderPicture } from '../lib/oidc-picture.js'

const clone = v => JSON.parse(JSON.stringify(v))
const w = (id, d = '2026-09-01') => ({ id, d, start: 1, end: 2, entries: [] })
const ref = { kind: 'image', hash: 'c'.repeat(64), mime: 'image/webp', size: 9000, width: 256, height: 256, at: 5 }
const ON = { media: { imageMB: 2, avatar: true } }
const SEEN = '2026-11-27T09:00:00.000Z'

let stop = null
beforeEach(() => { localStorage.clear(); api.mockReset() })
afterEach(() => { stop?.(); stop = null; localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('the provider\'s picture on a sign-in that takes the account\'s profile', () => {
  it('is taken for the account\'s profile, not dealt with on the copy this device had before', async () => {
    localStorage.removeItem('gym_owner')
    useStore.setState({ S: { ...clone(DEF), _ts: 500, workouts: [w('g1')], avatar: { preset: 'moon' } }, user: null, ready: true, config: ON })
    const server = { ...clone(DEF), _ts: 900, workouts: [w('a1')] }
    api.mockImplementation(async (p, o) => (p === '/api/config' ? ON : o?.method === 'PUT' ? { ok: true, rev: 4 } : { state: clone(server), rev: 3 }))
    const apiBlob = vi.fn(async () => new Blob(['x']))
    stop = startProviderPicture(useStore, { apiBlob, render: async () => ({ media: ref, blob: new Blob(['y']) }), media: { put: async () => {} } })
    useStore.getState().setUser({ id: 'kaya', name: 'Kaya', oidcPicture: SEEN }, { adopt: true })
    await useStore.getState().adoptProfile(async () => false)
    expect(useStore.getState().S.workouts.map(x => x.id)).toEqual(['a1'])
    await vi.waitFor(() => expect(useStore.getState().S.avatarOidc).toEqual({ at: SEEN, hash: ref.hash }), { timeout: 4000 })
    expect(useStore.getState().S.avatar).toEqual({ m: ref })
    expect(apiBlob).toHaveBeenCalledTimes(1)
  })

  it('comes for the next account when another sign-in overtook the question', async () => {
    localStorage.removeItem('gym_owner')
    useStore.setState({ S: { ...clone(DEF), _ts: 500, workouts: [w('g1')] }, user: null, ready: true, config: ON })
    const server = { ...clone(DEF), _ts: 900, workouts: [w('a1')] }
    api.mockImplementation(async (p, o) => (p === '/api/config' ? ON : o?.method === 'PUT' ? { ok: true, rev: 4 } : { state: clone(server), rev: 3 }))
    const apiBlob = vi.fn(async () => new Blob(['x']))
    stop = startProviderPicture(useStore, { apiBlob, render: async () => ({ media: ref, blob: new Blob(['y']) }), media: { put: async () => {} } })
    let answer = null
    useStore.getState().setUser({ id: 'kaya', name: 'Kaya' }, { adopt: true })
    const first = useStore.getState().adoptProfile(() => new Promise(r => { answer = r }))
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    useStore.getState().setUser({ id: 'lior', name: 'Lior', oidcPicture: SEEN })
    answer(false)
    expect((await first).stale).toBe(true)
    await vi.waitFor(() => expect(useStore.getState().S.avatarOidc).toEqual({ at: SEEN, hash: ref.hash }), { timeout: 4000 })
    expect(apiBlob).toHaveBeenCalledTimes(1)
  })
})
