// The Capacitor side of the rest alert (#296). Both phone apps have a RestAlert plugin
// (RestAlertPlugin.java, RestAlertPlugin.swift); anywhere else nothing may be registered, and the
// listener this file adds at startup must not reject with nothing to catch it. On Android
// the plugin is a Capacitor proxy that answers `then` with a native call that never settles, so
// it must never become the value of a promise (the Coach hang, #42): here that would hang every
// rest alert call.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')   // lib/mobile.js: MOBILE = import.meta.env.VITE_MOBILE === '1'
  const store = new Map()
  vi.stubGlobal('localStorage', { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), clear: () => store.clear() })
  return { platform: 'android', calls: [], registerPlugin: null, perm: 'granted', request: null }
})

// Shaped like the proxy registerPlugin() returns: every property is a native method, `then`
// included, and that one never calls back. Off the phone every method rejects, as Capacitor's do
// for a plugin the platform does not have.
const pluginProxy = () => new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'then') return () => new Promise(() => {})
    return (...args) => {
      h.calls.push(String(prop))
      if (h.platform !== 'android' && h.platform !== 'ios') return Promise.reject(new Error(`"RestAlert.${String(prop)}()" is not implemented on ${h.platform}`))
      return Promise.resolve(prop === 'addListener' ? { remove: async () => {} } : undefined)
    }
  },
})

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform },
  registerPlugin: (...args) => h.registerPlugin(...args),
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: h.perm }),
    requestPermissions: (...args) => (h.request ? h.request(...args) : Promise.resolve({ display: 'granted' })),
  },
}))

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }

const unhandled = []
const onUnhandled = reason => unhandled.push(reason)

beforeEach(() => {
  vi.resetModules()
  h.calls = []
  h.registerPlugin = vi.fn(() => pluginProxy())
  h.perm = 'granted'
  h.request = null
  localStorage.clear()
  unhandled.length = 0
  process.on('unhandledRejection', onUnhandled)
})
afterAll(() => {
  process.off('unhandledRejection', onUnhandled)
  vi.unstubAllEnvs()
})

describe('the rest alert in the iOS app', () => {
  it('schedules the end on the phone, like Android, and rejects nothing', async () => {
    h.platform = 'ios'
    const alert = await import('./rest-alert.js')
    await expect(alert.armRestAlert(Date.now() + 90_000, { totalSec: 90 })).resolves.toBe(true)
    alert.holdRestAlert(60, 90)
    alert.disarmRestAlert()
    await settle()
    expect(h.registerPlugin).toHaveBeenCalledTimes(1)
    expect(h.calls).toEqual(expect.arrayContaining(['schedule', 'hold', 'cancel']))
    expect(unhandled).toEqual([])
  })
})

describe('the rest alert in a browser shell', () => {
  it('registers nothing, rejects nothing and leaves the end to the server push', async () => {
    h.platform = 'web'
    const alert = await import('./rest-alert.js')
    await expect(alert.armRestAlert(Date.now() + 90_000, { totalSec: 90 })).resolves.toBe(false)
    alert.holdRestAlert(60, 90)
    alert.setRestAccent('red')
    alert.disarmRestAlert()
    await settle()
    expect(h.registerPlugin).not.toHaveBeenCalled()
    expect(h.calls).toEqual([])
    expect(unhandled).toEqual([])
  })
})

describe('the rest alert in the Android app', () => {
  it('reaches the plugin without ever waiting on the proxy, and registers it once', async () => {
    h.platform = 'android'
    const alert = await import('./rest-alert.js')
    await expect(alert.armRestAlert(Date.now() + 90_000, { totalSec: 90 })).resolves.toBe(true)
    alert.holdRestAlert(60, 90)
    alert.setRestAccent('red')
    alert.disarmRestAlert()
    await settle()
    expect(h.registerPlugin).toHaveBeenCalledTimes(1)
    expect(h.calls).toContain('addListener')
    expect(h.calls.filter(c => c !== 'addListener')).toEqual(['schedule', 'hold', 'setAccent', 'cancel'])
    expect(unhandled).toEqual([])
  })

  it('passes what the notification needs: the end, the whole rest, the labels and the accent', async () => {
    h.platform = 'android'
    const schedule = vi.fn(async () => {})
    h.registerPlugin = vi.fn(() => new Proxy({}, {
      get: (_, prop) => prop === 'then' ? () => new Promise(() => {}) : prop === 'schedule' ? schedule : async () => ({ remove: async () => {} }),
    }))
    const alert = await import('./rest-alert.js')
    const at = Date.now() + 90_000
    await alert.armRestAlert(at, { totalSec: 90, accent: 'red', sound: false })
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
      at, totalMs: 90_000, sound: false, title: 'Rest’s over. Next set!', pause: 'Pause', resume: 'Resume', skip: 'Skip',
      accent: (0xff000000 | 0xff453a) >>> 0, ink: 0xffffffff,
    }))
  })

  // Settings → Vibrate off, with the phone locked: the notification still buzzed the whole
  // pattern, and so did the stand-in buzz where notifications are off, because neither was told.
  it('tells the plugin whether the end may buzz, on a channel that matches', async () => {
    h.platform = 'android'
    const schedule = vi.fn(async () => {})
    h.registerPlugin = vi.fn(() => new Proxy({}, {
      get: (_, prop) => prop === 'then' ? () => new Promise(() => {}) : prop === 'schedule' ? schedule : async () => ({ remove: async () => {} }),
    }))
    const alert = await import('./rest-alert.js')
    await alert.armRestAlert(Date.now() + 90_000, { totalSec: 90 })
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ vibrate: true, channelId: 'rest-over' }))
    await alert.armRestAlert(Date.now() + 90_000, { totalSec: 90, vibrate: false })
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ vibrate: false, channelId: 'rest-over-quiet' }))
  })
})

// #375: "Vibrate when the phone is on silent".
describe('the alarm buzz in the Android app', () => {
  const capture = () => {
    const calls = {}
    h.registerPlugin = vi.fn(() => new Proxy({}, {
      get: (_, prop) => {
        if (prop === 'then') return () => new Promise(() => {})
        return async (...args) => { (calls[prop] = calls[prop] || []).push(args[0]); return prop === 'addListener' ? { remove: async () => {} } : undefined }
      },
    }))
    return calls
  }

  it('tells the alarm to buzz as an alarm only with Vibrate on', async () => {
    h.platform = 'android'
    const calls = capture()
    const alert = await import('./rest-alert.js')
    await alert.armRestAlert(Date.now() + 90_000, { totalSec: 90, alarmBuzz: true })
    expect(calls.schedule.at(-1)).toMatchObject({ vibrate: true, alarmBuzz: true })
    await alert.armRestAlert(Date.now() + 90_000, { totalSec: 90, vibrate: false, alarmBuzz: true })
    expect(calls.schedule.at(-1)).toMatchObject({ vibrate: false, alarmBuzz: false })
    await alert.armRestAlert(Date.now() + 90_000, { totalSec: 90 })
    expect(calls.schedule.at(-1)).toMatchObject({ alarmBuzz: false })
  })

  it('hands the plugin the end tone Settings → Sound picked', async () => {
    h.platform = 'android'
    const calls = capture()
    const alert = await import('./rest-alert.js')
    await alert.armRestAlert(Date.now() + 90_000, { totalSec: 90, sound: true })
    expect(calls.schedule.at(-1)).toMatchObject({ sound: true, classic: false })
    await alert.armRestAlert(Date.now() + 90_000, { totalSec: 90, sound: true, classic: true })
    expect(calls.schedule.at(-1)).toMatchObject({ sound: true, classic: true, tone: 'classic' })
    await alert.armRestAlert(Date.now() + 90_000, { totalSec: 90, sound: true, tone: 'whistle' })
    expect(calls.schedule.at(-1)).toMatchObject({ sound: true, classic: false, tone: 'whistle' })
  })

  it('buzzAsAlarm reaches the plugin with the pattern and answers true', async () => {
    h.platform = 'android'
    const calls = capture()
    const alert = await import('./rest-alert.js')
    await expect(alert.buzzAsAlarm([200, 100, 200])).resolves.toBe(true)
    expect(calls.buzz).toEqual([{ pattern: [200, 100, 200] }])
    await expect(alert.buzzAsAlarm([])).resolves.toBe(false)
    expect(calls.buzz).toHaveLength(1)
  })

  it('answers false in a browser shell without touching any plugin', async () => {
    h.platform = 'web'
    const alert = await import('./rest-alert.js')
    await expect(alert.buzzAsAlarm([200, 100, 200])).resolves.toBe(false)
    expect(h.registerPlugin).not.toHaveBeenCalled()
    expect(unhandled).toEqual([])
  })
})

// The native half cannot run here; what it must do with the flag is read off its source.
describe('the Android side of Vibrate off', () => {
  const src = name => readFileSync(new URL(`../../android/app/src/main/java/ch/duartesantos/opengym/${name}.java`, import.meta.url), 'utf8')
  const alert = src('RestAlert')

  it('reads the flag from the page, defaulting to on for an older page', () => {
    expect(src('RestAlertPlugin')).toMatch(/call\.getBoolean\("vibrate", Boolean\.TRUE\)/)
  })

  it('posts on a channel created without vibration, and only buzzes by hand when allowed to', () => {
    expect(alert).toMatch(/QUIET_CHANNEL_ID = "rest-over-quiet"/)
    expect(alert).toMatch(/if \(!vibrate\) return QUIET_CHANNEL_ID;/)
    expect(alert).toMatch(/channel\.enableVibration\(false\)/)
    expect(alert).toMatch(/if \(!shown && vibrate\) vibrateFallback\(ctx\);/)
    expect(alert).toMatch(/if \(vibrate\) b\.setVibrate\(VIBRATE\);/)
    expect(alert.match(/\.setVibrate\(/g)).toHaveLength(1)
  })

  it('keeps the flag for an end the countdown or a moved alarm fires', () => {
    // fireFromCountdown and updateAlarm build their own intents from the last schedule.
    expect(alert.match(/intent\.putExtra\("vibrate", lastVibrate\);/g)).toHaveLength(2)
    expect(alert).toMatch(/intent\.putExtra\("vibrate", vibrate\);/)
  })
})

describe('the Android side of the alarm buzz (#375)', () => {
  const src = name => readFileSync(new URL(`../../android/app/src/main/java/ch/duartesantos/opengym/${name}.java`, import.meta.url), 'utf8')
  const alert = src('RestAlert')
  const plugin = src('RestAlertPlugin')

  it('reads the flag from the page, off for an older page, and offers buzz()', () => {
    expect(plugin).toMatch(/call\.getBoolean\("alarmBuzz", Boolean\.FALSE\)/)
    expect(plugin).toMatch(/@PluginMethod\s+public void buzz\(PluginCall call\)/)
  })

  it('buzzes with the alarm usage, on every API level the app runs on', () => {
    expect(alert).toMatch(/VibrationAttributes\.createForUsage\(VibrationAttributes\.USAGE_ALARM\)/)
    expect(alert).toMatch(/setUsage\(AudioAttributes\.USAGE_ALARM\)/)
  })

  it('posts the notification on the quiet channel then, so the ringer-on phone buzzes once', () => {
    expect(alert).toMatch(/boolean vibrate = intent\.getBooleanExtra\("vibrate", true\) && !alarmBuzz;/)
    expect(alert).toMatch(/if \(alarmBuzz\) buzz\(ctx, VIBRATE\);/)
    expect(alert.match(/intent\.putExtra\("alarmBuzz", lastAlarmBuzz\);/g)).toHaveLength(2)
  })
})

// Fresh install, notifications not decided yet: the first rest pops the permission dialog. The
// QA left the app with the dialog open; the alarm waited behind the answer, so nothing rang, and
// once answered the schedule was refused ("at must be in the future") and blocked what followed.
describe('the notification permission never holds the rest alarm back', () => {
  const capture = () => {
    const calls = {}
    h.registerPlugin = vi.fn(() => new Proxy({}, {
      get: (_, prop) => {
        if (prop === 'then') return () => new Promise(() => {})
        return async (...args) => { (calls[prop] = calls[prop] || []).push(args[0]); return prop === 'addListener' ? { remove: async () => {} } : undefined }
      },
    }))
    return calls
  }

  it('schedules the alarm while the permission dialog is still open', async () => {
    h.platform = 'android'
    h.perm = 'prompt'
    h.request = vi.fn(() => new Promise(() => {}))   // the dialog nobody answers
    const calls = capture()
    const alert = await import('./rest-alert.js')
    await expect(alert.armRestAlert(Date.now() + 60_000, { totalSec: 60, alarmBuzz: true })).resolves.toBe(true)
    expect(calls.schedule).toHaveLength(1)
    expect(calls.schedule[0]).toMatchObject({ alarmBuzz: true })
    alert.disarmRestAlert()
    await expect(alert.armRestAlert(Date.now() + 60_000, { totalSec: 60 })).resolves.toBe(true)
    await settle()
    expect(calls.cancel).toHaveLength(1)
    expect(calls.schedule).toHaveLength(2)
    expect(h.request).toHaveBeenCalledTimes(1)
  })

  it('skips an end that passed before its turn instead of failing and blocking the next one', async () => {
    h.platform = 'android'
    const schedule = vi.fn(async a => { if (!(a.at > Date.now())) throw new Error('at must be in the future') })
    let release
    const gate = new Promise(r => { release = r })
    h.registerPlugin = vi.fn(() => new Proxy({}, {
      get: (_, prop) => prop === 'then' ? () => new Promise(() => {})
        : prop === 'schedule' ? schedule
        : prop === 'hold' ? () => gate
        : async () => ({ remove: async () => {} }),
    }))
    const alert = await import('./rest-alert.js')
    alert.holdRestAlert(30, 60)                       // a slow bridge call ahead in the chain
    const late = alert.armRestAlert(Date.now() + 30, { totalSec: 1 })
    await new Promise(r => setTimeout(r, 60))
    release()
    await expect(late).resolves.toBe(false)
    expect(schedule).not.toHaveBeenCalled()
    await expect(alert.armRestAlert(Date.now() + 60_000, { totalSec: 60 })).resolves.toBe(true)
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('asks once, and after a "Don\'t allow" never again, not even after a restart', async () => {
    h.platform = 'android'
    h.perm = 'prompt'
    h.request = vi.fn(async () => { h.perm = 'prompt-with-rationale'; return { display: 'denied' } })
    capture()
    let alert = await import('./rest-alert.js')
    for (let i = 0; i < 3; i++) await expect(alert.armRestAlert(Date.now() + 60_000, { totalSec: 60, alarmBuzz: true })).resolves.toBe(true)
    await settle()
    expect(h.request).toHaveBeenCalledTimes(1)
    vi.resetModules()                                 // the app is started again
    alert = await import('./rest-alert.js')
    await expect(alert.armRestAlert(Date.now() + 60_000, { totalSec: 60 })).resolves.toBe(true)
    await settle()
    expect(h.request).toHaveBeenCalledTimes(1)
  })

  // On the emulator: Home pressed with the dialog open closes it, requestPermissions answers
  // "denied", and the permission still reads 'prompt'. Nobody said no; the next launch asks.
  it('a dialog closed by leaving the app is not a "Don\'t allow": asked again next launch, not this session', async () => {
    h.platform = 'android'
    h.perm = 'prompt'
    h.request = vi.fn(async () => ({ display: 'denied' }))
    capture()
    let alert = await import('./rest-alert.js')
    await alert.armRestAlert(Date.now() + 60_000, { totalSec: 60 })
    await alert.armRestAlert(Date.now() + 60_000, { totalSec: 60 })
    await settle()
    expect(h.request).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('gym_rest_notif_asked')).toBeNull()
    vi.resetModules()
    alert = await import('./rest-alert.js')
    await alert.armRestAlert(Date.now() + 60_000, { totalSec: 60 })
    await settle()
    expect(h.request).toHaveBeenCalledTimes(2)
  })

  it('does not ask when notifications are already allowed or turned off', async () => {
    h.platform = 'android'
    h.request = vi.fn(async () => ({ display: 'granted' }))
    capture()
    for (const perm of ['granted', 'denied']) {
      vi.resetModules()
      h.perm = perm
      const alert = await import('./rest-alert.js')
      await alert.armRestAlert(Date.now() + 60_000, { totalSec: 60 })
      await settle()
    }
    expect(h.request).not.toHaveBeenCalled()
  })
})
