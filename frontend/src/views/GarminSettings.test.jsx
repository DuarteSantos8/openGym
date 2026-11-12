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
import { GARMIN_STORE } from '../lib/garmin-view.js'

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

  it('a Garmin without the app: Garmin Connect opens the store page', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const api = vi.fn(async name => (name === 'garminStatus' ? { supported: true, state: 'ready', installed: false, store: true, devices: [{ id: '7', name: 'fenix 8', connected: true, installed: false }] } : { ok: true }))
    await mount(api)
    expect(host.textContent).toContain('openGym isn’t on it yet')
    await act(async () => { rowTitled('Get openGym for Garmin').click() })
    expect(api).toHaveBeenCalledWith('garminStore')
    expect(open).not.toHaveBeenCalled()
  })

  it('and when Garmin Connect cannot open it, the store page on the web does (never a dead button)', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    // garminStore answers { ok: false }: the link is not up, or Garmin Connect said no
    await mount(fake({ supported: true, state: 'ready', installed: false, store: true, devices: [{ id: '7', name: 'fenix 8', connected: true, installed: false }] }))
    await act(async () => { rowTitled('Get openGym for Garmin').click() })
    expect(GARMIN_STORE).toBe('https://apps.garmin.com/apps/62e66310-66de-4bdd-8e40-5d2c0d853a08')
    expect(open).toHaveBeenCalledWith(GARMIN_STORE, '_blank', 'noopener,noreferrer')
  })

  it('Garmin Connect missing: says to install it and come back, and asks again by itself', async () => {
    vi.useFakeTimers()
    let st = { supported: true, state: 'no-gcm', devices: [] }
    const api = vi.fn(async name => (name === 'garminStatus' ? st : { ok: true }))
    await mount(api)
    expect(host.textContent).toContain('Garmin Connect isn’t on this phone. Install it, pair your watch there, then come back here.')
    expect(host.textContent).not.toContain('Look again')
    // installed meanwhile: the page asks every few seconds and moves on without a tap
    st = { supported: true, state: 'ready', devices: [] }
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(host.textContent).toContain('Garmin Connect doesn’t know a watch yet. Pair yours there first.')
    expect(host.textContent).toContain('Look again')
    vi.useRealTimers()
  })

  it('Garmin Connect too old: says so, and Look again starts the link over', async () => {
    const api = fake({ supported: true, state: 'gcm-upgrade', devices: [] })
    await mount(api)
    expect(host.textContent).toContain('Garmin Connect needs an update')
    await act(async () => { rowTitled('Look again').click() })
    expect(api).toHaveBeenCalledWith('garminPick')
  })

  it('the watch out of reach, never heard from: says so instead of offering the app', async () => {
    await mount(fake({ supported: true, state: 'ready', installed: false, reachable: false, store: true, devices: [{ id: '7', name: 'Forerunner 55', connected: false }] }))
    expect(host.textContent).toContain('Forerunner 55')
    expect(host.textContent).toContain('Not in reach')
    expect(host.textContent).toContain('Your Garmin isn’t in reach right now.')
    expect(host.textContent).not.toContain('Get openGym for Garmin')
    expect(host.textContent).toContain('Look again')
  })

  it('the watch has the app but is out of reach: it catches up later', async () => {
    await mount(fake({ supported: true, state: 'ready', installed: true, reachable: false, devices: [{ id: '7', name: 'Forerunner 55', connected: false, installed: true }] }))
    expect(host.textContent).toContain('It catches up as soon as the watch is in reach.')
    expect(host.textContent).not.toContain('Get openGym for Garmin')
  })

  it('the link could not start: says so, and Look again tries once more', async () => {
    const api = fake({ supported: true, state: 'error', devices: [] })
    await mount(api)
    expect(host.textContent).toContain('Couldn’t reach Garmin Connect. Try again in a moment.')
    await act(async () => { rowTitled('Look again').click() })
    expect(api).toHaveBeenCalledWith('garminPick')
  })

  it('no phone app at all (the web): the page says this build has no link instead of waiting for good', async () => {
    await mount(vi.fn(async () => null))
    expect(host.textContent).toContain('comes without the Garmin link')
    expect(host.textContent).not.toContain('Checking')
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
