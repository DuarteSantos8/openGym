// @vitest-environment happy-dom
// The page behind an open search stays out of reach through every navigation, on the real App,
// the real HashRouter and the page's own history (lib/search/hold-page.js). #app is keyed on the
// route, so it remounts under the overlay whenever the route changes, and the router's location
// can land a commit after the overlay's `open`: the hold is the state of the document, worked
// out again whenever it changes, not something done once when the overlay opens.
//
// A leak is a control Tab could land on that is neither in the header, nor in the overlay, nor in
// a sheet: none may exist while the overlay is open, whatever mounted, remounted or changed.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { openPlusSheet } from './components/PlusSheet.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { endSearch, useSearch, visit } from './lib/search/session.js'

vi.mock('./lib/sound.js', async importOriginal => ({ ...(await importOriginal()), setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const $ = s => document.querySelector(s)
const go = async fn => { await act(async () => { fn() }); await settle() }
const back = () => go(() => window.history.back())
const pill = () => $('.spill-i')
const inert = el => !!el.closest('[inert]')

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'
const LIVE = '.tab-hdr, #gains-search, #modal-root'
const reachable = () => [...document.querySelectorAll(FOCUSABLE)].filter(el => !el.disabled && el.tabIndex >= 0 && !inert(el))
const leaks = () => reachable().filter(el => !el.closest(LIVE)).map(el => el.outerHTML.slice(0, 90))

async function launch(at) {
  window.history.pushState({ marker: true }, '', '#/not-the-app')
  window.history.pushState(null, '', at)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<App />) })
  await settle()
}
const openOverlay = async () => {
  await act(async () => { pill().focus() })
  await settle()
  expect(useSearch.getState().open).toBe(true)
}

beforeEach(() => {
  originalS = useStore.getState().S
  localStorage.setItem('gym_guest', '1')
  sessionStorage.clear()
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)) })
  window.scrollTo = vi.fn()
})
afterEach(() => {
  act(() => endSearch())
  act(() => root.unmount())
  host.remove()
  useUI.getState().closeAll()
  useUI.getState().stopRest?.()
  useStore.setState({ S: originalS })
  localStorage.removeItem('gym_guest')
})

describe('the page behind an open search', () => {
  it('is held on the first screen of the overlay, with the header and the results live', async () => {
    await launch('#/home')
    await openOverlay()
    expect(leaks()).toEqual([])
    expect(reachable().some(el => el.closest('.tab-hdr'))).toBe(true)
    expect(inert($('#tabbar'))).toBe(true)
    expect($('#app').hasAttribute('inert')).toBe(false)
  })

  it('stays held when back from a result remounts #app under the overlay', async () => {
    await launch('#/home')
    await openOverlay()
    // A result's page: a sub-page with no tab header of its own.
    await go(() => visit('/train/history'))
    expect(useSearch.getState().open).toBe(false)
    expect($('#app .tab-hdr')).toBeNull()
    const was = $('#app')
    await back()
    expect(useSearch.getState().open).toBe(true)
    expect($('#app')).not.toBe(was)
    expect($('#app .tab-hdr')).not.toBeNull()
    expect(leaks()).toEqual([])
    expect(inert($('#tabbar'))).toBe(true)
    expect(inert(document.querySelector('#app main, #app > :not(.tab-hdr)'))).toBe(true)
    // And lets go of all of it with the close.
    await go(() => $('.avatar-btn').click())
    expect(useSearch.getState().live).toBe(false)
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })

  it('holds a rest timer that mounts while the search is open', async () => {
    await launch('#/home')
    await openOverlay()
    expect($('#timer')).toBeNull()
    await act(async () => { useUI.getState().startRest(60) })
    await settle()
    expect($('#timer')).not.toBeNull()
    expect(inert($('#timer'))).toBe(true)
    expect(leaks()).toEqual([])
    await go(() => $('.avatar-btn').click())
    expect($('#timer').hasAttribute('inert')).toBe(false)
  })

  it('holds the live dock that replaces the timer, and the tab bar that remounts with it', async () => {
    await launch('#/home')
    await openOverlay()
    await act(async () => { useStore.getState().update(s => { s.active = { id: 'a', name: 'Push A', entries: [], cur: 0, start: Date.now() - 60_000 } }, false) })
    await settle()
    expect($('#timer.dock')).not.toBeNull()
    expect(inert($('#timer'))).toBe(true)
    expect(leaks()).toEqual([])
    // Out to the workout (no tab bar, the rest bar in the dock's place) and back onto the overlay:
    // the dock and the bar are new elements.
    await go(() => visit('/train/workout'))
    expect($('#tabbar')).toBeNull()
    await back()
    expect(useSearch.getState().open).toBe(true)
    expect($('#timer.dock')).not.toBeNull()
    expect($('#tabbar')).not.toBeNull()
    expect(leaks()).toEqual([])
    expect(inert($('#timer'))).toBe(true)
    expect(inert($('#tabbar'))).toBe(true)
  })

  it('holds the sync banner that appears while the search is open', async () => {
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), connLocal: false } })
    await launch('#/home')
    expect($('.conn-bar')).toBeNull()
    await openOverlay()
    await act(async () => { useStore.getState().update(s => { s.connLocal = true }, false) })
    await settle()
    const bar = $('.conn-bar')
    expect(bar).not.toBeNull()
    expect(bar.querySelector('button')).not.toBeNull()
    expect(inert(bar.querySelector('button'))).toBe(true)
    expect(leaks()).toEqual([])
  })

  it('leaves a sheet opened over the overlay usable, and the page held when it closes', async () => {
    await launch('#/home')
    await openOverlay()
    await go(() => openPlusSheet('/home'))
    const sheet = $('.plus-sheet')
    expect(sheet).not.toBeNull()
    const rows = [...sheet.querySelectorAll('.lrow')]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(inert(row)).toBe(false)
    // The sheet holds #app itself; the tab bar is held by the search.
    expect($('#app').hasAttribute('inert')).toBe(true)
    expect(inert($('#tabbar'))).toBe(true)
    expect(leaks()).toEqual([])
    useUI.getState().closeAll()
    await settle()
    expect($('.plus-sheet')).toBeNull()
    expect($('#app').hasAttribute('inert')).toBe(false)
    expect(inert($('#tabbar'))).toBe(true)
    expect(leaks()).toEqual([])
    await go(() => $('.avatar-btn').click())
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })
})
