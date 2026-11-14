// @vitest-environment happy-dom
import { test, expect, vi, afterEach } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => { throw new Error('offline') }), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
import { DEF, useStore } from './useStore.js'
import { exportBackupZip, readBackupFile } from '../lib/backup-media.js'
afterEach(() => { localStorage.clear(); useStore.setState({ S: structuredClone(DEF), user: null, ready: false }) })
for (const zip of [false, true]) test(`unknown fields survive ${zip ? 'ZIP' : 'JSON'} export, file read, store import and persistence`, async () => {
  const S = { ...structuredClone(DEF), futureSetting: { answer: 42 }, routines: [{ id: 'r', name: 'Push', ex: [], futureField: 42 }] }
  const blob = zip ? (await exportBackupZip(S, { media: { get: async () => null } })).blob : new Blob([JSON.stringify(S)])
  const { state } = await readBackupFile(new File([blob], zip ? 'backup.zip' : 'backup.json'))
  expect(state.futureSetting).toEqual(S.futureSetting)
  expect(state.routines[0].futureField).toBe(42)
  useStore.setState({ S: structuredClone(DEF), user: null, ready: true })
  useStore.getState().importBackup(state)
  const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
  expect(saved.futureSetting).toEqual(S.futureSetting)
  expect(saved.routines[0].futureField).toBe(42)
})

import tombstoned from '../lib/__fixtures__/contracts/tombstoned-profile.json'
import older from '../lib/__fixtures__/contracts/older-nutrition-entry.json'
import nutrition from '../lib/__fixtures__/contracts/nutrition-entry.json'
import { visibleOptionalEntries } from '../lib/sync-merge.js'
test('real ZIP store restore keeps tombstoned optional payload hidden, then deliberately restores an older live backup', async () => {
  useStore.setState({ S: { ...structuredClone(DEF), nutritionEntries: [structuredClone(nutrition)] }, user: null, ready: true })
  const S = { ...structuredClone(DEF), ...structuredClone(tombstoned) }
  const { blob } = await exportBackupZip(S, { media: { get: async () => null } })
  const { state } = await readBackupFile(new File([blob], 'backup.zip'))
  useStore.getState().importBackup(state)
  expect(visibleOptionalEntries(useStore.getState().S, 'nutritionEntries')).toEqual([])
  expect(JSON.parse(localStorage.getItem('gym_state_v1')).nutritionEntries).toHaveLength(1)
  useStore.getState().importBackup({ ...structuredClone(DEF), nutritionEntries: [structuredClone(older)] })
  const visible = visibleOptionalEntries(useStore.getState().S, 'nutritionEntries')
  expect(visible).toHaveLength(1)
  expect(visible[0].schemaVersion).toBe(0)
  expect(visible[0].proteinG).toBeUndefined()
})

test('a complete legacy profile survives the real store load and serialization byte-for-byte', async () => {
  const legacy = { ...structuredClone(DEF), lang: 'en', _ts: 42, workouts: [], modules: { body: false } }
  const text = JSON.stringify(legacy)
  localStorage.setItem('gym_state_v1', text)
  vi.resetModules()
  const { useStore: loaded } = await import('./useStore.js')
  const { stateJson } = await import('../lib/state-json.js')
  expect(stateJson(loaded.getState().S)).toBe(text)
})

import { api } from '../lib/api.js'
import { stampPut } from '../../../api/sync-stamps.js'
for (const key of ['nutritionEntries', 'activities', 'providerLinks']) test(`F2 store ${key}: server-only reset ids are learned within the same epoch`, async () => {
  vi.useFakeTimers()
  const row = id => ({ id, name: id, _ts: 10, _f: { name: 10 } })
  let resolve
  api.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  try {
    useStore.setState({ S: { ...structuredClone(DEF), [key]: [row('a')] }, user: { id: 'probe' }, ready: false })
    const pending = useStore.getState().resetEverything()
    const reset = structuredClone(useStore.getState().S)
    const server = { ...reset, [key]: [row('a'), row('b')], deleted: { [key]: { a: reset.resetAt } } }
    resolve({ state: server, rev: 1 }); await pending
    const follow = structuredClone(useStore.getState().S)
    expect(follow.resetAt).toBe(reset.resetAt)
    expect(follow.resetIds[key]).toEqual(['a', 'b'])
    const saved = stampPut(server, follow, { overRead: true, now: reset.resetAt + 1 })
    expect(visibleOptionalEntries(saved, key)).toEqual([])
  } finally { vi.clearAllTimers(); vi.useRealTimers(); api.mockReset() }
})
