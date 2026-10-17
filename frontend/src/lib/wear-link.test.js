import { describe, it, expect, vi } from 'vitest'
import { createWearLink } from './wear-link.js'
import { routineToWatchSnapshot } from './wear-bridge.js'

const T0 = new Date(2026, 8, 17, 18, 0).getTime()
const UUID = '3f2b8c1e-5d7a-4c9e-8a11-0f6d2b9e7c44'
const bench = { id: '0025', sets: 2, reps: 5, weight: 60, prog: 'off' }
const baseState = (extra = {}) => ({
  unit: 'kg', workouts: [], exWeights: {}, restSec: 90,
  routines: [{ id: 'push', name: 'Push', prog: 'off', ex: [bench] }], ...extra,
})
const session = (state, id = UUID) => {
  const snap = routineToWatchSnapshot(state.routines[0], state)
  return {
    v: 1, id, routineId: 'push', name: 'Push', unit: 'kg', start: T0, end: T0 + 40 * 60000,
    exercises: snap.exercises.map(ex => ({ id: ex.id, ctx: ex.ctx, sets: ex.sets.map(({ rest, ...s }, i) => ({ ...s, done: true, at: T0 + (i + 1) * 60000 })) })),
  }
}

function rig(state) {
  const calls = { ack: [], finish: [], index: [], snapshot: [], toast: [], conflicts: [] }
  const plugin = {
    ack: vi.fn(async a => { calls.ack.push(a.id) }),
    publishIndex: vi.fn(async a => { calls.index.push(JSON.parse(a.json)) }),
    publishSnapshot: vi.fn(async a => { calls.snapshot.push({ routineId: a.routineId, body: JSON.parse(a.json) }) }),
  }
  const link = createWearLink({
    plugin,
    getState: () => state,
    finish: (active, opts) => {
      calls.finish.push({ active, opts })
      state.workouts = [...state.workouts, { id: active.id }]
    },
    askConflict: async c => { calls.conflicts.push(c) },
    nameOf: e => 'name-' + e.id,
    toast: m => calls.toast.push(m),
    t: s => s,
  })
  return { link, calls, plugin, state }
}

describe('sessionFinished', () => {
  it('finishes the session at the end the watch gave, then acks it', async () => {
    const { link, calls, state } = rig(baseState())
    await link.onSession({ id: UUID, payload: session(state) })
    expect(calls.finish).toHaveLength(1)
    expect(calls.finish[0].active.id).toBe(UUID)
    expect(calls.finish[0].opts).toEqual({ end: T0 + 40 * 60000 })
    expect(calls.ack).toEqual([UUID])
  })

  it('accepts the payload as the JSON string it travelled as', async () => {
    const { link, calls, state } = rig(baseState())
    await link.onSession({ id: UUID, payload: JSON.stringify(session(state)) })
    expect(calls.finish).toHaveLength(1)
  })

  it('acks a repeat without saving it twice', async () => {
    const { link, calls, state } = rig(baseState())
    await link.onSession({ id: UUID, payload: session(state) })
    await link.onSession({ id: UUID, payload: session(state) })
    expect(calls.finish).toHaveLength(1)
    expect(calls.ack).toEqual([UUID, UUID])
  })

  it('deals with the same session offered twice at once only once', async () => {
    const { link, calls, state } = rig(baseState())
    const p = session(state)
    await Promise.all([link.onSession({ id: UUID, payload: p }), link.onSession({ id: UUID, payload: p })])
    expect(calls.finish).toHaveLength(1)
    expect(calls.ack).toEqual([UUID])
  })

  it('acks and saves nothing for a session in which nothing was ticked', async () => {
    const { link, calls, state } = rig(baseState())
    const p = session(state)
    p.exercises[0].sets.forEach(s => { s.done = false })
    await link.onSession({ id: UUID, payload: p })
    expect(calls.finish).toEqual([])
    expect(calls.ack).toEqual([UUID])
  })

  it('drops what can never be read, but keeps what a newer watch app wrote', async () => {
    const { link, calls, state } = rig(baseState())
    await link.onSession({ id: UUID, payload: { v: 1, id: UUID, start: 0 } })
    expect(calls.ack).toEqual([UUID])
    const other = '11111111-2222-3333-4444-555555555555'
    await link.onSession({ id: other, payload: { ...session(state, other), v: 2 } })
    expect(calls.ack).toEqual([UUID])
    expect(calls.toast).toEqual(['Update openGym on this phone to read the workout from your watch.'])
  })

  it('does not touch the phone’s own workout: it asks, and acks only on the answer', async () => {
    const own = { id: 'mine', entries: [] }
    const { link, calls, state } = rig(baseState({ active: own }))
    await link.onSession({ id: UUID, payload: session(state) })
    expect(calls.finish).toEqual([])
    expect(calls.ack).toEqual([])
    expect(calls.conflicts).toHaveLength(1)
    expect(calls.conflicts[0].name).toBe('Push')

    await calls.conflicts[0].save()
    expect(calls.finish).toHaveLength(1)
    expect(calls.ack).toEqual([UUID])
    expect(state.active).toBe(own)
  })

  it('discarding from the conflict sheet acks without saving', async () => {
    const { link, calls, state } = rig(baseState({ active: { id: 'mine', entries: [] } }))
    await link.onSession({ id: UUID, payload: session(state) })
    await calls.conflicts[0].discard()
    expect(calls.finish).toEqual([])
    expect(calls.ack).toEqual([UUID])
  })

  it('a swallowed ack does not lose the saved workout', async () => {
    const { link, calls, plugin, state } = rig(baseState())
    plugin.ack.mockRejectedValueOnce(new Error('no data layer'))
    await link.onSession({ id: UUID, payload: session(state) })
    expect(calls.finish).toHaveLength(1)
    // ...and the watch offering it again is a plain duplicate.
    await link.onSession({ id: UUID, payload: session(state) })
    expect(calls.finish).toHaveLength(1)
    expect(plugin.ack).toHaveBeenCalledTimes(2)
  })

  it('ignores an event with no id at all', async () => {
    const { link, calls } = rig(baseState())
    await link.onSession({})
    await link.onSession(undefined)
    expect(calls.ack).toEqual([])
  })
})

describe('routineRequested', () => {
  it('answers a request with no routine with the list', async () => {
    const { link, calls } = rig(baseState())
    await link.onRoutineRequested({ requestId: 'a' })
    expect(calls.index).toHaveLength(1)
    expect(calls.index[0]).toMatchObject({ kind: 'index', routines: [{ id: 'push', name: 'Push', exercises: 1 }] })
  })

  it('answers a request for a routine with its snapshot, named in the app’s language', async () => {
    const { link, calls } = rig(baseState())
    await link.onRoutineRequested({ requestId: 'a', routineId: 'push' })
    expect(calls.snapshot).toHaveLength(1)
    expect(calls.snapshot[0].routineId).toBe('push')
    expect(calls.snapshot[0].body).toMatchObject({ kind: 'snapshot', routineId: 'push' })
    expect(calls.snapshot[0].body.exercises[0].name).toBe('name-0025')
  })

  it('answers for a routine that is gone, so the watch does not wait', async () => {
    const { link, calls } = rig(baseState())
    await link.onRoutineRequested({ routineId: 'deleted' })
    expect(calls.snapshot[0]).toMatchObject({ routineId: 'deleted', body: { kind: 'missing', routineId: 'deleted' } })
  })

  it('does not throw when the Data Layer is unavailable', async () => {
    const { link, plugin } = rig(baseState())
    plugin.publishSnapshot.mockRejectedValueOnce(new Error('unavailable'))
    await expect(link.onRoutineRequested({ routineId: 'push' })).resolves.toBeUndefined()
  })
})

describe('publishAll', () => {
  const two = () => baseState({
    routines: [
      { id: 'push', name: 'Push', prog: 'off', ex: [bench] },
      { id: 'pull', name: 'Pull', prog: 'off', ex: [{ id: '0026', sets: 3, reps: 8, weight: 40, prog: 'off' }] },
    ],
  })

  it('puts every routine’s snapshot and then the list, so a listed routine is already there', async () => {
    const { link, plugin, calls } = rig(two())
    await link.publishAll()
    expect(calls.snapshot.map(s => s.routineId)).toEqual(['push', 'pull'])
    expect(calls.index).toHaveLength(1)
    expect(calls.index[0].routines.map(r => r.id)).toEqual(['push', 'pull'])
    const order = [...plugin.publishSnapshot.mock.invocationCallOrder, ...plugin.publishIndex.mock.invocationCallOrder]
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('does not put again what has not changed, even though the timestamp moves', async () => {
    const { link, plugin } = rig(two())
    await link.publishAll()
    await link.publishAll()
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(2)
    expect(plugin.publishIndex).toHaveBeenCalledTimes(1)
  })

  it('puts only the routine that changed, and the list when its names change', async () => {
    const { link, plugin, calls, state } = rig(two())
    await link.publishAll()
    state.routines = [state.routines[0], { ...state.routines[1], ex: [{ ...state.routines[1].ex[0], weight: 45 }] }]
    await link.publishAll()
    expect(calls.snapshot.map(s => s.routineId)).toEqual(['push', 'pull', 'pull'])
    expect(plugin.publishIndex).toHaveBeenCalledTimes(1)
    state.routines = [state.routines[0], { ...state.routines[1], name: 'Pull day' }]
    await link.publishAll()
    expect(plugin.publishIndex).toHaveBeenCalledTimes(2)
    expect(calls.index[1].routines[1].name).toBe('Pull day')
  })

  it('force puts everything again (the watch asked)', async () => {
    const { link, plugin } = rig(two())
    await link.publishAll()
    await link.publishAll({ force: true })
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(4)
    expect(plugin.publishIndex).toHaveBeenCalledTimes(2)
  })

  it('a request for the list publishes the snapshots too', async () => {
    const { link, calls } = rig(two())
    await link.onRoutineRequested({ requestId: 'a' })
    expect(calls.snapshot.map(s => s.routineId)).toEqual(['push', 'pull'])
    expect(calls.index).toHaveLength(1)
  })

  it('a watch that is only checking in gets what changed, a refresh gets everything', async () => {
    const { link, plugin } = rig(two())
    await link.onRoutineRequested({ requestId: 'quiet-1' })
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(2)
    await link.onRoutineRequested({ requestId: 'quiet-2' })
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(2)
    expect(plugin.publishIndex).toHaveBeenCalledTimes(1)
    await link.onRoutineRequested({ requestId: 'refresh-3' })
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(4)
    expect(plugin.publishIndex).toHaveBeenCalledTimes(2)
  })

  it('a put that failed is tried again on the next pass, and never throws', async () => {
    const { link, plugin } = rig(two())
    plugin.publishSnapshot.mockRejectedValueOnce(new Error('no data layer'))
    await expect(link.publishAll()).resolves.toBeUndefined()
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(2)
    await link.publishAll()
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(3)
  })

  it('passes called together run one after the other', async () => {
    const { link, plugin } = rig(two())
    await Promise.all([link.publishAll(), link.publishAll(), link.publishAll()])
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(2)
  })

  it('forgets a deleted routine, so it is published afresh if it comes back', async () => {
    const { link, plugin, state } = rig(two())
    await link.publishAll()
    const pull = state.routines[1]
    state.routines = [state.routines[0]]
    await link.publishAll()
    state.routines = [state.routines[0], pull]
    await link.publishAll()
    expect(plugin.publishSnapshot).toHaveBeenCalledTimes(3)
  })
})
