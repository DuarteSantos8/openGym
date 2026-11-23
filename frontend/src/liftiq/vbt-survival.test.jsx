// @vitest-environment happy-dom
// LIFTIQ-FORK: `set.vbt` must survive finishing the workout, the sync merge and a JSON backup round trip,
// so an upstream change that starts whitelisting set keys is caught when the fork is rebased.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => { throw new Error('offline') }), setRemoteAuth: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { DEF, useStore } from '../store/useStore.js'
import { buildCompletedWorkout } from '../lib/finish-workout.js'
import { mergeStates, stampWorkout } from '../lib/sync-merge.js'
import { readBackupFile } from '../lib/backup-media.js'
import { sanitizeVbt } from './sanitize.js'

const clone = v => JSON.parse(JSON.stringify(v))
const VBT = sanitizeVbt({
  src: 'liftiq', repsWithSetup: 6, repsNoSetup: 5, setupIncluded: false, mpv: 0.72, vlPct: 12.3,
  pv: [0.73, 0.8, 0.66, 0.6, 0.59], upCm: 33, fw: 'sim-0.1', pkg: '0.1.0', at: 1790000000000,
})

const activeWith = vbt => ({
  id: 'active', name: 'Test', start: 1790000000000, cur: 0,
  entries: [{ id: '0025', target: { mode: 'reps', reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true, at: 1790000100000, vbt }, { w: 60, r: 5, done: false }] }],
})

describe('set.vbt survives', () => {
  it('finishing the workout (buildCompletedWorkout)', () => {
    const done = buildCompletedWorkout(activeWith(VBT), { end: 1790000600000, prs: [] })
    expect(done.entries[0].sets[0].vbt).toEqual(VBT)
    expect(done.entries[0].sets[1].vbt).toBeUndefined()
  })

  it('the sync merge, from either side and for a workout only one device has', () => {
    const base = Object.assign(clone(DEF), { _ts: 1.79e12 })
    const done = buildCompletedWorkout(activeWith(VBT), { end: 1790000600000, prs: [] })
    const withIt = { ...clone(base), workouts: [{ ...done, id: 'w1' }] }
    const without = { ...clone(base), _ts: 1.79e12 + 5, workouts: [] }
    expect(mergeStates(withIt, without).workouts.find(w => w.id === 'w1').entries[0].sets[0].vbt).toEqual(VBT)
    expect(mergeStates(without, withIt).workouts.find(w => w.id === 'w1').entries[0].sets[0].vbt).toEqual(VBT)
  })

  it('the sync merge of the same workout edited on both devices (the newer edit wins whole)', () => {
    const done = { ...buildCompletedWorkout(activeWith(VBT), { end: 1790000600000, prs: [] }), id: 'w1' }
    const older = stampWorkout(clone(done), 1.79e12 + 10)
    const edited = clone(done)
    edited.entries[0].sets[0].r = 6
    const newer = stampWorkout(edited, 1.79e12 + 20)
    const a = { ...clone(DEF), _ts: 1.79e12 + 10, workouts: [older] }
    const b = { ...clone(DEF), _ts: 1.79e12 + 20, workouts: [newer] }
    for (const merged of [mergeStates(a, b), mergeStates(b, a)]) {
      const set = merged.workouts.find(w => w.id === 'w1').entries[0].sets[0]
      expect(set.r).toBe(6)
      expect(set.vbt).toEqual(VBT)
    }
  })

  describe('a JSON backup round trip (Export backup, Import backup)', () => {
    beforeEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: true }) })
    afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

    it('keeps vbt in the store and in what the store saved', async () => {
      const done = { ...buildCompletedWorkout(activeWith(VBT), { end: 1790000600000, prs: [] }), id: 'w1', d: '2026-11-23' }
      const P = Object.assign(clone(DEF), { _ts: 1.79e12, workouts: [done] })
      const file = new File([JSON.stringify(P, null, 2)], 'opengym-backup.json', { type: 'application/json' })
      const { state } = await readBackupFile(file)
      useStore.getState().importBackup(state)
      const S = useStore.getState().S
      expect(S.workouts.find(w => w.id === 'w1').entries[0].sets[0].vbt).toEqual(VBT)
      const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
      expect(saved.workouts.find(w => w.id === 'w1').entries[0].sets[0].vbt).toEqual(VBT)
    })
  })

  it('a stored vbt stays small: no raw trace in the state', () => {
    expect(JSON.stringify(VBT).length).toBeLessThanOrEqual(300)
  })
})
