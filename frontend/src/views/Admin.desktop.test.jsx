// @vitest-environment happy-dom
// On a wide window Admin is a console of pages, /admin/<section>, one section each (picked in the
// sidebar). A phone keeps every card on one page (Admin.test.jsx).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Admin from './Admin.jsx'
import { adminSectionOf, adminSections } from '../lib/admin-sections.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ path: '/admin' }))
vi.mock('../lib/use-desktop.js', () => ({ useDesktop: () => true }))
vi.mock('../lib/api.js', () => ({
  api: path => {
    const answers = {
      '/api/admin/users': { users: [{ id: 'u1', name: 'Mallory', workouts: 2, lastSync: Date.now(), disabled: false }], invite_only: true },
      '/api/admin/invites': { invites: [] },
    }
    const key = path.split('?')[0]
    return key in answers ? Promise.resolve(answers[key]) : Promise.reject(new Error('not found'))
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: { id: 'adm', name: 'Admin', admin: true }, S: {} })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: () => {}, openSheet: () => {} })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useLocation: () => ({ pathname: mocks.path }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
vi.mock('./AdminCoach.jsx', () => ({ default: () => <div className="coach-card" /> }))

let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const show = async path => {
  mocks.path = path
  await act(async () => root.render(<Admin key={path} />))
  await act(() => new Promise(r => setTimeout(r, 0)))
  return {
    title: host.querySelector('h1').textContent,
    table: !!host.querySelector('.adm-table'),
    invites: host.textContent.includes('Sign-up is invite-only'),
    coach: !!host.querySelector('.coach-card'),
  }
}

it('shows one section per page', async () => {
  expect(await show('/admin')).toEqual({ title: 'Overview', table: true, invites: true, coach: false })
  expect(await show('/admin/users')).toEqual({ title: 'Users', table: true, invites: false, coach: false })
  expect(await show('/admin/invites')).toEqual({ title: 'Invite codes', table: false, invites: true, coach: false })
  expect(await show('/admin/coach')).toEqual({ title: 'Coach', table: false, invites: false, coach: true })
})

it('reads an unknown section as the overview', () => {
  expect(adminSectionOf('/admin/nope')).toBe('overview')
  expect(adminSectionOf('/admin/activity')).toBe('activity')
})

it('lists the optional sections only on instances that have them', () => {
  const ids = config => adminSections(config).map(([id]) => id)
  expect(ids({})).toEqual(['overview', 'users', 'invites', 'coach', 'activity'])
  expect(ids({ oidc: { label: 'SSO' }, shared: { types: [] }, trainers: { on: true } }))
    .toEqual(['overview', 'users', 'invites', 'coach', 'signin', 'community', 'gyms', 'activity'])
})
