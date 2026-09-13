// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://gym.test/" }
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = []
vi.mock('./api.js', () => ({
  api: vi.fn(async (path, opts) => {
    calls.push([path, opts?.method || 'GET', opts?.body ? JSON.parse(opts.body) : null])
    if (path === '/api/push/public-key') return { key: KEY }
    if (path.startsWith('/api/push/status')) return { subscribed: serverHas }
    return { ok: true }
  })
}))

const KEY = 'BPqx2m6xQ6pQK5hQtMz6d3kM2s7gq4yHqQvWzZ1sK1c'   // any base64url string
const keyBytes = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0)).buffer
}
let serverHas = true
let sub = null
const makeSub = key => ({
  endpoint: 'https://push.example/e1', options: { applicationServerKey: keyBytes(key) },
  toJSON: () => ({ endpoint: 'https://push.example/e1', keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => { sub = null; return true })
})
const reg = {
  pushManager: {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async ({ applicationServerKey }) => { sub = makeSub(KEY); sub.options.applicationServerKey = applicationServerKey; return sub })
  }
}

beforeEach(() => {
  calls.length = 0
  serverHas = true
  sub = null
  localStorage.clear()
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg) }, configurable: true })
  globalThis.PushManager = function () {}
  globalThis.Notification = { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }
})

describe('deviceId', () => {
  it('makes one token per browser and keeps it', async () => {
    const { deviceId } = await import('./push.js')
    const a = deviceId()
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(deviceId()).toBe(a)
    expect(localStorage.getItem('gym_device')).toBe(a)
  })
})

describe('syncPushSubscription', () => {
  it('does nothing without permission or without a subscription', async () => {
    const { syncPushSubscription } = await import('./push.js')
    Notification.permission = 'default'
    expect(await syncPushSubscription()).toBe(false)
    Notification.permission = 'granted'
    expect(await syncPushSubscription()).toBe(false)
    expect(calls).toEqual([])
  })

  it('asks the server and does not write when it already holds the endpoint', async () => {
    const { syncPushSubscription } = await import('./push.js')
    sub = makeSub(KEY)
    expect(await syncPushSubscription()).toBe(true)
    expect(calls.map(c => c[1] + ' ' + c[0].split('?')[0])).toEqual(['GET /api/push/public-key', 'GET /api/push/status'])
  })

  it('re-registers a subscription the server lost, with the device id', async () => {
    const { syncPushSubscription, deviceId } = await import('./push.js')
    sub = makeSub(KEY)
    serverHas = false
    expect(await syncPushSubscription()).toBe(true)
    const post = calls.find(c => c[0] === '/api/push/subscribe')
    expect(post[2]).toEqual({ subscription: { endpoint: 'https://push.example/e1', keys: { p256dh: 'p', auth: 'a' } }, deviceId: deviceId() })
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('replaces a subscription made against a key the server no longer has', async () => {
    const { syncPushSubscription } = await import('./push.js')
    const old = makeSub('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    sub = old
    expect(await syncPushSubscription()).toBe(true)
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1)
    expect(new Uint8Array(reg.pushManager.subscribe.mock.calls[0][0].applicationServerKey)).toEqual(new Uint8Array(keyBytes(KEY)))
    expect(calls.some(c => c[0] === '/api/push/subscribe')).toBe(true)
    expect(calls.some(c => c[0].startsWith('/api/push/status'))).toBe(false)
  })
})

describe('pushSupported', () => {
  it('needs the service worker, PushManager, Notification and an https origin', async () => {
    const { pushSupported } = await import('./push.js')
    expect(pushSupported()).toBe(true)
    expect(location.protocol).toBe('https:')
  })
})
