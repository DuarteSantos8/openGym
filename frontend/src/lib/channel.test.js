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
})
