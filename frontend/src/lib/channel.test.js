// Who installs the updates: the sideloaded APK updates itself, Google Play and the App Store do it
// for their builds. The updater must never show in a store build (Play does not allow it).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  return { platform: 'android', answer: { channel: 'sideload' }, fail: false }
})

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform },
  registerPlugin: () => new Proxy({}, {
    get: (_, prop) => prop === 'then' ? undefined : async () => {
      if (h.fail) throw new Error('"Channel" plugin is not implemented on android')
      return h.answer
    },
  }),
}))

beforeEach(() => {
  vi.resetModules()
  h.platform = 'android'
  h.answer = { channel: 'sideload' }
  h.fail = false
})

describe('install channel', () => {
  it('the APK from GitHub updates itself', async () => {
    const { getChannel, selfUpdates } = await import('./channel.js')
    expect(await getChannel()).toBe('sideload')
    expect(await selfUpdates()).toBe(true)
  })

  it('the Google Play build does not', async () => {
    h.answer = { channel: 'play' }
    const { getChannel, selfUpdates } = await import('./channel.js')
    expect(await getChannel()).toBe('play')
    expect(await selfUpdates()).toBe(false)
  })

  it('the F-Droid build is updated by F-Droid and has no native scanner', async () => {
    h.answer = { channel: 'fdroid' }
    const { getChannel, selfUpdates, nativeScanner, gymReminderBuilt } = await import('./channel.js')
    expect(await getChannel()).toBe('fdroid')
    expect(await selfUpdates()).toBe(false)
    expect(await nativeScanner()).toBe(false)
    expect(await gymReminderBuilt()).toBe(true)
  })

  it('the APK and the Play build scan with ML Kit', async () => {
    let m = await import('./channel.js')
    expect(await m.nativeScanner()).toBe(true)
    vi.resetModules()
    h.answer = { channel: 'play' }
    m = await import('./channel.js')
    expect(await m.nativeScanner()).toBe(true)
  })

  it('an older APK without the plugin is a sideloaded one', async () => {
    h.fail = true
    const { getChannel } = await import('./channel.js')
    expect(await getChannel()).toBe('sideload')
  })

  it('the iPhone app is the App Store\'s', async () => {
    h.platform = 'ios'
    const { getChannel, selfUpdates } = await import('./channel.js')
    expect(await getChannel()).toBe('appstore')
    expect(await selfUpdates()).toBe(false)
  })

  it('the gym reminder is there unless the build left background location out', async () => {
    let m = await import('./channel.js')
    expect(await m.gymReminderBuilt()).toBe(true)
    vi.resetModules()
    h.answer = { channel: 'play', backgroundLocation: false }
    m = await import('./channel.js')
    expect(await m.getChannel()).toBe('play')
    expect(await m.gymReminderBuilt()).toBe(false)
    vi.resetModules()
    h.fail = true
    m = await import('./channel.js')
    expect(await m.gymReminderBuilt()).toBe(true)
  })

  it('the Play flavour says "play" and leaves the updater out', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const app = new URL('../../android/app/', import.meta.url)
    const gradle = readFileSync(new URL('build.gradle', app), 'utf8')
    expect(gradle).toMatch(/play \{[\s\S]*?buildConfigField "String", "CHANNEL", '"play"'/)
    const main = readFileSync(new URL('src/main/AndroidManifest.xml', app), 'utf8')
    expect(main).not.toContain('REQUEST_INSTALL_PACKAGES')
    expect(existsSync(new URL('src/main/java/ch/duartesantos/opengym/InstallPlugin.java', app))).toBe(false)
    const play = readFileSync(new URL('src/play/java/ch/duartesantos/opengym/FlavorPlugins.java', app), 'utf8')
    expect(play).not.toContain('InstallPlugin')
  })
  it('the F-Droid flavour carries nothing from Google Play services', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const app = new URL('../../android/app/', import.meta.url)
    const gradle = readFileSync(new URL('build.gradle', app), 'utf8')
    expect(gradle).toMatch(/fdroid \{[\s\S]*?buildConfigField "String", "CHANNEL", '"fdroid"'/)
    // Play services only per flavour, never for every build.
    for (const line of gradle.split('\n')) {
      if (/com\.google\.android\.(gms|play)/.test(line)) expect(line).toMatch(/^\s*(\/\/|sideloadImplementation|playImplementation)/)
    }
    expect(gradle).toContain("exclude module: 'capacitor-mlkit-barcode-scanning'")
    expect(gradle).not.toContain('google-services')
    // The Wear OS link imports Play services: kept out of src/main.
    const main = new URL('src/main/java/ch/duartesantos/opengym/', app)
    expect(existsSync(new URL('WatchBridgePlugin.java', main))).toBe(false)
    expect(existsSync(new URL('WatchListenerService.java', main))).toBe(false)
    const fd = new URL('src/fdroid/java/ch/duartesantos/opengym/', app)
    for (const f of ['FlavorPlugins.java', 'AnimationPacksPlugin.java', 'WatchBridgePlugin.java']) {
      const src = readFileSync(new URL(f, fd), 'utf8')
      expect(src).not.toMatch(/import com\.google|InstallPlugin/)
    }
    const manifest = readFileSync(new URL('src/fdroid/AndroidManifest.xml', app), 'utf8')
    expect(manifest).toMatch(/WatchListenerService" tools:node="remove"/)
  })
})
