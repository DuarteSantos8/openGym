// @vitest-environment happy-dom

/* A weigh-in the sync hub writes on the server (api/sync-routes.js PUT /api/sync/bodyweight/{date})
   meets this device's pull and merge as they are. The server's half is the real one: the document
   the hub's write stores is made by api/sync-data.js and api/sync-stamps.js, then given the next
   revision and write id as server.js commitState does. What must hold: no device pushes a copy
   without the weigh-in back over it, and a correction made on a phone after it wins. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { withWeighIn } from '../../../api/sync-data.js'
import { stampPut } from '../../../api/sync-stamps.js'

const clone = value => JSON.parse(JSON.stringify(value))
const workout = (id, d = '2026-10-01') => ({ id, d, start: 1, entries: [] })
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const signedIn = S => useStore.setState({ S, user: { id: 'user-1' }, ready: true })
const DAY = '2026-10-12'

// The hub's write as the server stores it.
function hubWrite(doc, kg, now = Date.now()) {
  const next = withWeighIn(doc, DAY, kg, { now })
  stampPut(doc, next, { overRead: true, stamped: true })
  next._rev = (doc._rev || 0) + 1
  next._wids = [...(doc._wids || []), ...(doc._wid ? [doc._wid] : [])]
  next._wid = 'b'.repeat(16)
  return next
}
const dayOf = S => (S.bodyweight || []).find(e => e.d === DAY)

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})
afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('a weigh-in the hub wrote, on the next pull', () => {
  it('a first pull (no marker) with a local copy edited since the server’s last push adopts it, never pushes over it', async () => {
    const now = Date.now()
    const before = { ...clone(DEF), _ts: now - 60000, workouts: [workout('w1')], bodyweight: [], _rev: 3, _wid: 'a'.repeat(16) }
    const server = hubWrite(before, 79.5, now)
    expect(server._ts).toBeGreaterThan(before._ts)
    // This device's copy is newer than what the server held before the hub's write.
    signedIn({ ...clone(DEF), _ts: now - 1000, workouts: [workout('w1')], bodyweight: [] })
    api.mockResolvedValueOnce({ state: server, rev: server._rev })
    api.mockResolvedValue({ ok: true, rev: server._rev + 1 })

    await useStore.getState().pullState()

    for (const p of puts()) expect(dayOf(p.state)?.w, 'no push without the weigh-in').toBe(79.5)
    expect(dayOf(useStore.getState().S)?.w).toBe(79.5)
  })

  it('…which is what a hub write that left _ts where it was would have lost', async () => {
    const now = Date.now()
    const before = { ...clone(DEF), _ts: now - 60000, workouts: [workout('w1')], bodyweight: [], _rev: 3, _wid: 'a'.repeat(16) }
    const server = { ...hubWrite(before, 79.5, now), _ts: before._ts }
    signedIn({ ...clone(DEF), _ts: now - 1000, workouts: [workout('w1')], bodyweight: [] })
    api.mockResolvedValueOnce({ state: server, rev: server._rev })
    api.mockResolvedValue({ ok: true, rev: server._rev + 1 })

    await useStore.getState().pullState()

    expect(puts()).toHaveLength(1)
    expect(dayOf(puts()[0].state)).toBeUndefined()
  })

  it('a device on the revision before, with no change of its own, takes the server copy', async () => {
    const now = Date.now()
    const before = { ...clone(DEF), _ts: now - 60000, workouts: [workout('w1')], bodyweight: [], _rev: 3, _wid: 'a'.repeat(16) }
    const server = hubWrite(before, 79.5, now)
    signedIn(clone(before))
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 3, ts: before._ts, wid: before._wid }))
    api.mockResolvedValueOnce({ state: server, rev: server._rev })

    await useStore.getState().pullState()

    expect(puts()).toHaveLength(0)
    expect(dayOf(useStore.getState().S)?.w).toBe(79.5)
  })

  it('a device with a change of its own merges, and its push carries the weigh-in', async () => {
    const now = Date.now()
    const before = { ...clone(DEF), _ts: now - 60000, workouts: [workout('w1')], bodyweight: [], _rev: 3, _wid: 'a'.repeat(16) }
    const server = hubWrite(before, 79.5, now)
    signedIn({ ...clone(before), _ts: now - 500, workouts: [workout('w1'), workout('w2', '2026-10-02')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 3, ts: before._ts, wid: before._wid }))
    api.mockResolvedValueOnce({ state: server, rev: server._rev })
    api.mockResolvedValueOnce({ ok: true, rev: server._rev + 1 })

    await useStore.getState().pullState()

    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(server._rev)
    expect(dayOf(puts()[0].state)?.w).toBe(79.5)
    expect(puts()[0].state.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
  })

  it('a correction made on a phone after the hub’s write wins it, even from a copy that never saw it', async () => {
    const now = Date.now()
    const before = { ...clone(DEF), _ts: now - 60000, workouts: [workout('w1')], bodyweight: [{ d: DAY, w: 80, t: now - 60000 }], _rev: 3, _wid: 'a'.repeat(16) }
    // Whatever the hub's clock says (its `t` is never used), the server stamps by its own.
    const server = hubWrite(before, 79.5, now)
    expect(dayOf(server).t).toBeLessThanOrEqual(Date.now())
    // A second later the phone, still on revision 3, corrects the day to 81.
    signedIn({ ...clone(before), _ts: now + 1000, bodyweight: [{ d: DAY, w: 81, t: now + 1000 }] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 3, ts: before._ts, wid: before._wid }))
    api.mockResolvedValueOnce({ state: server, rev: server._rev })
    api.mockResolvedValueOnce({ ok: true, rev: server._rev + 1 })

    await useStore.getState().pullState()

    expect(puts()).toHaveLength(1)
    expect(dayOf(puts()[0].state)?.w).toBe(81)
    expect(dayOf(useStore.getState().S)?.w).toBe(81)
  })
})
