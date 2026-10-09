// On the Android app the status bar icons stayed white on the light theme and could not be read
// (Android 15 draws the page under them). The page tells the native side which theme it resolved
// to; nothing else may hear about it, and an APK without the plugin must not break the theme.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { platform: 'android', calls: [], fail: false }
})

const pluginProxy = () => new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'then') return () => new Promise(() => {})
    return async arg => {
      if (h.fail) throw new Error('"SystemBars" plugin is not implemented on android')
      h.calls.push([String(prop), arg])
    }
  },
})

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform },
  registerPlugin: () => pluginProxy(),
}))

beforeEach(() => {
  vi.resetModules()
  h.calls = []
  h.platform = 'android'
  h.fail = false
})

describe('system bars follow the theme on Android', () => {
  it('asks for dark icons on light and light icons on dark, once per change', async () => {
    const { setSystemBarsLight } = await import('./system-bars.js')
    await setSystemBarsLight(true)
    await setSystemBarsLight(true)
    await setSystemBarsLight(false)
    expect(h.calls).toEqual([['setStyle', { light: true }], ['setStyle', { light: false }]])
  })

  it('stays quiet off Android', async () => {
    h.platform = 'ios'
    const { setSystemBarsLight } = await import('./system-bars.js')
    await setSystemBarsLight(true)
    expect(h.calls).toEqual([])
  })

  it('an APK without the plugin is not an error', async () => {
    h.fail = true
    const { setSystemBarsLight } = await import('./system-bars.js')
    await expect(setSystemBarsLight(true)).resolves.toBeUndefined()
  })

  it('the app sends every resolved theme, and the activity registers the plugin', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    expect(app).toMatch(/function applyPrefs[\s\S]*?setSystemBarsLight\(de\.dataset\.theme === 'light'\)/)
    const dir = '../../android/app/src/main/java/ch/duartesantos/opengym/'
    const activity = readFileSync(new URL(dir + 'MainActivity.java', import.meta.url), 'utf8')
    const plugin = readFileSync(new URL(dir + 'SystemBarsPlugin.java', import.meta.url), 'utf8')
    expect(activity).toMatch(/registerPlugin\(SystemBarsPlugin\.class\);[\s\S]*super\.onCreate/)
    expect(plugin).toContain('@CapacitorPlugin(name = "SystemBars")')
    expect(plugin).toMatch(/setAppearanceLightStatusBars\(light\)/)
  })
})
