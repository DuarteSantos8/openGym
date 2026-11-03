// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The gym reminder (#614): settings kept on this device only, the no-nag rule the native side
   applies when a gym is entered, and the plugin wrapper (never resolving with the bare proxy). */
const mocks = vi.hoisted(() => ({
  MOBILE: true, platform: 'android', registered: 0, calls: [], listeners: {},
  get: null, configure: null, status: null, auth: null,
}))
vi.mock('./mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('./api.js', () => ({ remoteAuth: () => mocks.auth }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
  registerPlugin: name => {
    mocks.registered++
    expect(name).toBe('GymReminder')
    // A Capacitor-style proxy: every property is a native method, `then` included, and a `then`
    // that never calls back is what hung the Coach (#42). Resolving with it would hang here too.
    return new Proxy({}, {
      get: (_, k) => {
        if (k === 'get') return async () => mocks.get
        if (k === 'configure') return async a => { mocks.calls.push(['configure', a]); return mocks.configure }
        if (k === 'status') return async a => { mocks.calls.push(['status', a]); return mocks.status }
        if (k === 'server') return async a => { mocks.calls.push(['server', a]) }
        if (k === 'addListener') return async (ev, fn) => { mocks.listeners[ev] = fn; return { remove: () => { delete mocks.listeners[ev] } } }
        return () => new Promise(() => {})
      },
    })
  },
}))
const ln = vi.hoisted(() => ({ listeners: {} }))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { addListener: async (ev, fn) => { ln.listeners[ev] = fn; return { remove: () => { delete ln.listeners[ev] } } } },
}))

import {
  clampRadius, normGym, normConfig, normWindow, inWindow, skipReason, statusOf, copyFor, distanceM,
  readGymConfig, saveGymConfig, loadGymConfig, pushGymStatus, onGymReminderOpen, _resetGymReminder,
  GYM_KEY, RADIUS, MAX_GYMS, NOTIFICATION_ID,
} from './gym-reminder.js'

const at = (iso, hhmm) => new Date(`${iso}T${hhmm}:00`)
const gym = (over = {}) => ({ id: 'g1', name: 'Downtown', lat: 47.3769, lng: 8.5417, radius: 100, text: '', ...over })
const on = (over = {}) => ({ on: true, gyms: [gym()], window: null, ...over })
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  mocks.MOBILE = true; mocks.platform = 'android'; mocks.registered = 0; mocks.calls = []; mocks.listeners = {}; mocks.auth = null
  mocks.get = null; mocks.configure = { watching: 1, permission: { location: 'granted', background: 'granted' } }; mocks.status = undefined
  ln.listeners = {}
  localStorage.clear()
  _resetGymReminder()
})

describe('settings', () => {
  it('radius: 100 m by default, kept between 50 and 500', () => {
    expect(clampRadius(undefined)).toBe(RADIUS.def)
    expect(clampRadius('abc')).toBe(100)
    expect(clampRadius(10)).toBe(50)
    expect(clampRadius(9000)).toBe(500)
    expect(clampRadius(149.6)).toBe(150)
    expect(normGym({ lat: 1, lng: 2 }).radius).toBe(100)
  })
  it('a gym needs a real place; name and text are trimmed and capped', () => {
    expect(normGym({ lat: 95, lng: 0 })).toBe(null)
    expect(normGym({ lat: 0, lng: 0 })).toBe(null)
    expect(normGym({ lat: 'x', lng: 1 })).toBe(null)
    const g = normGym({ id: 'a', lat: 47.123456789, lng: 8.1, name: '  Home gym  ', text: 'x'.repeat(500) })
    expect(g).toMatchObject({ id: 'a', lat: 47.123457, name: 'Home gym' })
    expect(g.text).toHaveLength(120)
    expect(normGym({ lat: 1, lng: 2 }).id).toMatch(/^g/)
  })
  it('off by default, several gyms, duplicates dropped, at most 20 (iOS watches 20 regions)', () => {
    expect(normConfig(undefined)).toEqual({ on: false, gyms: [], window: null })
    const many = Array.from({ length: 25 }, (_, i) => gym({ id: 'g' + i, lat: 47 + i / 100 }))
    expect(normConfig({ on: true, gyms: [...many, gym({ id: 'g0' })] }).gyms).toHaveLength(MAX_GYMS)
    expect(normConfig({ gyms: [gym(), gym()] }).gyms).toHaveLength(1)
    expect(normConfig({ on: 'yes' }).on).toBe(false)
  })
  it('the time window: both ends valid, equal ends mean any time', () => {
    expect(normWindow({ from: '06:00', to: '22:00' })).toEqual({ from: '06:00', to: '22:00' })
    expect(normWindow({ from: '06:00', to: '06:00' })).toBe(null)
    expect(normWindow({ from: '6:00', to: '22:00' })).toBe(null)
    expect(normWindow({ from: '24:00', to: '22:00' })).toBe(null)
  })
  it('inWindow, also across midnight', () => {
    const day = { from: '06:00', to: '22:00' }
    expect(inWindow(day, at('2026-10-15', '05:59'))).toBe(false)
    expect(inWindow(day, at('2026-10-15', '06:00'))).toBe(true)
    expect(inWindow(day, at('2026-10-15', '21:59'))).toBe(true)
    expect(inWindow(day, at('2026-10-15', '22:00'))).toBe(false)
    const night = { from: '22:00', to: '02:00' }
    expect(inWindow(night, at('2026-10-15', '23:30'))).toBe(true)
    expect(inWindow(night, at('2026-10-15', '01:30'))).toBe(true)
    expect(inWindow(night, at('2026-10-15', '12:00'))).toBe(false)
    expect(inWindow(null, at('2026-10-15', '03:00'))).toBe(true)
  })
  it('distanceM is about right (Zurich HB to Bellevue ≈ 1.6 km)', () => {
    const d = distanceM({ lat: 47.3779, lng: 8.5403 }, { lat: 47.3667, lng: 8.5450 })
    expect(d).toBeGreaterThan(1200)
    expect(d).toBeLessThan(1400)
  })
})

describe('no-nag rule (what the native side applies when a gym is entered)', () => {
  const now = at('2026-10-15', '18:00')
  const status = (over = {}) => ({ trainedOn: '2026-10-14', quietOn: '', activeSince: 0, ...over })
  it('goes off on a normal day', () => {
    expect(skipReason({ config: on(), status: status(), now })).toBe(null)
  })
  it('off, or no gym: never', () => {
    expect(skipReason({ config: on({ on: false }), status: status(), now })).toBe('off')
    expect(skipReason({ config: on({ gyms: [] }), status: status(), now })).toBe('off')
  })
  it('max once a day', () => {
    expect(skipReason({ config: on(), status: status(), lastFired: '2026-10-15', now })).toBe('fired')
    expect(skipReason({ config: on(), status: status(), lastFired: '2026-10-14', now })).toBe(null)
  })
  it('not after training today, nor on an excused day', () => {
    expect(skipReason({ config: on(), status: status({ trainedOn: '2026-10-15' }), now })).toBe('trained')
    expect(skipReason({ config: on(), status: status({ quietOn: '2026-10-15' }), now })).toBe('quiet')
  })
  it('not while a workout runs; a session left open since yesterday does not count', () => {
    expect(skipReason({ config: on(), status: status({ activeSince: now.getTime() - 3600e3 }), now })).toBe('active')
    expect(skipReason({ config: on(), status: status({ activeSince: now.getTime() - 13 * 3600e3 }), now })).toBe(null)
  })
  it('only inside the optional time window', () => {
    const config = on({ window: { from: '06:00', to: '12:00' } })
    expect(skipReason({ config, status: status(), now })).toBe('window')
    expect(skipReason({ config, status: status(), now: at('2026-10-15', '07:00') })).toBe(null)
  })
})

describe('status for the native side', () => {
  it('the last day trained, a running session, an excused today', () => {
    const S = {
      workouts: [{ d: '2026-10-10' }, { d: '2026-10-14' }, { d: '2026-10-12' }],
      active: { start: 1234, entries: [] },
      dayNotes: { '2026-10-15': { tag: 'sick' } },
    }
    const st = statusOf(S, at('2026-10-15', '09:00'))
    expect(st.trainedOn).toBe('2026-10-14')
    expect(st.activeSince).toBe(1234)
    expect(st.title).toBe('Gym spotted')
    expect(st.body).toBe('Ready for your workout? 💪')
  })
  it('editing an old workout or logging one after the fact is not a running session', () => {
    expect(statusOf({ active: { start: 5, editingWorkoutId: 'w1' } }).activeSince).toBe(0)
    expect(statusOf({ active: { start: 5, backfill: true } }).activeSince).toBe(0)
    expect(statusOf({}).activeSince).toBe(0)
  })
  it('a gym with its own text uses it', () => {
    const st = statusOf({})
    expect(copyFor(gym({ text: 'Leg day lives here' }), st)).toEqual({ title: 'Gym spotted', body: 'Leg day lives here' })
    expect(copyFor(gym(), st).body).toBe('Ready for your workout? 💪')
  })
})

describe('kept on the device, never in the synced state', () => {
  it('saving writes the device key and hands the native side the config', async () => {
    const r = await saveGymConfig(on())
    expect(r.watching).toBe(1)
    expect(readGymConfig().on).toBe(true)
    // only the switch in WebView storage (it lands in phone backups); no place, no name
    expect(JSON.parse(localStorage.getItem(GYM_KEY))).toEqual({ on: true })
    expect(localStorage.getItem(GYM_KEY)).not.toMatch(/47\.37|Downtown/)
    expect(mocks.calls).toEqual([['configure', { config: normConfig(on()) }]])
    // nothing went into the profile's storage key
    expect(localStorage.getItem('gym_state_v1')).toBe(null)
  })
  it('with the profile: today is sent first, so the native side never acts on stale news', async () => {
    await saveGymConfig(on(), { workouts: [{ d: '2026-10-01' }] })
    expect(mocks.calls.map(c => c[0])).toEqual(['server', 'status', 'configure'])
  })
  it('server: a paired phone hands over its server for the arrival check, once per change; no server, an empty one', async () => {
    localStorage.setItem(GYM_KEY, JSON.stringify(on()))
    await pushGymStatus({ workouts: [] })
    expect(mocks.calls.filter(c => c[0] === 'server')).toEqual([['server', { server: '' }]])
    mocks.auth = { base: 'https://gym.example', headers: { Authorization: 'Bearer t' } }
    await pushGymStatus({ workouts: [] })
    await pushGymStatus({ workouts: [] })
    expect(mocks.calls.filter(c => c[0] === 'server')).toEqual([
      ['server', { server: '' }],
      ['server', { server: 'https://gym.example', headers: { Authorization: 'Bearer t' } }],
    ])
    // never in the page's own storage
    expect(JSON.stringify({ ...localStorage })).not.toContain('Bearer')
  })
  it('loading prefers the native copy (WebView storage can be evicted)', async () => {
    localStorage.setItem(GYM_KEY, JSON.stringify(on({ on: false })))
    mocks.get = { config: on(), permission: { location: 'granted', background: 'prompt' } }
    const r = await loadGymConfig()
    expect(r.config.on).toBe(true)
    expect(r.permission.background).toBe('prompt')
    expect(readGymConfig().on).toBe(true)
  })
  it('the web build: no plugin, nothing native, settings still readable', async () => {
    mocks.MOBILE = false
    const r = await saveGymConfig(on())
    expect(r.watching).toBe(0)
    expect(mocks.registered).toBe(0)
    expect(await pushGymStatus({ workouts: [] })).toBe(false)
  })
  it('status: only with the reminder on, and only when something changed', async () => {
    expect(await pushGymStatus({ workouts: [] })).toBe(false)
    localStorage.setItem(GYM_KEY, JSON.stringify(on()))
    expect(await pushGymStatus({ workouts: [] })).toBe(true)
    expect(await pushGymStatus({ workouts: [] })).toBe(false)
    expect(await pushGymStatus({ workouts: [{ d: '2026-10-15' }] })).toBe(true)
    expect(mocks.calls.filter(c => c[0] === 'status')).toHaveLength(2)
  })
})

describe('a tap on the notification', () => {
  it('Android: the plugin\'s open event', async () => {
    const cb = vi.fn()
    const stop = onGymReminderOpen(cb)
    await flush(); await flush()
    mocks.listeners.open()
    expect(cb).toHaveBeenCalledTimes(1)
    stop()
    expect(mocks.listeners.open).toBeUndefined()
  })
  it('iOS: Capacitor\'s local-notification tap with our id, not the other notifications', async () => {
    mocks.platform = 'ios'
    const cb = vi.fn()
    onGymReminderOpen(cb)
    await flush(); await flush(); await flush()
    const fire = ln.listeners.localNotificationActionPerformed
    fire({ actionId: 'tap', notification: { id: 1000 } })
    fire({ actionId: 'dismiss', notification: { id: NOTIFICATION_ID } })
    expect(cb).not.toHaveBeenCalled()
    fire({ actionId: 'tap', notification: { id: NOTIFICATION_ID } })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
