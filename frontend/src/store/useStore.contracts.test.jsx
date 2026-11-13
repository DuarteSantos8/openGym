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
