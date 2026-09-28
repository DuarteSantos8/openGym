// @vitest-environment happy-dom

/* Where the sync rules meet the plan rules. A routine edit carries its own edit time (`_ts`,
   stampRoutines) so a conflict keeps the version edited last; a logged session carries the plan
   it was built from (`planned`) and the routine it belongs to (`rid`), so the next session can
   tell an edited plan from a progressed one and start again from the edit. Each only works if
   the other's data survives: a merge that dropped `planned` would progress an edited plan as
   though nothing changed, and one that kept the stale routine would restart nothing at all.
   Every session here is started and finished the way the app does it (buildCombinedEntries →
   buildCompletedWorkout), and every sync goes through the store. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { buildCombinedEntries } from '../lib/session-merge.js'
import { buildCompletedWorkout } from '../lib/finish-workout.js'
import { convertWeight } from '../lib/units.js'
import { isWarmupRow } from '../lib/workout-model.js'

const BENCH = '0025'   // barbell bench press — loaded, 2.5 kg step
const PLAN_CHANGED = 'Plan changed — starting from your new target.'
const clone = value => JSON.parse(JSON.stringify(value))
const work = e => e.sets.filter(s => !isWarmupRow(s))
const rows = e => work(e).map(s => [s.w, s.r])
const start = (st, rids = ['A']) => buildCombinedEntries(st, rids).entries
const benchOf = st => st.routines.find(r => r.id === 'A').ex.find(c => c.id === BENCH)
const httpError = (status, data = {}) => Object.assign(new Error(data.error || 'HTTP ' + status), { status, data })
const netError = () => new TypeError('Failed to fetch')
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const signedIn = S => useStore.setState({ S, user: USER, ready: true, sync: { ...fresh } })

// One routine, "Push": bench 3 × 5 at 100 kg, edited last at `_ts` 100.
const withPlan = (over = {}) => ({
  ...clone(DEF), _ts: 100,
  routines: [{ id: 'A', name: 'Push', _ts: 100, ex: [{ id: BENCH, sets: 3, reps: 5, weight: 100 }] }],
  ...over,
})

// Train the routine for real: start it, tick every row (optionally at another weight), finish.
let day = 1
function train(st, typed = {}) {
  const entries = start(st).map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, ...(isWarmupRow(s) ? {} : typed), done: true })) }))
  const d = `2026-08-${String(day).padStart(2, '0')}`
  const active = { id: 'w' + day, d, start: day * 1000, routineIds: ['A'], name: 'Push', entries }
  day++
  st.workouts.push(buildCompletedWorkout(active, { end: active.start + 1 }))
  return st.workouts.at(-1)
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gym_owner', USER.id)
  api.mockReset(); toast.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh } })
})
afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh } })
})

describe('a plan edited on this device', () => {
  it('carries its edit time, and the next session starts again from the new sets and reps', () => {
    const S = withPlan()
    train(S)
    signedIn(S)

    useStore.getState().update(s => { s.restSec = 75 })
    expect(useStore.getState().S.routines[0]._ts).toBe(100)   // not a plan edit

    useStore.getState().update(s => { const c = benchOf(s); c.sets = 2; c.reps = 10 })
    const after = useStore.getState().S
    expect(after.routines[0]._ts).toBeGreaterThan(100)
    const [e] = start(after)
    expect(e.plan.why[0]).toBe(PLAN_CHANGED)
    expect(rows(e)).toEqual([[100, 10], [100, 10]])
    expect(e.planned).toMatchObject({ sets: 2, reps: 10 })
  })
})

describe('a conflict between the plan edit and a session logged at the old plan', () => {
  // Both devices start from the same copy: one session logged at 3 × 5.
  const shared = () => { const S = withPlan({ workouts: [] }); train(S); return S }

  it('edit on the other device, session here: the edit is kept and the session keeps its routine and plan', async () => {
    const base = shared()
    const here = { ...clone(base), _ts: 300 }            // the newer copy overall …
    const logged = train(here)                            // … because a session was logged at 3 × 5
    const there = clone(base)
    Object.assign(benchOf(there), { sets: 2, reps: 10 })
    there.routines[0]._ts = 250                           // … while the plan was edited over there
    there._ts = 200
    signedIn(here)
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...there, _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    expect(puts()).toHaveLength(2)
    for (const S of [puts()[1].state, useStore.getState().S]) {
      expect(benchOf(S)).toMatchObject({ sets: 2, reps: 10 })
      expect(S.routines[0]._ts).toBe(250)
      const entry = S.workouts.find(w => w.id === logged.id).entries[0]
      expect(entry.rid).toBe('A')
      expect(entry.planned).toMatchObject({ sets: 3, reps: 5, weight: 100 })
    }
    const [e] = start(useStore.getState().S)
    expect(e.plan.why[0]).toBe(PLAN_CHANGED)
    const lifted = work(logged.entries[0])[0].w
    expect(rows(e)).toEqual([[lifted, 10], [lifted, 10]])
  })

  it('edit here, session on the other device: the same, from the other side', async () => {
    const base = shared()
    signedIn({ ...clone(base) })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    useStore.getState().update(s => { const c = benchOf(s); c.sets = 2; c.reps = 10 })
    const editedAt = useStore.getState().S.routines[0]._ts
    const there = { ...clone(base) }
    const logged = train(there)
    there._ts = Date.now() + 60_000                       // the newer copy overall
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...there, _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    const S = useStore.getState().S
    expect(puts()[1].state.routines[0]).toMatchObject({ _ts: editedAt, ex: [{ sets: 2, reps: 10 }] })
    expect(S.workouts.map(w => w.id)).toContain(logged.id)
    const entry = S.workouts.find(w => w.id === logged.id).entries[0]
    expect(entry).toMatchObject({ rid: 'A', planned: { sets: 3, reps: 5 } })
    const [e] = start(S)
    expect(e.plan.why[0]).toBe(PLAN_CHANGED)
    expect(work(e).map(s => s.r)).toEqual([10, 10])
  })
})

describe('converting the numbers to lb', () => {
  it('converts the plan stamped on each session with the routine, so an edit of the reps holds the weight last lifted', () => {
    const S = withPlan()
    train(S, { w: 110 })   // the plan says 100, the bar held 110
    useStore.setState({ S, user: null, ready: true })

    // What Settings → Units → "Convert the numbers" does.
    useStore.getState().setUnit('lb')
    const lb = useStore.getState().S
    expect(lb.workouts[0].entries[0].planned.weight).toBe(benchOf(lb).weight)
    expect(benchOf(lb).weight).toBe(convertWeight(100, 'kg', 'lb'))
    // Unedited, the plan is not read as changed by the conversion.
    expect(start(lb)[0].plan.why[0]).not.toBe(PLAN_CHANGED)

    useStore.getState().update(s => { benchOf(s).reps = 8 })
    const [e] = start(useStore.getState().S)
    expect(e.plan.why[0]).toBe(PLAN_CHANGED)
    // Had the stamp stayed at 100 (kg) against a routine at 220.5 (lb), the weight would have
    // looked edited too, and the session would open at the plan's 220.5 instead.
    const lifted = convertWeight(110, 'kg', 'lb')
    expect(rows(e)).toEqual([[lifted, 8], [lifted, 8], [lifted, 8]])
  })
})

describe('changes kept aside by a forced sign-out', () => {
  it('carry the planned-sessions setting and the edited routine, and bring both back on the next sign-in', async () => {
    signedIn(withPlan({ workouts: [] }))
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ rev: 1 })   // a check in step: the fingerprint of rev 1 is taken
    window.dispatchEvent(new Event('online'))
    await new Promise(r => setTimeout(r, 10))

    useStore.getState().update(s => { s.startFrom = 'last'; benchOf(s).reps = 8 })
    const edited = clone(useStore.getState().S.routines[0])
    // A setting and a routine: two changes the server has not seen.
    expect(useStore.getState().unsyncedChanges()).toEqual({ owed: true, count: 2 })

    api.mockReset()
    api.mockRejectedValue(netError())
    expect(await useStore.getState().signOut({ force: true })).toEqual({ owed: true, count: 2, stashed: true })
    expect(useStore.getState().S.startFrom).toBe('plan')   // the copy is gone …
    const [kept] = Object.values(JSON.parse(localStorage.getItem('gym_stash')))
    expect(kept.state.startFrom).toBe('last')              // … and kept here
    expect(kept.state.routines).toEqual([edited])

    // Back to the same account: the server still has the plan as it was, and a routine the
    // other device added meanwhile.
    const server = withPlan({ _ts: 50, _rev: 2 })
    server.routines.push({ id: 'B', name: 'Pull', _ts: 60, ex: [] })
    api.mockReset()
    api.mockImplementation(async (path, o) => (o?.method === 'PUT' ? { ok: true, rev: 3 } : { state: clone(server), rev: 2 }))
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(async () => false)

    for (const S of [useStore.getState().S, puts().at(-1).state]) {
      expect(S.startFrom).toBe('last')
      expect(S.routines.map(r => r.id).sort()).toEqual(['A', 'B'])
      expect(S.routines.find(r => r.id === 'A')).toEqual(edited)
    }
    expect(localStorage.getItem('gym_stash')).toBeNull()
  })
})
