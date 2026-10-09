// @vitest-environment happy-dom
// Settings v1.3.11: the root, the pages, the search and the rest wheels. Every row the search
// knows has to be a row on its page, and every page and row title has a word in each pack.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PAGES, PAGE_IDS, ROOT_GROUPS, SEARCH, pageVisible, searchSettings, pageTrail, fold } from './settings-pages.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, sync: null, MOBILE: false, push: false, sheets: [], navs: [], toast: null }
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
  it('is an account card and one row per page, in the four groups, with value previews', () => {
    mount()
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('Guest')
    expect(host.querySelector('.sp-acct .lrow-s').textContent).toBe('Your data lives on this device. Sign in to sync.')
    // a guest in a browser has no reminders (no push server) and no Coach page (the server's Coach)
    expect(titles()).toEqual(['Guest', 'Workout', 'Timer alerts', 'Plan & schedule', 'Units & language', 'Equipment', 'Look & Home', 'Data & backup', 'About & updates'])
    expect(rowTitled('Workout').querySelector('.lrow-v').textContent).toBe('1:30 rest · Cards')
    expect(rowTitled('Timer alerts').querySelector('.lrow-v').textContent).toBe('Sound · Vibrate')
    expect(rowTitled('Plan & schedule').querySelector('.lrow-v').textContent).toMatch(/^Fixed Week · Mon/)
    expect(rowTitled('Units & language').querySelector('.lrow-v').textContent).toBe('kg · English')
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

  it('a row opens its page; the Coach row opens the phone Coach setup; the card opens Account', () => {
    mocks.MOBILE = true
    mount()
    act(() => rowTitled('Timer alerts').click())
    act(() => rowTitled('AI Coach').click())
    act(() => host.querySelector('.sp-acct').click())
    expect(mocks.navs).toEqual([['/settings/alerts'], ['/coach/setup'], ['/settings/account']])
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
    expect(Object.keys(byPage).sort()).toEqual(['about', 'advanced', 'alerts', 'data', 'equipment', 'look', 'plan', 'units', 'workout'])
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
      'Weigh in before workouts', 'Keep screen awake', 'Exercise animations', 'Fine-tuning'])
    // QA 10-05: the "screen stays on" line is the awake row's own subtitle, not a section footer
    // that read as if it explained the animations above it.
    expect(rowTitled('Keep screen awake').querySelector('.lrow-s').textContent).toMatch(/^The screen stays on/)
    expect(rowTitled('Exercise animations').querySelector('.lrow-s')).toBeNull()
    expect([...host.querySelectorAll('.sect-f')].some(f => /screen stays on/.test(f.textContent))).toBe(false)
    mount('advanced')
    expect(titles()).toEqual(['Planned sessions start from', 'Keep timing after target', 'Weight and reps buttons',
      'Drop and burst shortcuts on every set', 'Swipe actions', 'Superset buttons in the exercise header', 'Move, swap and remove buttons below the exercise'])
  })

  it('the Fine-tuning switches write S.wc as the old Workout controls sheet did', () => {
    mount('advanced')
    act(() => rowTitled('Superset buttons in the exercise header').querySelector('[role="switch"]').click())
    expect(mocks.S.wc.pairButtons).toBe(true)
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
    const keys = [...new Set([...PAGE_IDS.map(id => PAGES[id].title), ...SEARCH.map(e => e.title)])]
    for (const [file, pack] of Object.entries(packs)) {
      const missing = keys.filter(k => !Object.hasOwn(pack, k) || !String(pack[k]).trim())
      expect(missing, file).toEqual([])
    }
  })
  it('the root groups only name real pages', () => {
    for (const g of ROOT_GROUPS) for (const id of g) expect(PAGES[id], id).toBeTruthy()
  })
})

// Native integrations are indexed only when the current platform offers them.
it('finds Apple Health only on a device where the integration is available', () => {
  expect(searchSettings('healthkit', { ...guestWeb, mobile: true, healthAvailable: true }).map(x => x.title)).toContain('Sync with Apple Health')
  expect(searchSettings('healthkit', { ...guestWeb, healthAvailable: false })).toEqual([])
})
