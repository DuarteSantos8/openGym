// @vitest-environment happy-dom
// The edge swipe back shows the page it returns to underneath while the finger moves (TestFlight
// 1.4.2 (27): only a dark backdrop, then the app "teleported"). App renders that page from the
// route table, inert and hidden from assistive tech, at the scroll position it was left at; when
// the swipe lands it IS the page (the same element, not a second mount), and the window is back
// at that position in the same pass. A cancelled swipe takes it away again.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'
import { BACK_PREVIEW_EVENT } from './lib/edge-swipe-back.js'

vi.mock('./lib/sound.js', async importOriginal => ({ ...(await importOriginal()), setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn(), setNativeBuzzer: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, scrolls
const pages = () => [...document.querySelectorAll('#app > .page')]
const under = () => document.querySelector('#app > .page.under')
const send = detail => act(() => { window.dispatchEvent(new CustomEvent(BACK_PREVIEW_EVENT, { detail })) })
const go = async hash => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); window.dispatchEvent(new PopStateEvent('popstate')) }) }
const scrolledTo = async y => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
  await act(async () => { window.dispatchEvent(new Event('scroll')) })
}

beforeEach(async () => {
  originalS = useStore.getState().S
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)) })
  localStorage.setItem('gym_guest', '1')   // a guest: the app itself, no sign-in screen
  window.location.hash = '#/settings'
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  scrolls = []
  window.scrollTo = vi.fn((x, y) => { scrolls.push([x, y]); Object.defineProperty(window, 'scrollY', { configurable: true, value: y }) })
  await act(async () => { root.render(<App />) })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState({ S: originalS })
  localStorage.removeItem('gym_guest')
})

describe('the page underneath an edge swipe back', () => {
  it('is the page the back button goes to, at its scroll position, inert and hidden', async () => {
    await scrolledTo(420)
    await go('#/settings/units')
    expect(pages().map(p => p.dataset.path)).toEqual(['/settings/units'])
    const back = document.querySelector('#app [data-back]')
    expect(back.getAttribute('data-back')).toBe('/settings')

    send({ path: '/settings' })
    expect(pages().map(p => p.dataset.path)).toEqual(['/settings/units', '/settings'])
    const u = under()
    expect(u.getAttribute('aria-hidden')).toBe('true')
    expect(u.hasAttribute('inert')).toBe(true)
    expect(u.querySelector('.page-in').style.transform).toBe('translateY(-420px)')
    // The page on top is still the one whose back button the gesture presses.
    expect(document.querySelector('#app > .page:not(.under) [data-back]')).toBe(back)
  })

  it('becomes the page when the swipe lands: the same element, no second mount, back where it was scrolled', async () => {
    await scrolledTo(420)
    await go('#/settings/units')
    send({ path: '/settings' })
    const u = under()
    const marker = u.querySelector('.page-in > *')
    send({ commit: '/settings' })
    await act(async () => { document.querySelector('#app > .page:not(.under) [data-back]').click() })
    expect(pages()).toEqual([u])                         // kept, not mounted again
    expect(u.querySelector('.page-in > *')).toBe(marker)  // its content too
    expect(u.classList.contains('under')).toBe(false)
    expect(u.classList.contains('vfade')).toBe(false)     // no fade-in on a page already shown
    expect(u.hasAttribute('inert')).toBe(false)
    expect(u.getAttribute('aria-hidden')).toBeNull()
    expect(u.querySelector('.page-in').style.transform).toBe('')
    expect(u.id).toBe('')
    expect(scrolls.at(-1)).toEqual([0, 420])
  })

  it('a cancelled swipe takes it away and leaves the page as it was', async () => {
    await go('#/settings/units')
    const top = pages()[0]
    send({ path: '/settings' })
    expect(under()).not.toBeNull()
    send({ path: null })
    expect(pages()).toEqual([top])
    expect(window.location.hash).toBe('#/settings/units')
  })

  it('a back that lands somewhere else drops it, and that page mounts as usual', async () => {
    await go('#/settings/units')
    send({ path: '/stats' })
    await go('#/settings')
    expect(pages().map(p => p.dataset.path)).toEqual(['/settings'])
    expect(under()).toBeNull()
  })
})
