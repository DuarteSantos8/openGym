// @vitest-environment happy-dom
// Settings → Wear OS watch (Android app): whatever the link's state, the page says what is the
// case and what to do next, lists the watches, and shows when the watch last checked in.
import { beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import WearSettingsPage from './WearSettings.jsx'
import { readWatchPrefs, writeWatchStatus } from '../lib/watch-settings.js'
import { PAGES, ROOT_GROUPS, pageVisible } from './settings-pages.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function mount (wear, channel = 'sideload') {
  const el = document.createElement('div')
  document.body.replaceChildren(el)
  const api = { status: async () => wear, channel: async () => channel }
  await act(async () => { createRoot(el).render(<WearSettingsPage api={api} />) })
  await act(async () => {})
  return el
}
const row = (el, title) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const watch = (over = {}) => ({ id: 'n1', name: 'Galaxy Watch4 (ABCD)', connected: true, installed: false, reachable: false, ...over })
const none = { supported: true, paired: false, installed: false, reachable: false, watches: [] }

beforeEach(() => { localStorage.clear() })

describe('Settings → Wear OS watch', () => {
  it('no watch: says to pair one in its own app, offers nothing that leads nowhere', async () => {
    const el = await mount(none)
    expect(el.textContent).toContain('No Wear OS watch is connected to this phone.')
    expect(el.textContent).toContain('Galaxy Wearable')
    expect(row(el, 'Get openGym for Wear OS')).toBeUndefined()
    expect(el.textContent).not.toContain('Last heard from the watch')
  })

  it('a watch without the app, next to the APK: names the watch, says which watch app fits, offers the guide', async () => {
    const el = await mount({ ...none, paired: true, watches: [watch()] }, 'sideload')
    expect(el.textContent).toContain('the watch needs the Wear OS APK of the same release')
    expect(el.textContent).toContain('One from Google Play won’t pair with it.')
    expect(row(el, 'Galaxy Watch4 (ABCD)').textContent).toContain('openGym isn’t on it yet')
    expect(row(el, 'Get openGym for Wear OS')).toBeTruthy()
  })

  it('a watch without the app, next to the Play app: the Play Store on the watch, no APK talk', async () => {
    const el = await mount({ ...none, paired: true, watches: [watch()] }, 'play')
    expect(el.textContent).toContain('open the Play Store and install openGym from “Apps on your phone”')
    expect(el.textContent).not.toContain('APK')
    expect(row(el, 'Get openGym for Wear OS')).toBeUndefined()
  })

  it('the app on the watch and in reach: connected, and whether the watch has checked in', async () => {
    const wear = { supported: true, paired: true, installed: true, reachable: true, watches: [watch({ installed: true, reachable: true })] }
    let el = await mount(wear)
    expect(el.textContent).toContain('openGym is on your watch and in reach.')
    expect(el.textContent).toContain('The watch hasn’t checked in yet. Open openGym on it once.')
    expect(row(el, 'Galaxy Watch4 (ABCD)').textContent).toContain('Connected')
    writeWatchStatus({ version: '1.4.5', at: Date.now() - 5 * 60e3 })
    el = await mount(wear)
    expect(el.textContent).toContain('Last heard from the watch: ')
    expect(el.textContent).not.toContain('hasn’t checked in yet')
  })

  it('the app on the watch, the watch out of reach: says the sets wait there', async () => {
    const el = await mount({ supported: true, paired: false, installed: true, reachable: false, watches: [watch({ connected: false, installed: true })] })
    expect(el.textContent).toContain('the watch is out of reach right now')
    expect(el.textContent).toContain('wait there and land here once it is back')
    expect(row(el, 'Galaxy Watch4 (ABCD)').textContent).toContain('Not in reach')
  })

  it('the F-Droid build: says why there is no watch link and hides the switches that would do nothing', async () => {
    const el = await mount({ ...none, supported: false }, 'fdroid')
    expect(el.textContent).toContain('which F-Droid apps leave out')
    expect(row(el, 'Open on the watch')).toBeUndefined()
  })

  it('the switches are the watch\'s own choices, shared with every watch page', async () => {
    const el = await mount({ supported: true, paired: true, installed: true, reachable: true, watches: [] })
    await act(async () => { row(el, 'Tap the wrist when a rest is over').querySelector('[role="switch"]').click() })
    expect(readWatchPrefs().restHaptics).toBe(false)
    await act(async () => { row(el, 'Send workouts to the watch').querySelector('[role="switch"]').click() })
    expect(readWatchPrefs().enabled).toBe(false)
    expect(row(el, 'Open on the watch')).toBeUndefined()
  })
})

describe('where the page lives', () => {
  const ctx = over => ({ mobile: true, android: true, ios: false, demo: false, mod: () => true, ...over })
  it('in the Android app, not on the iPhone, the web or the demo; gone with the Watch module', () => {
    expect(PAGES.wear.mod).toBe('watch')
    expect(ROOT_GROUPS.flat()).toContain('wear')
    expect(pageVisible('wear', ctx())).toBe(true)
    expect(pageVisible('wear', ctx({ android: false, ios: true }))).toBe(false)
    expect(pageVisible('wear', ctx({ mobile: false, android: false }))).toBe(false)
    expect(pageVisible('wear', ctx({ demo: true }))).toBe(false)
    expect(pageVisible('wear', ctx({ mod: id => id !== 'watch' }))).toBe(false)
    // the Apple Watch page stays the iPhone's
    expect(pageVisible('watch', ctx())).toBe(false)
  })
})
