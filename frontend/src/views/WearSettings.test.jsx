// @vitest-environment happy-dom
// Settings → Wear OS watch (Android app): whatever the link's state, the page says what is the
// case and what to do next, lists the watches, and shows when the watch last checked in.
import { beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import WearSettingsPage from './WearSettings.jsx'
import { readWatchPrefs, writeWatchStatus, noteRoutinesSent } from '../lib/watch-settings.js'
import { PAGES, ROOT_GROUPS, WATCH_PAGES, pageVisible } from './settings-pages.js'

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
const pill = el => el.querySelector('[data-watch-pill]')?.dataset.watchPill
const none = { supported: true, paired: false, installed: false, reachable: false, watches: [] }

beforeEach(() => { localStorage.clear(); noteRoutinesSent(null) })

describe('Settings → Wear OS watch', () => {
  it('no watch: says to pair one in its own app, offers nothing that leads nowhere', async () => {
    const el = await mount(none)
    expect(el.textContent).toContain('Pair your watch in its own app, like Galaxy Wearable.')
    expect(row(el, 'Get openGym for Wear OS')).toBeUndefined()
    expect(pill(el)).toBe('setup')
  })

  it('a watch without the app, next to the APK: names the watch, says which watch app fits, offers the guide', async () => {
    const el = await mount({ ...none, paired: true, watches: [watch()] }, 'sideload')
    expect(el.textContent).toContain('Install the Wear OS APK of this release.')
    expect(el.textContent).toContain('The Play Store one won’t pair.')
    expect(row(el, 'Galaxy Watch4 (ABCD)').textContent).toContain('openGym isn’t on it yet')
    expect(row(el, 'Get openGym for Wear OS')).toBeTruthy()
  })

  it('a watch without the app, next to the Play app: the Play Store on the watch, no APK talk', async () => {
    const el = await mount({ ...none, paired: true, watches: [watch()] }, 'play')
    expect(el.textContent).toContain('On the watch, install openGym from the Play Store.')
    expect(el.textContent).not.toContain('APK')
    expect(row(el, 'Get openGym for Wear OS')).toBeUndefined()
  })

  it('the app on the watch and in reach: the pill says whether it checked in, when, and that it has every routine', async () => {
    const wear = { supported: true, paired: true, installed: true, reachable: true, watches: [watch({ installed: true, reachable: true })] }
    let el = await mount(wear)
    expect(pill(el)).toBe('away')
    expect(el.textContent).toContain('Open openGym on the watch once.')
    expect(row(el, 'Galaxy Watch4 (ABCD)').textContent).toContain('Connected')
    noteRoutinesSent({ hash: 'h1', count: 3 })
    writeWatchStatus({ version: '1.4.6', at: Date.now() - 5 * 60e3, routinesHash: 'h0', routinesCount: 2 })
    el = await mount(wear)
    expect(pill(el)).toBe('syncing')
    expect(el.textContent).toContain('Keep openGym open on the watch for a moment.')
    writeWatchStatus({ version: '1.4.6', at: Date.now() - 5 * 60e3, routinesHash: 'h1', routinesCount: 3 })
    el = await mount(wear)
    expect(pill(el)).toBe('connected')
    expect(el.querySelector('.wpill').textContent).toContain('3 routines · Last heard 5 minutes ago')
    expect(el.textContent).not.toContain('Open openGym on the watch once.')
    expect(el.querySelector('.wpill-sign circle')).toBeTruthy()   // a round watch, not the Apple one
  })

  it('the app on the watch, the watch out of reach: says the sets wait there', async () => {
    writeWatchStatus({ version: '1.4.5', at: Date.now() - 60 * 60e3 })
    const el = await mount({ supported: true, paired: false, installed: true, reachable: false, watches: [watch({ connected: false, installed: true })] })
    expect(el.textContent).toContain('Open openGym on the watch, or bring it closer.')
    expect(row(el, 'Galaxy Watch4 (ABCD)').textContent).toContain('Not in reach')
    expect(pill(el)).toBe('away')
  })

  it('the F-Droid build: says why there is no watch link and hides the switches that would do nothing', async () => {
    const el = await mount({ ...none, supported: false }, 'fdroid')
    expect(el.textContent).toContain('This version can’t reach a watch.')
    expect(row(el, 'Open on the watch')).toBeUndefined()
  })

  it('the switches are the watch\'s own choices, shared with every watch page', async () => {
    const el = await mount({ supported: true, paired: true, installed: true, reachable: true, watches: [] })
    await act(async () => { row(el, 'Tap the wrist when a rest is over').querySelector('[role="switch"]').click() })
    expect(readWatchPrefs().restHaptics).toBe(false)
    await act(async () => { row(el, 'Send workouts to the watch').querySelector('[role="switch"]').click() })
    expect(readWatchPrefs().enabled).toBe(false)
    expect(row(el, 'Open on the watch')).toBeUndefined()
    expect(el.querySelector('[data-watch-pill]')).toBeNull()   // off: nothing to report
  })
})

describe('where the page lives', () => {
  const ctx = over => ({ mobile: true, android: true, ios: false, demo: false, mod: () => true, ...over })
  it('in the Android app, not on the iPhone, the web or the demo; gone with the Watch module', () => {
    expect(PAGES.wear.mod).toBe('watch')
    // On the phone it sits under Settings → Watches with the other watches (#1105), not on the root.
    expect(PAGES.wear.parent).toBe('watches')
    expect(WATCH_PAGES).toContain('wear')
    expect(ROOT_GROUPS.flatMap(g => g.ids)).not.toContain('wear')
    expect(pageVisible('wear', ctx())).toBe(true)
    expect(pageVisible('wear', ctx({ android: false, ios: true }))).toBe(false)
    expect(pageVisible('wear', ctx({ mobile: false, android: false }))).toBe(false)
    expect(pageVisible('wear', ctx({ demo: true }))).toBe(false)
    expect(pageVisible('wear', ctx({ mod: id => id !== 'watch' }))).toBe(false)
    // the Apple Watch page stays the iPhone's
    expect(pageVisible('watch', ctx())).toBe(false)
  })
})
