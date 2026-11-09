// #821: Android can keep openGym upright (or sideways) without touching the phone's auto-rotate.
// The choice is per device, survives a restart, and an APK without the plugin keeps working.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const h = vi.hoisted(() => ({ calls: [], fail: false }))

const pluginProxy = () => new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'then') return () => new Promise(() => {})
    return async arg => {
      if (h.fail) throw new Error('"Orientation" plugin is not implemented on android')
      h.calls.push([String(prop), arg])
    }
  },
})
vi.mock('@capacitor/core', () => ({ registerPlugin: () => pluginProxy() }))

const memory = () => {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }
}

beforeEach(() => {
  vi.resetModules()
  h.calls = []
  h.fail = false
  globalThis.Capacitor = { getPlatform: () => 'android' }
})

describe('screen orientation (#821)', () => {
  it('follows the phone until told otherwise, and remembers the choice on this device', async () => {
    const { readOrientation, setOrientation } = await import('./orientation.js')
    const st = memory()
    expect(readOrientation(st)).toBe('auto')
    await setOrientation('portrait', st)
    expect(readOrientation(st)).toBe('portrait')
    expect(h.calls).toEqual([['lock', { mode: 'portrait' }]])
    await setOrientation('auto', st)
    expect(st.m.size).toBe(0)
    expect(readOrientation(st)).toBe('auto')
    st.setItem('gym_orientation', 'upside-down')
    expect(readOrientation(st)).toBe('auto')
  })

  it('does nothing off Android, and an APK without the plugin is no error', async () => {
    globalThis.Capacitor = { getPlatform: () => 'ios' }
    let m = await import('./orientation.js')
    await m.applyOrientation('portrait')
    expect(h.calls).toEqual([])
    vi.resetModules()
    globalThis.Capacitor = { getPlatform: () => 'android' }
    h.fail = true
    m = await import('./orientation.js')
    await expect(m.applyOrientation('landscape')).resolves.toBeUndefined()
  })

  it('the activity applies the saved choice before the page loads, and the app re-applies it', () => {
    const dir = '../../android/app/src/main/java/ch/duartesantos/opengym/'
    const activity = readFileSync(new URL(dir + 'MainActivity.java', import.meta.url), 'utf8')
    const plugin = readFileSync(new URL(dir + 'OrientationPlugin.java', import.meta.url), 'utf8')
    expect(activity).toMatch(/registerPlugin\(OrientationPlugin\.class\);[\s\S]*OrientationPlugin\.applySaved\(this\);[\s\S]*super\.onCreate/)
    expect(plugin).toContain('@CapacitorPlugin(name = "Orientation")')
    expect(plugin).toMatch(/SCREEN_ORIENTATION_SENSOR_PORTRAIT/)
    expect(plugin).toMatch(/SCREEN_ORIENTATION_UNSPECIFIED/)
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    expect(app).toMatch(/if \(MOBILE\) applyOrientation\(\)/)
  })
})
