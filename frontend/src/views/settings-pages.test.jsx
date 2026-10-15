// @vitest-environment happy-dom
// Settings v1.3.11: the root, the pages, the search and the rest wheels. Every row the search
// knows has to be a row on its page, and every page and row title has a word in each pack.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PAGES, PAGE_IDS, ROOT_GROUPS, SEARCH, featuresFor, pageExists, pageVisible, searchSettings, pageTrail, fold } from './settings-pages.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, sync: null, MOBILE: false, push: false, sheets: [], navs: [], backs: [], toast: null }
  state.snapshot = () => ({
    S: state.S, user: state.user, coachLocal: null, sync: state.sync, config: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), setUnit: vi.fn(),
    resetEverything: vi.fn(), resetDemo: vi.fn(), importBackup: vi.fn(), importConflict: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: render => { mocks.sheets.push(render); return { close: vi.fn() } } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a) => mocks.navs.push(a) }))
// A page's back is the tab's back, handed the page's own parent for a cold entry.
vi.mock('../lib/use-tab-nav.js', () => ({ back: parent => mocks.backs.push(parent), isSwitching: () => false }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(path => Promise.resolve(path === '/api/account/passkeys' ? { passkeys: [] } : {})), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false }))
vi.mock('../lib/push.js', () => ({ pushSupported: () => mocks.push, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn(), syncPushSubscription: vi.fn(() => Promise.resolve(mocks.pushOn)) }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => true }))
// The rest of the module is for the real store's freshState (the Features test reads it).
vi.mock('../lib/mobile.js', async importOriginal => ({
  ...(await importOriginal()),
  get MOBILE() { return mocks.MOBILE }, isAndroid: () => Promise.resolve(!!mocks.android), shareExport: vi.fn(), shareExportBlob: vi.fn(), syncReminder: vi.fn(),
}))
vi.mock('../lib/update.js', () => ({ checkForUpdate: () => Promise.resolve({ hasUpdate: false }), downloadAndInstall: vi.fn(), fetchChecksum: vi.fn(), RELEASES_PAGE: '' }))
vi.mock('../lib/health-sync.js', async importOriginal => ({
  ...(await importOriginal()),
  healthStatus: () => Promise.resolve({ status: 'available', granted: false }), loadHealth: () => Promise.resolve({ on: false, written: {}, error: null }),
  enableHealth: vi.fn(), disableHealth: vi.fn(), openHealthConnect: vi.fn(), onHealthChange: () => () => {},
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('./Measurements.jsx', () => ({ manageMeasurementsSheet: vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(), importFromHevy: vi.fn(),
  equipmentProfileSheet: vi.fn(), plateInventorySheet: vi.fn(), menuSheet: vi.fn(),
}))

import Settings from './Settings.jsx'

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, vibrate: true, effort: 'none', gifSize: 'full', lang: 'en',
    workouts: [], routines: [], exWeights: {}, equipProfiles: [{ id: 'p1', name: 'Home', equipment: [] }], activeEquipId: 'p1',
    reminder: { on: false, time: '17:30' },
  }
  mocks.user = null
  mocks.sync = null
  mocks.MOBILE = false
  mocks.android = false
  mocks.push = false
  mocks.pushOn = false
  mocks.toast = vi.fn()
  mocks.sheets = []
  mocks.navs = []
  Object.defineProperty(navigator, 'vibrate', { value: () => true, configurable: true, writable: true })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete navigator.vibrate
})

const mount = (page = null, find = null, via = null) => act(() => root.render(<Settings page={page} find={find} via={via} />))
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const titles = () => [...host.querySelectorAll('.lrow .lrow-t')].map(e => e.textContent)

// This test's guest in a browser, as the page itself sees it.
const guestWeb = {
  user: null, mobile: false, android: false, demo: false, wakeOK: true, hasMedia: false, pwOn: false, webauthn: false,
  sound: true, playOnSilent: false, canVibrate: true, vibrate: true, profiles: true, nameLang: false,
  pushOK: false, reminderOn: false, nudge: false, autoBackup: false, synced: false, installTip: true, androidWeb: false,
}

describe('the root', () => {
  it('is an account card and one row per page, grouped by domain, with value previews', () => {
    mount()
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('Guest')
    expect(host.querySelector('.sp-acct .lrow-s').textContent).toBe('Your data lives on this device. Sign in to sync.')
    // a guest in a browser has no notifications (no push server), no Coach page (the server's
    // Coach), no Health Connect, no photos yet, nothing to sync and nothing to log out of
    expect(titles()).toEqual(['Guest', 'Appearance', 'Units & language', 'Features', 'Workout', 'Fine-tuning', 'Timer alerts',
      'Schedule defaults', 'Equipment', 'Measurement fields', 'Backup', 'Import', 'Danger zone', 'About & updates', 'Licences'])
    expect([...host.querySelectorAll('.sect-t')].map(e => e.textContent)).toEqual(['General', 'Training', 'Body & progress', 'Data', 'About'])
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('1:30 rest · Cards')
    expect(rowTitled('Timer alerts').querySelector('.lrow-v').textContent).toBe('Sound · Vibrate')
    expect(rowTitled('Schedule defaults').querySelector('.lrow-v').textContent).toMatch(/^Fixed Week · Mon/)
    expect(rowTitled('Units & language').querySelector('.lrow-v').textContent).toBe('kg · English')
    expect(rowTitled('Equipment').querySelector('.lrow-v').textContent).toBe('Everything')
    expect(rowTitled('About & updates').querySelector('.lrow-v').textContent).toMatch(/^v\d|^vtest/)
  })

  it('signed in: the sync status with Sync now, Admin for an admin, and Sign out at the end', () => {
    mocks.user = { id: 'u1', name: 'Dana', admin: true }
    mocks.sync = { status: 'ok', server: 'https://gym.example', lastSynced: Date.now() }
    mount()
    const sects = [...host.querySelectorAll('.sect-t')].map(e => e.textContent)
    // signed in on the web app, nutrition is reachable: its group is there too
    expect(sects).toEqual(['Sync', 'General', 'Training', 'Nutrition', 'Body & progress', 'Data', 'Admin', 'About'])
    expect(titles()).toEqual(expect.arrayContaining(['Goals', 'Diary & meals']))
    expect(titles()).toContain('Sync now')
    expect(titles().at(-1)).toBe('Sign out')
    act(() => rowTitled('Admin dashboard').click())
    expect(mocks.navs.at(-1)).toEqual(['/me/admin'])
  })

  it('a phone paired with a server logs out by disconnecting', () => {
    mocks.MOBILE = true
    mocks.user = { id: 'u1', name: 'Dana' }
    mocks.sync = { status: 'ok', server: 'https://gym.example' }
    mount()
    expect(titles().at(-1)).toBe('Disconnect')
    expect(titles()).not.toContain('Sign out')
  })

  it('Measurement fields opens the measurement chooser', async () => {
    const { manageMeasurementsSheet } = await import('./Measurements.jsx')
    mount()
    act(() => rowTitled('Measurement fields').click())
    expect(manageMeasurementsSheet).toHaveBeenCalledTimes(1)
  })

  it('marks the page rows so a long preview wraps instead of losing its second half', () => {
    mount()
    const rows = ['Workout', 'Timer alerts', 'Schedule defaults', 'Units & language', 'Appearance'].map(rowTitled)
    for (const r of rows) expect(r.classList.contains('sp-root-row')).toBe(true)
    // index.css: the marked rows' value may wrap, and never shrinks below its longest word
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const rule = css.match(/^\.lrow\.sp-root-row \.lrow-v\{([^}]*)\}/m)?.[1] || ''
    expect(rule).toMatch(/white-space:normal/)
    expect(rule).toMatch(/line-clamp:3/)
    expect(rule).toMatch(/min-width:min-content/)
  })

  it('previews a rest that was never on the old list, and no timer at all', () => {
    mocks.S.restSec = 105
    mount()
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('1:45 rest · Cards')
    mocks.S.restSec = 0
    mount()
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('No rest timer · Cards')
  })

  it('signed in, Notifications is there and the card names the account; on the phone app the Coach too', () => {
    mocks.user = { id: 'u1', name: 'Dana' }
    mount()
    expect(titles()).toContain('Notifications')
    expect(titles()).not.toContain('AI Coach')
    expect(titles()).not.toContain('Admin dashboard')
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('Dana')
    expect(host.querySelector('.sp-avatar').textContent).toBe('D')
    mocks.user = null
    mocks.MOBILE = true
    mount()
    expect(titles()).toContain('Notifications')
    expect(titles()).toContain('AI Coach')
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('This phone')
  })

  it('a row opens its page; the Coach row opens the phone Coach setup; the card opens Account', () => {
    mocks.MOBILE = true
    mount()
    act(() => rowTitled('Timer alerts').click())
    act(() => rowTitled('AI Coach').click())
    act(() => host.querySelector('.sp-acct').click())
    expect(mocks.navs).toEqual([['/me/alerts'], ['/train/coach/setup'], ['/me/account']])
  })

  it('searches every setting and a hit goes to its page with the row to flash', () => {
    mount()
    const input = host.querySelector('.sp-search input')
    const type = v => act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    type('haptic')
    expect(titles()).toEqual(['Vibrate'])
    expect(host.querySelector('.lrow .lrow-s').textContent).toBe('Timer alerts')
    act(() => rowTitled('Vibrate').click())
    expect(mocks.navs.at(-1)).toEqual(['/me/alerts', { state: { find: 'Vibrate' } }])
    type('zzzz')
    expect(host.querySelector('.sp-empty').textContent).toBe('No setting matches “zzzz”.')
  })

  // Review of #37: a hit for a row on the root itself lands on the same page, and the results it
  // was picked from stayed up, so the flash lit the result row instead of the real one.
  it('a hit for a row on the root itself closes the results and flashes the real row', () => {
    mocks.user = { id: 'u1', name: 'Dana' }
    mocks.sync = { status: 'ok', server: 'https://gym.example', lastSynced: Date.now() }
    mount()
    const input = host.querySelector('.sp-search input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'sync now')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const sectTitles = () => [...host.querySelectorAll('.sect-t')].map(e => e.textContent)
    expect(sectTitles()).toEqual(['1 result'])
    act(() => rowTitled('Sync now').click())
    expect(mocks.navs.at(-1)).toEqual(['/me', { state: { find: 'Sync now' } }])
    // the route hands the same page the row to find (SettingsRoute)
    mount(null, 'Sync now')
    expect(sectTitles()).not.toContain('1 result')
    expect(host.querySelector('.sp-search input').value).toBe('')
    const lit = host.querySelector('.sp-flash')
    expect(lit?.querySelector('.lrow-t').textContent).toBe('Sync now')
    expect(lit.closest('.sect').querySelector('.sect-t').textContent).toBe('Sync')
  })
})

// Each search hit is a row on its page, on the device and profile it was offered for. The ctx is
// the one Settings builds (views/Settings.jsx) for the same mocks; push-dependent web rows are
// the exception the page settles on open (`via`), tested on their own below.
describe('the search lands on a row', () => {
  const scenarios = {
    'guest in a browser': () => {},
    'signed in, browser without push': () => { mocks.user = { id: 'u1', name: 'Dana' }; mocks.sync = { status: 'ok', server: 'https://gym.example' } },
    'phone, reminder off': () => { mocks.MOBILE = true },
    'phone, reminder and nudge on': () => { mocks.MOBILE = true; mocks.S.reminder = { on: true, time: '17:30', nudge: true }; mocks.S.autoBackup = true },
    'phone paired with a server': () => { mocks.MOBILE = true; mocks.user = { id: 'u1', name: 'Dana' }; mocks.sync = { status: 'ok', server: 'https://gym.example' } },
  }
  const ctxNow = () => ({
    ...guestWeb, user: mocks.user, mobile: mocks.MOBILE, pushOK: !mocks.MOBILE && mocks.push,
    reminderOn: !!mocks.S.reminder?.on, nudge: !!mocks.S.reminder?.nudge, autoBackup: !!mocks.S.autoBackup,
    synced: !!mocks.sync, installTip: !mocks.MOBILE, hasMedia: false, wakeOK: true,
  })
  for (const [name, setUp] of Object.entries(scenarios)) it(name, async () => {
    setUp()
    const ctx = ctxNow()
    const byPage = {}
    for (const e of SEARCH) if (pageVisible(e.page, ctx) && (!e.when || e.when(ctx))) (byPage[e.page ?? 'root'] ||= []).push(e.title)
    for (const [page, want] of Object.entries(byPage)) {
      mount(page === 'root' ? null : page)
      await act(async () => {})   // the passkey list, asked of the server on open
      const have = [...titles(), ...[...host.querySelectorAll('.btn')].map(b => b.textContent.trim())]
      for (const title of want) expect(have, `${page}: ${title}`).toContain(title)
    }
  })

  it('finds the rows that used to be missing', () => {
    const tr = s => s
    const web = { ...guestWeb, user: { id: 'u' }, synced: true, pushOK: true, reminderOn: true, nudge: true }
    expect(searchSettings('reminder time', web, tr).map(h => h.title)).toEqual(['Reminder time'])
    expect(searchSettings('tone', web, tr).map(h => h.title)).toContain('Nudge tone')
    expect(searchSettings('test notification', web, tr).map(h => h.title)).toEqual(['Send test notification'])
    expect(searchSettings('server', web, tr).map(h => h.title)).toContain('Sync now')
    expect(searchSettings('sync', web, tr).map(h => h.title)).toContain('Sync now')
    expect(searchSettings('loop', web, tr).map(h => h.title)).toContain('How you train')
    expect(searchSettings('swipe', web, tr)[0].title).toBe('Swipe actions')
    expect(searchSettings('gesture', web, tr).map(h => h.title)).toEqual(['Swipe actions'])
    expect(searchSettings('home screen', web, tr).map(h => h.title)).toEqual(['In Safari: Share → Add to Home Screen'])
    expect(searchSettings('install', { ...web, androidWeb: true }, tr).map(h => h.title)).toEqual(['In Chrome: ⋮ menu → Add to Home screen'])
    expect(searchSettings('backup folder', { ...guestWeb, mobile: true, android: true, autoBackup: true }, tr).map(h => h.title)).toEqual(['Backup folder'])
    expect(searchSettings('backup folder', { ...guestWeb, mobile: true, android: true }, tr)).toEqual([])
  })

  it('a web reminder row waits for push to answer, and flashes Push notifications when it stays off', async () => {
    vi.useFakeTimers()
    try {
      mocks.user = { id: 'u1', name: 'Dana' }
      mocks.push = true
      mocks.S.reminder = { on: true, time: '17:30' }
      mount('notifications', 'Nudge me when I skip a planned workout', 'Push notifications')
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
      expect(rowTitled('Push notifications').classList.contains('sp-flash')).toBe(true)
      expect(mocks.toast).toHaveBeenCalledWith('Turn on push notifications first.')

      // push on: the row appears once the server answers, and that row is the one flashed
      mocks.pushOn = true
      mocks.toast.mockClear()
      act(() => root.render(null))
      mount('notifications', 'Nudge me when I skip a planned workout', 'Push notifications')
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      expect(rowTitled('Nudge me when I skip a planned workout').classList.contains('sp-flash')).toBe(true)
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
      expect(mocks.toast).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})

describe('the search query', () => {
  const type = v => act(() => {
    const input = host.querySelector('.sp-search input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  afterEach(() => window.history.replaceState(null, ''))
  it('comes back with Back to the same entry, and is gone when Settings is opened afresh', () => {
    window.history.replaceState({ key: 'root1', idx: 1 }, '')
    mount()
    type('vib')
    act(() => root.render(null))
    mount()                                                   // Back from the hit: same entry
    expect(host.querySelector('.sp-search input').value).toBe('vib')
    expect(titles()).toContain('Vibrate')
    act(() => root.render(null))
    window.history.replaceState({ key: 'root2', idx: 3 }, '')  // the gear, a tab, Android Back then the gear
    mount()
    expect(host.querySelector('.sp-search input').value).toBe('')
    expect(titles()).toContain('Timer alerts')
  })
})

describe('the pages', () => {
  it('each search entry is a row on its page (guest in a browser)', () => {
    const byPage = {}
    for (const e of SEARCH) if (pageVisible(e.page, guestWeb) && (!e.when || e.when(guestWeb))) (byPage[e.page] ||= []).push(e.title)
    expect(Object.keys(byPage).sort()).toEqual(['about', 'advanced', 'alerts', 'appearance', 'backup', 'danger', 'equipment', 'import', 'licences', 'schedule', 'units', 'workout'])
    for (const [page, want] of Object.entries(byPage)) {
      mount(page)
      const have = titles()
      for (const title of want) expect(have, `${page}: ${title}`).toContain(title)
    }
  })

  it('every old row has a home: the Workout page holds the rest, logging and the before/during rows', () => {
    mount('workout')
    expect([...host.querySelectorAll('.sect-t')].map(e => e.textContent)).toEqual(['Rest', 'Logging', 'Before and during'])
    expect(titles()).toEqual(['Rest timer', 'Rest-pause rest', 'Effort per set', 'Shown under each exercise', 'Layout',
      'Collapse completed exercises', 'Weigh in before workouts', 'Keep screen awake', 'Exercise animations'])
    // QA 10-05: the "screen stays on" line is the awake row's own subtitle, not a section footer
    // that read as if it explained the animations above it.
    expect(rowTitled('Keep screen awake').querySelector('.lrow-s').textContent).toMatch(/^The screen stays on/)
    expect(rowTitled('Exercise animations').querySelector('.lrow-s')).toBeNull()
    expect([...host.querySelectorAll('.sect-f')].some(f => /screen stays on/.test(f.textContent))).toBe(false)
    mount('advanced')
    expect(titles()).toEqual(['Planned sessions start from', 'Keep timing after target', 'Weight and reps buttons',
      'Drop and burst shortcuts on every set', 'Swipe actions', 'Exercise chips at the top', 'Superset buttons in the exercise header', 'Move, swap and remove buttons below the exercise'])
  })

  it('Collapse completed exercises is saved for every session and drops a running session\'s own choice', () => {
    mount('workout')
    mocks.S.active = { collapseCompleted: false, entries: [] }
    const sw = rowTitled('Collapse completed exercises').querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => sw.click())
    expect(mocks.S.collapseCompleted).toBe(true)
    expect('collapseCompleted' in mocks.S.active).toBe(false)
  })

  it('the Fine-tuning switches write S.wc as the old Workout controls sheet did', () => {
    mount('advanced')
    act(() => rowTitled('Superset buttons in the exercise header').querySelector('[role="switch"]').click())
    expect(mocks.S.wc.pairButtons).toBe(true)
    // the chip row at the top of a workout (#323) is on by default; its switch turns it off
    const chips = rowTitled('Exercise chips at the top').querySelector('[role="switch"]')
    expect(chips.getAttribute('aria-checked')).toBe('true')
    act(() => chips.click())
    expect(mocks.S.wc.exerciseChips).toBe(false)
  })

  it('a sub-page carries the shared header; every one goes back to Profile (§6)', () => {
    for (const [page, title] of [['alerts', 'Timer alerts'], ['advanced', 'Fine-tuning'], ['licences', 'Licences'], ['danger', 'Danger zone'], ['features', 'Features']]) {
      mount(page)
      expect(host.querySelector('.sub-hdr h1').textContent).toBe(title)
      act(() => host.querySelector('.sub-hdr button[aria-label="Back"]').click())
      expect(mocks.backs.at(-1), page).toBe('/me')
    }
  })

  it('the root carries it too, titled Profile, and its back is the tab\'s own', () => {
    mount()
    expect(host.querySelector('.sub-hdr h1').textContent).toBe('Profile')
    const before = mocks.backs.length
    act(() => host.querySelector('.sub-hdr button[aria-label="Back"]').click())
    expect(mocks.backs).toHaveLength(before + 1)   // the tab's back, with no parent given: the tab decides
  })

  it('a search hit flashes its row', () => {
    mount('alerts', 'Flash the screen')
    expect(rowTitled('Flash the screen').classList.contains('sp-flash')).toBe(true)
  })
})

describe('the rest wheels', () => {
  const doneIn = sheet => {
    const close = vi.fn()
    const h = document.createElement('div'); document.body.appendChild(h)
    const r = createRoot(h)
    act(() => r.render(sheet(close)))
    return { h, r, close }
  }
  it('Rest timer opens the wheel and stores any value as seconds in restSec', () => {
    mount('workout')
    expect(rowTitled('Rest timer').querySelector('.lrow-v').textContent).toBe('1:30')
    act(() => rowTitled('Rest timer').click())
    const { h, r } = doneIn(mocks.sheets.at(-1))
    expect(h.querySelector('h3').textContent).toBe('Rest timer')
    const [min, sec] = h.querySelectorAll('[role="spinbutton"]')
    expect(min.getAttribute('aria-valuemax')).toBe('15')
    act(() => { sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true })) })
    act(() => { sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })) })
    act(() => { [...h.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    expect(mocks.S.restSec).toBe(101)
    act(() => r.unmount()); h.remove()
    mount('workout')
    expect(rowTitled('Rest timer').querySelector('.lrow-v').textContent).toBe('1:41')
  })

  it('0:00 is the timer off', () => {
    mocks.S.restSec = 0
    mount('workout')
    expect(rowTitled('Rest timer').querySelector('.lrow-v').textContent).toBe('Off')
  })

  it('Rest-pause rest uses the wheel too, 5 s to 5 minutes', () => {
    mount('workout')
    act(() => rowTitled('Rest-pause rest').click())
    const { h, r } = doneIn(mocks.sheets.at(-1))
    const [min, sec] = h.querySelectorAll('[role="spinbutton"]')
    expect(min.getAttribute('aria-valuemax')).toBe('5')
    act(() => { sec.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    act(() => { [...h.querySelectorAll('button')].find(b => b.textContent === 'Done').click() })
    expect(mocks.S.restPauseSec).toBe(5)
    act(() => r.unmount()); h.remove()
  })
})

describe('searchSettings', () => {
  const tr = s => s
  it('matches titles, synonyms and pages, ignoring case and accents', () => {
    expect(searchSettings('Vibrate', guestWeb, tr).map(h => h.title)).toEqual(['Vibrate'])
    expect(searchSettings('buzz', guestWeb, tr).map(h => h.title)).toEqual(['Vibrate'])
    expect(searchSettings('pounds', guestWeb, tr).map(h => h.title)).toEqual(['Weight unit'])
    expect(searchSettings('dark mode', guestWeb, tr).map(h => h.title)).toEqual(['Theme'])
    expect(searchSettings('gif', guestWeb, tr).map(h => h.title)).toEqual(['Exercise animations'])
    expect(searchSettings('RÉST TIMER', guestWeb, tr)[0].title).toBe('Rest timer')
    expect(fold('Thème')).toBe('theme')
  })

  it('pages are hits too, and a title starting with the query comes first', () => {
    const hits = searchSettings('units', guestWeb, tr)
    expect(hits[0]).toMatchObject({ title: 'Units & language', isPage: true, page: 'units' })
    expect(searchSettings('rest', guestWeb, tr).slice(0, 2).map(h => h.title)).toEqual(['Rest timer', 'Rest-pause rest'])
  })

  it('names the page a row is on (Profile for the root\'s own), and keeps to the rows this device shows', () => {
    expect(pageTrail('advanced', tr)).toBe('Fine-tuning')
    expect(pageTrail(null, tr)).toBe('Profile')
    expect(searchSettings('overtime', guestWeb, tr)[0].trail).toBe('Fine-tuning')
    expect(searchSettings('sync now', { ...guestWeb, user: { id: 'u' }, synced: true }, tr)[0]).toMatchObject({ page: null, trail: 'Profile' })
    expect(searchSettings('admin', guestWeb, tr)).toEqual([])
    expect(searchSettings('admin', { ...guestWeb, user: { id: 'u', admin: true } }, tr)[0]).toMatchObject({ page: 'admin', isPage: true })
    expect(searchSettings('health connect', guestWeb, tr)).toEqual([])
    expect(searchSettings('nudge', guestWeb, tr)).toEqual([])                              // no Reminders for a web guest
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' } }, tr)).toEqual([])         // no push in this browser
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' }, pushOK: true }, tr)).toEqual([])   // the reminder is off
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' }, pushOK: true, reminderOn: true }, tr).map(h => h.title)).toEqual(['Nudge me when I skip a planned workout'])
    expect(searchSettings('nudge', { ...guestWeb, mobile: true, reminderOn: true }, tr).map(h => h.title)).toEqual(['Nudge me when I skip a planned workout'])
    expect(searchSettings('coach', guestWeb, tr)).toEqual([])
    expect(searchSettings('coach', { ...guestWeb, mobile: true }, tr)[0].page).toBe('coach')
    expect(searchSettings('vibrate silent', { ...guestWeb, mobile: true, android: true }, tr).map(h => h.title)).toEqual(['Vibrate on silent too'])
    expect(searchSettings('   ', guestWeb, tr)).toEqual([])
  })

  it('searches in the app language as well', () => {
    const de = { Vibrate: 'Vibration', 'Timer alerts': 'Timer-Hinweise', Settings: 'Einstellungen' }
    const hits = searchSettings('vibration', guestWeb, s => de[s] || s)
    expect(hits[0]).toMatchObject({ title: 'Vibrate', label: 'Vibration', trail: 'Timer-Hinweise' })
  })

  it('finds the translated choices of a row, and words of its own language', async () => {
    const { setLang, t } = await import('../lib/i18n.js')
    try {
      await setLang('de')
      const first = q => searchSettings(q, guestWeb, t)[0]?.title
      expect(first('Dunkel')).toBe('Theme')
      expect(first('Feste Woche')).toBe('How you train')
      expect(first('Wochenstart')).toBe('Week starts on')
      expect(first('kompakt')).toBe('Layout')
      expect(first('wischen')).toBe('Swipe actions')
      expect(first('Geste')).toBe('Swipe actions')
      await setLang('ar')
      expect(searchSettings('تناوب', guestWeb, t).map(h => h.title)).toContain('How you train')
    } finally { await setLang('en') }
  })

  it('English words match from the start of a word only, so "ton" never finds "buttons"', async () => {
    const { setLang, t } = await import('../lib/i18n.js')
    try {
      await setLang('de')
      const titles = searchSettings('ton', guestWeb, t).map(h => h.title)
      expect(titles).not.toContain('Weight and reps buttons')
      expect(titles).not.toContain('Superset buttons in the exercise header')
    } finally { await setLang('en') }
    expect(searchSettings('tone', { ...guestWeb, user: { id: 'u' }, pushOK: true, reminderOn: true, nudge: true }, s => s).map(h => h.title)).toContain('Nudge tone')
    expect(searchSettings('json', guestWeb, s => s).map(h => h.title)).toContain('Export backup (JSON)')
  })
})

describe('translations', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  it('every page and searchable row title has a word in each pack', () => {
    const keys = [...new Set([...PAGE_IDS.map(id => PAGES[id].title), ...SEARCH.map(e => e.title), ...ROOT_GROUPS.map(g => g.title)])]
    for (const [file, pack] of Object.entries(packs)) {
      const missing = keys.filter(k => !Object.hasOwn(pack, k) || !String(pack[k]).trim())
      expect(missing, file).toEqual([])
    }
  })
  it('the root groups only name real pages', () => {
    for (const g of ROOT_GROUPS) for (const id of g.ids) expect(PAGES[id], id).toBeTruthy()
  })
})

describe('Features', () => {
  it('lists every switch that starts off, says whether it is on, and opens its page with the switch flashed', () => {
    mocks.S.timerFlash = true
    mount('features')
    const t = titles()
    expect(t).toContain('Flash the screen')
    expect(t).toContain('Keep timing after target')
    expect(t).toContain('Reduce motion')
    expect(t).toContain('Filter by equipment')          // this test's profile has an equipment profile
    expect(t).not.toContain('Workout day reminder')     // no reminders for a guest in a browser
    expect(t).not.toContain('Auto-backup on changes')   // the phone app's
    expect(rowTitled('Flash the screen').querySelector('.lrow-v').textContent).toBe('On')
    expect(rowTitled('Flash the screen').querySelector('.lrow-s').textContent).toBe('Timer alerts')
    expect(rowTitled('Reduce motion').querySelector('.lrow-v').textContent).toBe('Off')
    act(() => rowTitled('Flash the screen').click())
    expect(mocks.navs.at(-1)).toEqual(['/me/alerts', { state: { find: 'Flash the screen' } }])
  })

  it('a reminder that waits on push opens Notifications with Push notifications to flash instead', () => {
    mocks.MOBILE = true
    mount('features')
    act(() => rowTitled('Workout day reminder').click())
    expect(mocks.navs.at(-1)).toEqual(['/me/notifications', { state: { find: 'Workout day reminder', via: 'Push notifications' } }])
  })

  it('every row it lists starts off in a new profile', async () => {
    const { freshState } = await vi.importActual('../store/useStore.js')
    const listed = SEARCH.filter(e => e.feature)
    expect(listed.length).toBeGreaterThan(10)
    for (const e of listed) expect(e.feature(freshState(), { baseLang: 'de', systemMotion: false }), e.title).not.toBe(true)
  })

  // Every switch a new profile shows off, on every page, has to be on Features: a browser signed
  // in with push, an Android phone, and an Android phone with the reminder on (for its nudge).
  it('lists every switch that is off in a new profile, wherever it is', async () => {
    const { freshState } = await vi.importActual('../store/useStore.js')
    const scenarios = {
      'web, signed in, push': () => { mocks.user = { id: 'u1', name: 'Dana' }; mocks.sync = { status: 'ok', server: 'https://gym.example' }; mocks.push = true },
      'Android phone': () => { mocks.MOBILE = true; mocks.android = true },
      'Android phone, reminder on': () => { mocks.MOBILE = true; mocks.android = true; mocks.S.reminder = { ...mocks.S.reminder, on: true } },
    }
    for (const [name, setUp] of Object.entries(scenarios)) {
      mocks.S = { ...freshState(), lang: 'en', equipProfiles: [{ id: 'p1', name: 'Home', equipment: [] }] }
      mocks.user = null; mocks.sync = null; mocks.MOBILE = false; mocks.android = false; mocks.push = false
      setUp()
      const off = new Set()
      for (const page of PAGE_IDS) {
        if (page === 'features' || page === 'account' || !pageExists(page, { user: mocks.user, mobile: mocks.MOBILE })) continue
        mount(page)
        await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve() })
        for (const row of host.querySelectorAll('.lrow')) {
          if (row.querySelector('[role="switch"][aria-checked="false"]')) off.add(row.querySelector('.lrow-t').textContent)
        }
        act(() => root.render(null))
      }
      mount('features')
      await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve() })
      const have = titles()
      expect(off.size, name).toBeGreaterThan(3)
      for (const title of off) expect(have, `${name}: ${title}`).toContain(title)
    }
  })
})

describe('Appearance', () => {
  it('keeps reduce motion, and drops nothing else of its own', () => {
    mount('appearance')
    expect(titles()).toEqual(['Theme', 'Accent color', 'Body diagram', 'Exercise drawings', 'Reduce motion', 'Gym check-in', 'Body weight', 'Show connection status'])
    act(() => rowTitled('Reduce motion').querySelector('[role="switch"]').click())
    expect(mocks.S.reduceMotion).toBe(true)
  })

  it('reduce motion shows on, and says why, when the device already reduces motion', () => {
    const real = window.matchMedia
    window.matchMedia = q => ({ matches: q.includes('prefers-reduced-motion'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      mount('appearance')
      const sw = rowTitled('Reduce motion').querySelector('[role="switch"]')
      expect(sw.getAttribute('aria-checked')).toBe('true')
      expect(rowTitled('Reduce motion').querySelector('.lrow-s').textContent).toBe('On in your device settings, so it is on here too.')
      mount('features')
      expect(rowTitled('Reduce motion').querySelector('.lrow-v').textContent).toBe('On')
    } finally { window.matchMedia = real }
  })
})
