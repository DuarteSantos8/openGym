// @vitest-environment happy-dom
// Profile's sync status (ia-proposal §5): Gains' own sync and the hub's Gains ↔ NutriTrace
// sync, the two the avatar's dot watches, and one Sync now for both. Against the fake hub.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { resetSyncThrottle, useHubSync } from '../lib/nutrition/sync.js'
import { createFakeNutriTrace, fixtureSyncStatus } from '../lib/nutrition/fake-nutritrace.js'
import SyncStatusCard from './SyncStatusCard.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, nt
const toast = vi.fn()
const syncNow = vi.fn(async () => useStore.getState().sync)
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)) })

function setUp({ syncStatus = fixtureSyncStatus(), user = { id: 3, name: 'Ana' }, sync = { status: 'ok', lastSynced: Date.now() - 60000 } } = {}) {
  nt = createFakeNutriTrace({ syncStatus })
  vi.stubGlobal('fetch', nt.fetch)
  useStore.setState({ user, sync, syncNow, pushState: vi.fn(async () => {}) })
  useUI.setState({ toast })
}

beforeEach(() => {
  useHubSync.getState().reset()
  resetSyncThrottle()
  toast.mockClear()
  syncNow.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('SyncStatusCard', () => {
  it('shows both syncs, each with its state and when it last ran', async () => {
    setUp()
    act(() => root.render(<SyncStatusCard />))
    await settle()
    expect(rowTitled('Training and body').querySelector('.lrow-s').textContent).toMatch(/^All synced · Last synced: /)
    expect(rowTitled('Nutrition').querySelector('.lrow-s').textContent).toMatch(/^All synced · Last synced: /)
    expect(nt.requests.some(r => r.path === '/hub/api/sync/status')).toBe(true)
  })

  it('says when the hub needs the person, and Sync now runs both and says so', async () => {
    setUp({ syncStatus: fixtureSyncStatus('error') })
    act(() => root.render(<SyncStatusCard />))
    await settle()
    expect(rowTitled('Nutrition').querySelector('.lrow-s').textContent).toMatch(/^Nutrition sync needs attention/)
    await act(async () => { rowTitled('Sync now').click() })
    await settle()
    expect(syncNow).toHaveBeenCalledTimes(1)
    expect(nt.requests.some(r => r.method === 'POST' && r.path === '/hub/api/sync/now')).toBe(true)
    expect(toast).toHaveBeenCalledWith('Nutrition sync needs attention')
    // Gains was synced by the first half: the hub run does not push it a second time
    expect(useStore.getState().pushState).not.toHaveBeenCalled()
  })

  it('a hub that does not answer is not "All synced": the toast says nutrition did not sync', async () => {
    setUp()
    act(() => root.render(<SyncStatusCard />))
    await settle()
    nt.failNext('POST', '/hub/api/sync/now', 'offline')
    await act(async () => { rowTitled('Sync now').click() })
    await settle()
    expect(toast).toHaveBeenCalledWith('Training synced, but nutrition did not: the sync service did not answer.')
    expect(toast).not.toHaveBeenCalledWith('All synced')
  })

  it('a training sync that fails says so, without asking the hub', async () => {
    setUp({ sync: { status: 'error', lastError: { status: 502, code: 'http' } } })
    act(() => root.render(<SyncStatusCard />))
    await settle()
    await act(async () => { rowTitled('Sync now').click() })
    await settle()
    expect(toast).toHaveBeenCalledWith('Server error (HTTP 502)')
    expect(nt.requests.some(r => r.path === '/hub/api/sync/now')).toBe(false)
  })

  it('a person the hub has not stored yet reads "Not synced yet"', async () => {
    setUp({ syncStatus: null })
    act(() => root.render(<SyncStatusCard />))
    await settle()
    expect(rowTitled('Nutrition').querySelector('.lrow-s').textContent).toBe('Not synced yet')
  })

  it('is not there for a guest', async () => {
    setUp({ user: null, sync: { status: 'local' } })
    act(() => root.render(<SyncStatusCard />))
    expect(host.textContent).toBe('')
  })
})
