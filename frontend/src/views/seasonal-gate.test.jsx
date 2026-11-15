// @vitest-environment happy-dom
// Christmas (and its advent calendar) is a surprise every year until 1 December, local time, and
// goes back into hiding on 1 January: outside December nothing of it may show or be reachable,
// even with the theme set to On (lib/seasonal.js `hidden`). This walks every way in on a day out
// of December (the last minute of November 2026, 1 January 2027, November 2027): the theme helpers,
// Settings → Look & Home, Seasonal themes and Modules, the settings search, the app icon picker,
// the streak icon picker, openSeasonal (the advent row's way in) and the Christmas chunk's own
// open() and Home card. Then the same on 1 December, where it all turns up and switches off.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchSettings } from './settings-pages.js'
import { activeSeason, seasonAccent, seasonInWorkout, shownThemes, themeOn } from '../lib/seasonal.js'
import { inAdvent, adventOpenable, openDoor } from '../lib/advent.js'
import { offeredIcons } from '../lib/app-icon-variants.js'
import { pickerChoices } from '../lib/streak-icons.js'

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
import { openSeasonal } from '../components/Seasonal.jsx'

globalThis.__APP_VERSION__ ??= 'test'

const NOV = new Date(2026, 10, 30, 23, 59)
const DEC = new Date(2026, 11, 1, 0, 1)
const XMAS = /christmas|advent|festive|xmas|santa/i
const guestWeb = { user: null, mobile: false, ios: false, android: false, demo: false, desktopWeb: true, mod: () => true }

let host, root
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  mocks.S = {
    unit: 'kg', lang: 'en', workouts: [], routines: [], exWeights: {}, equipProfiles: [{ id: 'p1', name: 'Home', equipment: [] }], activeEquipId: 'p1',
    reminder: { on: false, time: '17:30' },
    // the worst case: Christmas forced On with its colours, and an advent calendar someone made up
    seasonal: { christmas: 'on', christmasColors: true, christmasWorkout: true, halloween: 'off' },
    advent: { year: 2026, opened: [24], done: [] },
  }
  Object.assign(mocks, { user: null, sync: null, config: null, MOBILE: false, push: false, pushOn: false, toast: vi.fn(), sheets: [], navs: [] })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const mount = page => act(() => root.render(<Settings page={page} key={page} />))

describe.each([['the last minute of November 2026', NOV], ['New Year\'s Day 2027', new Date(2027, 0, 1, 0, 0)], ['November 2027', new Date(2027, 10, 20, 12)]])('%s', (_, when) => {
  beforeEach(() => vi.setSystemTime(when))

  it('the theme does not exist: no On, no colours, no workout decoration, no calendar', () => {
    expect(shownThemes().map(th => th.id)).toEqual(['halloween'])
    expect(themeOn(mocks.S, 'christmas')).toBe(false)
    expect(activeSeason(mocks.S)).toBe(null)
    expect(seasonAccent(mocks.S)).toBe(null)
    expect(seasonInWorkout(mocks.S)).toBe(false)
    expect(inAdvent()).toBe(false)
    expect(adventOpenable()).toBe(false)
    const s = {}
    expect(openDoor(s, 1)).toBe(false)
  })

  it('Settings shows nothing of it: Look & Home, Seasonal themes, Modules', () => {
    for (const page of ['look', 'themes', 'modules']) {
      mount(page)
      expect(host.textContent, page).not.toMatch(XMAS)
    }
    mount('themes')
    expect([...host.querySelectorAll('.lrow-t')].map(e => e.textContent)).toContain('Halloween')
  })

  it('the settings search finds nothing of it, in any word', () => {
    for (const q of ['christmas', 'xmas', 'advent', 'advent calendar', 'santa', 'festive colors', 'december']) {
      expect(searchSettings(q, guestWeb, s => s), q).toEqual([])
    }
    expect(searchSettings('halloween', guestWeb, s => s).length).toBeGreaterThan(0)
  })

  it('no Christmas app icon to pick, no festive streak flame', () => {
    expect(offeredIcons(new Date(), 'default').map(v => v.id)).not.toContain('christmas')
    expect(pickerChoices({ advent: { year: 2025, opened: [] } }, 'flame').map(c => c.v)).not.toContain('flameHat')
    expect(offeredIcons(new Date(), 'christmas').map(v => v.id)).toContain('christmas')   // one in use stays
  })

  it('no way in to the calendar: openSeasonal, the chunk\'s own open() and its Home card all say no', async () => {
    expect(await openSeasonal('christmas', 'advent')).toBe(false)
    expect(mocks.sheets).toHaveLength(0)
    const xm = await import('../seasonal/christmas.jsx')
    expect(xm.open('advent')).toBe(false)
    act(() => root.render(<xm.Deco spot="home-advent" />))
    expect(host.innerHTML).toBe('')
  })
})

describe('1 December 2026, one minute past midnight', () => {
  beforeEach(() => vi.setSystemTime(DEC))

  it('everything turns up', async () => {
    expect(shownThemes().map(th => th.id)).toEqual(['halloween', 'christmas'])
    expect(activeSeason(mocks.S)).toBe('christmas')
    expect(inAdvent()).toBe(true)
    mount('themes')
    expect(host.textContent).toContain('Christmas')
    expect(host.textContent).toContain('Advent calendar')
    // in its own weeks it is simply on or off, like any switch
    const sw = host.querySelector('[aria-label="Christmas"]')
    expect(sw).not.toBeNull()
    act(() => sw.click())
    expect(mocks.S.seasonal.christmas).toBe('off')
    expect(activeSeason(mocks.S)).toBe(null)
    act(() => root.unmount()); root = createRoot(host); mount('themes')
    act(() => host.querySelector('[aria-label="Christmas"]').click())
    expect(mocks.S.seasonal.christmas).toBe('auto')
    expect(searchSettings('christmas', guestWeb, s => s).length).toBeGreaterThan(0)
    expect(offeredIcons(new Date(), 'default').map(v => v.id)).toContain('christmas')
    expect(await openSeasonal('christmas', 'advent')).toBe(true)
    expect(mocks.sheets).toHaveLength(1)
  })
})
