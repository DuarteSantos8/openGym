// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { createMediaStore, memoryBackend, _setMediaStore } from '../lib/media-store.js'
import { _resetMediaOwed } from '../lib/media-owed.js'
import { readZip, zipStore } from '../lib/zip.js'
import { sha256Hex } from '../lib/sha256.js'
import { jpeg } from '../lib/media-samples.test-util.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings → Data with photos and videos: the JSON export says it leaves them out, the zip export
   carries them, Import takes either, and "Reset everything" takes the files too — on the server
   once the empty state is there, and on this device except what a stash still refers to. */
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, config: null, sync: { status: 'ok' }, stashed: new Set() }
  state.replaceState = vi.fn()
  state.importBackup = vi.fn()
  state.resetEverything = vi.fn()
  state.menuSheet = vi.fn()
  state.conflict = null
  state.pushState = vi.fn(async () => {})
  state.confirmSheet = vi.fn()
  state.api = vi.fn(() => Promise.resolve({ ok: true }))
  state.toast = vi.fn()
  // Stable across renders: KeptChangesRows re-asks whenever the function changes, and sets a new
  // list each time.
  state.kept = []
  state.keptChanges = async () => state.kept
  state.snapshot = () => ({
    S: state.S, user: state.user, config: state.config, sync: state.sync, coachLocal: null,
    update: vi.fn(), replaceState: state.replaceState, setUser: vi.fn(), pullState: vi.fn(), pushState: state.pushState,
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
    syncNow: vi.fn(), unsyncedChanges: () => ({ owed: false, count: 0 }), keptChanges: state.keptChanges,
    stashedMediaHashes: async () => state.stashed,
    importConflict: async () => state.conflict, importBackup: state.importBackup, importLegacyBackup: vi.fn(), resetEverything: state.resetEverything
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' }, workouts: [] }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), shareExportBlob: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../lib/coach-api.js', () => ({ forgetCoach: vi.fn(() => Promise.resolve()) }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: (...a) => mocks.menuSheet(...a), askAddDeviceData: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

const PHOTO = jpeg()
let HASH, media, host, root
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
// For what goes through a dynamic import and a few awaits of file reads: a busy test run can take
// longer than a fixed number of ticks.
const until = async (cond, ms = 4000) => {
  const end = Date.now() + ms
  while (!(await cond()) && Date.now() < end) await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}
const row = text => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(text))
const stateWithPhoto = () => ({
  engineSchemaVersion: 2, unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {},
  customEx: [{ id: 'c1', n: 'Sandbag carry', bp: 'back', custom: true, media: { kind: 'image', hash: HASH, mime: 'image/jpeg', size: PHOTO.length, width: 640, height: 480, at: 1 } }]
})

beforeEach(async () => {
  HASH = await sha256Hex(PHOTO)
  media = createMediaStore(memoryBackend())
  _setMediaStore(media)
  mocks.S = stateWithPhoto()
  mocks.user = null
  mocks.config = null
  mocks.sync = { status: 'ok' }
  mocks.stashed = new Set()
  mocks.conflict = null
  for (const f of [mocks.replaceState, mocks.importBackup, mocks.resetEverything, mocks.menuSheet, mocks.pushState, mocks.confirmSheet, mocks.api, mocks.toast]) f.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  _setMediaStore(null)
})
const mount = async () => { act(() => root.render(<Settings page="data" />)); await settle() }

describe('Settings — photos and videos', () => {
  it('the JSON export says it leaves them out, the zip row and the Photos & videos row appear', async () => {
    await mount()
    expect(row('Export backup (JSON)').textContent).toContain('Without photos and videos')
    expect(row('Export with photos & videos (.zip)')).toBeTruthy()
    expect(row('Photos & videos').textContent).toContain('Kept on this device only')
    expect(host.querySelector('input[type="file"][accept=".json,.zip,application/json,application/zip"]')).toBeTruthy()
  })

  // QA, v1.3.9: a paired phone started in airplane mode has no config yet (it is never cached),
  // and the row called its photos "Kept on this device only" — the guest's sentence — with no
  // count of what was waiting, while they went up by themselves once it was back online.
  it('signed in with the server\'s config not known yet (an offline start): waiting to upload, not kept here only', async () => {
    _resetMediaOwed()
    await media.put(HASH, new Blob([PHOTO]), { mime: 'image/jpeg', pending: true })
    mocks.user = { id: 'u1', name: 'Ana' }
    mocks.config = null
    mocks.sync = { status: 'offline', offline: true }
    await mount()
    expect(row('Photos & videos').textContent).not.toContain('Kept on this device only')
    expect(row('Photos & videos').textContent).toContain('1 waiting to upload')
  })

  it('signed in to a server that stores no photos or videos: kept on this device only', async () => {
    mocks.user = { id: 'u1', name: 'Ana' }
    mocks.config = { invite_only: false }
    await mount()
    expect(row('Photos & videos').textContent).toContain('Kept on this device only')
  })

  it('without any, none of that shows', async () => {
    mocks.S = { ...stateWithPhoto(), customEx: [] }
    await mount()
    expect(row('Export backup (JSON)').textContent).not.toContain('Without photos')
    expect(row('Export with photos & videos')).toBeUndefined()
    expect(row('Photos & videos')).toBeUndefined()
  })

  it('the zip export carries the state and the photo under its hash', async () => {
    await media.put(HASH, new Blob([PHOTO]), { mime: 'image/jpeg', pending: false })
    let blob = null
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation(b => { blob = b; return 'blob:zip' })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await mount()
    act(() => { row('Export with photos & videos (.zip)').click() })
    await until(() => created.mock.calls.length > 0)
    expect(created).toHaveBeenCalled()
    const names = (await readZip(blob)).map(e => e.name)
    expect(names).toEqual(['opengym-backup.json', `media/${HASH}.jpg`, 'README.txt'])
    expect(mocks.toast).toHaveBeenCalledWith('Backup exported')
    vi.restoreAllMocks()
  })

  it('the zip export names one file it could not include in the singular', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:zip')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      await mount()   // the photo is not on this device, and a guest has nowhere to fetch it from
      act(() => { row('Export with photos & videos (.zip)').click() })
      await until(() => created.mock.calls.length > 0)
      expect(mocks.toast).toHaveBeenCalledWith('1 file could not be included')
    } finally { vi.restoreAllMocks() }
  })

  it('importing a zip keeps its photo as pending, once confirmed', async () => {
    const S = stateWithPhoto()
    const zip = await zipStore([{ name: 'opengym-backup.json', blob: new Blob([JSON.stringify(S)]) }, { name: `media/${HASH}.jpg`, blob: new Blob([PHOTO]) }])
    await mount()
    const input = host.querySelector('input[type="file"][accept^=".json"]')
    Object.defineProperty(input, 'files', { value: [new File([zip], 'backup.zip')], configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await until(() => mocks.confirmSheet.mock.calls.length > 0)
    expect(mocks.confirmSheet).toHaveBeenCalledTimes(1)
    expect(await media.has(HASH)).toBe(false)          // nothing before the confirm
    await act(async () => { await mocks.confirmSheet.mock.calls[0][0].onConfirm() })
    expect(await media.get(HASH)).toMatchObject({ mime: 'image/jpeg', pending: true })
    expect(mocks.importBackup).toHaveBeenCalledTimes(1)
    expect(mocks.importBackup.mock.calls[0][0].customEx[0].media.hash).toBe(HASH)
    expect(mocks.importBackup.mock.calls[0][1]).toEqual({ mergeWith: null })   // the replace
  })

  // QA, v1.3.9: the import replaced a workout another device had synced meanwhile, unsaid.
  it('importing over a server that has workouts the backup lacks says how many, and can merge them in', async () => {
    mocks.user = { id: 'u1', name: 'Ana' }
    mocks.conflict = { workouts: 2, state: { workouts: [] }, rev: 9 }
    const S = stateWithPhoto()
    await mount()
    const input = host.querySelector('input[type="file"][accept^=".json"]')
    Object.defineProperty(input, 'files', { value: [new File([JSON.stringify(S)], 'backup.json')], configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await until(() => mocks.menuSheet.mock.calls.length > 0)
    expect(mocks.confirmSheet).not.toHaveBeenCalled()
    const sheet = mocks.menuSheet.mock.calls[0][0]
    expect(sheet.subtitle).toBe('The server has 2 workouts that are not in this backup, logged since it was made or on another device. Replacing deletes them.')
    expect(sheet.items.map(i => i.label)).toEqual(['Replace anyway', 'Merge them in', 'Cancel'])
    await act(async () => { await sheet.items[1].onClick() })
    expect(mocks.importBackup).toHaveBeenCalledTimes(1)
    expect(mocks.importBackup.mock.calls[0][1]).toEqual({ mergeWith: mocks.conflict })
    await act(async () => { await sheet.items[0].onClick() })
    expect(mocks.importBackup.mock.calls[1][1]).toEqual({ mergeWith: null })
  })

  it('Reset, signed in: pushes, asks the server to sweep, and keeps only what a stash refers to', async () => {
    mocks.user = { id: 'u1', name: 'Ana' }
    mocks.config = { media: { imageMB: 2 } }
    const other = 'c'.repeat(64)
    await media.put(HASH, new Blob([PHOTO]), { mime: 'image/jpeg', pending: false })
    await media.put(other, new Blob(['x']), { mime: 'image/png', pending: true })
    mocks.stashed = new Set([other])
    await mount()
    act(() => { row('Reset everything').click() })
    act(() => { mocks.confirmSheet.mock.calls[0][0].onConfirm() })
    await until(async () => !(await media.has(HASH)))
    expect(mocks.pushState).toHaveBeenCalled()
    expect(mocks.api.mock.calls.map(c => c[0])).toContain('/api/media/sweep')
    expect(await media.has(HASH)).toBe(false)
    expect(await media.has(other)).toBe(true)
  })

  it('Reset: no sweep before the empty state is on the server, nor for a guest', async () => {
    mocks.user = { id: 'u1', name: 'Ana' }
    mocks.config = { media: { imageMB: 2 } }
    mocks.sync = { status: 'offline' }
    await mount()
    act(() => { row('Reset everything').click() })
    act(() => { mocks.confirmSheet.mock.calls[0][0].onConfirm() })
    await until(() => mocks.pushState.mock.calls.length > 0)
    await settle()
    expect(mocks.api.mock.calls.map(c => c[0])).not.toContain('/api/media/sweep')
    act(() => root.unmount())
    root = createRoot(host)
    mocks.user = null
    mocks.sync = { status: 'ok' }
    mocks.confirmSheet.mockClear(); mocks.api.mockClear()
    await media.put(HASH, new Blob([PHOTO]), { mime: 'image/jpeg', pending: true })
    await mount()
    act(() => { row('Reset everything').click() })
    act(() => { mocks.confirmSheet.mock.calls[0][0].onConfirm() })
    await until(async () => !(await media.has(HASH)))
    expect(mocks.api).not.toHaveBeenCalled()
    expect(await media.has(HASH)).toBe(false)
  })
})
