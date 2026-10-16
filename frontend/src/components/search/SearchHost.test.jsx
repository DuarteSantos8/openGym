// @vitest-environment happy-dom
// The page behind the search while it is open: out of reach for the keyboard and for a screen
// reader (the overlay is a non-modal combobox popup, so the page is made inert, not the overlay
// a trap), with only the header and the results live. Composed with the other holders of `inert`
// in the shell: the tab switch's on #app, and the sheets' on #app, #tabbar and #timer.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trapDialogFocus } from '../../lib/use-dialog-focus.js'
import { endSearch, useSearch } from '../../lib/search/session.js'
import { useStore } from '../../store/useStore.js'
import RootHeader from '../RootHeader.jsx'
import SearchHost from './SearchHost.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  history.replaceState({ idx: 0, key: 'k' }, '')
  vi.spyOn(history, 'back').mockImplementation(() => {})
  useStore.setState({ user: null })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  act(() => endSearch())
  vi.restoreAllMocks()
})

const wait = ms => act(() => new Promise(r => setTimeout(r, ms)))
const $ = s => document.querySelector(s)
const pill = () => $('.spill-i')
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'
// What Tab can land on: focusable, not out of the order, and not under an inert element.
const tabbable = () => [...document.querySelectorAll(FOCUSABLE)].filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]'))
const inert = el => !!el.closest('[inert]')

async function mount() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/home']}>
    <div id="app">
      <RootHeader title="Home" />
      <main id="page"><button type="button">Log food</button><a href="#/train">Train</a><input aria-label="Weight" /></main>
    </div>
    <div id="timer"><button type="button">Pause rest</button></div>
    <nav id="tabbar"><button type="button">Home</button><button type="button">Food</button></nav>
    <SearchHost />
  </MemoryRouter>))
}
const open = async () => {
  await act(async () => pill().focus())
  await wait(100)
}

describe('the page behind an open search', () => {
  it('is reachable until the search opens', async () => {
    await mount()
    const names = tabbable().map(el => el.textContent || el.getAttribute('aria-label'))
    expect(names).toEqual(expect.arrayContaining(['Log food', 'Train', 'Weight', 'Pause rest', 'Home', 'Food']))
  })

  it('goes inert while it is open: Tab from the avatar and from the pill stays in the header and the results', async () => {
    await mount()
    await open()
    expect(useSearch.getState().open).toBe(true)
    const order = tabbable()
    const names = order.map(el => el.textContent || el.getAttribute('aria-label'))
    for (const outside of ['Log food', 'Train', 'Weight', 'Pause rest', 'Home', 'Food']) expect(names).not.toContain(outside)
    for (const el of order) expect(el.closest('.tab-hdr, #gains-search'), el.outerHTML).not.toBeNull()
    // The ring Tab walks: the pill and the avatar are in it, and each one's neighbours belong too.
    const at = [pill(), $('.avatar-btn')].map(el => order.indexOf(el))
    expect(at.every(i => i >= 0)).toBe(true)
    for (const i of at) {
      expect(order[(i + 1) % order.length].closest('.tab-hdr, #gains-search')).not.toBeNull()
      expect(order[(i - 1 + order.length) % order.length].closest('.tab-hdr, #gains-search')).not.toBeNull()
    }
    // The page's own controls, the tab bar and the dock are the inert ones; #app itself is not.
    expect(inert($('#page'))).toBe(true)
    expect(inert($('#tabbar'))).toBe(true)
    expect(inert($('#timer'))).toBe(true)
    expect($('#app').hasAttribute('inert')).toBe(false)
    expect(inert(pill())).toBe(false)
    expect(inert($('.avatar-btn'))).toBe(false)
  })

  it('comes back with the close, leaving nothing inert', async () => {
    await mount()
    await open()
    await act(async () => $('.avatar-btn').click())
    await wait(50)
    expect(useSearch.getState().open).toBe(false)
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })

  it('holds a block the page renders under the header while the search is open', async () => {
    await mount()
    await open()
    const late = document.createElement('section')
    late.innerHTML = '<button type="button">Arrived late</button>'
    await act(async () => { $('#app').appendChild(late) })
    await wait(10)
    expect(inert(late.firstChild)).toBe(true)
    await act(async () => $('.avatar-btn').click())
    await wait(50)
    expect(late.hasAttribute('inert')).toBe(false)
  })

  it('leaves alone, and keeps, the inert that is not its own', async () => {
    await mount()
    // A sheet holds the tab bar already when the search opens over it.
    $('#tabbar').setAttribute('inert', '')
    await open()
    // The shell holds #app while a tab switch rewrites the history, and the search ends with it.
    $('#app').setAttribute('inert', '')
    await act(async () => endSearch())
    await wait(50)
    expect($('#app').hasAttribute('inert')).toBe(true)
    expect($('#tabbar').hasAttribute('inert')).toBe(true)
    expect($('#page').hasAttribute('inert')).toBe(false)
    expect($('#timer').hasAttribute('inert')).toBe(false)
  })

  it('takes over what a sheet held when the search opened, once the sheet lets go of it, and lifts it with the close', async () => {
    await mount()
    $('#tabbar').setAttribute('inert', '')
    await open()
    $('#tabbar').removeAttribute('inert')
    await wait(10)
    expect($('#tabbar').hasAttribute('inert')).toBe(true)
    await act(async () => $('.avatar-btn').click())
    await wait(50)
    expect($('#tabbar').hasAttribute('inert')).toBe(false)
  })

  it('a sheet opened over the open search holds #app and lets it go without freeing what the search holds', async () => {
    await mount()
    await open()
    const sheet = document.createElement('div')
    sheet.innerHTML = '<button type="button">Log</button>'
    document.body.appendChild(sheet)
    const release = trapDialogFocus(sheet)
    expect($('#app').hasAttribute('inert')).toBe(true)
    release()
    await wait(10)
    expect($('#app').hasAttribute('inert')).toBe(false)
    expect(inert($('#page'))).toBe(true)
    expect(inert($('#tabbar'))).toBe(true)
    expect(inert($('#timer'))).toBe(true)
    sheet.remove()
    await act(async () => $('.avatar-btn').click())
    await wait(50)
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })
})
