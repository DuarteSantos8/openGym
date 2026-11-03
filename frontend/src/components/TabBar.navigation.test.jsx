// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, router, originalS, originalUser, onStart
beforeEach(() => {
  const store = useStore.getState()
  originalS = store.S
  originalUser = store.user
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'test', name: 'test' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  onStart = vi.fn()
  router = createMemoryRouter([{ path: '*', element: <TabBar onStart={onStart} /> }], { initialEntries: ['/home'] })
  act(() => root.render(<RouterProvider router={router} />))
})
afterEach(() => {
  act(() => root.unmount())
  router.dispose()
  host.remove()
  useStore.setState({ S: originalS, user: originalUser })
})
const tap = async label => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === label)
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
const go = async to => { await act(async () => router.navigate(to)) }

describe('root tab history', () => {
  it('does not accumulate a back stack when switching tabs repeatedly', async () => {
    for (let i = 0; i < 3; i++) {
      for (const label of ['Plan', 'Stats', 'Exercises', 'Home']) await tap(label)
    }
    await tap('Plan')
    expect(router.state.location.pathname).toBe('/plan')
    await go(-1)
    expect(router.state.location.pathname).toBe('/plan')
  })

  it('ignores a tap on the current root, but clears a tab query when returning to its root', async () => {
    const key = router.state.location.key
    await tap('Home')
    expect(router.state.location.key).toBe(key)
    await go('/stats?range=month')
    await tap('Stats')
    expect(router.state.location.pathname).toBe('/stats')
    expect(router.state.location.search).toBe('')
  })

  it('still pushes a detail page and returns to the tab it opened from', async () => {
    await tap('Plan')
    await go('/plan/r/one')
    await go(-1)
    expect(router.state.location.pathname).toBe('/plan')
    await go('/settings/workout')
    await go(-1)
    expect(router.state.location.pathname).toBe('/plan')
  })

  it('opens a different tab root from a nested page of the active tab', async () => {
    await go('/plan/r/one')
    await tap('Plan')
    expect(router.state.location.pathname).toBe('/plan')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('preserves the workout chooser return path', async () => {
    useStore.setState({ S: { ...useStore.getState().S, routines: [] } })
    await tap('Start')
    expect(router.state.location.pathname).toBe('/workout')
    await go(-1)
    expect(router.state.location.pathname).toBe('/home')
    expect(onStart).not.toHaveBeenCalled()
  })
})
