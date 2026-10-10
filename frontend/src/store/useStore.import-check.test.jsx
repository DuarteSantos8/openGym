// @vitest-environment happy-dom

/* QA, v1.3.9: importing a backup replaced the server copy outright, and a workout another device
   had synced meanwhile was gone. The import stays a deliberate replace, but the server is asked
   first: what it holds that the backup does not is said in the confirm, with the choice to merge
   it in (views/Settings.jsx doImport). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { buildSessionExposures } from '../lib/session-start.js'
import { entriesForExposures } from '../lib/session-ui-adapter.js'
import { ruleOccurrence } from '../lib/test-fixtures.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ids = xs => (xs || []).map(x => x.id)
const workout = (id, d = '2026-09-20') => ({ id, d, start: 1, end: 2, exposures: [] })
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const signedIn = (S, rev) => {
  localStorage.setItem('gym_sync', JSON.stringify({ rev, ts: S._ts }))
  useStore.setState({ S, user: { id: 'u1' }, ready: true, sync: { offline: false, pending: false, lastSynced: 0 } })
}
const BACKUP = { ...clone(DEF), _ts: 50, restSec: 120, workouts: [workout('w1'), workout('w2')] }
const SERVER = { ...clone(DEF), _ts: 300, restSec: 60, workouts: [workout('w1'), workout('w2'), workout('elsewhere', '2026-09-26')], _rev: 7 }

beforeEach(() => { localStorage.clear(); api.mockReset() })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('importing a backup over a profile that moved on', () => {
  it('names the workouts on the server that the backup lacks', async () => {
    signedIn({ ...clone(DEF), _ts: 200, workouts: [workout('w1')] }, 6)
    api.mockResolvedValueOnce({ state: clone(SERVER), rev: 7 })
    const c = await useStore.getState().importConflict(BACKUP)
    expect(c).toMatchObject({ workouts: 1, rev: 7 })
  })

  it('nothing to say when the backup has everything, when signed out, or when the server cannot be asked', async () => {
    signedIn(clone(DEF), 6)
    api.mockResolvedValueOnce({ state: clone(BACKUP), rev: 7 })
    expect(await useStore.getState().importConflict(BACKUP)).toBeNull()
    api.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await useStore.getState().importConflict(BACKUP)).toBeNull()
    useStore.setState({ user: null })
    expect(await useStore.getState().importConflict(BACKUP)).toBeNull()
  })

  it('"Merge them in" keeps the backup\'s settings and every workout of both, pushed against the server\'s revision', async () => {
    signedIn({ ...clone(DEF), _ts: 200, workouts: [workout('w1')] }, 6)
    api.mockResolvedValueOnce({ state: clone(SERVER), rev: 7 })
    const c = await useStore.getState().importConflict(BACKUP)
    api.mockResolvedValueOnce({ ok: true, rev: 8 })
    useStore.getState().importBackup(BACKUP, { mergeWith: c })
    await useStore.getState().pushState()
    const put = puts().at(-1)
    expect(put.baseRev).toBe(7)
    expect(ids(put.state.workouts)).toEqual(['w1', 'w2', 'elsewhere'])
    expect(put.state.restSec).toBe(120)
  })

  // Review of 771184c9: a workout logged here and not yet sent was neither counted nor merged.
  it('counts this device\'s unsent workouts too, and "Merge them in" keeps them', async () => {
    signedIn({ ...clone(DEF), _ts: 200, workouts: [workout('w1')] }, 7)
    useStore.getState().update(s => { s.workouts.push(workout('unsent', '2026-09-27')) })
    api.mockResolvedValueOnce({ state: clone(SERVER), rev: 7 })
    const c = await useStore.getState().importConflict(BACKUP)
    expect(c).toMatchObject({ workouts: 2, local: true })   // 'elsewhere' on the server, 'unsent' here
    api.mockResolvedValueOnce({ ok: true, rev: 8 })
    useStore.getState().importBackup(BACKUP, { mergeWith: c })
    await useStore.getState().pushState()
    expect(ids(puts().at(-1).state.workouts)).toEqual(['w1', 'w2', 'elsewhere', 'unsent'])
  })

  it('"Replace anyway" replaces, against the revision the check read (or the copy\'s own)', async () => {
    signedIn({ ...clone(DEF), _ts: 200, workouts: [workout('w1')] }, 6)
    api.mockResolvedValueOnce({ state: clone(SERVER), rev: 7 })
    await useStore.getState().importConflict(BACKUP)
    api.mockResolvedValueOnce({ ok: true, rev: 8 })
    useStore.getState().importBackup(BACKUP)
    await useStore.getState().pushState()
    let put = puts().at(-1)
    expect(put.baseRev).toBe(7)
    expect(ids(put.state.workouts)).toEqual(['w1', 'w2'])
    // no check before it (the server could not be asked): the copy's own revision
    api.mockResolvedValueOnce({ ok: true, rev: 9 })
    useStore.getState().importBackup(BACKUP)
    await useStore.getState().pushState()
    put = puts().at(-1)
    expect(put.baseRev).toBe(8)
  })
})

// RC review 2026-10-07: a backup imported mid-workout dropped the workout running on this device.
// "Merge them in" set the backup's `active` (none) over it, and the replace took the backup's
// whole copy, `active` included. A running session lives on this device only, so no backup or
// server copy can stand in for it: it stays, in the unit of the copy that replaces this one.
describe('a backup imported while a workout is running', () => {
  const running = { id: 'run', d: '2026-09-20', start: 1000, cur: 0, exposures: [], entries: [{ id: 'bench', sets: [{ w: 100, r: 5, done: true }] }] }
  it('"Merge them in" keeps the running workout', async () => {
    signedIn({ ...clone(DEF), _ts: 200, workouts: [workout('w1')] }, 6)
    useStore.getState().setActive(clone(running))
    api.mockResolvedValueOnce({ state: clone(SERVER), rev: 7 })
    const c = await useStore.getState().importConflict(BACKUP)
    useStore.getState().importBackup(BACKUP, { mergeWith: c })
    expect(useStore.getState().A).toEqual(running)
  })
  it('"Replace anyway" and the plain import keep it too', async () => {
    signedIn({ ...clone(DEF), _ts: 200, workouts: [workout('w1')] }, 6)
    useStore.getState().setActive(clone(running))
    api.mockResolvedValueOnce({ state: clone(SERVER), rev: 7 })
    await useStore.getState().importConflict(BACKUP)
    useStore.getState().importBackup(BACKUP)
    expect(useStore.getState().A).toEqual(running)
    useStore.setState({ user: null })
    useStore.getState().importBackup({ ...BACKUP, active: null })
    expect(useStore.getState().A).toEqual(running)
  })
  it('in the backup\'s unit when the backup is in another one', async () => {
    signedIn({ ...clone(DEF), _ts: 200, unit: 'kg', workouts: [workout('w1')] }, 6)
    useStore.getState().setActive(clone(running))
    useStore.setState({ user: null })
    useStore.getState().importBackup({ ...BACKUP, unit: 'lb' })
    const { S, A } = useStore.getState()
    expect(S.unit).toBe('lb')
    expect(A.start).toBe(1000)
    expect(A.entries[0].sets[0].w).not.toBe(100)
  })
  it('a backup taken mid-workout still brings its session when none runs here', async () => {
    signedIn({ ...clone(DEF), _ts: 200, workouts: [workout('w1')] }, 6)
    useStore.setState({ user: null })
    // A real session: the import checks that its entries and exposures agree and that its prescriptions are in the backup.
    const profile = { ...clone(DEF), routines: [] }
    const exposures = buildSessionExposures(profile, { id: 'r1', name: 'Push', ex: [ruleOccurrence('0025')] }, { now: 1000, newId: seed => seed, unit: 'kg' })
    const midWorkout = { id: 'run', d: '2026-09-20', start: 1000, cur: 0, name: 'Push', routineIds: ['r1'], exposures, entries: entriesForExposures(exposures, profile.prescriptions).map(e => ({ ...e, target: { ...e.target, mode: 'reps' } })) }
    useStore.getState().importBackup({ ...BACKUP, prescriptions: profile.prescriptions, active: clone(midWorkout) })
    expect(useStore.getState().A?.id).toBe('run')
  })
})
