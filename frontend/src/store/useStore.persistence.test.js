// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
const nativeSaveMock = vi.hoisted(() => vi.fn())
const nativeLoadMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/api.js', () => ({ api: apiMock, setRemoteAuth: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: true, nativeLoad: nativeLoadMock, nativeSave: nativeSaveMock,
  syncReminder: vi.fn().mockResolvedValue(true), writeAutoBackup: vi.fn()
}))

describe('durable local persistence failures', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    apiMock.mockReset()
    nativeLoadMock.mockReset().mockResolvedValue(null)
    nativeSaveMock.mockReset().mockResolvedValue(true)
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps a visible edit and marks it dirty when localStorage is full', async () => {
    const { useStore } = await import('./useStore.js')
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'gym_state_v1') throw new DOMException('quota exceeded', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })
    const events = []
    const onError = event => events.push(event.detail)
    globalThis.addEventListener('opengym:persistence-error', onError)

    const store = useStore.getState()
    store.update(state => { state.routines = [{ id: 'quota-routine', name: 'Still visible', ex: [] }] }, false)

    expect(useStore.getState().S.routines[0].name).toBe('Still visible')
    expect(useStore.getState().persistenceError).toBe('local_storage_write_failed')
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(events).toContainEqual({ kind: 'local_storage_write_failed' })
    process.stdout.write('gate2_localstorage_quota_edit_visible=true\n')
    process.stdout.write('gate2_localstorage_quota_error=local_storage_write_failed\n')
    process.stdout.write('gate2_localstorage_quota_dirty=true\n')
    globalThis.removeEventListener('opengym:persistence-error', onError)
  })

  it('keeps the edit and exposes native mirror failure after the debounce', async () => {
    nativeSaveMock.mockResolvedValue(false)
    const { useStore } = await import('./useStore.js')
    const store = useStore.getState()
    store.update(state => { state.routines = [{ id: 'native-routine', name: 'Native failure visible', ex: [] }] }, false)

    await vi.advanceTimersByTimeAsync(801)
    expect(nativeSaveMock).toHaveBeenCalled()
    expect(useStore.getState().S.routines[0].name).toBe('Native failure visible')
    expect(useStore.getState().persistenceError).toBe('native_persistence_failed')
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    process.stdout.write('gate2_native_persistence_edit_visible=true\n')
    process.stdout.write('gate2_native_persistence_error=native_persistence_failed\n')
    process.stdout.write('gate2_native_persistence_dirty=true\n')
  })
})
