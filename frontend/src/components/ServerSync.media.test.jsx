// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The sheet a sign-out shows when the server is missing something names the photos and videos
   that have not reached it, offers the backup that carries them, and its "Try again" sends them
   too. */
const mocks = vi.hoisted(() => ({
  sync: { status: 'offline', lastError: { status: 0, code: 'network' } },
  syncNow: null, signOut: null, syncMedia: null, MOBILE: false, config: null, startProviderSignIn: null
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ sync: mocks.sync, syncNow: mocks.syncNow, signOut: mocks.signOut, config: mocks.config })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('./AppSignIn.jsx', () => ({ startProviderSignIn: (...a) => mocks.startProviderSignIn(...a) }))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/media-sync.js', () => ({ syncMedia: (...a) => mocks.syncMedia(...a) }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('../lib/api.js', () => ({ passkeyLogin: vi.fn(), webauthnOK: () => true }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
vi.mock('../views/MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))

const { OwedSheet } = await import('./ServerSync.jsx')

let host, root
beforeEach(() => {
  mocks.MOBILE = false
  mocks.sync = { status: 'offline', lastError: { status: 0, code: 'network' } }
  mocks.config = null
  mocks.syncNow = vi.fn(async () => mocks.sync)
  mocks.syncMedia = vi.fn(async () => {})
  mocks.signOut = vi.fn(async () => ({ owed: true, count: 0, media: 1 }))
  mocks.startProviderSignIn = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))

describe('OwedSheet with photos and videos waiting', () => {
  it('names them, and exports the backup that carries them', () => {
    const zip = vi.fn(), json = vi.fn()
    act(() => root.render(<OwedSheet kind="signout" count={0} media={2} exportBackup={json} exportBackupZip={zip} done={vi.fn()} close={vi.fn()} />))
    expect(host.textContent).toContain('2 photos or videos have not reached your server yet.')
    expect(host.textContent).not.toContain('Some changes on this device')
    act(() => { button('Export with photos & videos (.zip)').click() })
    expect(zip).toHaveBeenCalledTimes(1)
    expect(json).not.toHaveBeenCalled()
  })

  it('names the changes and the media when both are waiting', () => {
    act(() => root.render(<OwedSheet kind="signout" count={3} media={1} exportBackup={vi.fn()} exportBackupZip={vi.fn()} done={vi.fn()} close={vi.fn()} />))
    expect(host.textContent).toContain('Not on your server yet')
    expect(host.textContent).toContain('1 photo or video has not reached your server yet.')
  })

  // QA, v1.3.9: "1 photos or videos have not reached your server yet."
  it('one file is named in the singular', () => {
    act(() => root.render(<OwedSheet kind="signout" count={0} media={1} exportBackup={vi.fn()} exportBackupZip={vi.fn()} done={vi.fn()} close={vi.fn()} />))
    expect(host.textContent).toContain('1 photo or video has not reached your server yet.')
    expect(host.textContent).not.toContain('1 photos')
  })

  it('Try again sends them too — the refused ones included — and the sheet follows the new count', async () => {
    act(() => root.render(<OwedSheet kind="signout" count={0} media={1} exportBackup={vi.fn()} exportBackupZip={vi.fn()} done={vi.fn()} close={vi.fn()} />))
    mocks.signOut = vi.fn(async () => ({ owed: true, count: 0, media: 1 }))
    mocks.sync = { status: 'pending' }
    await act(async () => { button('Try again').click(); await new Promise(r => setTimeout(r, 0)) })
    expect(mocks.syncMedia).toHaveBeenCalledWith({ force: true, retryRejected: true })
    expect(mocks.signOut).toHaveBeenCalled()
  })

  it('without media, it is the sheet it always was', () => {
    const json = vi.fn()
    act(() => root.render(<OwedSheet kind="signout" count={2} exportBackup={json} done={vi.fn()} close={vi.fn()} />))
    expect(host.textContent).not.toContain('photos or videos')
    act(() => { button('Export backup (JSON)').click() })
    expect(json).toHaveBeenCalled()
  })

  // Where the phone-sync fixes and the media meet: a server that refuses the device is not
  // something "Try again" can fix, for photos and videos no more than for changes.
  it('refused phone with only photos or videos waiting: names them, and offers Pair again, not Try again', () => {
    mocks.MOBILE = true
    mocks.sync = { status: 'auth', auth: true, lastError: { status: 401, code: 'auth' } }
    const zip = vi.fn()
    act(() => root.render(<OwedSheet kind="disconnect" count={0} media={3} exportBackup={vi.fn()} exportBackupZip={zip} done={vi.fn()} close={vi.fn()} />))
    expect(host.textContent).toContain('3 photos or videos have not reached your server yet.')
    expect(host.textContent).not.toContain('Some changes on this device')
    expect(host.textContent).toContain('The server refuses this phone')
    expect(host.textContent).toContain('Pair again, or export a backup first.')
    expect(host.textContent).not.toContain('Try again')
    expect(button('Pair again')).toBeTruthy()
    act(() => { button('Export with photos & videos (.zip)').click() })
    expect(zip).toHaveBeenCalledTimes(1)
    expect(button('Disconnect anyway')).toBeTruthy()
    expect(mocks.syncMedia).not.toHaveBeenCalled()
  })

  it('refused phone with a provider: "Sign in again with Google" is the primary action, Pair again stays beneath it', () => {
    mocks.MOBILE = true
    mocks.sync = { status: 'auth', auth: true, server: 'https://gym.example.com', lastError: { status: 401, code: 'auth' } }
    mocks.config = { oidc: { name: 'Google' } }
    act(() => root.render(<OwedSheet kind="disconnect" count={0} media={3} exportBackup={vi.fn()} exportBackupZip={vi.fn()} done={vi.fn()} close={vi.fn()} />))
    const provider = button('Sign in again with Google')
    const pair = button('Pair again')
    expect(provider).toBeTruthy()
    expect(provider.className).toContain('primary')
    expect(pair).toBeTruthy()
    expect(pair.className).not.toContain('primary')
    act(() => { provider.click() })
    expect(mocks.startProviderSignIn).toHaveBeenCalledWith('https://gym.example.com')
  })

  it('refused browser with photos or videos waiting: Sign in again, and the backup that carries them', () => {
    mocks.sync = { status: 'auth', auth: true, lastError: { status: 401, code: 'auth' } }
    act(() => root.render(<OwedSheet kind="signout" count={null} media={1} exportBackup={vi.fn()} exportBackupZip={vi.fn()} done={vi.fn()} close={vi.fn()} />))
    expect(host.textContent).toContain('Some changes on this device have not reached your server.')
    expect(host.textContent).toContain('1 photo or video has not reached your server yet.')
    expect(host.textContent).toContain('Sign in again, or export a backup first.')
    expect(host.textContent).not.toContain('Try again')
    expect(button('Sign in with passkey')).toBeTruthy()
    expect(button('Export with photos & videos (.zip)')).toBeTruthy()
  })

  it('a phone whose server is only out of reach still offers Try again for them', () => {
    mocks.MOBILE = true
    act(() => root.render(<OwedSheet kind="disconnect" count={0} media={2} exportBackup={vi.fn()} exportBackupZip={vi.fn()} done={vi.fn()} close={vi.fn()} />))
    expect(host.textContent).toContain('2 photos or videos have not reached your server yet.')
    expect(host.textContent).toContain('Try again, or export a backup first.')
    expect(button('Try again')).toBeTruthy()
    expect(button('Pair again')).toBeFalsy()
  })
})
