// @vitest-environment happy-dom
// Settings > Workout > Live widget on a phone: the status card (the master switch, what stands in
// the way, "Try it" as a row), the Dynamic Island tab only on an iPhone that has one, and the help
// sheet. "Try it" shows the real Live Activity (or Android's notification) with the moment
// previewed, marked a preview, never over a running workout, gone by itself after two minutes.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, calls: [], status: { supported: true, island: false }, statusP: null, asked: 0, shown: true, os: 'ios', sheets: [], opened: 0, perm: 'denied', permAsked: 0 }
  state.snapshot = () => ({ S: state.S, ready: true, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  state.plugin = {
    status: async () => { state.asked++; return state.statusP ? state.statusP : state.status },
    update: async x => { state.calls.push(['update', x]); return { shown: state.shown } },
    end: async () => { state.calls.push(['end']) },
    drain: async () => ({ events: [] }),
    ack: async () => {},
    addListener: async () => ({ remove () {} }),
  }
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const state_sheets = fn => mocks.sheets.push(fn)
  const snap = () => ({ timer: null, toast: () => {}, openSheet: fn => state_sheets(fn) })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true, nativePlatform: async () => mocks.os }))
vi.mock('../lib/gym-reminder.js', () => ({ openAppSettings: async () => { mocks.opened++; return true } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { requestPermissions: async () => { mocks.permAsked++; if (mocks.perm === 'granted') mocks.status = { ...mocks.status, allowed: true }; return { display: mocks.perm } } } }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => mocks.plugin }))

const { default: LiveWidgetSettings, surfacesFor } = await import('./LiveWidgetSettings.jsx')
const LA = await import('../lib/live-activity.js')

let host, root
const render = async el => { await act(async () => { root.render(el) }) }
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = async el => { await act(async () => { el.click() }) }

const IOS16 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const realUA = navigator.userAgent
const setUA = v => Object.defineProperty(navigator, 'userAgent', { value: v, configurable: true })
const android = () => { mocks.os = 'android'; mocks.status = { supported: true, allowed: true } }
const titles = (el = host) => [...el.querySelectorAll('.lrow .lrow-t')].map(x => x.textContent)
const rowOf = (title, el = host) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const master = () => rowOf('Live widget')?.querySelector('[role="switch"]')

beforeEach(() => {
  globalThis.Capacitor = { getPlatform: () => mocks.os }
  localStorage.clear()
  Object.assign(mocks, { statusP: null, asked: 0, shown: true, os: 'ios', sheets: [], opened: 0, perm: 'denied', permAsked: 0 })
  mocks.S = { unit: 'kg', restSec: 90, effort: 'rir', lang: 'en', workouts: [], routines: [], exWeights: {} }
  mocks.calls = []
  mocks.status = { supported: true, island: false }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete globalThis.Capacitor; LA._resetLiveActivity(); vi.useRealTimers(); setUA(realUA); localStorage.clear() })

describe('which surfaces a phone previews', () => {
  it('the Dynamic Island only on an iPhone that has one; unknown means none', () => {
    const ids = (os, st) => surfacesFor(os, st, false).map(x => x.id)
    expect(ids('ios', null)).toEqual(['lock'])
    expect(ids('ios', { island: false })).toEqual(['lock'])
    expect(ids('ios', { island: true })).toEqual(['lock', 'island'])
    expect(ids('android', { island: true })).toEqual(['android'])
    expect(ids(null, null)).toEqual(['lock', 'island', 'android'])
    // The strip of the workout screen is drawn under its own switch now; the function still knows it.
    expect(ids(null, null).includes('app')).toBe(false)
    expect(surfacesFor(null, null, true).map(x => x.id)).toContain('app')
  })
  it('the page asks the plugin and shows the island tab when it says so', async () => {
    mocks.status = { supported: true, island: true }
    await render(<LiveWidgetSettings />)
    await settle()
    expect([...host.querySelectorAll('.gl-surface button')].map(b => b.textContent)).toEqual(['Lock Screen', 'Dynamic Island'])
    expect(host.querySelector('.gl-surface').getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.getElementById(host.querySelector('.gl-surface').getAttribute('aria-labelledby')).textContent).toBe('Preview on')
  })
  it('no island: no tab at all, the Lock Screen is the preview', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-surface')).toBeNull()
    expect(host.querySelector('.gl-lock')).toBeTruthy()
  })
  it('Android: no tab, the notification, and no “In the app” tab even with the strip on', async () => {
    android()
    mocks.S.liveWidget = { v: 2, card: true }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-surface')).toBeNull()
    expect(host.querySelector('.gl-stage-android')).toBeTruthy()
    expect(host.querySelector('.gl-strip-demo')).toBeTruthy()
  })
})

describe('the status card', () => {
  it('healthy: the master switch, on, and the test row; no warning, no footer, no lede', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    const card = host.querySelector('.gl-status')
    expect(titles(card)).toEqual(['Live widget', 'Try it on this phone'])
    expect(master().getAttribute('aria-checked')).toBe('true')
    expect(card.querySelector('.sect-f')).toBeNull()
    expect(host.querySelector('.gl-lede')).toBeNull()
    // The card comes first on the page.
    expect(host.querySelector('.gl-settings').firstElementChild).toBe(card)
  })
  it('before the phone answered: both rows are there already and inert, so nothing jumps', async () => {
    let answer
    mocks.statusP = new Promise(r => { answer = r })
    await render(<LiveWidgetSettings />)
    expect(titles(host.querySelector('.gl-status'))).toEqual(['Live widget', 'Try it on this phone'])
    expect(master().disabled).toBe(true)
    expect(host.querySelector('.gl-try').tagName).toBe('DIV')
    await act(async () => { answer({ supported: true, island: false }) })
    await settle()
    expect(master().disabled).toBe(false)
    expect(host.querySelector('.gl-try').tagName).toBe('BUTTON')
  })
  it('Live Activities off: a warning row that opens the app’s settings, and no test row', async () => {
    mocks.status = { supported: false, island: true }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-try')).toBeNull()
    expect(master()).toBeTruthy()
    const warn = host.querySelector('.gl-warn')
    expect(warn.querySelector('.lrow-t').textContent).toBe('Live Activities are off for openGym. Turn them on in the iPhone’s Settings.')
    expect(warn.querySelector('.lrow-c')).toBeTruthy()
    await click(warn)
    expect(mocks.opened).toBe(1)
  })
  it('asks again when the app comes back from the system’s settings', async () => {
    mocks.status = { supported: false, island: false }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-warn')).toBeTruthy()
    mocks.status = { supported: true, island: false }
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(host.querySelector('.gl-warn')).toBeNull()
    expect(host.querySelector('.gl-try')).toBeTruthy()
  })
  it('an iPhone below iOS 17: says so, with no switch, no test and nothing to tap', async () => {
    setUA(IOS16)
    mocks.status = { supported: false, island: false }
    await render(<LiveWidgetSettings />)
    await settle()
    const card = host.querySelector('.gl-status')
    expect(titles(card)).toEqual(['This needs iOS 17 or later. This iPhone is on an older version.'])
    expect(card.querySelector('.gl-warn').tagName).toBe('DIV')
    expect(card.querySelector('[role="switch"]')).toBeNull()
  })
  it('Android without the notification permission: asks Android first, and opens the settings only on a no', async () => {
    android()
    mocks.status = { supported: true, allowed: false }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-try')).toBeNull()
    const warn = () => host.querySelector('.gl-warn')
    expect(warn().querySelector('.lrow-t').textContent).toBe('Notifications are off for openGym, so Android has nowhere to show this.')
    await click(warn())
    await settle()
    expect(mocks.permAsked).toBe(1)
    expect(mocks.opened).toBe(1)
    expect(warn()).toBeTruthy()
    // Allowed in Android's own question: no trip to the settings, and the row goes.
    mocks.perm = 'granted'
    await click(warn())
    await settle()
    expect(mocks.permAsked).toBe(2)
    expect(mocks.opened).toBe(1)
    expect(warn()).toBeNull()
    expect(host.querySelector('.gl-try')).toBeTruthy()
  })
})

describe('off on this phone', () => {
  it('the master switch is a fact about this phone: localStorage, never S', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    const before = JSON.stringify(mocks.S)
    await click(master())
    expect(localStorage.getItem('gym_live_off')).toBe('1')
    expect(JSON.stringify(mocks.S)).toBe(before)
    expect(master().getAttribute('aria-checked')).toBe('false')
    // The card keeps the switch only; the stage steps back behind the word.
    expect(titles(host.querySelector('.gl-status'))).toEqual(['Live widget'])
    expect(host.querySelector('.gl-status .sect-f').textContent).toBe('Off on this phone. Your choices below still apply to your other devices and the Home Screen widget.')
    expect(host.querySelector('.gl-stage').classList.contains('off')).toBe(true)
    expect(host.querySelector('.gl-off').textContent).toBe('Off')
    expect(host.querySelector('.gl-stage').getAttribute('aria-label')).toMatch(/Off\.$/)
    await click(master())
    expect(localStorage.getItem('gym_live_off')).toBeNull()
    expect(host.querySelector('.gl-stage').classList.contains('off')).toBe(false)
    expect(host.querySelector('.gl-try')).toBeTruthy()
  })
  it('remembers it on the next visit, and ends a test that was running', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    await click(host.querySelector('.gl-try'))
    await settle()
    mocks.calls = []
    await click(master())
    await settle()
    expect(mocks.calls).toEqual([['end']])
    await act(async () => root.unmount())
    root = createRoot(host)
    await render(<LiveWidgetSettings />)
    await settle()
    expect(master().getAttribute('aria-checked')).toBe('false')
    expect(host.querySelector('.gl-try')).toBeNull()
  })
  it('Android adds that the rest timer keeps its own notification', async () => {
    android()
    localStorage.setItem('gym_live_off', '1')
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-status .sect-f').textContent).toBe('Off on this phone. Your choices below still apply to your other devices and the Home Screen widget. The rest timer keeps its own notification.')
  })
  it('the switches below still write, and “Back to the defaults” never turns the widget back on', async () => {
    localStorage.setItem('gym_live_off', '1')
    await render(<LiveWidgetSettings />)
    await settle()
    await click(rowOf('Pause').querySelector('[role="switch"]'))
    expect(mocks.S.liveWidget.buttons.pause).toBe(true)
    await render(<LiveWidgetSettings />)
    await click(rowOf('Back to the defaults'))
    expect(localStorage.getItem('gym_live_off')).toBe('1')
  })
})

describe('Try it', () => {
  const row = () => host.querySelector('.gl-try')
  const title = () => row().querySelector('.lrow-t').textContent
  const hint = () => host.querySelector('.gl-try-hint').textContent
  it('is a row: shows the sample as a preview activity, with the hint, and Stop ends it', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    expect(row().classList.contains('lrow')).toBe(true)
    expect(title()).toBe('Try it on this phone')
    expect(hint()).toBe('Lock your phone to see it on the Lock Screen.')
    await click(row())
    await settle()
    const up = mocks.calls.find(c => c[0] === 'update')
    expect(up).toBeTruthy()
    const attrs = JSON.parse(up[1].attributes)
    expect(attrs.pv).toBe(true)
    expect(attrs.wid).toMatch(/^preview-/)
    expect(JSON.parse(up[1].state).cur.exName).toBe('Barbell Bench Press')
    expect(title()).toBe('Stop')
    expect(hint()).toBe('Lock your phone to see it on the Lock Screen. Ends by itself after 2 minutes.')
    await click(row())
    await settle()
    expect(mocks.calls.at(-1)).toEqual(['end'])
    expect(title()).toBe('Try it on this phone')
  })
  it('an iPhone with a Dynamic Island: swipe home, since iOS keeps an app’s own activity out of it while the app is in front', async () => {
    mocks.status = { supported: true, island: true }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(hint()).toBe('Swipe home to see it in the Dynamic Island, or lock your phone for the Lock Screen.')
    // Whichever tab is in view: the hint is about the phone, not the tab.
    await click([...host.querySelectorAll('.gl-surface button')].find(b => b.textContent === 'Dynamic Island'))
    expect(hint()).toBe('Swipe home to see it in the Dynamic Island, or lock your phone for the Lock Screen.')
  })
  it('Android: pull down from the top', async () => {
    android()
    await render(<LiveWidgetSettings />)
    await settle()
    expect(hint()).toBe('Pull down from the top to see it with your notifications.')
  })
  it('follows the moment picked while it runs', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    await click(row())
    await settle()
    await click([...host.querySelectorAll('.gl-moments button')].find(b => b.textContent === 'Resting'))
    await settle()
    const last = mocks.calls.filter(c => c[0] === 'update').at(-1)
    expect(JSON.parse(last[1].state).restEndsAt).toBeGreaterThan(Date.now())
  })
  it('never over a running workout: the same title, not tappable, with the reason', async () => {
    mocks.S.active = { id: 'w1', start: Date.now(), cur: 0, entries: [{ id: '0025', sets: [{ w: 80, r: 8 }] }] }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(row().tagName).toBe('DIV')
    expect(title()).toBe('Try it on this phone')
    expect(hint()).toMatch(/Not while a workout is running/)
    expect(await LA.tryLive({ attributes: {}, state: {} }, mocks.S)).toBe(false)
  })
  it('the phone answers that it showed nothing: back to idle, says so, and asks the phone again', async () => {
    mocks.shown = false
    await render(<LiveWidgetSettings />)
    await settle()
    const asked = mocks.asked
    await click(row())
    await settle()
    expect(title()).toBe('Try it on this phone')
    expect(hint()).toBe('Your phone did not show it. Not showing up? at the bottom has the usual reasons.')
    expect(mocks.asked).toBeGreaterThan(asked)
    expect(LA.tryingLive()).toBe(false)
    // A second go that works clears the line.
    mocks.shown = true
    await click(row())
    await settle()
    expect(title()).toBe('Stop')
  })
  it('ends by itself after two minutes, and on leaving the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await render(<LiveWidgetSettings />)
    await settle()
    await click(row())
    await settle()
    await act(async () => { vi.advanceTimersByTime(LA.TRY_SECONDS * 1000 + 10) })
    await settle()
    expect(mocks.calls.some(c => c[0] === 'end')).toBe(true)
    mocks.calls = []
    await click(row())
    await settle()
    await act(async () => root.unmount())
    await settle()
    expect(mocks.calls.at(-1)).toEqual(['end'])
    root = createRoot(host)
  })
  it('a workout that started meanwhile keeps its card: ending the preview leaves it alone', async () => {
    LA._setLivePluginForTest(mocks.plugin, mocks.snapshot)
    expect(await LA.tryLive(SMlive(), mocks.S)).toBe(true)
    mocks.S = { ...mocks.S, active: { id: 'w2', entries: [] } }
    mocks.calls = []
    await LA.endTryLive(() => mocks.S)
    expect(mocks.calls).toEqual([])
  })
})

describe('what a phone leaves out', () => {
  it('Android: no +15 s row (the rest card always has it), and its own words on three rows', async () => {
    android()
    await render(<LiveWidgetSettings />)
    await settle()
    expect(titles()).not.toContain('+15 s on rests')
    const sub = t => rowOf(t).querySelector('.lrow-s').textContent
    expect(sub('Weight and reps')).toBe('Less weight and More weight in the notification. They take both free places, so the other buttons step aside.')
    expect(sub('Record hints')).toBe('“2 more reps for a record”, on the Home Screen widget.')
    expect(sub('Time since start')).toBe('A running clock in the corner while a set is up.')
    expect(host.querySelector('.sect:last-child .sect-f').textContent).toMatch(/Live Update/)
    expect([...host.querySelectorAll('.sect-f')].map(x => x.textContent)).toContain('Adds a progress bar and up to four extras.')
  })
  it('iPhone: +15 s is there, and the note under the last card is the iOS one', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    expect(titles()).toContain('+15 s on rests')
    expect(host.querySelector('.sect:last-child .sect-f').textContent).toMatch(/iOS 17/)
    expect([...host.querySelectorAll('.sect-f')].map(x => x.textContent)).toContain('Adds a progress bar, the record hint and up to four extras.')
  })
})

describe('Not showing up?', () => {
  let box, boxRoot
  const openHelp = async () => {
    await click(rowOf('Not showing up?'))
    expect(mocks.sheets).toHaveLength(1)
    box = document.createElement('div')
    document.body.appendChild(box)
    boxRoot = createRoot(box)
    const closed = vi.fn()
    await act(async () => { boxRoot.render(mocks.sheets[0](closed)) })
    await settle()
    return closed
  }
  afterEach(async () => { if (boxRoot) await act(async () => boxRoot.unmount()); box?.remove(); box = boxRoot = null })

  it('iPhone with an island: four reasons, the first with the phone’s own answer and a way to the setting', async () => {
    mocks.status = { supported: true, island: true }
    await render(<LiveWidgetSettings />)
    await settle()
    const closed = await openHelp()
    expect(box.querySelector('h3').textContent).toBe('Not showing up?')
    expect(box.textContent).toMatch(/It shows up when a workout starts and leaves when you finish\./)
    expect(titles(box)).toEqual(['Allow Live Activities', 'Allow it on a locked phone', 'Leave the app', 'Gone after a swipe or a very long session'])
    const first = rowOf('Allow Live Activities', box)
    expect(first.querySelector('.lrow-v').textContent).toBe('On')
    await click(first)
    expect(mocks.opened).toBe(1)
    // The honest line: it comes back with the next set, not by opening the app.
    expect(rowOf('Gone after a swipe or a very long session', box).querySelector('.lrow-s').textContent).toMatch(/It comes back with your next set\.$/)
    await click([...box.querySelectorAll('.btn')].find(b => b.textContent === 'Done'))
    expect(closed).toHaveBeenCalled()
  })
  it('iPhone without an island: no “Leave the app”; Live Activities off reads Off', async () => {
    mocks.status = { supported: false, island: false }
    await render(<LiveWidgetSettings />)
    await settle()
    await openHelp()
    expect(titles(box)).toEqual(['Allow Live Activities', 'Allow it on a locked phone', 'Gone after a swipe or a very long session'])
    expect(rowOf('Allow Live Activities', box).querySelector('.lrow-v').textContent).toBe('Off')
  })
  it('Android: the notification permission with its answer, and the Android note under it', async () => {
    android()
    mocks.status = { supported: true, allowed: false }
    await render(<LiveWidgetSettings />)
    await settle()
    await openHelp()
    expect(titles(box)).toEqual(['Allow notifications'])
    const r = rowOf('Allow notifications', box)
    expect(r.querySelector('.lrow-v').textContent).toBe('Off')
    expect(r.querySelector('.lrow-s').textContent).toBe('Android Settings, Apps, openGym, Notifications.')
    expect(box.querySelector('.sect-f').textContent).toMatch(/Live Update/)
    await click(r)
    expect(mocks.opened).toBe(1)
  })
})

const SM = await import('../lib/live-samples.js')
function SMlive () { return SM.sampleLive(mocks.S, 'strength', { now: Date.now() }) }
