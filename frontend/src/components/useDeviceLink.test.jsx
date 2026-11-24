// @vitest-environment happy-dom
// The hook reads the real store's sync status: a phone with only a server still shows its row.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useDeviceLink } from './useDeviceLink.js'
import { _resetDeviceLink } from '../lib/device-link-live.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, got
const Probe = () => { got = useDeviceLink({ live: false }); return null }
beforeEach(() => { _resetDeviceLink(); host = document.createElement('div'); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); useStore.setState({ sync: { status: 'local' } }) })

describe('useDeviceLink', () => {
  it('shows a server row that warns when the sync status is offline', async () => {
    useStore.setState({ sync: { status: 'offline' } })
    await act(async () => { root.render(<Probe />) })
    expect(got.rows.find(r => r.id === 'server')).toMatchObject({ state: 'offline', warn: true })
    expect(got.overall).toBe('warn')
  })

  it('warns at once on a held sync, which waits for the user and not for the network', async () => {
    useStore.setState({ sync: { status: 'held' } })
    await act(async () => { root.render(<Probe />) })
    expect(got.rows.find(r => r.id === 'server')).toMatchObject({ state: 'wait', warn: true, action: 'retry' })
  })

  it('passes a pending sync on to the server row', async () => {
    useStore.setState({ sync: { status: 'offline', pending: true } })
    await act(async () => { root.render(<Probe />) })
    expect(got.rows.find(r => r.id === 'server').pending).toBe(true)
  })
})
