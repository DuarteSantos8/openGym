// @vitest-environment happy-dom
// The device button: the device and state it draws, the words it speaks, hidden where nothing is
// live, and a tap opens the Devices sheet.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ link: { rows: [], overall: 'none' }, open: null }))
vi.mock('./useDeviceLink.js', () => ({ useDeviceLink: () => m.link }))
vi.mock('./DevicesSheet.jsx', () => ({ openDevicesSheet: () => m.open() }))

import LinkSign, { showLinkSign } from './LinkSign.jsx'

const watch = (state, warn = false) => ({ id: 'watch', kind: 'apple', state, warn })
const server = (state, warn = false) => ({ id: 'server', kind: 'server', state, warn })

let host, root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); m.open = vi.fn() })
afterEach(() => { act(() => root.unmount()); host.remove() })
const render = async (rows, overall) => {
  m.link = { rows, overall }
  await act(async () => { root.render(<LinkSign />) })
  return host.querySelector('button.dev-sign')
}

describe('LinkSign', () => {
  it.each([
    ['a live watch', [watch('live')], 'ok', 'watch', 'live', 'Devices: Apple Watch, Live'],
    ['a resting watch', [watch('delayed')], 'ok', 'watch', 'delayed', 'Devices: Apple Watch, Delayed'],
    ['the first look', [], 'checking', 'watch', 'checking', 'Devices: Checking…'],
    ['a silent watch', [watch('notAnswering', true)], 'warn', 'watch', 'trouble', 'Devices: Apple Watch, Not answering'],
    ['the server down', [watch('live'), server('offline', true)], 'warn', 'cloud', 'trouble', 'Devices: Sync server, Offline'],
    ['the server alone', [server('ok')], 'ok', 'cloud', 'live', 'Devices: Sync server, All synced'],
    ['nothing linked', [], 'none', 'phone', 'none', 'Devices: Nothing connected'],
  ])('%s', async (_, rows, overall, device, state, label) => {
    const b = await render(rows, overall)
    expect(b.dataset.device).toBe(device)
    expect(b.dataset.state).toBe(state)
    expect(b.getAttribute('aria-label')).toBe(label)
  })
  it('says nothing in the bar: the words are in the label and the sheet', async () => {
    const b = await render([watch('notAnswering', true)], 'warn')
    expect(b.textContent).toBe('')
  })
  it('the same state re-rendered keeps the same button, so nothing replays', async () => {
    const a = await render([watch('live')], 'ok')
    const b = await render([watch('live')], 'ok')
    expect(b).toBe(a)
  })
  it('a tap opens the Devices sheet', async () => {
    const b = await render([watch('live')], 'ok')
    await act(async () => { b.click(); await new Promise(r => setTimeout(r, 0)) })
    expect(m.open).toHaveBeenCalled()
  })
  it('no device button in the editor, a backfill or the tour', () => {
    expect(showLinkSign({}, false, false)).toBe(true)
    expect(showLinkSign({ backfill: true }, false, false)).toBe(false)
    expect(showLinkSign({}, true, false)).toBe(false)
    expect(showLinkSign({}, false, true)).toBe(false)
  })
})

describe('LinkSign: the wake', () => {
  it('wakes on a change into live, not when it mounts live', async () => {
    let b = await render([watch('live')], 'ok')
    expect(b.dataset.wake).toBeUndefined()
    await render([watch('notAnswering', true)], 'warn')
    b = await render([watch('live')], 'ok')
    expect(b.dataset.wake).toBe('true')
    await render([watch('live')], 'ok')
    expect(b.dataset.wake).toBe('true')
  })
  it('back from a rest it brightens without the wake', async () => {
    await render([watch('delayed')], 'ok')
    const b = await render([watch('live')], 'ok')
    expect(b.dataset.wake).toBeUndefined()
  })
})
