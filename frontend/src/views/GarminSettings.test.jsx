// @vitest-environment happy-dom
// Settings → Garmin (views/GarminSettings.jsx): what the page shows for the phone's Garmin link,
// and that its buttons call the native side (WatchBridge.garminPick / garminStore).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../lib/mobile.js', () => ({ MOBILE: true, nativePlatform: async () => 'android' }))

import GarminSettingsPage from './GarminSettings.jsx'
import { readWatchPrefs } from '../lib/watch-settings.js'
import { GARMIN_DOCS } from '../lib/garmin-view.js'

let host, root
beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

const fake = status => vi.fn(async name => (name === 'garminStatus' ? status : { ok: name === 'garminPick' }))
const mount = async api => { await act(async () => { root.render(<GarminSettingsPage api={api} />) }); await act(async () => {}) }
const rowTitled = text => [...host.querySelectorAll('button, [role="button"], .lrow')].find(el => el.textContent.includes(text))

describe('Settings → Garmin', () => {
  it('lists the Garmins and says openGym is on them', async () => {
    await mount(fake({ supported: true, state: 'ready', installed: true, reachable: true, devices: [{ id: '7', name: 'Forerunner 265', connected: true, installed: true }] }))
    expect(host.textContent).toContain('Forerunner 265')
    expect(host.textContent).toContain('Connected')
    expect(host.textContent).toContain('openGym is on your Garmin. Sets you log on the wrist land here.')
    expect(host.textContent).toContain('Look again')
    expect(host.textContent).not.toContain('Get openGym for Garmin')
  })

  it('on the iPhone, nothing picked: Choose watches opens Garmin Connect', async () => {
    const api = fake({ supported: true, state: 'idle', picker: true, devices: [] })
    await mount(api)
    expect(host.textContent).toContain('Pick your Garmin in Garmin Connect')
    await act(async () => { rowTitled('Choose watches').click() })
    expect(api).toHaveBeenCalledWith('garminPick')
  })

  it('a Garmin without the app: the guide opens while the app is not in the store', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mount(fake({ supported: true, state: 'ready', installed: false, store: false, devices: [{ id: '7', name: 'fenix 8', connected: true, installed: false }] }))
    expect(host.textContent).toContain('openGym isn’t on it yet')
    await act(async () => { rowTitled('Get openGym for Garmin').click() })
    expect(open).toHaveBeenCalledWith(GARMIN_DOCS, '_blank', 'noopener,noreferrer')
  })

  it('a build without the Garmin link says why, and keeps only the watch switch', async () => {
    await mount(fake({ supported: false, state: 'build', devices: [] }))
    expect(host.textContent).toContain('comes without the Garmin link')
    expect(host.textContent).not.toContain('Open on the watch')
    expect(host.textContent).not.toContain('Look again')
  })

  it('the switch is the one every watch shares', async () => {
    await mount(fake({ supported: true, state: 'ready', installed: true, devices: [] }))
    const sw = host.querySelector('[aria-label="Send workouts to the watch"]')
    await act(async () => { sw.click() })
    expect(readWatchPrefs().enabled).toBe(false)
  })
})
