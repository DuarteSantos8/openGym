// @vitest-environment happy-dom
// The tab shell end to end, on the real HashRouter and the page's own history: four tabs, each
// with its own stack and scroll; switching replaces history instead of pushing, so a run of back
// presses walks down one tab and then leaves the app, never into another tab; pages any tab
// opens (Profile, the workout) sit on the tab that opened them; the live dock; the launch.
//
// "Leaves the app" is observed directly: each test starts on top of a marker entry that is not
// the app's, and a back press that leaves the app lands on it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout, loadStarterPlan } from './sheets.jsx'
import { nav } from './lib/nav.js'
import { switchTab } from './lib/use-tab-nav.js'

vi.mock('./lib/sound.js', async importOriginal => ({ ...(await importOriginal()), setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, scrolls
// A switch can take a few history walks, each landing on a later task: give them room.
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const hash = () => window.location.hash
const idx = () => window.history.state?.idx
const tab = label => [...document.querySelectorAll('#tabbar button')].find(b => b.textContent === label)
const lit = () => document.querySelector('#tabbar button[aria-current="page"]')?.textContent || null
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
// The Training hub's four targets, and the centre +.
const target = title => [...document.querySelectorAll('.hub-tile')].find(x => x.querySelector('.hub-tile-t').textContent === title)
const plus = () => document.querySelector('#tabbar button.start')
const click = async el => { await act(async () => { el.click() }); await settle() }
// Home's action row, its first slot while a session runs.
const homeResume = () => [...document.querySelectorAll('.act-b')].find(b => b.textContent === 'Resume')
const go = async fn => { await act(async () => { fn() }); await settle() }
const back = async () => { await act(async () => { window.history.back() }); await settle() }
// One back press from here: does it leave the app (land on the marker under it)?
async function backLeavesApp() {
  let left = false
  const see = () => { left = !!window.history.state?.marker }
  window.addEventListener('popstate', see, { once: true })
  await back()
  return left
}

async function launch(at) {
  window.history.pushState({ marker: true }, '', '#/not-the-app')
  window.history.pushState(null, '', at)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<App />) })
  await settle()
}
function quit() {
  act(() => root.unmount())
  host.remove()
}

beforeEach(() => {
  originalS = useStore.getState().S
  localStorage.setItem('gym_guest', '1')
  sessionStorage.clear()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)) })
  scrolls = []
  window.scrollTo = vi.fn((x, y) => scrolls.push(y))
})
afterEach(() => {
  quit()
  useUI.getState().closeAll()
  useUI.getState().stopRest?.()
  useStore.setState({ S: originalS })
  localStorage.removeItem('gym_guest')
})

const running = () => useStore.getState().update(s => { s.active = { id: 'a', name: 'Push A', entries: [], cur: 0, start: Date.now() - 60_000 } }, false)
// A plan with a routine on today, so Start starts it.
function planToday() {
  loadStarterPlan('full-body')
  useStore.getState().update(s => { s.week = { [new Date().getDay()]: [s.routines[0].id] } }, false)
}

describe('switching tabs', () => {
  it('replaces history instead of pushing, so back never reaches another tab', async () => {
    await launch('#/home')
    await click(tab('Training'))
    expect(hash()).toBe('#/train')
    expect(lit()).toBe('Training')
    await click(target('Exercises'))
    expect(hash()).toBe('#/train/exercises')
    expect(idx()).toBe(1)

    await click(tab('Progress'))
    expect(hash()).toBe('#/progress')
    expect(idx()).toBe(0)
    expect(await backLeavesApp()).toBe(true)
  })

  it('each tab comes back where it was left, its own back stack under it', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('History'))
    await click(tab('Progress'))
    await go(() => nav('/progress/body?range=90'))
    await click(tab('Training'))
    expect(hash()).toBe('#/train/history')
    expect(idx()).toBe(1)
    await back()
    expect(hash()).toBe('#/train')
    await click(tab('Progress'))
    expect(hash()).toBe('#/progress/body?range=90')
    await back()
    expect(hash()).toBe('#/progress')
    expect(await backLeavesApp()).toBe(true)
  })

  it('the tab on screen tapped again goes back to its root', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('Routines'))
    expect(hash()).toBe('#/train/routines')
    await click(tab('Training'))
    expect(hash()).toBe('#/train')
    expect(idx()).toBe(0)
    expect(await backLeavesApp()).toBe(true)
  })

  it('puts each tab\'s page back where it was scrolled to', async () => {
    await launch('#/home')
    await click(tab('Training'))
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true })
    await act(async () => { window.dispatchEvent(new Event('scroll')) })
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    await click(tab('Progress'))
    expect(scrolls.at(-1)).toBe(0)
    await click(tab('Training'))
    expect(scrolls.at(-1)).toBe(640)
  })
})

// The two sequences that broke the two-mode version (review of 4f359187), in their tab form.
describe('the review repros', () => {
  it('starting a workout the usual way leaves nothing of Home under Nutrition', async () => {
    planToday()
    await launch('#/home')
    await click(plus())
    await click([...document.querySelectorAll('.plus-sheet .lrow')].find(r => r.textContent.includes('Start workout')))
    await click(button('Start without weighing in'))
    expect(hash()).toBe('#/train/workout')
    await click(document.querySelector('button[aria-label="Minimize"]'))
    expect(hash()).toBe('#/home')
    await click(tab('Nutrition'))
    expect(hash()).toBe('#/food')
    expect(idx()).toBe(0)
    expect(await backLeavesApp()).toBe(true)
  })

  it('a page of another tab opened from Profile goes through the switch, not into this tab', async () => {
    await launch('#/home')
    await click(tab('Nutrition'))
    await click(document.querySelector('.avatar-btn'))
    expect(hash()).toBe('#/me')
    expect(lit()).toBe(null)   // Profile sits on Nutrition, lighting no tab
    await go(() => nav('/train/schedule'))
    expect(hash()).toBe('#/train/schedule')
    expect(lit()).toBe('Training')
    await click(tab('Nutrition'))
    expect(hash()).toBe('#/me')   // Nutrition kept Profile on top of itself
    await click(tab('Training'))
    expect(hash()).toBe('#/train/schedule')
    await back()
    expect(hash()).toBe('#/train')
    expect(await backLeavesApp()).toBe(true)
  })
})

describe('a history the mirror does not match', () => {
  it('a sheet\'s entry left under the page does not stop the walk short', async () => {
    await launch('#/train')
    // What Modals.jsx leaves behind when a sheet closes as the app moves on.
    window.history.pushState({ ...window.history.state, idx: 1, openGymSheet: true }, '')
    await go(() => nav('/train/history'))
    expect(idx()).toBe(2)
    await click(tab('Home'))
    expect(hash()).toBe('#/home')
    expect(idx()).toBe(0)
    expect(await backLeavesApp()).toBe(true)
  })

  it('a walk back that never lands does not freeze the screen', async () => {
    // A position the browser cannot walk back from: history.go does nothing, no popstate.
    window.history.replaceState({ idx: 5, key: 'odd', usr: null }, '', '#/train')
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root.render(<App />) })
    await settle()
    await act(async () => { tab('Progress').click() })
    await act(async () => { await new Promise(r => setTimeout(r, 450)) })
    await settle()
    expect(hash()).toBe('#/progress')
    expect(document.getElementById('app').hasAttribute('inert')).toBe(false)
    await click(tab('Home'))
    expect(hash()).toBe('#/home')
  })

  it('browser Forward onto the tab that was left steps straight back', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('History'))
    await click(tab('Progress'))
    await act(async () => { window.history.forward() })
    await settle()
    expect(hash()).toBe('#/progress')
  })

  it('a back press in the middle of a switch still ends on one tab, the screen let go', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('History'))
    await act(async () => { tab('Progress').click(); window.history.back() })
    await act(async () => { await new Promise(r => setTimeout(r, 450)) })
    await settle()
    expect(document.getElementById('app').hasAttribute('inert')).toBe(false)
    // The extra back press is spent walking; the switch still ends on the tab asked for, on its root.
    expect(hash()).toBe('#/progress')
    expect(lit()).toBe('Progress')
    await click(tab('Home'))
    expect(hash()).toBe('#/home')
  })
})

// history.go in a real WebView lands on a later task, sometimes much later. These hold it back
// on purpose: inside the watchdog's 400 ms, and past it.
describe('a walk back that lands late', () => {
  let realGo, replaces
  const slowWalks = ms => {
    realGo = window.history.go.bind(window.history)
    window.history.go = d => { setTimeout(() => realGo(d), ms) }
    const realReplace = window.history.replaceState.bind(window.history)
    replaces = 0
    window.history.replaceState = (...a) => { replaces++; return realReplace(...a) }
  }
  afterEach(() => { if (realGo) { window.history.go = realGo; realGo = null } delete window.history.replaceState })
  const wait = ms => act(async () => { await new Promise(r => setTimeout(r, ms)) })

  it('inside the watchdog, the switch waits for it and builds once', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('History'))
    slowWalks(150)
    await act(async () => { tab('Progress').click() })
    await wait(300)
    await settle()
    expect(hash()).toBe('#/progress')
    expect(idx()).toBe(0)
    expect(replaces).toBe(1)   // one build: the watchdog did not fire before the walk landed
  })

  it('past the watchdog, the late landing is finished again, and the tab left keeps its stack', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('History'))
    slowWalks(600)
    await act(async () => { tab('Progress').click() })
    await wait(800)
    await settle()
    expect(hash()).toBe('#/progress')
    expect(idx()).toBe(0)
    expect(lit()).toBe('Progress')
    window.history.go = realGo; realGo = null
    await click(tab('Training'))
    expect(hash()).toBe('#/train/history')
    expect(idx()).toBe(1)
  })
})

// A finished or discarded session must not stay on any tab's stack: its address shows the Start
// screen once the session is over.
describe('a workout that has ended', () => {
  const discard = async () => {
    await click(document.querySelector('button[aria-label="Workout options"]'))
    await click([...document.querySelectorAll('.sheet button, .sheet .lrow, .sheet [role="button"]')].find(b => b.textContent.includes('Discard')))
    // The confirm dialog's own button.
    await click([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Discard'))
  }

  it('discarded from a Nutrition dock, it leaves Nutrition and Training as they were', async () => {
    running()
    await launch('#/home')
    await click(tab('Nutrition'))
    await click(document.querySelector('#timer.dock .dock-main'))
    expect(hash()).toBe('#/train/workout')
    await discard()
    expect(useStore.getState().S.active).toBeNull()
    expect(hash()).toBe('#/food')
    await click(tab('Home'))
    await click(tab('Nutrition'))
    expect(hash()).toBe('#/food')
    expect(lit()).toBe('Nutrition')
    await click(tab('Training'))
    expect(hash()).toBe('#/train')
  })

  it('ended from Home, it leaves no Start screen under Home', async () => {
    running()
    await launch('#/home')
    await click(homeResume())
    expect(hash()).toBe('#/train/workout')
    await discard()
    expect(hash()).toBe('#/home')
    expect(idx()).toBe(0)
    expect(await backLeavesApp()).toBe(true)
  })
})

// A page the switch arrives at that redirects as it mounts (a missing routine, the Coach for a
// guest) must get its redirect: it mounts only once the switch is done.
describe('a page that redirects', () => {
  it('a missing routine opened from Home lands on Routines, not on a blank page', async () => {
    await launch('#/home')
    await go(() => nav('/train/routines/nope'))
    await settle()
    expect(hash()).toBe('#/train/routines')
    expect(lit()).toBe('Training')
    expect(document.querySelector('.sub-hdr h1').textContent).toBe('Routines')
  })

  it('a cold #/coach as a guest goes Home with the bar, not a blank Coach page', async () => {
    await launch('#/coach')
    expect(hash()).toBe('#/home')
    expect(document.querySelector('#tabbar')).not.toBeNull()
    expect(lit()).toBe('Home')
  })

  it('a cold #/coach/proposal does the same', async () => {
    await launch('#/coach/proposal')
    expect(hash()).toBe('#/home')
    expect(document.querySelector('#tabbar')).not.toBeNull()
  })
})

describe('back on a sub-page', () => {
  it('opened cold, it goes to the parent in its place', async () => {
    await launch('#/progress/body/measurements')
    await click(document.querySelector('.sub-hdr button[aria-label="Back"]'))
    expect(hash()).toBe('#/progress/body')
    await click(document.querySelector('.sub-hdr button[aria-label="Back"]'))
    expect(hash()).toBe('#/progress')
    expect(await backLeavesApp()).toBe(true)
  })

  it('reached in the tab, it goes one step down the stack', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('History'))
    await click(document.querySelector('.sub-hdr button[aria-label="Back"]'))
    expect(hash()).toBe('#/train')
    expect(idx()).toBe(0)
  })

  it('Profile goes back to the tab that opened it', async () => {
    await launch('#/home')
    await click(tab('Progress'))
    await click(document.querySelector('.avatar-btn'))
    await click(document.querySelector('.sub-hdr button[aria-label="Back"]'))
    expect(hash()).toBe('#/progress')
  })
})

describe('the live dock', () => {
  it('shows while a workout runs and you are elsewhere, and opens it', async () => {
    running()
    await launch('#/progress')
    const dock = () => document.querySelector('#timer.dock')
    expect(dock().textContent).toContain('Push A')
    expect(tab('Training').querySelector('.live-dot')).not.toBeNull()
    await click(dock().querySelector('.dock-main'))
    expect(hash()).toBe('#/train/workout')
    expect(dock()).toBeNull()   // the workout screen has its own rest bar, and no bar at all
  })

  it('carries the rest countdown with +30 and Skip', async () => {
    running()
    await launch('#/home')
    await act(async () => { useUI.getState().startRest(60) })
    const dock = document.querySelector('#timer.dock')
    expect(dock.querySelector('.t').textContent).toMatch(/^[01]:\d\d$/)
    await click(button('30s'))
    expect(useUI.getState().timer.left).toBeGreaterThan(80)
    await click(button('Skip'))
    expect(useUI.getState().timer).toBeNull()
    expect(document.querySelector('#timer.dock')).not.toBeNull()   // the session is still on
  })

  it('is not there without a running workout', async () => {
    await launch('#/home')
    expect(document.querySelector('#timer.dock')).toBeNull()
  })
})

// The last gate's findings (review of c544044d), each failing there.
describe('a sheet\'s entry nobody is closing', () => {
  it('after a reload on a sheet\'s entry, back still works', async () => {
    // History as a reload leaves it: Training, History, and the entry of a sheet open on History.
    window.history.pushState({ marker: true }, '', '#/not-the-app')
    window.history.pushState({ usr: null, key: 'a', idx: 0 }, '', '#/train')
    window.history.pushState({ usr: null, key: 'b', idx: 1 }, '', '#/train/history')
    window.history.pushState({ usr: null, key: 'b', idx: 2, openGymSheet: true }, '')
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root.render(<App />) })
    await settle()
    await click(document.querySelector('.sub-hdr button[aria-label="Back"]'))
    expect(hash()).toBe('#/train')
  })

  it('a leaked one mid-session: each tap of back goes back, and taps do not pile up', async () => {
    await launch('#/train')
    await go(() => nav('/train/history'))
    window.history.pushState({ ...window.history.state, idx: 2, openGymSheet: true }, '')
    const backBtn = () => document.querySelector('.sub-hdr button[aria-label="Back"]')
    await click(backBtn())
    await click(backBtn())
    expect(hash()).toBe('#/train')
    expect(idx()).toBe(0)
    // No waiting listener left behind to walk back again on the next pop.
    await click(target('History'))
    await back()
    expect(hash()).toBe('#/train')
  })
})

describe('Nice! after a finished workout', () => {
  it('goes back where the session was opened, leaving no Start screen under it', async () => {
    running()
    await launch('#/home')
    await click(homeResume())
    expect(hash()).toBe('#/train/workout')
    await go(() => finishWorkout())
    await click(button('Finish anyway'))
    await click(button('Nice!'))
    expect(useStore.getState().S.active).toBeNull()
    expect(hash()).toBe('#/home')
    expect(idx()).toBe(0)
    expect(await backLeavesApp()).toBe(true)
  })
})

describe('a navigation in the middle of a switch', () => {
  it('to a third tab, mid-build: that tab, with the arriving tab\'s whole stack put aside', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('History'))
    await click(tab('Home'))
    // The moment the switch back to Training writes its first entry, something opens Body.
    const realReplace = window.history.replaceState.bind(window.history)
    let fired = false
    window.history.replaceState = (s, ...rest) => {
      realReplace(s, ...rest)
      if (!fired && s?.usr?.tabSwitch && String(rest[1] || '').includes('/train')) { fired = true; queueMicrotask(() => nav('/progress/body')) }
    }
    try {
      await click(tab('Training'))
      await settle()
    } finally { delete window.history.replaceState }
    expect(fired).toBe(true)
    expect(hash()).toBe('#/progress/body')
    expect(lit()).toBe('Progress')
    await click(tab('Training'))
    expect(hash()).toBe('#/train/history')
    // Progress holds its own stack: Body over the Progress hub, nothing of Training under it.
    await click(tab('Progress'))
    expect(hash()).toBe('#/progress/body')
    await back()
    expect(hash()).toBe('#/progress')
    expect(await backLeavesApp()).toBe(true)
  })

  it('a push while walking back is carried out once the switch is done', async () => {
    await launch('#/home')
    await click(document.querySelector('.avatar-btn'))
    expect(hash()).toBe('#/me')
    // The walk back takes a while, as it can on a device; the push lands in the middle of it.
    const realGo = window.history.go.bind(window.history)
    window.history.go = d => { setTimeout(() => realGo(d), 100) }
    try {
      await act(async () => { tab('Training').click() })
      await act(async () => { nav('/train/exercises') })
      await act(async () => { await new Promise(r => setTimeout(r, 600)) })
      await settle()
    } finally { window.history.go = realGo }
    expect(hash()).toBe('#/train/exercises')
    expect(lit()).toBe('Training')
    await back()
    expect(hash()).toBe('#/train')
  })
})

describe('a sheet that closes into a switch', () => {
  it('leaves the page inert until the switch is done', async () => {
    await launch('#/home')
    await click(document.querySelector('.avatar-btn'))
    await click(plus())
    const realGo = window.history.go.bind(window.history)
    window.history.go = d => { setTimeout(() => realGo(d), 200) }
    try {
      await act(async () => { [...document.querySelectorAll('.plus-sheet .lrow')].find(r => r.textContent.includes('Gym check-in')).click() })
      await act(async () => { await new Promise(r => setTimeout(r, 50)) })
      expect(document.getElementById('app').hasAttribute('inert')).toBe(true)
      await act(async () => { await new Promise(r => setTimeout(r, 700)) })
      await settle()
    } finally { window.history.go = realGo }
    expect(hash()).toBe('#/train/checkin')
    expect(document.getElementById('app').hasAttribute('inert')).toBe(false)
  })
})

describe('the + sheet', () => {
  it('tints its rows only with colours a white glyph clears 3:1 on, in both themes', async () => {
    await launch('#/progress/body')
    await click(plus())
    const tints = [...document.querySelectorAll('.plus-sheet .lrow-i')].map(i => i.style.getPropertyValue('--tint'))
    expect(tints.length).toBeGreaterThan(3)
    for (const tint of tints) expect(['var(--blue)', 'var(--indigo)', 'var(--purple)', 'var(--pink)'], tint).toContain(tint)
  })

  it('offers what fits the screen first, then the fixed rows', async () => {
    await launch('#/home')
    await click(tab('Training'))
    await click(target('History'))
    await click(plus())
    const rows = () => [...document.querySelectorAll('.plus-sheet .lrow')].map(r => r.textContent)
    expect(rows()[0]).toContain('Log past workout')
    expect(rows().some(r => r.includes('Weigh in'))).toBe(true)
    expect(rows().some(r => r.includes('Start workout'))).toBe(true)
    expect(rows().some(r => r.includes('Soon'))).toBe(false)
  })

  it('is a modal dialog: named, focus moved in and kept there, the page behind out of reach, focus back on +', async () => {
    await launch('#/home')
    plus().focus()
    await click(plus())
    const dialog = document.querySelector('.plus-sheet[role="dialog"]')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Add')
    expect(dialog.contains(document.activeElement)).toBe(true)
    for (const id of ['app', 'tabbar']) expect(document.getElementById(id).hasAttribute('inert'), id).toBe(true)
    const controls = [...dialog.querySelectorAll('button')]
    controls.at(-1).focus()
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })) })
    expect(document.activeElement).toBe(controls[0])
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await settle()
    expect(document.querySelector('.plus-sheet')).toBeNull()
    expect(document.getElementById('tabbar').hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(plus())
  })

  it('names Resume and the time while a workout runs', async () => {
    running()
    await launch('#/home')
    await click(plus())
    const row = [...document.querySelectorAll('.plus-sheet .lrow')].find(r => r.textContent.includes('Resume workout'))
    expect(row.querySelector('.plus-sheet-live')).not.toBeNull()
  })
})

describe('the launch', () => {
  it('opens Home', async () => {
    await launch('#/')
    expect(hash()).toBe('#/home')
  })

  it('opens straight into a running workout', async () => {
    running()
    await launch('#/')
    expect(hash()).toBe('#/train/workout')
  })

  it('takes an old route to where it lives now, query kept', async () => {
    await launch('#/stats?focus=weekly-volume')
    // Into Training load, where the weekly volume card is; the hub is its parent, not stacked in.
    expect(hash()).toBe('#/progress/load?focus=weekly-volume')
    expect(document.getElementById('weekly-volume') || document.querySelector('.sub-hdr h1').textContent === 'Training load').toBeTruthy()
    expect(idx()).toBe(0)
    await click(document.querySelector('.sub-hdr button[aria-label="Back"]'))
    expect(hash()).toBe('#/progress')
    expect(await backLeavesApp()).toBe(true)
  })

  it('keeps the fragment of an old route', async () => {
    await launch('#/history#2026')
    expect(hash()).toBe('#/train/history#2026')
  })

  it('switching programmatically works from code outside the shell', async () => {
    await launch('#/home')
    await go(() => switchTab('food'))
    expect(hash()).toBe('#/food')
  })
})
