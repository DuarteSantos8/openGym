// @vitest-environment happy-dom
// Settings → Features → Music, Spotify's rows: the account's when the server has Spotify, this
// device's own app when it has not, "try again" when the server did not say, and a Connect button
// that works again once the sign-in is back.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ S: { music: 'spotify' }, acct: null, accountStatus: vi.fn(), connectAccount: vi.fn(), toast: vi.fn() }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ S: m.S, update: () => {} }) }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: m.toast }) } }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../lib/music/index.js', () => ({ appleMusicDevice: () => false, musicBarOn: () => true, musicSource: S => S.music || '' }))
vi.mock('../lib/music/spotify.js', () => ({ connectSpotify: vi.fn(), disconnectSpotify: vi.fn(), spotifyConnected: () => false, redirectUri: () => 'opengym://spotify' }))
vi.mock('../lib/music/spotify-account.js', () => ({ accountStatus: m.accountStatus, connectAccount: m.connectAccount, disconnectAccount: vi.fn() }))
vi.mock('../lib/music/apple-music.js', () => ({ authorizeAppleMusic: vi.fn() }))

import MusicSettings from './MusicSettings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => { m.accountStatus.mockReset(); m.connectAccount.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => { await act(async () => { root.render(<MusicSettings />) }); await act(async () => {}) }
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)

describe('Spotify in Settings → Features', () => {
  it('a server that did not answer: try again, not the Client ID of a Spotify app of your own', async () => {
    m.accountStatus.mockResolvedValue({ available: false, connected: false, unknown: true })
    await mount()
    expect(host.textContent).toContain('Could not reach your server')
    expect(host.querySelector('input[aria-label="Spotify Client ID"]')).toBeNull()
    m.accountStatus.mockResolvedValue({ available: true, connected: true, name: 'Ana' })
    await act(async () => { button('Try again').click() })
    expect(host.textContent).toContain('Connected to your account as Ana')
  })

  it('the account’s Connect works again once the sign-in comes back, whatever its outcome', async () => {
    m.accountStatus.mockResolvedValue({ available: true, connected: false })
    m.connectAccount.mockImplementation(() => new Promise(() => {}))   // the browser takes over
    await mount()
    await act(async () => { button('Connect').click() })
    expect(button('Connect').disabled).toBe(true)
    await act(async () => { window.dispatchEvent(new Event('opengym:spotify')) })
    expect(button('Connect').disabled).toBe(false)
  })

  it('and when the app is shown again without one (the sign-in left in the browser)', async () => {
    m.accountStatus.mockResolvedValue({ available: true, connected: false })
    m.connectAccount.mockImplementation(() => new Promise(() => {}))
    await mount()
    await act(async () => { button('Connect').click() })
    expect(button('Connect').disabled).toBe(true)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(button('Connect').disabled).toBe(false)
  })
})
