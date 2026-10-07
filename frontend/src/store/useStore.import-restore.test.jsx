// @vitest-environment happy-dom

/* Restoring a backup is how a mistake is undone, so what the backup holds must come back and stay,
   though it was deleted since (QA 2026-10-06): the removal record used to delete it again, at once
   with "Merge them in" and on the next conflict of any other device with "Replace". And the
   replace must not wipe what another device synced while the confirm was open. The server below
   answers like api/server.js (409 with the current document on a stale baseRev). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { mergeStates, stampChange } from '../lib/sync-merge.js'

const clone = v => JSON.parse(JSON.stringify(v))
const ids = xs => (xs || []).map(x => x.id).sort()
const workout = (id, t) => ({ id, d: '2026-09-20', start: t - 3600e3, end: t, entries: [] })
const httpError = (status, data) => Object.assign(new Error('HTTP ' + status), { status, data })
const T = Date.now() - 86400e3

let doc
const serve = () => api.mockImplementation(async (path, o = {}) => {
  const body = o.body ? JSON.parse(o.body) : null
  if ((o.method || 'GET') === 'GET') return { state: clone(doc), rev: doc._rev }
  if (o.method === 'PUT') {
    if (body.baseRev != null && body.baseRev !== doc._rev) throw httpError(409, { error: 'conflict', rev: doc._rev, state: clone(doc) })
    doc = { ...body.state, _rev: doc._rev + 1 }
    return { ok: true, rev: doc._rev }
  }
  throw new Error('unexpected ' + path)
})
const change = (prev, mut, wall = Date.now() - 60000) => { const n = clone(prev); mut(n); n._ts = stampChange(prev, n, wall); return n }

let backup, other
beforeEach(() => {
  localStorage.clear(); api.mockReset(); toast.mockReset()
  // w1..w3 logged and synced; the backup holds them; w4 logged; then w2 deleted (on this device)
  const synced = { ...clone(DEF), _ts: T, workouts: [workout('w1', T - 3e6), workout('w2', T - 2e6), workout('w3', T - 1e6)] }
  backup = clone(synced)
  const withW4 = change(synced, S => { S.workouts.push(workout('w4', Date.now() - 5000)) })
  const now = change(withW4, S => { S.workouts = S.workouts.filter(w => w.id !== 'w2') })
  doc = { ...clone(now), _rev: 5 }
  other = clone(now)   // device B, synced to rev 5, then offline with an unsent change
  other = change(other, S => { S.workouts.push(workout('w5', Date.now() - 1000)) })
  localStorage.setItem('gym_sync', JSON.stringify({ rev: 5, ts: now._ts }))
  useStore.setState({ S: clone(now), user: { id: 'u1' }, ready: true, sync: { offline: false, pending: false, lastSynced: 0 } })
  serve()
})
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('a restored backup brings back what it holds, and it stays', () => {
  it('"Merge them in" restores a deleted workout, on the server and on a stale device', async () => {
    const c = await useStore.getState().importConflict(backup)
    useStore.getState().importBackup(backup, { mergeWith: c || { state: clone(doc), rev: doc._rev } })
    await useStore.getState().pushState()
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(ids(doc.workouts)).toEqual(['w1', 'w2', 'w3', 'w4'])
    // B comes back online: its push gets the 409 and it merges the server's copy
    expect(ids(mergeStates(other, doc).workouts)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])
  })

  it('"Replace" restores it too, and a stale device with an unsent change does not delete it again', async () => {
    await useStore.getState().importConflict(backup)
    useStore.getState().importBackup(backup)
    await useStore.getState().pushState()
    expect(ids(doc.workouts)).toEqual(['w1', 'w2', 'w3'])
    // RC review 2026-10-07: w4, which the replace dropped, came back from B's unsent change. The
    // replace now records what it replaced, like a reset: w4 stays gone, while w5, which only B
    // knew of, stays.
    expect(ids(mergeStates(other, doc).workouts)).toEqual(['w1', 'w2', 'w3', 'w5'])
    expect(ids(mergeStates(doc, other).workouts)).toEqual(['w1', 'w2', 'w3', 'w5'])
  })

  it('"Replace" wins over another device\'s older unsent edit of an entry it replaces, not over a later one', async () => {
    // the server's w3 was corrected after the backup was made; B, offline, changed its note too
    doc.workouts = doc.workouts.map(w => (w.id === 'w3' ? { ...w, note: 'server', _ts: T + 10, _f: { note: T + 10 } } : w))
    other = change(other, S => { const w = S.workouts.find(x => x.id === 'w3'); w.note = 'B before'; w._ts = Date.now() })
    await useStore.getState().importConflict(backup)
    useStore.getState().importBackup(backup)
    await useStore.getState().pushState()
    let m = mergeStates(other, doc)
    expect(m.workouts.find(w => w.id === 'w3').note).toBeUndefined()   // the backup's w3, as it was
    // a change B makes after the replace, and a workout it logs then, still win
    const later = change(other, S => { S.workouts.find(x => x.id === 'w3').note = 'B after'; S.workouts.find(x => x.id === 'w3')._ts = Date.now() + 60000
      S.workouts.push(workout('w7', Date.now() + 60000)) }, Date.now() + 60000)
    for (m of [mergeStates(later, doc), mergeStates(doc, later)]) {
      expect(m.workouts.find(w => w.id === 'w3').note).toBe('B after')
      expect(ids(m.workouts)).toEqual(['w1', 'w2', 'w3', 'w5', 'w7'])
    }
  })

  it('the backup\'s settings win over an older unsent setting change on another device', async () => {
    other = change(other, S => { S.restSec = 45 })
    backup.restSec = 150
    await useStore.getState().importConflict(backup)
    useStore.getState().importBackup(backup)
    await useStore.getState().pushState()
    expect(mergeStates(other, doc).restSec).toBe(150)
  })

  it('a workout another device synced while the confirm was open is kept, and that is said', async () => {
    await useStore.getState().importConflict(backup)
    // the other device syncs w6 while the sheet is open
    doc = { ...clone(doc), workouts: [...doc.workouts, workout('w6', Date.now())], _rev: doc._rev + 1 }
    useStore.getState().importBackup(backup)
    await useStore.getState().pushState()
    expect(ids(doc.workouts)).toContain('w6')
    expect(ids(doc.workouts)).toEqual(expect.arrayContaining(['w1', 'w2', 'w3']))
    await vi.waitFor(() => expect(toast).toHaveBeenCalled())
  })
})
