// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings for programmes (spec 6.1, 8.5, 16): Plan → Progression holds the two Config defaults,
   whether a newer 1RM is offered (S.refUpdates) and what a programme's start proposes for its end
   (S.programmeEnd); Server & sync says when this server cannot take this app's programmes yet. */
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, sync: null, syncBlocked: null, MOBILE: false, unsynced: { owed: false, count: 0 }, kept: [], sheets: [], navs: [] }
  state.toast = vi.fn()
  state.confirmSheet = vi.fn()
  state.syncNow = vi.fn(async () => state.sync)
  state.disconnectServer = vi.fn()
  state.signOut = vi.fn()
  state.signOutAll = vi.fn()
  state.shareExport = vi.fn(async () => {})
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync, syncBlocked: state.syncBlocked, coachLocal: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next }, replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
    syncNow: state.syncNow, unsyncedChanges: () => state.unsynced, keptChanges: async () => state.kept,
    disconnectServer: state.disconnectServer, signOut: state.signOut, signOutAll: state.signOutAll,
    adoptProfile: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to) }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({
  get MOBILE() { return mocks.MOBILE },
  isAndroid: () => Promise.resolve(false), shareExport: (...a) => mocks.shareExport(...a), syncReminder: vi.fn(),
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: props => <div className="connect" data-url={props.initialUrl ?? ''} data-again={String(!!props.again)} /> }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(), askAddDeviceData: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

const BASE = 'https://gym.example.com'
const USER = { id: 'u1', name: 'andi' }
const sync_ = (status, extra = {}) => ({ status, offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: BASE, ...extra })

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = USER
  mocks.MOBILE = true
  mocks.sync = sync_('ok', { lastSynced: Date.now() - 5 * 60000 })
  mocks.unsynced = { owed: false, count: 0 }
  mocks.syncBlocked = null
  mocks.kept = []
  mocks.sheets.length = 0
  mocks.navs.length = 0
  for (const f of [mocks.toast, mocks.confirmSheet, mocks.syncNow, mocks.disconnectServer, mocks.signOut, mocks.signOutAll, mocks.shareExport]) f.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const block = page => [...page.querySelectorAll('.sect')].find(s => s.querySelector('.sect-t')?.textContent === 'Server & sync')
const rowByTitle = (el, title) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const buttonByText = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent === text)
const openSheet = (i = -1) => mount(mocks.sheets.at(i).render(() => {}))


const section = (page, title) => [...page.querySelectorAll('.sect')].find(s => s.querySelector('.sect-t')?.textContent === title)
const choose = label => { const sheet = openSheet(); act(() => [...sheet.querySelectorAll('button, .item, [role="option"]')].find(b => b.textContent.startsWith(label)).click()) }

describe('Settings for programmes', () => {
  // SelectRow opens its picker through the bound UI store: the mocked one here.
  beforeEach(async () => { const { bindUI } = await import('../components/ui.jsx'); const { useUI } = await import('../store/useUI.js'); bindUI(useUI) })
  it('Settings rows write refUpdates and programmeEnd; server-upgrade sync message', () => {
    // Plan → Progression: what an older profile without them reads as, then each choice written.
    let page = mount(<Settings page="plan" />)
    const prog = section(page, 'Progression')
    expect(rowByTitle(prog, 'New 1RM estimates').textContent).toContain('Ask me first')
    expect(rowByTitle(prog, 'When a programme’s weeks run out').textContent).toContain('Stop')
    act(() => rowByTitle(prog, 'New 1RM estimates').click())
    choose('Keep the one in use')
    expect(mocks.S.refUpdates).toBe('keep')
    act(() => rowByTitle(prog, 'When a programme’s weeks run out').click())
    choose('Keep going until every goal is reached')
    expect(mocks.S.programmeEnd).toBe('extend')
    page = mount(<Settings page="plan" />)
    expect(rowByTitle(section(page, 'Progression'), 'New 1RM estimates').textContent).toContain('Keep the one in use')

    // Server & sync: a server without engine contract 1 holds the changes, and says why.
    mocks.syncBlocked = 'server-upgrade'
    mocks.unsynced = { owed: true, count: 2 }
    page = mount(<Settings page="account" />)
    const sync = section(page, 'Server & sync')
    expect(rowByTitle(sync, 'All synced')).toBeUndefined()
    expect(rowByTitle(sync, 'This server needs an update to sync programmes').textContent).toContain('Not on your server yet: 2 changes')
    // Offline it is the offline line that holds: the block is not what stops it then.
    mocks.sync = sync_('offline', { offline: true, pending: true })
    page = mount(<Settings page="account" />)
    expect(rowByTitle(section(page, 'Server & sync'), 'This server needs an update to sync programmes')).toBeUndefined()
    expect(section(page, 'Server & sync').textContent).toContain('The server cannot be reached')
  })
})
