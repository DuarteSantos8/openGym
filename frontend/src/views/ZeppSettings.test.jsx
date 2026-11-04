// @vitest-environment happy-dom
// Settings → Zepp OS watch (Discord 11-03/04: ravk_ found no such page on three Android phones,
// might1338 could not copy the pairing code, jag86_ looked for the app in the Zepp App Store).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ZeppSettingsPage, { ZEPP_INSTALL_DOCS } from './ZeppSettings.jsx'
import { pageVisible } from './settings-pages.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), remoteAuth: () => ({ base: 'https://gym.example/' }) }))
vi.mock('../components/ServerSync.jsx', () => ({ connectServer: vi.fn() }))
import { connectServer } from '../components/ServerSync.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
const mount = async props => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<ZeppSettingsPage {...props} />))
}
const titles = () => [...host.querySelectorAll('.lrow-t')].map(el => el.textContent)
const fakeApi = () => ({ relayLinks: vi.fn(() => Promise.resolve([])), relayPairCode: vi.fn(() => Promise.resolve({ code: '482913', exp: Date.now() + 600000 })), relayUnlink: vi.fn() })

beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '' }) })
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); root = host = null; vi.restoreAllMocks() })

describe('where the page shows', () => {
  it('on a phone on its own too, not only signed in to a server; never in the demo', () => {
    expect(pageVisible('zepp', { mobile: true, user: null })).toBe(true)
    expect(pageVisible('zepp', { mobile: true, user: { id: 'u' } })).toBe(true)
    expect(pageVisible('zepp', { mobile: false, user: { id: 'u' } })).toBe(true)
    expect(pageVisible('zepp', { mobile: false, user: null, demo: true })).toBe(false)
    expect(pageVisible('zepp', { mobile: true, user: null, mod: id => id !== 'watch' })).toBe(false)
  })
})

describe('without a server', () => {
  it('says why it needs one, offers to connect and asks the server for nothing', async () => {
    const api = fakeApi()
    await mount({ api, signedIn: false })
    expect(titles()).toContain('Connect to my server')
    expect(host.textContent).toContain('through your own openGym server')
    expect(api.relayLinks).not.toHaveBeenCalled()
    const row = [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Connect to my server'))
    act(() => row.click())
    expect(connectServer).toHaveBeenCalled()
  })
})

describe('signed in', () => {
  it('the pairing code and the address can be copied', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const toast = vi.spyOn(useUI.getState(), 'toast')
    await mount({ api: fakeApi(), signedIn: true })
    const pairRow = [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Pair a watch'))
    await act(async () => pairRow.click())
    expect(host.querySelector('[data-testid="zepp-code"]').textContent).toBe('482913')
    await act(async () => host.querySelector('[aria-label="Copy code"]').click())
    expect(writeText).toHaveBeenCalledWith('482913')
    await act(async () => host.querySelector('[aria-label="Copy address"]').click())
    expect(writeText).toHaveBeenLastCalledWith('https://gym.example')
    expect(toast).toHaveBeenCalledWith('Copied')
  })

  it('says the watch app is not in the Zepp App Store yet, and links the install guide', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mount({ api: fakeApi(), signedIn: true })
    expect(host.textContent).toContain('isn’t in the Zepp App Store yet')
    const row = [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Install the watch app'))
    act(() => row.click())
    expect(open).toHaveBeenCalledWith(ZEPP_INSTALL_DOCS, '_blank', 'noopener,noreferrer')
  })
})
