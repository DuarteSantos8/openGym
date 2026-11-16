// @vitest-environment happy-dom

/* A device whose clock runs behind: every change it makes is stamped after the stamps of the copy
   it was made on (lib/sync-merge.js stampChange), so it wins over what it had already seen. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const AHEAD = Date.now() + 86400000   // stamps written by a device a day ahead

beforeEach(() => { localStorage.clear(); useStore.setState({ user: null, ready: true }) })
afterEach(() => { localStorage.clear() })

describe('update stamps after what the copy has seen', () => {
  it('settings, routines, workouts and removals all come after the newest stamp', () => {
    const S = { ...clone(DEF), _ts: AHEAD, restSec: 90, edited: { restSec: AHEAD },
      routines: [{ id: 'r1', name: 'A', ex: [], _ts: AHEAD }],
      workouts: [{ id: 'w1', d: '2026-10-06', start: 1, end: 2, entries: [], _ts: AHEAD }, { id: 'w2', d: '2026-10-06', start: 3, end: 4, entries: [] }] }
    useStore.setState({ S })
    useStore.getState().update(s => {
      s.restSec = 60
      s.routines[0].name = 'B'
      s.workouts[0].note = 'n'; s.workouts[0]._ts = Date.now()
      s.workouts = s.workouts.filter(w => w.id !== 'w2')
    })
    const n = useStore.getState().S
    expect(n.edited.restSec).toBeGreaterThan(AHEAD)
    expect(n.routines[0]._ts).toBeGreaterThan(AHEAD)
    expect(n.workouts[0]._ts).toBeGreaterThan(AHEAD)
    expect(n.deleted.workouts.w2).toBeGreaterThan(AHEAD)
    expect(n._ts).toBeGreaterThan(AHEAD)
  })
  // QA retest 2026-10-06: a weigh-in corrected on the phone that runs behind kept its raw clock
  // time and lost to the entry it had just corrected on the next merge.
  it('a weigh-in logged or corrected comes after the newest stamp too, and wins the merge', async () => {
    const { mergeStates } = await import('../lib/sync-merge.js')
    const S = { ...clone(DEF), _ts: AHEAD, bodyweight: [{ d: '2026-10-06', w: 80, t: AHEAD }] }
    useStore.setState({ S })
    useStore.getState().update(s => { s.bodyweight[0].w = 78.4; s.bodyweight[0].t = Date.now() })
    useStore.getState().update(s => { s.bodyweight.push({ d: '2026-10-07', w: 78.1, t: Date.now() }) })
    const n = useStore.getState().S
    expect(n.bodyweight[0].t).toBeGreaterThan(AHEAD)
    expect(n.bodyweight[1].t).toBeGreaterThan(AHEAD)
    const other = { ...clone(S), restSec: 120, edited: { restSec: AHEAD + 5 }, _ts: AHEAD + 5 }   // the laptop changed something else
    for (const m of [mergeStates(other, n), mergeStates(n, other)]) expect(m.bodyweight.map(e => e.w)).toEqual([78.4, 78.1])
  })

  it('a unit switch does not re-stamp weigh-ins it only converted', () => {
    const S = { ...clone(DEF), _ts: 100, bodyweight: [{ d: '2026-10-06', w: 80, t: 50 }] }
    useStore.setState({ S })
    useStore.getState().update(s => { s.bodyweight[0].w = 176.4 })
    expect(useStore.getState().S.bodyweight[0].t).toBe(50)
  })
})
