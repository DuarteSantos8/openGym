import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { propertyList, watchProfile, validWatchSession } from './watch-protocol.js'
vi.mock('./mobile.js', () => ({ MOBILE: false }))
vi.mock('./exercises.js', () => ({ exOr: id => ({ id, n: 'test' }), imgSrc: () => '', isAssisted: () => false }))
vi.mock('./nav.js', () => ({ nav: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ui } }))
const ui = vi.hoisted(() => ({ timer: null, stopRest: vi.fn(), abandonWork: vi.fn(), startRest: vi.fn(), addRest: vi.fn(), pauseRest: vi.fn(), resumeRest: vi.fn() }))
const { applyWatchSession, snapshot } = await import('./apple-watch.js')
const session = () => ({ id: 'workout', profile: '["local","local"]', seq: 1, name: 'A',
  start: Date.now() - 1000, d: '2026-10-07', routineIds: ['routine'], entries: [{ id: 'exercise', sets: [{ w: 10, r: 8, done: false }] }] })
const store = (active = null) => {
  const state = { S: { active, workouts: [], restSec: 90 }, update: fn => fn(state.S) }
  return { getState: () => state }
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('document', { hidden: true }) })
afterEach(() => vi.unstubAllGlobals())
describe('Watch transport and profile isolation', () => {
  it('scopes sessions to both server and account', () => {
    const profile = (server, id) => watchProfile({ getState: () => ({ sync: { server }, user: { id } }) })
    expect(profile('a', '1')).not.toBe(profile('a', '2'))
    expect(profile('a', '1')).not.toBe(profile('b', '1'))
    expect(watchProfile({ getState: () => ({}) })).toBe('["local","local"]')
  })
  it('removes unsupported nulls recursively, including arrays', () => {
    expect(propertyList({ a: null, b: [null, { x: undefined, w: 2 }], c: NaN })).toEqual({ b: [{ w: 2 }], c: 0 })
  })
  it('accepts normal sessions and minimal discard markers', () => {
    expect(validWatchSession(session())).toBe(true)
    expect(validWatchSession({ id: 'a', profile: 'p', seq: 2, discarded: true })).toBe(true)
  })
  for (const [label, change] of Object.entries({
    'missing owner': { profile: undefined }, 'invalid sequence': { seq: -1 },
    'fractional sequence': { seq: 1.5 }, 'future start': { start: Date.now() + 100000 },
    'missing entries': { entries: null }, 'empty entries': { entries: [] },
    'invalid rows': { entries: [{ id: 'e', sets: [null] }] },
    'invalid changes': { changes: [null] }, 'future sequence': { changes: [{ seq: 2 }] },
  })) it(`rejects ${label}`, () => expect(validWatchSession({ ...session(), ...change })).toBe(false))
})
describe('Phone reconciliation', () => {
  it('does not publish a previous profile while the next account is loading', () => {
    const st = store(session())
    expect(snapshot(st)).toEqual({ profile: session().profile, session: {}, routines: [], rest: {} })
  })
  it('adopts a session started offline without saving display metadata', async () => {
    const st = store(); const s = session(); s.entries[0].thumbnailKey = 'photo'
    expect(await applyWatchSession(st, { session: s })).toBe(true)
    expect(st.getState().S.active.id).toBe(s.id)
    expect(st.getState().S.active.entries[0].thumbnailKey).toBeUndefined()
  })
  it('keeps foreign-account sessions queued', async () => {
    const st = store()
    expect(await applyWatchSession(st, { session: { ...session(), profile: 'other' } })).toBe(false)
    expect(st.getState().S.active).toBeNull()
  })
  it('keeps a conflicting active workout intact', async () => {
    const st = store({ id: 'different' })
    expect(await applyWatchSession(st, { session: session() })).toBe(false)
    expect(st.getState().S.active.id).toBe('different')
  })
  it('does not revive a completed or discarded session', async () => {
    const st = store(); st.getState().S.workouts = [{ id: 'workout' }]
    expect(await applyWatchSession(st, { session: session() })).toBe(true)
    expect(st.getState().S.active).toBeNull()
    st.getState().S.workouts = []; st.getState().S._watchDiscardedIds = ['workout']
    await applyWatchSession(st, { session: session() }); expect(st.getState().S.active).toBeNull()
  })
  it('discards only the matching session', async () => {
    const st = store({ id: 'workout' })
    await applyWatchSession(st, { session: { id: 'workout', profile: session().profile, seq: 2, discarded: true } })
    expect(st.getState().S.active).toBeNull(); expect(ui.stopRest).toHaveBeenCalledOnce()
  })
  it('supports unchecking and ignores an old replay', async () => {
    const st = store(); await applyWatchSession(st, { session: session() })
    st.getState().S.active.entries[0].sets[0].done = true
    const next = { ...session(), seq: 2, changes: [{ seq: 2, entry: 0, set: 0, field: 'done', value: false }] }
    await applyWatchSession(st, { session: next })
    expect(st.getState().S.active.entries[0].sets[0].done).toBe(false)
    await applyWatchSession(st, { session: { ...next, changes: [{ ...next.changes[0], value: true }] } })
    expect(st.getState().S.active.entries[0].sets[0].done).toBe(false)
  })
  it('edits weight and rounds repetitions, rejecting negative values', async () => {
    const st = store(); await applyWatchSession(st, { session: session() })
    await applyWatchSession(st, { session: { ...session(), seq: 4, changes: [
      { seq: 2, entry: 0, set: 0, field: 'w', value: 12.5 },
      { seq: 3, entry: 0, set: 0, field: 'r', value: 9.2 },
      { seq: 4, entry: 0, set: 0, field: 'w', value: -1 },
    ] } })
    expect(st.getState().S.active.entries[0].sets[0]).toMatchObject({ w: 12.5, r: 9 })
  })
  it('does not apply changes to a replaced exercise', async () => {
    const st = store(); await applyWatchSession(st, { session: session() })
    const next = session(); next.seq = 2; next.entries[0].id = 'replacement'
    next.changes = [{ seq: 2, entry: 0, set: 0, field: 'w', value: 100 }]
    await applyWatchSession(st, { session: next })
    expect(st.getState().S.active.entries[0].sets[0].w).toBe(10)
  })
})
