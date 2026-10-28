// @vitest-environment happy-dom
// Issue #239: the local "rest over" alert ignored the Push switch in Settings. Every rest asked
// for the notification permission on its own, and once granted it fired with the switch off —
// a page cannot give a permission back. "On" is this browser holding a push subscription.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'

let showNotification, getNotifications, requestPermission, subscription, originalSettings
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
  getNotifications = vi.fn(async () => [])
  requestPermission = vi.fn(async () => 'granted')
  subscription = null
  globalThis.Notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission })
  window.Notification = globalThis.Notification
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ showNotification, getNotifications, pushManager: { getSubscription: async () => subscription } }) },
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

  // iOS ignores a tag's replacement (issue #172), so the page closes the previous one by hand
  // before showing its own — the worker already does this on a push.
  it('closes the previous rest-timer notification before showing the next', async () => {
    subscription = { endpoint: 'https://push.example/x' }
    const order = []
    getNotifications.mockImplementation(async ({ tag }) => [{ tag, close: () => order.push('close') }])
    showNotification.mockImplementation(() => order.push('show'))
    await runOut()
    expect(getNotifications).toHaveBeenCalledWith({ tag: 'rest-timer' })
    expect(order).toEqual(['close', 'show'])
  })

  it('never asks for the permission by itself — only the switch does', async () => {
    globalThis.Notification.permission = 'default'
    await runOut()
    expect(requestPermission).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()
  })
})
