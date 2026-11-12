// @vitest-environment happy-dom
// The offer made when the app opens (initUpdateNotice): held back while a workout is open, made
// once it is over, also when asking GitHub again fails by then.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEEN_KEY } from '../lib/update-notice.js'

const m = vi.hoisted(() => ({ S: {}, sheets: [], subs: [], check: null, confirm: null }))
const store = get => { const u = () => get(); u.getState = get; u.subscribe = fn => { m.subs.push(fn) }; return u }
vi.mock('../lib/i18n.js', () => ({ t: (s, ...a) => a.reduce((out, v, i) => out.replace(`{${i}}`, v), s) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true, isAndroid: async () => true }))
vi.mock('../lib/channel.js', () => ({ getChannel: async () => 'sideload' }))
vi.mock('../lib/update.js', () => ({ checkForUpdate: (...a) => m.check(...a), downloadAndInstall: vi.fn(), fetchChecksum: vi.fn() }))
vi.mock('../store/useStore.js', () => ({ useStore: store(() => ({ S: m.S })) }))
vi.mock('../store/useUI.js', () => ({ useUI: store(() => ({ sheets: m.sheets, toast: vi.fn(), openSheet: vi.fn() })) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: (...a) => m.confirm(...a) }))

const info = { hasUpdate: true, latestVersion: '9.9.9', apkUrl: 'https://example.invalid/app.apk' }
const changed = () => m.subs.forEach(fn => fn())

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
  Object.assign(m, { S: {}, sheets: [], subs: [], check: vi.fn(async () => info), confirm: vi.fn() })
})
afterEach(() => { vi.useRealTimers() })

async function start() {
  const { initUpdateNotice } = await import('./UpdateNotice.jsx')
  await initUpdateNotice()
  await vi.advanceTimersByTimeAsync(4000)
}

describe('the update offer when the app opens', () => {
  it('asks once, and writes down which version it offered', async () => {
    await start()
    expect(m.confirm).toHaveBeenCalledTimes(1)
    expect(m.confirm.mock.calls[0][0].title).toBe('Update to 9.9.9?')
    expect(localStorage.getItem(SEEN_KEY)).toBe('9.9.9')
  })

  it('waits for the workout to end, and still offers when asking again fails by then', async () => {
    m.S = { active: { id: 'w' } }
    await start()
    expect(m.confirm).not.toHaveBeenCalled()
    expect(localStorage.getItem(SEEN_KEY)).toBe(null)
    // Over an hour later the answer has expired and GitHub cannot be reached.
    m.check = vi.fn(async () => { throw new Error('offline') })
    changed()                                  // still in the workout: nothing
    await vi.advanceTimersByTimeAsync(2000)
    expect(m.confirm).not.toHaveBeenCalled()
    m.S = {}
    changed()
    changed()                                  // two store changes are one retry
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.check).toHaveBeenCalledTimes(1)
    expect(m.confirm).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(SEEN_KEY)).toBe('9.9.9')
    // Offered: later changes do not ask again.
    changed()
    await vi.advanceTimersByTimeAsync(2000)
    expect(m.confirm).toHaveBeenCalledTimes(1)
  })

  it('with the real check: the answer expires after an hour, GitHub is down, the offer is still made', async () => {
    const realFetch = globalThis.fetch
    const latest = { tag_name: 'v9.9.9', assets: [{ name: 'openGym-9.9.9.apk', browser_download_url: 'https://example.invalid/openGym-9.9.9.apk' }] }
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => latest }))
    try {
      m.check = (await vi.importActual('../lib/update.js')).checkForUpdate
      m.S = { active: { id: 'w' } }
      await start()
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect(m.confirm).not.toHaveBeenCalled()
      // Within the hour the kept answer is used: no second request.
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(30 * 60000)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      // Past the hour the workout ends, and asking again fails.
      await vi.advanceTimersByTimeAsync(31 * 60000)
      globalThis.fetch = vi.fn(async () => { throw new Error('offline') })
      m.S = {}
      changed()
      await vi.advanceTimersByTimeAsync(1000)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect(m.confirm).toHaveBeenCalledTimes(1)
      expect(m.confirm.mock.calls[0][0].title).toBe('Update to 9.9.9?')
      expect(localStorage.getItem(SEEN_KEY)).toBe('9.9.9')
      // Offered once: coming back to the app later does not ask a second time.
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(2000)
      expect(m.confirm).toHaveBeenCalledTimes(1)
    } finally { globalThis.fetch = realFetch }
  })

  it('does not offer a held-back version that was offered meanwhile', async () => {
    m.S = { active: { id: 'w' } }
    await start()
    localStorage.setItem(SEEN_KEY, '9.9.9')    // started from About during the workout
    m.check = vi.fn(async () => { throw new Error('offline') })
    m.S = {}
    changed()
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.confirm).not.toHaveBeenCalled()
  })

  it('waits for an open sheet the same way', async () => {
    m.sheets = [{ id: 1 }]
    await start()
    expect(m.confirm).not.toHaveBeenCalled()
    m.sheets = []
    changed()
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.confirm).toHaveBeenCalledTimes(1)
  })
})
