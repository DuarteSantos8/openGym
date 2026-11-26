// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AskCoach, { STARTERS } from './AskCoach.jsx'
import { useStore } from '../store/useStore.js'

const { nav } = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal(), useNavigate: () => nav }))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  root = createRoot(host)
  useStore.setState({ user: { id: 'test' }, config: { coach: { enabled: true } } })
})
afterEach(() => { act(() => root.unmount()); vi.restoreAllMocks() })

it('opens each starter in the Coach as a draft', () => {
  act(() => root.render(<AskCoach level="beginner" />))
  const buttons = [...host.querySelectorAll('button')]
  expect(buttons.map(b => b.textContent.trim())).toEqual([
    'Build me a back workout with no weights',
    'Add a push day on Tuesday and a pull day on Wednesday',
    'Make today shorter',
  ])
  buttons.forEach((button, i) => {
    act(() => button.click())
    expect(nav).toHaveBeenLastCalledWith('/coach', { state: { coachStarter: STARTERS[i] } })
  })
})

it.each([null, { coach: { enabled: false } }])('shows no row before an enabled config is known (%j)', config => {
  useStore.setState({ config, ready: false })
  act(() => root.render(<AskCoach level="beginner" />))
  expect(host.textContent).toBe('')
})

it('hides all prompts if connectivity drops while the enabled config is cached', () => {
  act(() => root.render(<AskCoach level="beginner" />))
  expect(host.querySelector('button')).toBeTruthy()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  act(() => window.dispatchEvent(new Event('offline')))
  expect(host.textContent).toBe('')
})
