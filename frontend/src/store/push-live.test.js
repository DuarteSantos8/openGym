// @vitest-environment happy-dom
// The server reads a running workout in a sync as "training now" (api/server.js presence), and
// takes the admin row's progress from `live` beside the state. A push carries it only while a
// workout runs, and a workout it cannot describe never fails the push.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => ({ rev: 1 })), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { useStore } from './useStore.js'

const pushed = () => vi.mocked(api).mock.calls.filter(([path, o]) => path === '/api/data' && o.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const push = async active => {
  const S = { ...useStore.getState().S, active }
  useStore.setState({ S, user: { id: 'u1', name: 'Boris' }, ready: true })
  await useStore.getState().pushState()
}

beforeEach(() => { vi.mocked(api).mockClear() })

describe('a push and the running workout', () => {
  it('carries the progress of the workout beside the state', async () => {
    await push({ name: 'Push Day', start: 1700000000000, cur: 0, entries: [{ sets: [{ done: true }, { done: false }] }] })
    expect(pushed()[0].live).toEqual({ name: 'Push Day', exIdx: 1, exTotal: 1, setsDone: 1, setsTotal: 2, startedAt: 1700000000000 })
  })

  it('carries nothing when no workout runs', async () => {
    await push(null)
    expect('live' in pushed()[0]).toBe(false)
  })

  it('a workout it cannot describe still pushes', async () => {
    await push({ name: 'Odd', start: 1, cur: 0, entries: [{}] })
    expect(pushed()).toHaveLength(1)
    expect('live' in pushed()[0]).toBe(false)
  })
})
