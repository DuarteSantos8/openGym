// @vitest-environment happy-dom
// Settings → Huawei watch (views/HuaweiSettings.jsx): what the page shows for the phone's Huawei
// link, and that its buttons call the native side (WatchBridge.huaweiPick).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../lib/mobile.js', () => ({ MOBILE: true, nativePlatform: async () => 'android' }))

import HuaweiSettingsPage from './HuaweiSettings.jsx'
import { HUAWEI_DOCS } from '../lib/huawei-view.js'

let host, root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

const fake = status => vi.fn(async name => (name === 'huaweiStatus' ? status : { ok: name === 'huaweiPick' }))
const mount = async api => { await act(async () => { root.render(<HuaweiSettingsPage api={api} />) }); await act(async () => {}) }
const rowTitled = text => [...host.querySelectorAll('button, [role="button"], .lrow')].find(el => el.textContent.includes(text))

describe('Settings → Huawei watch', () => {
  it('lists the watches, says how it works, and offers Look again', async () => {
    await mount(fake({ supported: true, state: 'ready', installed: true, reachable: true, devices: [{ id: '7', name: 'Watch GT 5', connected: true, installed: true }] }))
    expect(host.textContent).toContain('Watch GT 5')
    expect(host.textContent).toContain('Connected')
    expect(host.textContent).toContain('keep it open while you train')
    expect(host.textContent).toContain('Look again')
    expect(host.textContent).not.toContain('Get openGym for Huawei')
  })

  it('a watch without the app: the guide opens on the web', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mount(fake({ supported: true, state: 'ready', installed: false, devices: [{ id: '7', name: 'Watch Fit 4', connected: true, installed: false }] }))
    expect(host.textContent).toContain('openGym isn’t on it yet')
    await act(async () => { rowTitled('Get openGym for Huawei').click() })
    expect(open).toHaveBeenCalledWith(HUAWEI_DOCS, '_blank', 'noopener,noreferrer')
  })

  it('Huawei Health missing: says to install it, and moves on by itself once it is there', async () => {
    vi.useFakeTimers()
    let st = { supported: true, state: 'no-health', devices: [] }
    const api = vi.fn(async name => (name === 'huaweiStatus' ? st : { ok: true }))
    await mount(api)
    expect(host.textContent).toContain('Huawei Health isn’t on this phone.')
    expect(host.textContent).not.toContain('Look again')
    st = { supported: true, state: 'ready', devices: [] }
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(host.textContent).toContain('Huawei Health doesn’t know a watch yet.')
    expect(host.textContent).toContain('Look again')
    vi.useRealTimers()
  })

  it('no permission: Allow in Huawei Health asks, then the page looks again', async () => {
    const api = fake({ supported: true, state: 'no-permission', devices: [] })
    await mount(api)
    expect(host.textContent).toContain('needs your OK in Huawei Health')
    await act(async () => { rowTitled('Allow in Huawei Health').click() })
    expect(api.mock.calls.map(c => c[0]).slice(-2)).toEqual(['huaweiPick', 'huaweiStatus'])
  })

  it('an error: Look again tries once more', async () => {
    const api = fake({ supported: true, state: 'error', devices: [] })
    await mount(api)
    expect(host.textContent).toContain('Couldn’t reach Huawei Health.')
    await act(async () => { rowTitled('Look again').click() })
    expect(api).toHaveBeenCalledWith('huaweiPick')
  })

  it('starting: says it is looking, with no button', async () => {
    await mount(fake({ supported: true, state: 'starting', devices: [] }))
    expect(host.textContent).toContain('Looking for your watch')
    expect(host.textContent).not.toContain('Look again')
  })

  it('a build without the link, or no phone app at all: says so instead of waiting for good', async () => {
    await mount(fake({ supported: false, state: 'build', devices: [] }))
    expect(host.textContent).toContain('can’t talk to a Huawei watch yet')
    expect(host.textContent).not.toContain('Look again')
    await mount(vi.fn(async () => null))
    expect(host.textContent).toContain('can’t talk to a Huawei watch yet')
    expect(host.textContent).not.toContain('Checking')
  })
})
