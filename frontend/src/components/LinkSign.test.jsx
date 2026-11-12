// @vitest-environment happy-dom
// The link sign: one class and word per overall state, hidden where nothing is live, and a tap
// opens the Devices sheet.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ overall: 'ok', open: null }))
vi.mock('./useDeviceLink.js', () => ({ useDeviceLink: () => ({ rows: [], overall: m.overall }) }))
vi.mock('./DevicesSheet.jsx', () => ({ openDevicesSheet: () => m.open() }))

import LinkSign, { showLinkSign } from './LinkSign.jsx'

let host, root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); m.open = vi.fn() })
afterEach(() => { act(() => root.unmount()); host.remove() })
const render = async overall => { m.overall = overall; await act(async () => { root.render(<LinkSign />) }) }

describe('LinkSign', () => {
  it.each(['ok', 'none', 'checking', 'warn'])('shows the %s state', async o => {
    await render(o)
    const b = host.querySelector('button.link-sign')
    expect(b.classList.contains(o)).toBe(true)
    expect(b.getAttribute('aria-label')).toMatch(/^Devices: /)
  })
  it('warn carries the words Check link', async () => {
    await render('warn')
    expect(host.textContent).toContain('Check link')
    await render('ok')
    expect(host.textContent).not.toContain('Check link')
  })
  it('a tap opens the Devices sheet', async () => {
    await render('ok')
    await act(async () => { host.querySelector('button').click(); await new Promise(r => setTimeout(r, 0)) })
    expect(m.open).toHaveBeenCalled()
  })
  it('no link icon in the editor, a backfill or the tour', () => {
    expect(showLinkSign({}, false, false)).toBe(true)
    expect(showLinkSign({ backfill: true }, false, false)).toBe(false)
    expect(showLinkSign({}, true, false)).toBe(false)
    expect(showLinkSign({}, false, true)).toBe(false)
  })
})
