// @vitest-environment happy-dom

/* #923: an equipment profile's machine list goes into a backup with the profile and comes back
   out of it, whether the import replaces this copy or merges the server's into it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const gym = machines => ({ id: 'gym', name: 'Gym', equipment: ['leverage machine', 'sled machine'], accV: 2, ...(machines ? { machines } : {}) })
const BACKUP = { ...clone(DEF), _ts: 50, equipProfiles: [gym(['leg-press', 'lat-pulldown'])], activeEquipId: 'gym', equipFilterOn: true }

beforeEach(() => { localStorage.clear(); api.mockReset() })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('machine kinds in a backup', () => {
  it('a replace brings the list back, over a copy that had none', () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 200, equipProfiles: [gym()] }, user: null, ready: true })
    useStore.getState().importBackup(clone(BACKUP))
    expect(useStore.getState().S.equipProfiles.find(p => p.id === 'gym').machines).toEqual(['leg-press', 'lat-pulldown'])
  })
  it('"Merge them in" keeps the backup\'s list for a profile both copies have', () => {
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 6, ts: 200 }))
    useStore.setState({ S: { ...clone(DEF), _ts: 200, equipProfiles: [gym()] }, user: { id: 'u1' }, ready: true, sync: { offline: false, pending: false, lastSynced: 0 } })
    const server = { ...clone(DEF), _ts: 300, equipProfiles: [gym(['smith'])], _rev: 7 }
    useStore.getState().importBackup(clone(BACKUP), { mergeWith: { state: server, rev: 7 } })
    expect(useStore.getState().S.equipProfiles.find(p => p.id === 'gym').machines).toEqual(['leg-press', 'lat-pulldown'])
  })
  it('a list in a backup that is not a list, or holds junk, filters as if there were none', async () => {
    const { profileMachines } = await import('../lib/machine-kinds.js')
    useStore.setState({ S: clone(DEF), user: null, ready: true })
    useStore.getState().importBackup({ ...clone(BACKUP), equipProfiles: [{ ...gym(), machines: 'leg-press' }, { ...gym(), id: 'g2', machines: [{}, 'nope'] }] })
    for (const p of useStore.getState().S.equipProfiles) expect(profileMachines(p)).toEqual([])
  })
})
