// @vitest-environment happy-dom
// On a wide window the tab bar is a sidebar (index.css, "desktop sidebar") and carries what a
// phone reaches through Home's gear: Settings, Check in, Admin for an admin. The phone keeps its
// five tabs, nothing more.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TabBar from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

const loc = vi.hoisted(() => ({ pathname: '/home' }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  useLocation: () => loc,
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, original

beforeEach(() => {
  loc.pathname = '/home'
  original = useStore.getState()
  useStore.setState({ S: structuredClone(DEF), user: { id: 1, name: 'test', admin: true } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState(original)
})

const labels = () => [...host.querySelectorAll('#tabbar button')].map(b => b.textContent)

it('adds Check in, Admin and Settings on a desktop, and only there', () => {
  act(() => { root.render(<TabBar onStart={() => {}} />) })
  expect(labels()).toHaveLength(5)
  act(() => { root.render(<TabBar onStart={() => {}} desktop />) })
  expect(labels()).toEqual(expect.arrayContaining(['Check in', 'Admin', 'Settings']))
  expect(labels()).toHaveLength(8)
})

it('leaves Admin out for everyone else', () => {
  useStore.setState({ user: { id: 2, name: 'member' } })
  act(() => { root.render(<TabBar onStart={() => {}} desktop />) })
  expect(labels()).not.toContain('Admin')
})

it('is the admin console\'s own navigation while Admin is open', () => {
  loc.pathname = '/admin/users'
  act(() => { root.render(<TabBar onStart={() => {}} desktop />) })
  expect(labels()).toEqual(['Overview', 'Users', 'Invite codes', 'Coach', 'Activity log', 'Back to the app'])
  expect(host.querySelector('#tabbar button.on').textContent).toBe('Users')
})
