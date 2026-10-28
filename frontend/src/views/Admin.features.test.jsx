// @vitest-environment happy-dom
// Admin → Features: the QR scanning switch reads the instance's state, saves a flip with
// POST /api/admin/features and refreshes the config, so this browser hides the scan buttons at once.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Admin from './Admin.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ features: null, posts: [], refreshConfig: null }))
vi.mock('../lib/api.js', () => ({
  api: (path, opts) => {
    const key = path.split('?')[0]
    if (key === '/api/admin/features') {
      if (opts?.method === 'POST') {
        const body = JSON.parse(opts.body)
        mocks.posts.push(body)
        mocks.features = { ...mocks.features, ...body }
      }
      return Promise.resolve({ features: mocks.features })
    }
    if (key === '/api/admin/users') return Promise.resolve({ users: [], invite_only: false })
    if (key === '/api/admin/invites') return Promise.resolve({ invites: [] })
    if (key === '/api/admin/audit') return Promise.resolve({ rows: [] })
    return Promise.reject(new Error('not found'))
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: { id: 'adm', name: 'Admin', admin: true }, S: {}, refreshConfig: mocks.refreshConfig })
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
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useLocation: () => ({ state: null }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
vi.mock('./AdminCoach.jsx', () => ({ default: () => null }))

let root, host
beforeEach(() => {
  mocks.features = { qr: true, bodyScale: true }
  mocks.posts.length = 0
  mocks.refreshConfig = vi.fn(async () => null)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
const switchFor = label => host.querySelector(`.adm-features [role="switch"][aria-label="${label}"]`)
const qrSwitch = () => switchFor('Exercise QR codes')

describe('Admin features', () => {
  it('one switch per feature, each saved on its own', async () => {
    act(() => root.render(<Admin />))
    await settle()
    expect([...host.querySelectorAll('.adm-features [role="switch"]')].map(s => s.getAttribute('aria-label')))
      .toEqual(['Exercise QR codes', 'Body-composition scales'])
    await act(async () => { switchFor('Body-composition scales').click() })
    await settle()
    expect(mocks.posts).toEqual([{ bodyScale: false }])
    expect(switchFor('Exercise QR codes').getAttribute('aria-checked')).toBe('true')
    expect(switchFor('Body-composition scales').getAttribute('aria-checked')).toBe('false')
  })

  it('shows the QR switch on, and switching it off saves and refreshes the config', async () => {
    act(() => root.render(<Admin />))
    await settle()
    expect(qrSwitch().getAttribute('aria-checked')).toBe('true')

    await act(async () => { qrSwitch().click() })
    await settle()
    expect(mocks.posts).toEqual([{ qr: false }])
    expect(mocks.refreshConfig).toHaveBeenCalledTimes(1)
    expect(qrSwitch().getAttribute('aria-checked')).toBe('false')
  })
})
