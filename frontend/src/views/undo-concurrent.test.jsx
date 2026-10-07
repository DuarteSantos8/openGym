// @vitest-environment happy-dom
// RC review 2026-10-07: an Undo after a swipe beat a change another device made, offline, to the
// same list before it saw the removal: a routine's set count (exercise swiped out of the routine
// and put back), a reorder of the loop (a routine swiped out of it and put back), and with an
// older app (v1.3.9) a rename of the routine swiped away in Plan and put back. Undo means "as if
// nothing happened", so that change has to survive, on every device, in either merge order.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({}) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { deleteRoutineWithUndo, takeOutOfLoop } from './Plan.jsx'
import { removeRoutineExercise } from './RoutineEdit.jsx'
import { mergeStates, stampChange } from '../lib/sync-merge.js'
import { saveRotation } from '../lib/rotation.js'
import { stampPut } from '../../../api/sync-stamps.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const undo = () => useUI.getState().runToastAction()
const change = (prev, fn, wall) => { const next = clone(prev); fn(next); next._ts = stampChange(prev, next, wall); return next }
const T0 = Date.now() - 3_600_000
const ex = (id, sets) => ({ id, sets, reps: 8, weight: 40 })
const shared = () => {
  const base = Object.assign(clone(DEF), {
    _ts: T0 - 10_000,
    routines: [
      { id: 'a', name: 'Push', _ts: T0 - 10_000, ex: [ex('0025', 3), ex('0198', 3), ex('0586', 3)] },
      { id: 'b', name: 'Pull', _ts: T0 - 10_000, ex: [ex('0586', 3)] },
      { id: 'c', name: 'Legs', _ts: T0 - 10_000, ex: [ex('0198', 5)] },
    ],
    week: { 1: ['a', 'b'], 3: ['b'], 5: ['c'] },
  })
  // one stamped change, so the copy carries a record of edits like any copy from this version
  return change(base, s => { s.restSec = 100 }, T0 - 9_000)
}
const both = (x, y) => [mergeStates(x, y), mergeStates(y, x)]
// The device's clock, set per step: with the real one, steps a fast machine runs in the same
// millisecond got equal stamps (Node 22 on CI), and the order these tests are about was a tie.
const T1 = Date.now()
const clockAt = ms => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(ms) }

beforeEach(() => { localStorage.clear(); useStore.setState({ S: shared(), user: null }) })
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

describe('Undo of an exercise swiped out of a routine', () => {
  it('a set count changed offline on another device before it saw the removal survives', () => {
    const base = S()
    const other = change(base, s => { s.routines[0].ex[2].sets = 6 }, T0)   // offline, before the swipe
    removeRoutineExercise('a', 0)
    const removed = clone(S())                                             // what the server got
    undo()
    const here = S()
    expect(here.routines[0].ex.map(e => e.id)).toEqual(['0025', '0198', '0586'])
    for (const m of both(here, other)) {
      expect(m.routines[0].ex.map(e => `${e.id}x${e.sets}`)).toEqual(['0025x3', '0198x3', '0586x6'])
      // and every copy settles on it, the one still holding the removal included
      for (const n of both(m, removed)) expect(n.routines[0].ex.map(e => `${e.id}x${e.sets}`)).toEqual(['0025x3', '0198x3', '0586x6'])
      for (const n of both(m, here)) expect(n.routines[0].ex.map(e => `${e.id}x${e.sets}`)).toEqual(['0025x3', '0198x3', '0586x6'])
    }
    for (const m of both(mergeStates(here, removed), other)) expect(m.routines[0].ex[2].sets).toBe(6)
  })
  it('a change made after the other device saw the removal still loses to the Undo', () => {
    clockAt(T1)
    removeRoutineExercise('a', 0)
    const removed = clone(S())
    const other = change(removed, s => { s.routines[0].ex[1].sets = 9 }, T1 + 1000)   // on the list without it
    clockAt(T1 + 2000)
    undo()
    for (const m of both(S(), other)) expect(m.routines[0].ex.map(e => `${e.id}x${e.sets}`)).toEqual(['0025x3', '0198x3', '0586x3'])
  })
  it('a change on the removal stamped the same as the Undo loses to it on every device', () => {
    // both clocks behind, so both lifted to one past the removal's stamp (stampChange)
    clockAt(T1)
    removeRoutineExercise('a', 0)
    const removed = clone(S())
    const other = change(removed, s => { s.routines[0].ex[1].sets = 9 }, T1 - 5000)
    undo()
    expect(S().routines[0]._ts).toBe(other.routines[0]._ts)
    for (const m of both(S(), other)) expect(m.routines[0].ex.map(e => `${e.id}x${e.sets}`)).toEqual(['0025x3', '0198x3', '0586x3'])
  })
  it('an Undo after another edit of the routine puts the exercise back without claiming the rest', () => {
    removeRoutineExercise('a', 0)
    useStore.getState().update(s => { s.routines[0].ex[0].sets = 4 })
    undo()
    expect(S().routines[0].ex.map(e => `${e.id}x${e.sets}`)).toEqual(['0025x3', '0198x4', '0586x3'])
    expect(S().routines[0]._u).toBeUndefined()
  })
})

describe('Undo of a routine swiped out of the loop', () => {
  const loop = s => s.queue?.ids?.join(',')
  const setSeq = ids => useStore.getState().update(s => { saveRotation(s, ids, 'Loop') })
  const reorder = s => { const ids = ['c', 'a', 'b']; s.rotation = { ...s.rotation, sequence: ids }; s.queue = { ...s.queue, ids } }
  beforeEach(() => {
    clockAt(T1)
    useStore.getState().update(s => { s.scheduleMode = 'rotation'; saveRotation(s, ['a', 'b', 'c'], 'Loop') })
  })
  it('a reorder made offline on another device before it saw the removal survives', () => {
    const base = clone(S())
    const other = change(base, reorder, T1 + 1000)
    clockAt(T1 + 2000)
    expect(takeOutOfLoop('b', setSeq, ['a', 'b', 'c'], 'Loop')).toBe(true)
    const removed = clone(S())
    clockAt(T1 + 3000)
    undo()
    expect(loop(S())).toBe('a,b,c')
    for (const m of both(S(), other)) {
      expect(loop(m)).toBe('c,a,b')
      expect(m.rotation.sequence.join(',')).toBe('c,a,b')
      for (const n of both(m, removed)) expect(loop(n)).toBe('c,a,b')
    }
  })
  it('a reorder on the removal stamped the same as the Undo loses to it on every device', () => {
    clockAt(T1 + 2000)
    expect(takeOutOfLoop('b', setSeq, ['a', 'b', 'c'], 'Loop')).toBe(true)
    const other = change(clone(S()), reorder, T1)   // clock behind: lifted past the removal
    undo()
    expect(S().edited.queue).toBe(other.edited.queue)
    for (const m of both(S(), other)) {
      expect(loop(m)).toBe('a,b,c')
      expect(m.rotation.sequence.join(',')).toBe('a,b,c')
    }
  })
})

describe('Undo of a routine swiped away in Plan, with an older app (v1.3.9) on the account', () => {
  // v1.3.9's merge keeps a routine whole, the version with the later `_ts`, and stamps nothing
  // but `_ts` (lib/sync-merge.js of v1.3.9).
  const v139Merge = (local, server) => {
    const n = (server._ts || 0) > (local._ts || 0) ? server : local, o = n === local ? server : local
    const out = clone(n)
    const other = new Map(o.routines.map(r => [r.id, r]))
    out.routines = [...n.routines, ...o.routines.filter(r => !n.routines.some(x => x.id === r.id))]
      .map(r => { const alt = other.get(r.id); return clone(alt && (alt._ts || 0) > (r._ts || 0) ? alt : r) })
    out._ts = Math.max(local._ts || 0, server._ts || 0)
    return out
  }
  it('a rename made there offline before the removal survives the Undo', () => {
    const base = S()
    const old = clone(base)
    old.routines[1].name = 'Pull heavy'; old.routines[1]._ts = T0; old._ts = T0   // v1.3.9, offline
    deleteRoutineWithUndo('b')
    undo()
    const server = clone(S())
    // v1.3.9 comes back: 409, its merge, its push over that revision
    const pushed = v139Merge(old, server)
    stampPut(server, pushed, { overRead: true, stamped: false, now: Date.now() + 1 })
    expect(pushed.routines.find(r => r.id === 'b').name).toBe('Pull heavy')
    for (const m of both(S(), pushed)) {
      expect(m.routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
      expect(m.routines.find(r => r.id === 'b').name).toBe('Pull heavy')
      expect(m.week[3]).toEqual(['b'])
    }
  })
  // RC verify 2026-10-07: a routine with no edit time (the seed's, a template's, one from before
  // stamps and never edited since) was stamped "now" by the Undo, the newer version to v1.3.9.
  it('a rename made there offline survives the Undo of a routine that had no edit time', () => {
    useStore.setState({ S: (() => { const s = clone(S()); delete s.routines[1]._ts; return s })() })
    const base = S()
    const old = clone(base)
    old.routines[1].name = 'Pull heavy'; old.routines[1]._ts = T0; old._ts = T0   // v1.3.9, offline
    deleteRoutineWithUndo('b')
    undo()
    expect(S().routines.find(r => r.id === 'b')._ts).toBeUndefined()
    const server = clone(S())
    const pushed = v139Merge(old, server)
    stampPut(server, pushed, { overRead: true, stamped: false, now: Date.now() + 1 })
    expect(pushed.routines.find(r => r.id === 'b').name).toBe('Pull heavy')
    for (const m of both(S(), pushed)) {
      expect(m.routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
      expect(m.routines.find(r => r.id === 'b').name).toBe('Pull heavy')
      expect(m.week[3]).toEqual(['b'])
    }
  })
  it('a weekday another device changed before it saw the removal survives the Undo', () => {
    const other = change(S(), s => { s.week[3] = ['b', 'c'] }, Date.now() - 1000)
    deleteRoutineWithUndo('b')
    const removed = clone(S())
    undo()
    for (const m of both(S(), other)) {
      expect(m.week[3]).toEqual(['b', 'c'])
      expect(m.week[1]).toEqual(['a', 'b'])
      for (const n of both(m, removed)) expect(n.routines.map(r => r.id)).toEqual(['a', 'b', 'c'])
    }
  })
})
