// @vitest-environment happy-dom

/* The update from v1.3.9 while that app still owed the server a change (QA retest 2026-10-06): its
   offline setting, plan and note changes were undone on the first sync when another device had
   synced meanwhile, and pushed without stamps when none had. lib/sync-legacy.js. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ api: null }))
vi.mock('../lib/api.js', () => ({ api: (...a) => h.api(...a), setRemoteAuth: () => {} }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {}, stopRest: () => {}, abandonWork: () => {} }) } }))

const clone = v => JSON.parse(JSON.stringify(v))
const T = Date.UTC(2026, 9, 6, 8)
const W = (id, t) => ({ id, d: '2026-10-01', start: t, end: t + 3600e3, entries: [] })
const OWNER = 'u1'

// v1.3.9's fingerprint (lib/sync-changes.js at the v1.3.9 tag).
const NOT_CONTENT = new Set(['_ts', '_rev', 'active', 'workouts', 'bodyweight', 'routines', 'customEx'])
const hash = v => { const s = JSON.stringify(v) ?? ''; let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0 } return x.toString(36) }
function fp139(S) {
  const rest = {}
  for (const f of Object.keys(S).sort()) if (!NOT_CONTENT.has(f)) rest[f] = S[f]
  return { w: Object.fromEntries(S.workouts.map(w => [w.id, hash(w)])), b: {}, r: {}, c: {}, s: hash(rest) }
}

function server(doc) {
  const s = { doc: clone(doc), log: [] }
  h.api = async (path, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : undefined
    s.log.push({ method, path, body })
    if (method === 'GET' && path === '/api/data/rev') return { rev: s.doc._rev }
    if (method === 'GET' && path === '/api/data') return { state: clone(s.doc), rev: s.doc._rev }
    if (method === 'PUT' && path === '/api/data') {
      if (body.baseRev != null && body.baseRev !== s.doc._rev) throw Object.assign(new Error('conflict'), { status: 409, data: { error: 'conflict', rev: s.doc._rev, state: clone(s.doc) } })
      body.state._rev = s.doc._rev + 1
      s.doc = body.state
      return { ok: true, rev: s.doc._rev }
    }
    throw new Error('unexpected ' + method + ' ' + path)
  }
  return s
}

let DEF
// What v1.3.9 left in the browser: its copy with offline changes, owed, the marker of the revision
// it last synced and the fingerprint of that copy. No write id: that app never wrote one.
function leaveOldCopy(base, mut) {
  const fp = fp139(base)
  const old = clone(base); delete old._rev
  mut(old)
  localStorage.setItem('gym_owner', OWNER)
  localStorage.setItem('gym_user', JSON.stringify({ id: OWNER, name: 'Ana' }))
  localStorage.setItem('gym_state_v1', JSON.stringify(old))
  localStorage.setItem('gym_sync', JSON.stringify({ rev: base._rev, ts: base._ts }))
  localStorage.setItem('gym_synced_fp', JSON.stringify(fp))
  localStorage.setItem('gym_dirty', '1')
}
async function openApp() {
  vi.resetModules()
  const m = await import('./useStore.js')
  m.useStore.setState({ user: { id: OWNER, name: 'Ana' }, ready: true })
  return m.useStore
}

beforeEach(async () => {
  localStorage.clear()
  DEF = (await import('./useStore.js')).DEF
})
afterEach(() => localStorage.clear())

const baseDoc = () => ({ ...clone(DEF), _ts: T, _rev: 3, restSec: 90, week: { 1: 'r1' }, exNotes: { bench: 'old' }, workouts: [W('w1', T - 9e6), W('w2', T - 8e6)] })

describe('the first sync after the update from v1.3.9', () => {
  it('another device synced meanwhile: the old app\'s offline rest time, plan day and note are kept', async () => {
    const base = baseDoc()
    leaveOldCopy(base, s => { s.restSec = 140; s.week = { 1: 'r1', 3: 'r1' }; s.exNotes = { bench: 'new note' }; s._ts = T + 1000 })
    // an updated device logged a workout and turned the sound off, stamped
    const srvDoc = { ...clone(base), _rev: 4, _ts: T + 5000, sound: false, edited: { sound: T + 5000 }, workouts: [...base.workouts, W('w3x', T + 5000)] }
    const srv = server(srvDoc)
    const A = await openApp()
    await A.getState().pullState()
    for (const S of [srv.doc, A.getState().S]) {
      expect(S.restSec).toBe(140)
      expect(S.week).toEqual({ 1: 'r1', 3: 'r1' })
      expect(S.exNotes.bench).toBe('new note')
      expect(S.sound).toBe(false)
      expect(S.workouts.map(w => w.id).sort()).toEqual(['w1', 'w2', 'w3x'])
    }
    expect(localStorage.getItem('gym_legacy_owed')).toBe(null)
    expect(localStorage.getItem('gym_stash')).toBe(null)
  })

  it('both sides changed the same setting: the merge decides as before, and the old copy is kept aside', async () => {
    const base = baseDoc()
    leaveOldCopy(base, s => { s.restSec = 140; s._ts = T + 1000 })
    server({ ...clone(base), _rev: 4, _ts: T + 5000, restSec: 60, edited: { restSec: T + 5000 } })
    const A = await openApp()
    await A.getState().pullState()
    await new Promise(r => setTimeout(r, 20))
    const kept = Object.values(JSON.parse(localStorage.getItem('gym_stash')) || {})
    expect(kept).toHaveLength(1)
    expect(kept[0].name).toBe('This device, before the update')
    expect(kept[0].state.restSec).toBe(140)
  })

  it('nobody synced meanwhile: the push lets the server stamp what the old app changed', async () => {
    const base = baseDoc()
    leaveOldCopy(base, s => { s.restSec = 140; s._ts = T + 1000 })
    const srv = server(base)
    const A = await openApp()
    await A.getState().pullState()
    const put = srv.log.find(x => x.method === 'PUT')
    expect(put.body.stamped).toBe(false)
    expect(put.body.baseRev).toBe(3)
    expect(localStorage.getItem('gym_legacy_owed')).toBe(null)
    // and from here on this app stamps its own changes
    A.getState().update(s => { s.restSec = 150 })
    await A.getState().pushState()
    expect(srv.log.filter(x => x.method === 'PUT').at(-1).body.stamped).toBe(true)
  })

  it('a copy this app wrote is never taken for an old app\'s', async () => {
    const base = baseDoc()
    leaveOldCopy(base, s => { s.restSec = 140 })
    localStorage.setItem('gym_state_wid', 'abc')
    const srv = server(base)
    const A = await openApp()
    await A.getState().pullState()
    expect(srv.log.find(x => x.method === 'PUT').body.stamped).toBe(true)
  })
})
