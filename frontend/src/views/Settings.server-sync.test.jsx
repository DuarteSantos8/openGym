// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings → "Server & sync": which server, which account, how things stand, when this device
   last held what the server holds, how much is still waiting, and "Sync now" with its outcome.
   Then the way out — Disconnect, Sign out, Sign out everywhere — which no longer promises a sync
   it never checked, and which asks before leaving changes the server has not got: try again,
   export a backup, or go ahead anyway with the changes kept on the device. */
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, sync: null, MOBILE: false, unsynced: { owed: false, count: 0 }, kept: [], sheets: [], navs: [] }
  state.toast = vi.fn()
  state.confirmSheet = vi.fn()
  state.syncNow = vi.fn(async () => state.sync)
  state.update = vi.fn()
  state.disconnectServer = vi.fn()
  state.signOut = vi.fn()
  state.signOutAll = vi.fn()
  state.shareExport = vi.fn(async () => {})
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync, coachLocal: null,
    update: state.update, replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
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
const sync = (status, extra = {}) => ({ status, offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: BASE, ...extra })

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
  mocks.sync = sync('ok', { lastSynced: Date.now() - 5 * 60000 })
  mocks.unsynced = { owed: false, count: 0 }
  mocks.kept = []
  mocks.sheets.length = 0
  mocks.navs.length = 0
  for (const f of [mocks.toast, mocks.confirmSheet, mocks.syncNow, mocks.disconnectServer, mocks.signOut, mocks.signOutAll, mocks.shareExport, mocks.update]) f.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const block = page => [...page.querySelectorAll('.sect')].find(s => s.querySelector('.sect-t')?.textContent === 'Server & sync')
const rowByTitle = (el, title) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const buttonByText = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent === text)
const openSheet = (i = -1) => mount(mocks.sheets.at(i).render(() => {}))

describe('Server & sync', () => {
  it('lets a user hide the connection banner without hiding sync details in Settings', () => {
    const page = mount(<Settings />)
    const row = rowByTitle(page, 'Connection banner')
    expect(row.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
    act(() => row.querySelector('[role="switch"]').click())
    const change = mocks.update.mock.calls.at(-1)?.[0]
    expect(change).toBeTypeOf('function')
    change(mocks.S)
    expect(mocks.S.showConnectionBanner).toBe(false)
    expect(block(page)).toBeTruthy()
  })

  it('a paired phone in step: server, account, "All synced" with the time, and Sync now reporting back', async () => {
    const page = mount(<Settings />)
    const b = block(page)
    expect(b).toBeTruthy()
    expect(rowByTitle(b, 'gym.example.com').textContent).toContain('Signed in as andi')
    expect(rowByTitle(b, 'All synced').textContent).toContain('Last synced: 5 minutes ago')
    expect(rowByTitle(b, 'Disconnect')).toBeTruthy()          // the phone's own rows sit in the block
    expect(rowByTitle(b, 'Pair again')).toBeUndefined()       // nothing to fix

    await act(async () => { rowByTitle(b, 'Sync now').click() })
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('All synced')
  })

  it('refused by the server: says so, how much is waiting, and offers "Pair again" with the address filled in', async () => {
    mocks.sync = sync('auth', { auth: true, pending: true, lastSynced: Date.now() - 2 * 86400000, lastError: { status: 401, code: 'auth' } })
    mocks.unsynced = { owed: true, count: 3 }
    const page = mount(<Settings />)
    const b = block(page)
    const status = rowByTitle(b, 'The server refuses this phone')
    expect(status.textContent).toContain('Last synced: 2 days ago')
    expect(status.textContent).toContain('Not on your server yet: 3 changes')
    act(() => rowByTitle(b, 'Pair again').click())
    const sheet = openSheet().querySelector('.connect')
    expect(sheet.dataset.url).toBe(BASE)
    expect(sheet.dataset.again).toBe('true')

    // Sync now reports the outcome, whatever it is.
    await act(async () => { rowByTitle(b, 'Sync now').click() })
    expect(mocks.toast).toHaveBeenCalledWith('The server refuses this phone')
  })

  // A v1.3.8 phone that lost its pairing, upgraded: both rows said "This phone is not connected to a
  // server." (Android QA, v1.3.9). The status row says it; the server row says there is no address.
  it('a phone an earlier version unpaired says it is not connected once, and that its address is unknown', () => {
    mocks.sync = sync('auth', { auth: true, pending: true, server: null, lastError: { status: 0, code: 'not-paired' } })
    const page = mount(<Settings />)
    const b = block(page)
    expect(rowByTitle(b, 'Server address unknown').textContent).toContain('Signed in as andi')
    expect([...b.querySelectorAll('.lrow-t')].filter(el => el.textContent === 'This phone is not connected to a server.')).toHaveLength(1)
    expect(rowByTitle(b, 'Pair again')).toBeTruthy()
  })

  it('a browser with a server error shows the HTTP code; one that never synced here says so', () => {
    mocks.MOBILE = false
    mocks.sync = sync('error', { pending: true, lastError: { status: 502, code: 'http' } })
    mocks.unsynced = { owed: true, count: 1 }
    const page = mount(<Settings />)
    const status = rowByTitle(block(page), 'Server error (HTTP 502)')
    expect(status.textContent).toContain('Not synced with this server yet')
    expect(status.textContent).toContain('Not on your server yet: 1 change')
    // The browser's account rows follow in their own section.
    expect(rowByTitle(page, 'Sign out')).toBeTruthy()
  })

  it('while everything is fine, a change still in its debounce is not counted as waiting', () => {
    mocks.unsynced = { owed: true, count: 1 }
    const page = mount(<Settings />)
    expect(rowByTitle(block(page), 'All synced').textContent).not.toContain('Not on your server yet')
  })

  it('a phone kept local has no server block, and lists the changes a forced disconnect kept', async () => {
    mocks.user = null
    mocks.sync = sync('local', { server: null })
    mocks.kept = [{ server: BASE, uid: 'u1', name: 'andi', at: 1 }]
    const page = mount(<Settings />)
    await settle()
    expect(block(page)).toBeUndefined()
    const kept = rowByTitle(page, 'Changes kept for andi')
    expect(kept.textContent).toContain('gym.example.com')
    expect(kept.textContent).toContain('Added back when this device connects as that account again.')
  })

  it('signed in as another account, the changes kept for the first are listed in the block', async () => {
    mocks.MOBILE = false
    mocks.user = { id: 'u2', name: 'bea' }
    mocks.kept = [{ server: BASE, uid: 'u1', name: 'andi', at: 1 }]
    const page = mount(<Settings />)
    await settle()
    expect(rowByTitle(block(page), 'Changes kept for andi')).toBeTruthy()
  })
})

describe('leaving the server', () => {
  const confirm = () => mocks.confirmSheet.mock.calls.at(-1)[0]

  it('Disconnect no longer promises a sync it did not check, and goes straight through when nothing is waiting', async () => {
    mocks.disconnectServer.mockResolvedValueOnce({ owed: false })
    const page = mount(<Settings />)
    act(() => rowByTitle(page, 'Disconnect').click())
    expect(confirm().message).not.toMatch(/synced to your server first/)
    expect(confirm().message).toContain('checks that your server has every change')
    await act(async () => { await confirm().onConfirm() })
    expect(mocks.disconnectServer).toHaveBeenCalledWith(undefined)
    expect(mocks.sheets).toHaveLength(0)
    expect(mocks.navs).toEqual(['/home'])
    expect(mocks.toast).toHaveBeenCalledWith('Disconnected — back to local-only')
  })

  it('with changes waiting it asks: how many, try again, export, or disconnect anyway — which keeps them', async () => {
    mocks.disconnectServer.mockResolvedValueOnce({ owed: true, count: 2 })
    const page = mount(<Settings />)
    act(() => rowByTitle(page, 'Disconnect').click())
    await act(async () => { await confirm().onConfirm() })
    expect(mocks.navs).toEqual([])                         // nothing left, nothing wiped
    expect(mocks.sheets.at(-1).opts).toMatchObject({ kind: 'center' })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Not on your server yet: 2 changes')
    expect(sheet.textContent).toContain('keeps a copy of these changes on this device')

    await act(async () => { buttonByText(sheet, 'Export backup (JSON)').click() })
    expect(mocks.shareExport).toHaveBeenCalledTimes(1)     // the phone exports through the share sheet
    expect(mocks.shareExport.mock.calls[0][1]).toMatch(/^opengym-backup-\d{4}-\d{2}-\d{2}\.json$/)

    mocks.disconnectServer.mockResolvedValueOnce({ owed: true, count: 2, stashed: true })
    await act(async () => { buttonByText(sheet, 'Disconnect anyway').click() })
    expect(mocks.disconnectServer).toHaveBeenLastCalledWith({ force: true })
    expect(mocks.navs).toEqual(['/home'])
    expect(mocks.toast).toHaveBeenLastCalledWith('The changes your server has not seen are kept on this device, and added back when it connects as this account again.')
  })

  it('"Try again" syncs, and leaves once the server has everything', async () => {
    mocks.disconnectServer.mockResolvedValueOnce({ owed: true, count: 1 })
    const page = mount(<Settings />)
    act(() => rowByTitle(page, 'Disconnect').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()

    mocks.disconnectServer.mockResolvedValueOnce({ owed: true, count: 1 })
    mocks.sync = sync('offline', { offline: true, pending: true, lastError: { status: 0, code: 'network' } })
    await act(async () => { buttonByText(sheet, 'Try again').click() })
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    expect(mocks.navs).toEqual([])
    expect(sheet.textContent).toContain('The server cannot be reached')   // why it is still waiting (the device itself is online)

    mocks.disconnectServer.mockResolvedValueOnce({ owed: false })
    await act(async () => { buttonByText(sheet, 'Try again').click() })
    expect(mocks.navs).toEqual(['/home'])
  })

  it('refused by the server, "Try again" makes way for "Pair again" — pairing is what brings the changes over', async () => {
    mocks.sync = sync('auth', { auth: true, pending: true, lastError: { status: 401, code: 'auth' } })
    mocks.disconnectServer.mockResolvedValueOnce({ owed: true, count: null })
    const page = mount(<Settings />)
    act(() => rowByTitle(page, 'Disconnect').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Some changes on this device have not reached your server.')
    expect(buttonByText(sheet, 'Try again')).toBeUndefined()
    // The sentence names the button that is there (it said "Try again" beside "Pair again").
    expect(sheet.textContent).toContain('Pair again, or export a backup first.')
    expect(sheet.textContent).not.toContain('Try again')
    act(() => buttonByText(sheet, 'Pair again').click())
    expect(openSheet().querySelector('.connect').dataset.again).toBe('true')
  })

  it('a browser the server refuses is told to sign in again, next to the button that does', async () => {
    mocks.MOBILE = false
    mocks.sync = sync('auth', { auth: true, pending: true, lastError: { status: 401, code: 'auth' } })
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 2 })
    const page = mount(<Settings />)
    act(() => rowByTitle(page, 'Sign out').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Sign in again, or export a backup first.')
    expect(sheet.textContent).not.toContain('Try again')
    expect(buttonByText(sheet, 'Sign in with passkey')).toBeTruthy()
  })

  it('a server that is only out of reach still offers Try again, and says so', async () => {
    mocks.disconnectServer.mockResolvedValueOnce({ owed: true, count: 1 })
    const page = mount(<Settings />)
    act(() => rowByTitle(page, 'Disconnect').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Try again, or export a backup first.')
    expect(buttonByText(sheet, 'Try again')).toBeTruthy()
  })

  it('a copy that cannot be kept aside is not wiped either, and it says so', async () => {
    mocks.disconnectServer.mockResolvedValueOnce({ owed: true, count: 1 })
    const page = mount(<Settings />)
    act(() => rowByTitle(page, 'Disconnect').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    mocks.disconnectServer.mockResolvedValueOnce({ owed: true, count: 1, stashed: false })
    await act(async () => { buttonByText(sheet, 'Disconnect anyway').click() })
    expect(mocks.navs).toEqual([])
    expect(mocks.toast).toHaveBeenLastCalledWith('Could not keep a copy of the changes on this device — nothing was removed.')
  })

  it('browser: Sign out checks first too, and "Sign out everywhere" says paired phones have to be paired again', async () => {
    mocks.MOBILE = false
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 4 })
    const page = mount(<Settings />)
    act(() => rowByTitle(page, 'Sign out').click())
    expect(confirm().message).not.toMatch(/synced to your profile first/)
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Not on your server yet: 4 changes')
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 4, stashed: true })
    await act(async () => { buttonByText(sheet, 'Sign out anyway').click() })
    expect(mocks.signOut).toHaveBeenLastCalledWith({ force: true })
    expect(mocks.navs).toEqual(['/home'])

    act(() => rowByTitle(page, 'Sign out everywhere').click())
    expect(confirm().message).toContain('Phones paired with it are disconnected and have to be paired again.')
    mocks.signOutAll.mockRejectedValueOnce(new Error('HTTP 502'))
    await act(async () => { await confirm().onConfirm() })
    expect(mocks.toast).toHaveBeenLastCalledWith('Could not sign out everywhere — you are still signed in.')
  })
})
