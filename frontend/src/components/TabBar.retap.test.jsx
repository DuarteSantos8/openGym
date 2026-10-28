// @vitest-environment happy-dom
// The tab you are on, tapped again: to the top of its page (lib/scroll-top.js), and from the top of
// Exercises into its search field. A tap on another tab still just switches.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, router, originalS, originalUser, page, reduce
const tap = async label => {
  const b = [...host.querySelectorAll('#tabbar button')].find(x => x.textContent === label)
  await act(async () => b.click())
}
const at = y => Object.defineProperty(window, 'scrollY', { configurable: true, value: y })

beforeEach(() => {
  const store = useStore.getState()
  originalS = store.S; originalUser = store.user
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'test', name: 'test' } })
  reduce = false
  window.matchMedia = vi.fn(q => ({ matches: reduce && q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} }))
  window.scrollTo = vi.fn()
  at(0)
  // The page as App.jsx draws it, with the Library's search field in it.
  page = document.createElement('div'); page.id = 'app'
  page.innerHTML = '<div class="page"><div class="search"><input class="input"></div></div>'
  document.body.appendChild(page)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  router = createMemoryRouter([{ path: '*', element: <TabBar onStart={vi.fn()} /> }], { initialEntries: ['/library'] })
  act(() => root.render(<RouterProvider router={router} />))
})
afterEach(() => {
  act(() => root.unmount())
  router.dispose()
  host.remove(); page.remove()
  document.body.style.position = ''
  useStore.setState({ S: originalS, user: originalUser })
})

describe('tapping the tab you are on', () => {
  it.each(['Home', 'Plan', 'Stats', 'Exercises'])('%s scrolls its page to the top, smoothly', async label => {
    const path = { Home: '/home', Plan: '/plan', Stats: '/stats', Exercises: '/library' }[label]
    await act(async () => router.navigate(path))
    const key = router.state.location.key
    at(3000)
    await tap(label)
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'smooth' })
    expect(router.state.location.key).toBe(key)      // no navigation, no history entry
  })

  it('jumps with Reduce Motion on', async () => {
    reduce = true
    at(3000)
    await tap('Exercises')
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })

  it('at the top of Exercises already, goes to the search field', async () => {
    await tap('Exercises')
    expect(window.scrollTo).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(page.querySelector('.search input'))
  })

  it('at the top of another tab does nothing', async () => {
    await act(async () => router.navigate('/plan'))
    await tap('Plan')
    expect(window.scrollTo).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(page.querySelector('.search input'))
  })

  it('leaves the page alone under an open sheet', async () => {
    at(3000)
    document.body.style.position = 'fixed'
    await tap('Exercises')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})

it('a tap on another tab switches as before and does not scroll', async () => {
  at(3000)
  await tap('Stats')
  expect(router.state.location.pathname).toBe('/stats')
  expect(window.scrollTo).not.toHaveBeenCalled()
})

it('History lights Stats, and a tap there goes to Stats rather than up History', async () => {
  await act(async () => router.navigate('/history'))
  at(3000)
  await tap('Stats')
  expect(router.state.location.pathname).toBe('/stats')
  expect(window.scrollTo).not.toHaveBeenCalled()
})
