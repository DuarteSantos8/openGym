// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Admin from './Admin.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* "Recovery code" in a user's drill-down (#584): on every instance, for a profile that is not an
   admin; for an admin only when the viewer is the owner; never for the owner (whose way back is
   the server command) or oneself. Asks first, then shows the code exactly once, locked. */
const mocks = vi.hoisted(() => ({ answers: {}, sheets: [], posts: [], confirm: vi.fn(), me: { id: 'adm', name: 'Admin', admin: true } }))
vi.mock('../lib/api.js', () => ({
  api: (path, init) => {
    if (init?.method === 'POST') mocks.posts.push({ path, body: JSON.parse(init.body) })
    const key = path.split('?')[0]
    return key in mocks.answers ? Promise.resolve(mocks.answers[key]) : Promise.reject(new Error('not found'))
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: mocks.me, S: {} })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: () => {}, openSheet: (render, opts) => mocks.sheets.push({ render, opts }) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useLocation: () => ({ state: null }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: (...a) => mocks.confirm(...a) }))
vi.mock('./AdminCoach.jsx', () => ({ default: () => null }))

const mounted = []
function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)

const detail = extra => ({
  user: { id: 'u1', name: 'Mallory', created: '2026-09-01T00:00:00Z', disabled: false, admin: false, ...extra },
  unit: 'kg', lastSync: null, routines: [], bodyweight: [], workouts: []
})
async function openMallory() {
  const page = render(<Admin />)
  await settle()
  act(() => [...page.querySelectorAll('.item')].find(el => el.textContent.includes('Mallory')).click())
  const sheet = render(mocks.sheets.at(-1).render(() => {}))
  await settle()
  return sheet
}

beforeEach(() => {
  document.body.innerHTML = ''
  mocks.sheets.length = 0
  mocks.posts.length = 0
  mocks.confirm.mockClear()
  mocks.me = { id: 'adm', name: 'Admin', admin: true }
  mocks.answers = {
    '/api/admin/users': { users: [{ id: 'u1', name: 'Mallory', workouts: 0, lastSync: null, disabled: false }], invite_only: false },
    '/api/admin/invites': { invites: [] },
    '/api/admin/audit': { events: [], total: 0, enabled: true, retention: { days: 90 }, ip_mode: 'off' },
    '/api/admin/user/recovery': { ok: true, name: 'Mallory', code: 'K7WQ-2MZP-4HXA', expires: Date.now() + 86400000 },
  }
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Admin → Recovery code', () => {
  it('is there for a plain profile on an instance without password sign-in, asks, then shows the code once, locked', async () => {
    mocks.answers['/api/admin/user'] = detail()
    const sheet = await openMallory()
    act(() => button(sheet, 'Recovery code').click())
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    const ask = mocks.confirm.mock.calls[0][0]
    expect(ask.title).toBe('Recovery code for Mallory?')
    expect(ask.message).not.toMatch(/—/)
    await act(async () => { await ask.onConfirm() })
    expect(mocks.posts).toEqual([{ path: '/api/admin/user/recovery', body: { id: 'u1' } }])
    const shown = mocks.sheets.at(-1)
    expect(shown.opts).toEqual({ locked: true })
    const code = render(shown.render(() => {}))
    expect(code.textContent).toContain('K7WQ-2MZP-4HXA')
    expect(code.textContent).toContain('Lost access?')
  })
  it('shows until when an unused one is good', async () => {
    mocks.answers['/api/admin/user'] = detail({ recoveryUntil: Date.now() + 3600000 })
    const sheet = await openMallory()
    expect(sheet.textContent).toContain('recovery code until')
  })
  it('for an admin only when the viewer is the owner', async () => {
    mocks.answers['/api/admin/user'] = detail({ admin: true })
    expect(button(await openMallory(), 'Recovery code')).toBeUndefined()
  })
  it('the owner may make one for an admin', async () => {
    mocks.answers['/api/admin/users'] = { users: [{ id: 'adm', name: 'Admin', owner: true, admin: true, workouts: 0 }, { id: 'u1', name: 'Mallory', workouts: 0, lastSync: null, disabled: false }], invite_only: false }
    mocks.answers['/api/admin/user'] = detail({ admin: true })
    expect(button(await openMallory(), 'Recovery code')).toBeTruthy()
  })
  it('never for the owner, who gets the server command instead, nor for a disabled profile', async () => {
    mocks.answers['/api/admin/user'] = detail({ admin: true, owner: true })
    const owner = await openMallory()
    expect(button(owner, 'Recovery code')).toBeUndefined()
    expect(owner.textContent).toContain('node recover.js')
    mocks.answers['/api/admin/user'] = detail({ disabled: true })
    expect(button(await openMallory(), 'Recovery code')).toBeUndefined()
  })
  it('never for oneself', async () => {
    mocks.me = { id: 'u1', name: 'Mallory', admin: true }
    mocks.answers['/api/admin/user'] = detail()
    expect(button(await openMallory(), 'Recovery code')).toBeUndefined()
  })
})
