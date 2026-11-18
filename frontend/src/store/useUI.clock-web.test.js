// @vitest-environment happy-dom
// The workout Timer's countdown (components/WorkoutClock.jsx) in the browser: the notification at
// its end and the server's push say the time is up, and name no next set, where a rest after a set
// names the set waiting.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

import { useUI } from './useUI.js'
import { useStore } from './useStore.js'
import { api } from '../lib/api.js'

let showNotification, originalS, originalUser
const hide = hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
}
const pushes = () => api.mock.calls.filter(([p]) => p === '/api/push/rest-timer').map(([, o]) => JSON.parse(o.body))
// A set waiting, so a rest after a set has one to name: "Plank, 45 s".
const active = { id: 'w', cur: 0, entries: [{ id: 'x1', n: 'Plank', target: { mode: 'time', sec: 45 }, sets: [{ done: false }] }] }

beforeEach(() => {
  vi.useFakeTimers()
  originalS = useStore.getState().S
  originalUser = useStore.getState().user
  useStore.setState({ S: { ...originalS, sound: false, active } })
  useUI.setState({ timer: null })
  api.mockClear()
  showNotification = vi.fn()
  globalThis.Notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission: vi.fn() })
  window.Notification = globalThis.Notification
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ showNotification, getNotifications: async () => [], pushManager: { getSubscription: async () => ({ endpoint: 'https://push.example/x' }) } }) },
  })
})
afterEach(() => {
  useUI.getState().stopRest()
  hide(false)
  useStore.setState({ S: originalS, user: originalUser })
  delete globalThis.Notification
  vi.useRealTimers()
})

describe('the workout Timer in the browser', () => {
  it('its notification says the time is up, a rest after a set names the next set', async () => {
    useUI.getState().startRest(2, 0)
    hide(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(showNotification.mock.calls.at(-1)[0]).toBe('Rest’s over: Plank, 45 s')
    hide(false)
    useUI.getState().startRest(2, undefined, { clock: true })
    hide(true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(showNotification.mock.calls.at(-1)[0]).toBe('Time’s up.')
  })

  it('asks the server for a timer push, with no next set', () => {
    useStore.setState({ user: { id: 'u1' } })
    useUI.getState().startRest(30, 0)
    expect(pushes().at(-1)).toMatchObject({ seconds: 30, next: 'Plank, 45 s' })
    expect(pushes().at(-1).timer).toBeUndefined()
    useUI.getState().startRest(30, undefined, { clock: true })
    expect(pushes().at(-1)).toMatchObject({ seconds: 30, timer: true })
    expect(pushes().at(-1).next).toBeUndefined()
    useUI.getState().addRest(15)   // moved, it is booked again the same way
    expect(pushes().at(-1)).toMatchObject({ seconds: 45, timer: true })
    expect(pushes().at(-1).next).toBeUndefined()
  })
})
