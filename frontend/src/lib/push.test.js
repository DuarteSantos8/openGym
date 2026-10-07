// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://gym.test/" }
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const calls = []
vi.mock('./api.js', () => ({
  api: vi.fn(async (path, opts) => {
    calls.push([path, opts?.method || 'GET', opts?.body ? JSON.parse(opts.body) : null])
    if (path === '/api/push/public-key') return { key: KEY }
    if (path.startsWith('/api/push/status')) return serverHas ? { subscribed: true, deviceId: serverDevice === MINE ? localStorage.getItem('gym_device') : serverDevice } : { subscribed: false }
    return { ok: true }
  })
}))

const KEY = 'BPqx2m6xQ6pQK5hQtMz6d3kM2s7gq4yHqQvWzZ1sK1c'   // any base64url string
const keyBytes = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0)).buffer
}
let serverHas = true
// The device id the server's row carries when it holds the endpoint; MINE is this browser's own.
const MINE = Symbol('this browser')
let serverDevice = MINE
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

// The endpoints this run sent to POST /api/push/subscribe, in order.
const posts = () => calls.filter(c => c[0] === '/api/push/subscribe').map(c => c[2].subscription.endpoint)

beforeEach(() => {
  calls.length = 0
  reg.pushManager.subscribe.mockClear()
  serverHas = true
  serverDevice = MINE
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

  it('keeps a stored id of the shape the server accepts', async () => {
    const { deviceId } = await import('./push.js')
    localStorage.setItem('gym_device', 'dev_aaaaaaaa')
    expect(deviceId()).toBe('dev_aaaaaaaa')
  })
})

// A server that applies the writes the way api/server.js does: the endpoint is stored from the
// first POST on, under the device id sent if it has the shape deviceIdOf accepts, and under none
// otherwise. Whatever state a boot starts from, the second boot must find nothing to write.
describe('against a server that applies the writes, the second boot writes nothing', () => {
  const serverKeeps = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null)
  const bootTwice = async () => {
    const { syncPushSubscription } = await import('./push.js')
    const { api } = await import('./api.js')
    const real = api.getMockImplementation()
    api.mockImplementation(async (path, opts) => {
      const answer = await real(path, opts)
      if (path === '/api/push/subscribe') { serverHas = true; serverDevice = serverKeeps(JSON.parse(opts.body).deviceId) }
      return answer
    })
    try {
      expect(await syncPushSubscription()).toBe(true)
      const first = posts().length
      expect(await syncPushSubscription()).toBe(true)
      return [first, posts().length - first]
    } finally { api.mockImplementation(real) }
  }

  it.each([
    ['stored under no id', () => { serverDevice = null }],
    ['stored under another id', () => { serverDevice = 'someoneelse01' }],
    ['not stored', () => { serverHas = false }]
  ])('%s: one write, then none', async (_, seed) => {
    sub = makeSub(KEY)
    seed()
    expect(await bootTwice()).toEqual([1, 0])
  })

  // A hand-set id the server refuses was sent as it was, the row kept no id, and every boot sent
  // it again. It is replaced by one the server keeps, once, and that one is kept after.
  it.each([['bad!'], ['short77'], ['a'.repeat(65)], ['abc.defghijk']])('a stored id the server refuses (%s) is replaced once, and the sync settles', async stored => {
    const { deviceId } = await import('./push.js')
    localStorage.setItem('gym_device', stored)
    sub = makeSub(KEY)
    serverDevice = null
    expect(await bootTwice()).toEqual([1, 0])
    const id = localStorage.getItem('gym_device')
    expect(id).not.toBe(stored)
    expect(serverKeeps(id)).toBe(id)
    expect(calls.find(c => c[0] === '/api/push/subscribe')[2].deviceId).toBe(id)
    expect(deviceId()).toBe(id)
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

  it('asks the server and does not write when it already holds the endpoint under this browser\'s device id', async () => {
    const { syncPushSubscription } = await import('./push.js')
    sub = makeSub(KEY)
    expect(await syncPushSubscription()).toBe(true)
    expect(calls.map(c => c[1] + ' ' + c[0].split('?')[0])).toEqual(['GET /api/push/public-key', 'GET /api/push/status'])
  })

  // A row from before device ids (or one the worker re-sent without its id) read as stored, so it
  // was never written again: the server could not tell this browser's rest-timer alert from the
  // account's and sent it to every device.
  it('sends the same subscription again, with the device id, when the server holds it under none', async () => {
    const { syncPushSubscription, deviceId } = await import('./push.js')
    sub = makeSub(KEY)
    serverDevice = null
    expect(await syncPushSubscription()).toBe(true)
    expect(calls.map(c => c[1] + ' ' + c[0].split('?')[0])).toEqual(['GET /api/push/public-key', 'GET /api/push/status', 'POST /api/push/subscribe'])
    expect(calls.at(-1)[2]).toEqual({ subscription: { endpoint: 'https://push.example/e1', keys: { p256dh: 'p', auth: 'a' } }, deviceId: deviceId() })
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
    expect(sub.unsubscribe).not.toHaveBeenCalled()
  })

  it('and when the server holds it under another device id', async () => {
    const { syncPushSubscription, deviceId } = await import('./push.js')
    sub = makeSub(KEY)
    serverDevice = 'someoneelse01'
    expect(await syncPushSubscription()).toBe(true)
    expect(posts()).toEqual(['https://push.example/e1'])
    expect(calls.at(-1)[2].deviceId).toBe(deviceId())
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('does not write when an older api answers without a device id at all', async () => {
    const { syncPushSubscription } = await import('./push.js')
    sub = makeSub(KEY)
    serverDevice = undefined
    expect(await syncPushSubscription()).toBe(true)
    expect(posts()).toEqual([])
  })

  it('does not write where this browser has no device id to give (storage refused)', async () => {
    const { syncPushSubscription } = await import('./push.js')
    sub = makeSub(KEY)
    serverDevice = null
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('The operation is insecure.') } })
    try {
      expect(await syncPushSubscription()).toBe(true)
    } finally {
      Object.defineProperty(window, 'localStorage', real)
    }
    expect(posts()).toEqual([])
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

// The worker re-registers a subscription the push service rotated, with no page open and no
// localStorage to read the device id from, so the page leaves the id in a cache the worker reads
// (public/sw.js, pushsubscriptionchange). Without it the row the worker sent lost its device id.
describe('the device id the worker re-registers with', () => {
  let stored
  const fakeCaches = { open: vi.fn(async name => ({ put: async (url, res) => { stored.push([name, String(url), await res.text()]) } })) }
  beforeEach(() => { stored = []; globalThis.caches = fakeCaches })
  afterEach(() => { delete globalThis.caches })

  it('is left for the worker when the browser holds a subscription at boot', async () => {
    const { syncPushSubscription, deviceId } = await import('./push.js')
    sub = makeSub(KEY)
    expect(await syncPushSubscription()).toBe(true)
    expect(stored).toEqual([['opengym-device', '/opengym-device-id', deviceId()]])
  })

  it('and when the switch is turned on', async () => {
    const { enablePush, deviceId } = await import('./push.js')
    await enablePush()
    expect(stored).toEqual([['opengym-device', '/opengym-device-id', deviceId()]])
  })

  it('is not left where the browser holds no subscription', async () => {
    const { syncPushSubscription } = await import('./push.js')
    expect(await syncPushSubscription()).toBe(false)
    expect(stored).toEqual([])
  })

  it('a Cache API that refuses (private mode) changes nothing else', async () => {
    const { syncPushSubscription } = await import('./push.js')
    globalThis.caches = { open: async () => { throw new DOMException('denied', 'SecurityError') } }
    sub = makeSub(KEY)
    serverHas = false
    expect(await syncPushSubscription()).toBe(true)
    expect(calls.filter(c => c[0] === '/api/push/subscribe')).toHaveLength(1)
  })
})

describe('pushSupported', () => {
  it('needs the service worker, PushManager, Notification and an https origin', async () => {
    const { pushSupported } = await import('./push.js')
    expect(pushSupported()).toBe(true)
    expect(location.protocol).toBe('https:')
  })
})
