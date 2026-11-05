// @vitest-environment happy-dom

/* Engine contract 1 in the store (spec 15.1, 16): a v2 copy from before programmes ran through the
   engine is kept once as it was, upgraded, validated, read back through the sync's packing and only
   then swapped in, on load and on a pull; a failing upgrade keeps it. A marked copy never reaches a
   server that cannot read it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateProfileV1ToV2 } from '../../../api/migration/profile-migration.js'
import { validateCanonicalProfile } from '../../../api/migration/profile-validation.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'

const h = vi.hoisted(() => ({ api: null }))
vi.mock('../lib/api.js', () => ({ setAccessHeaders: vi.fn(), api: (...a) => h.api(...a), setRemoteAuth: () => {} }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {}, stopRest: () => {}, abandonWork: () => {} }) } }))

const BACKUP = 'gym_state_v1.pre-contract-1'
const clone = v => JSON.parse(JSON.stringify(v))
// A v2 profile as the app before contract 1 wrote it: today's programme shape, running since Monday.
function contract0(over = {}) {
  const { engineContractRevision, ...p } = migrateProfileV1ToV2({ unit: 'kg', weekStart: 1, routines: [{ id: 'A', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }], workouts: [] }, LIB_BY_ID).profile
  return {
    ...p, _ts: 100, week: { 1: ['A'] },
    programmes: { P: { id: 'P', name: 'Block', at: 1, days: { 1: ['A'] }, weeks: [{ rpe: 7, t: { '0025': { pct: 75 } } }, { deload: true }] } },
    programme: { id: 'P', startedOn: '2026-10-19', cycle: 1, bump: 0, saved: { week: { 2: ['A'] }, scheduleMode: null, rotation: null, pass: false } },
    ...over
  }
}
async function openApp() {
  vi.resetModules()
  return (await import('./useStore.js')).useStore
}

beforeEach(() => { localStorage.clear(); h.api = async () => { throw new Error('no server') } })
afterEach(() => localStorage.clear())

describe('the contract-1 upgrade of this copy', () => {
  it('a contract-0 v2 profile is backed up, upgraded, validated and swapped once; a failing upgrade keeps it', async () => {
    const source = contract0()
    localStorage.setItem('gym_state_v1', JSON.stringify(source))
    const S = (await openApp()).getState().S
    // Upgraded: the programme is a definition and the running one a run, with the notice to show.
    expect(S.engineContractRevision).toBe(1)
    expect(S.programmes.P).toMatchObject({ schedule: { mode: 'weeks', appts: [{ rid: 'A', day: 1 }] }, duration: { n: 2, unit: 'weeks' } })
    expect(S.programmeRuns[S.programme.runId]).toMatchObject({ programmeId: 'P', startedOn: '2026-10-19', tracks: { 't:P:A:o0': { ack: 'legacy' } } })
    expect(S.programme.saved).toEqual(source.programme.saved)
    expect(S.contractNotice.map(n => n.kind)).toContain('legacy-choices')
    expect(validateCanonicalProfile(S).ok).toBe(true)
    // The run freezes this device's timezone, and no setting changes for it: the reminder is the default one.
    expect(S.programmeRuns[S.programme.runId].tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(S.reminder).toEqual((await import('./useStore.js')).DEF.reminder)
    // The source kept once, as it was; the upgraded copy is what the browser holds now.
    expect(JSON.parse(localStorage.getItem(BACKUP))).toEqual(source)
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).engineContractRevision).toBe(1)
    // A second load finds nothing to do and leaves the backup alone.
    localStorage.setItem(BACKUP, 'first')
    const again = (await openApp()).getState().S
    expect(again.programmeRuns).toEqual(S.programmeRuns)
    expect(localStorage.getItem(BACKUP)).toBe('first')

    // A copy whose upgrade cannot validate stays exactly as it was, beside its backup, and says so.
    localStorage.clear()
    const broken = contract0({ refReviews: 'not a map' })
    localStorage.setItem('gym_state_v1', JSON.stringify(broken))
    const store = await openApp()
    expect(store.getState().S.engineContractRevision).toBeUndefined()
    expect(store.getState().S.programmes).toEqual(broken.programmes)
    expect(store.getState().migration).toMatchObject({ phase: 'error', reason: 'contract' })
    expect(JSON.parse(localStorage.getItem('gym_state_v1'))).toEqual(broken)
    expect(JSON.parse(localStorage.getItem(BACKUP))).toEqual(broken)
  })

  it('a pulled contract-0 copy is upgraded before it is taken', async () => {
    const store = await openApp()
    store.setState({ user: { id: 'u1' }, ready: true })
    const remote = { ...contract0(), _ts: 500, _rev: 2 }
    h.api = async (path, opts = {}) => {
      if ((opts.method || 'GET') === 'GET' && path === '/api/data') return { state: clone(remote), rev: 2 }
      throw new Error('unexpected ' + path)
    }
    await store.getState().pullState()
    const S = store.getState().S
    expect(S.engineContractRevision).toBe(1)
    expect(Object.keys(S.programmeRuns)).toHaveLength(1)
    expect(S.programmes.P.tracks).toHaveLength(1)
  })
})

describe('the server it syncs with', () => {
  it('a marked profile is not pushed to a server without engineContract', async () => {
    const store = await openApp()
    const puts = []
    h.api = async (path, opts = {}) => {
      if (opts.method === 'PUT') { puts.push(JSON.parse(opts.body)); return { ok: true, rev: 1 } }
      throw new Error('unexpected ' + path)
    }
    store.setState({ user: { id: 'u1' }, ready: true, config: { allow_guest: false } })
    store.getState().update(s => { s.restSec = 75 }, false)
    await store.getState().pushState()
    expect(puts).toHaveLength(0)
    expect(store.getState().syncBlocked).toBe('server-upgrade')
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    // The server is updated: the copy that waited goes, and the block is lifted.
    store.setState({ config: { allow_guest: false, engineContract: 1 } })
    await store.getState().pushState()
    expect(puts).toHaveLength(1)
    expect(store.getState().syncBlocked).toBeNull()
  })

  it('every request says which engine contract this build reads and writes', async () => {
    const { api } = await vi.importActual('../lib/api.js')
    const fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    try { await api('/api/data', { method: 'PUT', body: '{}' }) } finally { vi.unstubAllGlobals() }
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'X-OpenGym-Engine-Contract': '1', 'X-OpenGym-Engine-Schema': '2' })
  })
})
