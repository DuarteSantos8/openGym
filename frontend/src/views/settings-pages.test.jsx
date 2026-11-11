// @vitest-environment happy-dom
// Settings v1.3.11: the root, the pages, the search and the rest wheels. Every row the search
// knows has to be a row on its page, and every page and row title has a word in each pack.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PAGES, PAGE_IDS, ROOT_GROUPS, SEARCH, pageVisible, onRoot, searchSettings, pageTrail, fold } from './settings-pages.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, sync: null, config: null, MOBILE: false, push: false, sheets: [], navs: [], toast: null }
  state.snapshot = () => ({
    S: state.S, user: state.user, coachLocal: null, sync: state.sync, config: state.config,
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
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a) => mocks.navs.push(a), useLocation: () => ({ pathname: '/settings', search: '' }) }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(path => Promise.resolve(path === '/api/account/passkeys' ? { passkeys: [] } : {})), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false }))
vi.mock('../lib/push.js', () => ({ pushSupported: () => mocks.push, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn(), syncPushSubscription: vi.fn(() => Promise.resolve(mocks.pushOn)) }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => true }))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE }, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), shareExportBlob: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(), importFromHevy: vi.fn(),
  equipmentProfileSheet: vi.fn(), plateInventorySheet: vi.fn(), menuSheet: vi.fn(),
}))

import Settings from './Settings.jsx'
import { FLOWS } from '../lib/tour.js'
import { bindUI } from '../components/ui.jsx'
import { useUI } from '../store/useUI.js'

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
  mocks.config = null
  mocks.MOBILE = false
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
// A page that reads something first (the passkeys from the server, the gyms from the phone) until
// it has: on a busy machine one tick is not always enough.
const settle = async () => {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  for (let i = 0; i < 50 && titles().includes('Checking…'); i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) })
}

// This test's guest in a browser, as the page itself sees it.
const guestWeb = {
  user: null, mobile: false, android: false, demo: false, wakeOK: true, hasMedia: false, pwOn: false, webauthn: false,
  sound: true, playOnSilent: false, canVibrate: true, vibrate: true, profiles: true, nameLang: false,
  pushOK: false, reminderOn: false, nudge: false, autoBackup: false, synced: false, installTip: true, androidWeb: false,
  // the test browser (happy-dom) is neither Android nor Apple, so the page shows the desktop install tip
  desktopWeb: true,
}

describe('the root', () => {
  it('is an account card and one row per page, in the four groups, with value previews', () => {
    mount()
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('Guest')
    expect(host.querySelector('.sp-acct .lrow-s').textContent).toBe('Your data lives on this device. Sign in to sync.')
    // a guest in a browser has no reminders (no push server) and no Coach page (the server's Coach)
    // #1105: what you change each week, then what you set once, then connections (option C)
    expect(titles()).toEqual(['Guest', 'Workout', 'Timer alerts', 'Plan & schedule', 'Units & language', 'Equipment', 'Look & Home', 'Modules', 'Integrations', 'Use your subscription', 'Data & backup', 'About & updates'])
    expect([...host.querySelectorAll('.sect-t')].map(h => h.textContent)).toEqual(['Training', 'Set once', 'Connections'])
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('1:30 rest · Cards')
    expect(rowTitled('Timer alerts').querySelector('.lrow-v').textContent).toBe('Sound · Vibrate')
    expect(rowTitled('Plan & schedule').querySelector('.lrow-v').textContent).toMatch(/^Fixed Week · Mon/)
    expect(rowTitled('Units & language').querySelector('.lrow-v').textContent).toBe('kg · English · Epley')
    expect(rowTitled('Equipment').querySelector('.lrow-v').textContent).toBe('Everything')
    expect(rowTitled('About & updates').querySelector('.lrow-v').textContent).toMatch(/^v\d|^vtest/)
  })

  it('marks the page rows so a long preview wraps instead of losing its second half', () => {
    mount()
    const rows = ['Workout', 'Timer alerts', 'Plan & schedule', 'Units & language', 'Look & Home'].map(rowTitled)
    for (const r of rows) expect(r.classList.contains('sp-root-row')).toBe(true)
    // index.css: the marked rows' value may wrap, and never shrinks below its longest word
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const rule = css.match(/^\.lrow\.sp-root-row \.lrow-v\{([^}]*)\}/m)?.[1] || ''
    expect(rule).toMatch(/white-space:normal/)
    expect(rule).toMatch(/line-clamp:3/)
    expect(rule).toMatch(/min-width:min-content/)
    // P10 (redesign 1.4.5): on every phone width the preview is the row's subtitle, under the title
    const phone = css.match(/@media \(max-width:430px\)\{\n  \.lrow\.sp-root-row:has\(\.lrow-v\)\{([^}]*)\}/)?.[1] || ''
    expect(phone).toMatch(/display:grid/)
    expect(css).toMatch(/\.lrow\.sp-root-row \.lrow-v\{grid-column:2;grid-row:2;[^}]*text-align:start/)
    // the sub-page title takes a second line rather than an ellipsis ("Alertas do temporizador")
    const title = css.match(/^\.sp-title\{([^}]*)\}/m)?.[1] || ''
    expect(title).not.toMatch(/nowrap/)
    expect(title).toMatch(/line-clamp:2/)
  })

  it('previews a rest that was never on the old list, and no timer at all', () => {
    mocks.S.restSec = 105
    mount()
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('1:45 rest · Cards')
    mocks.S.restSec = 0
    mount()
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('No rest timer · Cards')
  })

  it('signed in, Reminders is there and the card names the account; on the phone app the Coach too', () => {
    mocks.user = { id: 'u1', name: 'Dana' }
    mount()
    expect(titles()).toContain('Reminders')
    expect(titles()).not.toContain('AI Coach')
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('Dana')
    expect(host.querySelector('.sp-avatar').textContent).toBe('D')
    mocks.user = null
    mocks.MOBILE = true
    mount()
    expect(titles()).toContain('Reminders')
    expect(titles()).toContain('AI Coach')
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('This phone')
  })

  // #1105: one Watches row on the phones; the web has only Zepp, so its row stays on the root.
  it('groups the watches on a phone, and keeps Zepp on the root on the web', () => {
    const phone = { mobile: true, ios: true, android: false }
    expect(pageVisible('watches', phone)).toBe(true)
    expect(pageVisible('watches', { ...phone, mod: id => id !== 'watch' })).toBe(false)
    expect(pageVisible('watches', { user: { id: 'u' } })).toBe(false)
    expect(onRoot('zepp', phone)).toBe(false)
    expect(onRoot('zepp', { user: { id: 'u' } })).toBe(true)
    expect(pageTrail('garmin')).toBe('Watches › Garmin')
    mocks.MOBILE = true
    mount()
    expect(titles()).toContain('Watches')
    for (const w of ['Apple Watch', 'Garmin', 'Zepp OS watch']) expect(titles()).not.toContain(w)
    mount('watches')
    // this test phone is not known to be an iPhone, so no Apple Watch (pageVisible above covers it)
    expect(titles()).toEqual(['Garmin', 'Zepp OS watch'])
    act(() => rowTitled('Garmin').click())
    expect(mocks.navs).toEqual([['/settings/garmin']])
    mocks.MOBILE = false
    mocks.user = { id: 'u1', name: 'Dana' }
    mount()
    expect(titles()).toContain('Zepp OS watch')
    expect(titles()).not.toContain('Watches')
  })

  it('a row opens its page; the Coach row opens the phone Coach setup; the card opens Account', () => {
    mocks.MOBILE = true
    mount()
    act(() => rowTitled('Timer alerts').click())
    act(() => rowTitled('AI Coach').click())
    act(() => host.querySelector('.sp-acct').click())
    expect(mocks.navs).toEqual([['/settings/alerts'], ['/coach/setup'], ['/settings/account']])
  })

  it('in a hosted app, an admin gets the Coach row too, straight to the Coach card of the admin dashboard', () => {
    mocks.config = { coach: { enabled: true } }
    mocks.user = { id: 'u1', name: 'Dana' }
    mount()
    expect(titles()).not.toContain('AI Coach')
    mocks.user = { id: 'u1', name: 'Dana', admin: true }
    mount()
    expect(rowTitled('AI Coach').textContent).toContain('Admin')
    // in Connections, just before the assistants' row (no longer bolted onto Look & Home)
    expect(rowTitled('AI Coach').nextElementSibling).toBe(rowTitled('Use your subscription'))
    act(() => rowTitled('AI Coach').click())
    expect(mocks.navs).toEqual([['/admin', { state: { section: 'coach' } }]])
  })

  it('only while the server offers the Coach, so the row never leads to an admin page without it (#683)', () => {
    mocks.user = { id: 'u1', name: 'Dana', admin: true }
    mount()
    expect(titles()).not.toContain('AI Coach')
    mocks.config = { coach: null }
    mount()
    expect(titles()).not.toContain('AI Coach')
    mocks.config = { coach: { enabled: true } }
    mount()
    expect(titles()).toContain('AI Coach')
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
    expect(mocks.navs.at(-1)).toEqual(['/settings/alerts', { state: { find: 'Vibrate' } }])
    type('zzzz')
    expect(host.querySelector('.sp-empty').textContent).toBe('No setting matches “zzzz”.')
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
    for (const e of SEARCH) if (pageVisible(PAGES[e.page].parent || e.page, ctx) && (!e.when || e.when(ctx))) (byPage[e.page] ||= []).push(e.title)
    for (const [page, want] of Object.entries(byPage)) {
      if (page === 'coach') continue
      mount(page)
      await settle()
      const have = [...titles(), ...[...host.querySelectorAll('.btn')].map(b => b.textContent.trim())]
      for (const title of want) expect(have, `${page}: ${title}`).toContain(title)
    }
  })

  // Rows that are not settings, so the search leaves them out (#1105). One line each, with why.
  const NOT_SEARCHABLE = new Set([
    'account: All data stays on this phone', 'account: All synced', // the sync status line
    'account: gym.example', // the server's address, as the person typed it
    'account: Passkeys not supported in this browser.', 'reminders: Not supported in this browser.', // a note, not a row to change
    'equipment: Home', // the name of this test's equipment profile
    'about: Rate openGym on the App Store', 'about: Buy me a coffee', 'about: Ko-fi', 'about: GitHub Sponsors', // links out of the app
    'gym: Checking…', // the page loading
    'gym-find: Current location', // a search result, not a setting
    'voice: Try it', // plays a sample
    'zepp: Install the watch app', // a link to the install guide
    'integrations: Strava', 'integrations: openNutrition', // brand names, not translated: the Integrations page's own words find them
    'live: Effort', // reads "Effort (RIR)" once effort is on; "Effort per set" answers the word
  ])
  // The other way round (#1105): every row a page shows can be found, so a new row cannot slip
  // past the search. A row that opens a page (a sub-page, or Zepp inside Watches) counts through
  // that page's own entry.
  for (const [name, setUp] of Object.entries(scenarios)) it(`${name}: every row on a page is in the search`, async () => {
    setUp()
    const ctx = ctxNow()
    const missing = []
    const shown = p => pageVisible(p, ctx) && (!PAGES[p].parent || shown(PAGES[p].parent))
    for (const page of PAGE_IDS) {
      // coach: a redirect. live-custom: per exercise type checklists, found through the page itself.
      if (page === 'coach' || page === 'live-custom' || !shown(page)) continue
      const known = new Set([...SEARCH.filter(e => e.page === page).map(e => e.title), ...PAGE_IDS.map(id => PAGES[id].title)])
      mount(page)
      await settle()
      for (const title of titles()) if (!known.has(title) && !NOT_SEARCHABLE.has(`${page}: ${title}`)) missing.push(`${page}: ${title}`)
    }
    expect(missing).toEqual([])
  })

  // Settings → Look & Home → Text size (1.4.5): people ask for a bigger font in their own words.
  it('finds Text size by font, text, size and bigger, in every language', async () => {
    const { readdirSync } = await import('node:fs')
    const dir = resolve(process.cwd(), 'src/locales')
    for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
      const dict = (await import(/* @vite-ignore */ resolve(dir, f))).default
      const tr = s => dict[s] || s
      for (const q of ['font', 'text', 'size', 'bigger', fold(tr('Larger')).split(' ')[0], fold(tr('Largest')).split(' ')[0]]) {
        expect(searchSettings(q, guestWeb, tr).map(h => h.title), `${f}: ${q}`).toContain('Text size')
      }
    }
    expect(searchSettings('forgotten', { ...guestWeb, mobile: true }, s => s).map(h => h.title)).toContain('Ask “Still training?”')
    expect(searchSettings('forgotten', guestWeb, s => s)).toEqual([])
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
    expect(searchSettings('home screen', { ...web, desktopWeb: false }, tr).map(h => h.title)).toEqual(['In Safari: Share → Add to Home Screen'])
    expect(searchSettings('install', { ...web, androidWeb: true, desktopWeb: false }, tr).map(h => h.title)).toEqual(['In Chrome: ⋮ menu → Add to Home screen'])
    // Windows and Linux are neither: Chrome's install icon, not an iPhone's Share menu (night QA 10-19).
    expect(searchSettings('install', web, tr).map(h => h.title)).toEqual(['In Chrome or Edge: the install icon in the address bar'])
    expect(searchSettings('backup folder', { ...guestWeb, mobile: true, android: true, autoBackup: true }, tr).map(h => h.title)).toEqual(['Backup folder'])
    expect(searchSettings('backup folder', { ...guestWeb, mobile: true, android: true }, tr)).toEqual([])
  })

  // Checked in Chrome, signed in on the web: "gym" offered the Gym reminder page, a phone-only
  // page whose tap only bounced back to Settings. Its parent (Reminders) is there on the web.
  it('never offers a page this device does not have, even under a parent it has', () => {
    const tr = s => s
    const web = { ...guestWeb, user: { id: 'u' }, synced: true, pushOK: true }
    expect(pageVisible('reminders', web)).toBe(true)
    expect(searchSettings('gym reminder', web, tr).map(h => h.title)).not.toContain('Gym reminder')
    expect(searchSettings('gym reminder', { ...web, mobile: true }, tr).map(h => h.title)).toContain('Gym reminder')
  })

  it('a web reminder row waits for push to answer, and flashes Push notifications when it stays off', async () => {
    vi.useFakeTimers()
    try {
      mocks.user = { id: 'u1', name: 'Dana' }
      mocks.push = true
      mocks.S.reminder = { on: true, time: '17:30' }
      mount('reminders', 'Nudge me when I skip a planned workout', 'Push notifications')
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
      expect(rowTitled('Push notifications').classList.contains('sp-flash')).toBe(true)
      expect(mocks.toast).toHaveBeenCalledWith('Turn on push notifications first.')

      // push on: the row appears once the server answers, and that row is the one flashed
      mocks.pushOn = true
      mocks.toast.mockClear()
      act(() => root.render(null))
      mount('reminders', 'Nudge me when I skip a planned workout', 'Push notifications')
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
    for (const e of SEARCH) if (pageVisible(PAGES[e.page].parent || e.page, guestWeb) && (!e.when || e.when(guestWeb))) (byPage[e.page] ||= []).push(e.title)
    expect(Object.keys(byPage).sort()).toEqual(['about', 'account', 'advanced', 'alerts', 'data', 'equipment', 'integrations', 'live', 'look', 'modules', 'plan', 'themes', 'units', 'voice', 'workout'])
    for (const [page, want] of Object.entries(byPage)) {
      mount(page)
      // A row, or a button with the same words (the "Works with" chips on Integrations).
      const have = [...titles(), ...[...host.querySelectorAll('.btn')].map(b => b.textContent.trim())]
      for (const title of want) expect(have, `${page}: ${title}`).toContain(title)
    }
  })

  // #1105: each heading names what is under it, in the order a session goes.
  it('every old row has a home: the Workout page, from starting to the workout screen', () => {
    mount('workout')
    expect([...host.querySelectorAll('.sect-t')].map(e => e.textContent)).toEqual(['Starting', 'Warm-ups', 'Rest', 'Logging', 'Records', 'Workout screen', 'More'])
    expect(titles()).toEqual(['Start button', 'Preview before starting', 'Weigh in before workouts', 'Daily check-in', 'Automatic warm-ups', 'Rest timer', 'Rest between warm-ups', 'Rest before the next exercise', 'Rest-pause rest',
      'Effort per set', 'Shown under each exercise', 'Last time means', 'Compare sets with last time', 'New exercises start with', 'Record trophies', 'Cheer on a record', 'How close to a record',
      'Layout', 'Collapse completed exercises', 'Skip completed exercises', 'Next exercise when the rest ends', 'Keep screen awake', 'Exercise animations', 'Live widget', 'Fine-tuning'])
    // QA 10-05: the "screen stays on" line is the awake row's own subtitle, not a section footer
    // that read as if it explained the animations above it.
    expect(rowTitled('Keep screen awake').querySelector('.lrow-s').textContent).toMatch(/^The screen stays on/)
    expect(rowTitled('Exercise animations').querySelector('.lrow-s')).toBeNull()
    expect([...host.querySelectorAll('.sect-f')].some(f => /screen stays on/.test(f.textContent))).toBe(false)
    // Fine-tuning is the workout screen only; the rules for the numbers a session opens with
    // sit on Plan & schedule (#1105).
    mount('advanced')
    expect([...host.querySelectorAll('.sect-t')].map(e => e.textContent)).toEqual(['Timed sets', 'Buttons on the workout screen'])
    expect(titles()).toEqual(['Keep timing after target', 'Timed holds start by themselves', 'Weight and reps buttons',
      'Drop and burst shortcuts on every set', 'Swipe actions', 'Exercise chips at the top', 'Muscle map at the top', 'Superset buttons in the exercise header', 'Move, swap and remove buttons below the exercise'])
    mount('plan')
    expect([...host.querySelectorAll('.sect-t')].map(e => e.textContent)).toEqual(['Training rules'])
    expect(titles()).toEqual(['How you train', 'Week starts on', 'Default progression', 'Deload weeks', 'Suggest a deload when I need one', 'Planned sessions start from',
      'Weekly sets per muscle', 'Load starter plan'])
    expect(searchSettings('deload weeks', guestWeb, s => s)[0].trail).toBe('Plan & schedule')
    // "Last time means" sits under the row it explains (#1105 polish).
    expect(searchSettings('last time means', guestWeb, s => s)[0].trail).toBe('Workout')
  })

  // #1105 step 5: Look, then what Home shows, then the streak; Units & language says what is what.
  it('every old row has a home: Look & Home and Units & language', () => {
    const heads = () => [...host.querySelectorAll('.sect-t')].map(e => e.textContent)
    mount('look')
    expect(heads()).toEqual(['Look', 'Home', 'Streak'])
    expect(titles()).toEqual(['Theme', 'Accent color', 'Icons', 'Motion', 'Text size', 'Body diagram', 'Exercise drawings', 'Seasonal themes',
      'Body weight', 'Recovery tips', 'Week and month recap', 'Weekly sets on Home', 'Monthly challenges', 'Show connection status',
      'Streak flame', 'Streak freeze', 'Streak freezes', 'Sick and travel weeks', 'Recovery counts for the streak', 'Sport counts for the streak'])
    mocks.S.modules = { motivation: false }                    // no streak: no empty heading
    mount('look')
    expect(heads()).toEqual(['Look', 'Home'])
    delete mocks.S.modules
    mount('units')
    expect(heads()).toEqual(['Language', 'Units', 'Stats'])
    expect(titles()).toEqual(['Language', 'Weight unit', 'Weight decimals', 'Weight step', 'Speed unit',
      '1RM formula', 'Count warm-ups in volume', 'Count body weight in bodyweight lifts', 'About you', 'Daily weigh-in value'])
  })

  it('Default progression shows linear on an older profile and writes S.progDefault', () => {
    bindUI(useUI) // SelectRow opens its sheet through the bound store (the mock above)
    mount('plan')
    expect(rowTitled('Default progression').querySelector('.lrow-v').textContent).toBe('Linear progression')
    act(() => rowTitled('Default progression').click())
    const h = document.createElement('div'); document.body.appendChild(h)
    const r = createRoot(h)
    act(() => r.render(mocks.sheets.at(-1)(vi.fn())))
    const off = [...h.querySelectorAll('button, [role="button"], .lrow')].find(e => e.textContent.startsWith('No automatic progression'))
    act(() => off.click())
    expect(mocks.S.progDefault).toBe('off')
    act(() => r.unmount()); h.remove()
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
    // the header's muscle map (#670) is on by default too
    const map = rowTitled('Muscle map at the top').querySelector('[role="switch"]')
    expect(map.getAttribute('aria-checked')).toBe('true')
    act(() => map.click())
    expect(mocks.S.wc.muscleMap).toBe(false)
  })

  it('a sub-page names where back goes; Fine-tuning goes back to Workout', () => {
    mount('alerts')
    expect(host.querySelector('.sp-back').textContent).toBe('Settings')
    expect(host.querySelector('.sp-back').hasAttribute('aria-label')).toBe(false)   // its name is the word it shows
    expect(host.querySelector('.sp-title').textContent).toBe('Timer alerts')
    mount('advanced')
    expect(host.querySelector('.sp-back').textContent).toBe('Workout')
    act(() => host.querySelector('.sp-back').click())
    expect(mocks.navs.at(-1)).toEqual(['/settings/workout', { replace: true }])
  })

  it('a search hit flashes its row', () => {
    mount('alerts', 'Flash the screen')
    expect(rowTitled('Flash the screen').classList.contains('sp-flash')).toBe(true)
  })
})

// The tour and the tutorials point at rows by their data-tour anchor (#1105). A row that moves
// without its anchor makes an optional stop vanish in silence, so every Settings stop is checked.
describe('the tour on Settings', () => {
  // Stops a test cannot show: sp-back is the page header, drawn outside Settings; data-health needs
  // the phone's health store (Settings.health.test.jsx checks it).
  const ELSEWHERE = new Set(['sp-back', 'data-health'])
  it('every Settings stop of every flow finds its anchor', async () => {
    mocks.MOBILE = true; mocks.user = { id: 'u1', name: 'Dana' }; mocks.sync = { status: 'ok', server: 'https://gym.example' }
    mocks.S.autoBackup = true
    const lost = []
    for (const [flow, steps] of Object.entries(FLOWS)) for (const s of steps) {
      if (typeof s.route !== 'string' || !s.route.startsWith('/settings') || !s.anchor || ELSEWHERE.has(s.anchor)) continue
      mount(s.route.split('/')[2] || null)
      await settle()
      if (!host.querySelector(`[data-tour="${s.anchor}"]`)) lost.push(`${flow}/${s.id}: ${s.anchor}`)
    }
    expect(lost).toEqual([])
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

  it('names Fine-tuning under Workout, and keeps to the rows this device shows', () => {
    expect(pageTrail('advanced', tr)).toBe('Workout › Fine-tuning')
    expect(searchSettings('overtime', guestWeb, tr)[0].trail).toBe('Workout › Fine-tuning')
    expect(searchSettings('nudge', guestWeb, tr)).toEqual([])                              // no Reminders for a web guest
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' } }, tr)).toEqual([])         // no push in this browser
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' }, pushOK: true }, tr)).toEqual([])   // the reminder is off
    expect(searchSettings('nudge', { ...guestWeb, user: { id: 'u' }, pushOK: true, reminderOn: true }, tr).map(h => h.title)).toEqual(['Nudge me when I skip a planned workout'])
    expect(searchSettings('nudge', { ...guestWeb, mobile: true, reminderOn: true }, tr).map(h => h.title)).toEqual(['Nudge me when I skip a planned workout'])
    // the AI Coach module's own row on Settings → Modules is the one AI Coach hit a web guest gets
    // (the voice style "Calm coach" is a hit of its own)
    expect(searchSettings('coach', guestWeb, tr).filter(h => h.page !== 'modules' && h.page !== 'voice')).toEqual([])
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
    const keys = [...new Set([...PAGE_IDS.map(id => PAGES[id].title), ...SEARCH.map(e => e.title)])]
    for (const [file, pack] of Object.entries(packs)) {
      const missing = keys.filter(k => !Object.hasOwn(pack, k) || !String(pack[k]).trim())
      expect(missing, file).toEqual([])
    }
  })
  it('the root groups only name real pages', () => {
    for (const g of ROOT_GROUPS) for (const id of g.ids) expect(PAGES[id], id).toBeTruthy()
  })
})

// Equipment per gym (#808): the active gym at the top, its switcher swaps the lists below.
describe('the equipment page with two gyms', () => {
  it('shows the active gym first and switching it loads that gym’s plates, with a toast', () => {
    bindUI(useUI)
    const homePlates = { kg: { 20: 1, _ts: 5 } }
    mocks.S = {
      ...mocks.S, invGym: 'p1', plates: homePlates,
      equipProfiles: [
        { id: 'p1', name: 'Home', equipment: [], plates: homePlates, dumbbells: {}, barDefaults: {}, stackWeights: {} },
        { id: 'p2', name: 'Big gym', equipment: [], plates: { kg: { 25: 3, _ts: 6 } }, dumbbells: {}, barDefaults: {}, stackWeights: {} },
      ],
    }
    mount('equipment')
    expect(titles().slice(0, 2)).toEqual(['Active gym', 'Plates'])
    expect(rowTitled('Active gym').querySelector('.lrow-v').textContent).toBe('Home')
    expect([...host.querySelectorAll('.sect-h, h2, .sect-t')].map(e => e.textContent)).toContain('Equipment at Home')
    act(() => rowTitled('Active gym').click())
    const h = document.createElement('div'); document.body.appendChild(h)
    const r = createRoot(h)
    act(() => r.render(mocks.sheets.at(-1)(vi.fn())))
    const big = [...h.querySelectorAll('button, [role="button"], .lrow')].find(e => e.textContent.startsWith('Big gym'))
    act(() => big.click())
    expect(mocks.S.activeEquipId).toBe('p2')
    expect(mocks.S.plates.kg[25]).toBe(3)
    expect(mocks.S.equipProfiles[0].plates).toEqual(homePlates)
    expect(mocks.toast).toHaveBeenCalledWith('Using Big gym equipment')
    act(() => r.unmount()); h.remove()
  })
})
