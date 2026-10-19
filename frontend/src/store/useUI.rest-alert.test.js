// @vitest-environment happy-dom
// Issue #239: the local "rest over" alert ignored the Push switch in Settings. Every rest asked
// for the notification permission on its own, and once granted it fired with the switch off —
// a page cannot give a permission back. "On" is this browser holding a push subscription.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'

let showNotification, requestPermission, subscription, originalSettings
const hide = hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
}
const runOut = async () => {
  useUI.getState().startRest(2)
  hide(true)
  await vi.advanceTimersByTimeAsync(3000)
}

beforeEach(() => {
  vi.useFakeTimers()
  originalSettings = useStore.getState().S
  useStore.setState({ S: { ...originalSettings, sound: false }, user: null })
  useUI.setState({ timer: null })
  showNotification = vi.fn()
  requestPermission = vi.fn(async () => 'granted')
  subscription = null
  globalThis.Notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission })
  window.Notification = globalThis.Notification
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ showNotification, pushManager: { getSubscription: async () => subscription } }) },
  })
})
afterEach(() => {
  useUI.getState().stopRest()
  hide(false)
  useStore.setState({ S: originalSettings })
  delete globalThis.Notification
  vi.useRealTimers()
})

describe('the local rest-over alert follows the Push switch', () => {
  it('stays silent with the switch off, even though the permission is granted', async () => {
    await runOut()
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('fires once with the switch on, tagged like the server push, without repeating the title', async () => {
    subscription = { endpoint: 'https://push.example/x' }
    await runOut()
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, opts] = showNotification.mock.calls[0]
    expect(title).toBe('Rest’s over. Next set!')
    expect(opts.tag).toBe('rest-timer')
    expect(opts.body).toBeUndefined()
  })

  it('never asks for the permission by itself — only the switch does', async () => {
    globalThis.Notification.permission = 'default'
    await runOut()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()
  })

  it.each([false, true])('interval work alerts follow notification permission and subscription (enabled=%s)', async enabled => {
    subscription = enabled ? { endpoint: 'https://push.example/x' } : null
    useUI.getState().startWork(2, 'Work', vi.fn(), { interval: 'running-group' })
    hide(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(showNotification).toHaveBeenCalledTimes(enabled ? 1 : 0)
    if (enabled) expect(showNotification.mock.calls[0][0]).toBe('Interval complete')
    expect(requestPermission).not.toHaveBeenCalled()
  })
})
