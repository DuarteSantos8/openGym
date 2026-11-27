// @vitest-environment happy-dom
// Home's one look per start (components/WhatsNew.jsx): only the APK that installs its own updates
// hears that a newer version is out; Play, F-Droid, the App Store and the web leave it to them.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ channel: 'sideload', info: { hasUpdate: true, latestVersion: '9.9.9' }, toast: null, openSheet: null }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../lib/demo.js', () => ({ DEMO: false }))
vi.mock('../lib/channel.js', () => ({ getChannel: async () => mocks.channel }))
vi.mock('../lib/update.js', async orig => ({ ...(await orig()), checkForUpdate: async () => mocks.info }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: mocks.toast, openSheet: mocks.openSheet }) } }))
globalThis.__APP_VERSION__ = '1.4.6'

const { lookOnStart, _resetLookForTests } = await import('./WhatsNew.jsx')
const seen = { workouts: [] }

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gym_seen_version', '1.4.6')
  _resetLookForTests()
  mocks.toast = vi.fn()
  mocks.openSheet = vi.fn()
})

describe('the look on start', () => {
  it('the sideloaded APK hears about a newer version, and Update goes to About', async () => {
    const go = vi.fn()
    await lookOnStart(seen, go)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    const [msg, opts] = mocks.toast.mock.calls[0]
    expect(msg).toContain('9.9.9')
    opts.onAction()
    expect(go).toHaveBeenCalled()
  })

  it.each(['play', 'fdroid', 'offline', 'appstore', 'web'])('%s: nothing, its store updates it', async ch => {
    mocks.channel = ch
    await lookOnStart(seen, () => {})
    expect(mocks.toast).not.toHaveBeenCalled()
    mocks.channel = 'sideload'
  })

  it('after an update the sheet comes first, and no nudge on top of it', async () => {
    localStorage.setItem('gym_seen_version', '1.4.5')
    await lookOnStart(seen, () => {})
    expect(mocks.openSheet).toHaveBeenCalledTimes(1)
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('during a workout: nothing at all', async () => {
    localStorage.setItem('gym_seen_version', '1.4.5')
    await lookOnStart({ workouts: [], active: { id: 'a' } }, () => {})
    expect(mocks.openSheet).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})
