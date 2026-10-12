// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* When Disconnect, Sign out or Sign out everywhere fails, the toast says what that action was and
   what still stands: "Sign out everywhere" was the only wording, whichever one had failed. */
const mocks = vi.hoisted(() => ({ toast: null, disconnectServer: null, signOut: null, signOutAll: null }))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({
    sync: null, config: null, syncNow: async () => null,
    disconnectServer: (...a) => mocks.disconnectServer(...a),
    signOut: (...a) => mocks.signOut(...a),
    signOutAll: (...a) => mocks.signOutAll(...a)
  })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: m => mocks.toast(m), openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/media-sync.js', () => ({ syncMedia: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false }))
vi.mock('../lib/api.js', () => ({ passkeyLogin: vi.fn(), webauthnOK: () => true }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
vi.mock('../views/MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))

const { leaveServer, OwedSheet } = await import('./ServerSync.jsx')

const fail = () => vi.fn(async () => { throw new Error('boom') })
beforeEach(() => {
  mocks.toast = vi.fn()
  mocks.disconnectServer = fail()
  mocks.signOut = fail()
  mocks.signOutAll = fail()
})

describe('leaving the server, when it fails', () => {
  it.each([
    ['disconnect', 'disconnectServer', 'Couldn’t disconnect. You’re still connected.'],
    ['signout', 'signOut', 'Couldn’t sign out. You’re still signed in.'],
    ['everywhere', 'signOutAll', 'Couldn’t sign out everywhere. You’re still signed in.']
  ])('%s says its own words and leaves the screen where it is', async (kind, method, line) => {
    const done = vi.fn()
    await leaveServer(kind, { exportBackup: vi.fn(), exportBackupZip: vi.fn(), done })
    expect(mocks[method]).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith(line)
    expect(done).not.toHaveBeenCalled()
  })
})

describe('the sheet that offers going ahead anyway, when that fails', () => {
  it.each([
    ['disconnect', 'disconnectServer', 'Disconnect anyway', 'Couldn’t disconnect. You’re still connected.'],
    ['signout', 'signOut', 'Sign out anyway', 'Couldn’t sign out. You’re still signed in.']
  ])('%s says its own words', async (kind, method, label, line) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<OwedSheet kind={kind} count={2} exportBackup={vi.fn()} exportBackupZip={vi.fn()} done={vi.fn()} close={vi.fn()} />))
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
    await act(async () => { btn.click() })
    expect(mocks[method]).toHaveBeenCalledWith({ force: true })
    expect(mocks.toast).toHaveBeenCalledWith(line)
    act(() => root.unmount()); host.remove()
  })
})
