// @vitest-environment happy-dom
// The backup-folder rows (#161) sit under Auto-backup, on Android only, and only while it is on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { bindUI } from '../components/ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, MOBILE: true, android: true, folder: {}, asked: [] }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE }, isAndroid: () => Promise.resolve(mocks.android), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('../components/BackupFolderRow.jsx', async () => {
  const real = await vi.importActual('../components/BackupFolderRow.jsx')
  return {
    default: () => <div className="backup-folder-row" />,
    useBackupFolder: enabled => { mocks.asked.push(enabled); return [enabled ? mocks.folder : null, () => {}] },
    autoBackupSubtitle: real.autoBackupSubtitle,
  }
})
vi.mock('../lib/update.js', () => ({ checkForUpdate: () => new Promise(() => {}), downloadAndInstall: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

// SelectRow opens its choices through the bound UI store; capture the sheet to render it here.
let sheet = null
bindUI({ getState: () => ({ openSheet: render => { sheet = render; return { close: () => {} } } }) })

let host, root
beforeEach(() => {
  sheet = null
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.MOBILE = true
  mocks.android = true
  mocks.folder = {}
  mocks.asked = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = async () => { await act(async () => { root.render(<Settings page="data" />) }) }
const shown = () => !!host.querySelector('.backup-folder-row')

describe('the backup folder rows', () => {
  it('show on Android with auto-backup on', async () => {
    mocks.S.autoBackup = true
    await mount()
    expect(shown()).toBe(true)
  })
  it('not with auto-backup off', async () => {
    mocks.S.autoBackup = false
    await mount()
    expect(shown()).toBe(false)
  })
  it('not on iOS', async () => {
    mocks.S.autoBackup = true
    mocks.android = false
    await mount()
    expect(shown()).toBe(false)
  })
})

// Android QA: the Auto-backup row still said Documents/openGym after another folder was chosen.
describe('the Auto-backup row', () => {
  const subtitle = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Auto-backup on changes'))?.querySelector('.lrow-s')?.textContent
  it('names the chosen folder', async () => {
    mocks.S.autoBackup = true
    mocks.folder = { uri: 'content://tree/Sync', label: 'SyncFolder' }
    await mount()
    expect(subtitle()).toContain('“SyncFolder”')
    expect(subtitle()).not.toContain('Documents/openGym')
  })
  it('names Documents/openGym with no folder chosen', async () => {
    mocks.S.autoBackup = true
    await mount()
    expect(subtitle()).toContain('Documents/openGym')
  })
})
