// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Admin from './Admin.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The admin's half of password sign-in (#118): "Reset password" in a user's drill-down, which
   asks first and then shows the one-time code exactly once, on a sheet that a stray tap cannot
   close. Only an instance with password sign-in sends `password` on the user, and only then is
   any of this there. */
const mocks = vi.hoisted(() => ({ answers: {}, sheets: [], posts: [], confirm: vi.fn() }))
vi.mock('../lib/api.js', () => ({
  api: (path, init) => {
    if (init?.method === 'POST') mocks.posts.push({ path, body: JSON.parse(init.body) })
    const key = path.split('?')[0]
    return key in mocks.answers ? Promise.resolve(mocks.answers[key]) : Promise.reject(new Error('not found'))
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: { id: 'adm', name: 'Admin', admin: true }, S: {} })
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
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
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
  mocks.answers = {
    '/api/admin/users': { users: [{ id: 'u1', name: 'Mallory', workouts: 0, lastSync: null, disabled: false }], invite_only: false },
    '/api/admin/invites': { invites: [] },
    '/api/admin/audit': { events: [], total: 0, enabled: true, retention: { days: 90 }, ip_mode: 'off' },
    '/api/admin/user/password-reset': { ok: true, name: 'Mallory', code: 'K7WQ-2MZP-4HXA', expires: Date.now() + 86400000 },
  }
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Admin → Reset password', () => {
  it('is not there on an instance without password sign-in', async () => {
    mocks.answers['/api/admin/user'] = detail()
    const sheet = await openMallory()
    expect(button(sheet, 'Disable account')).toBeTruthy()
    expect(button(sheet, 'Reset password')).toBeUndefined()
  })

  it('asks first, then shows the one-time code once, on a sheet that stays until "Done"', async () => {
    mocks.answers['/api/admin/user'] = detail({ password: true, resetUntil: null })
    const sheet = await openMallory()
    expect([...sheet.querySelectorAll('.adm-pill')].map(p => p.textContent)).toContain('password')
    act(() => button(sheet, 'Reset password').click())
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    const opts = mocks.confirm.mock.calls[0][0]
    expect(opts.confirmText).toBe('Create reset code')
    expect(opts.message).toMatch(/current password stops working/)
    expect(mocks.posts).toEqual([])            // nothing happens before the confirm

    const before = mocks.sheets.length
    await act(async () => { await opts.onConfirm() })
    await settle()
    expect(mocks.posts).toEqual([{ path: '/api/admin/user/password-reset', body: { id: 'u1' } }])
    const shown = mocks.sheets.slice(before).find(s => s.opts?.locked)
    expect(shown).toBeTruthy()
    const code = render(shown.render(() => {}))
    expect(code.textContent).toContain('K7WQ-2MZP-4HXA')
    expect(code.textContent).toContain('Mallory')
    expect(button(code, 'Done')).toBeTruthy()
  })

  it('offers it to a profile with no password too — the way back after a lost passkey', async () => {
    mocks.answers['/api/admin/user'] = detail({ password: false, resetUntil: Date.now() + 3600000 })
    const sheet = await openMallory()
    expect(button(sheet, 'Reset password')).toBeTruthy()
    expect(sheet.textContent).toMatch(/lets them set one/)
    expect(sheet.textContent).toMatch(/reset code until/)
  })
})

describe('Admin → sign-in e-mail', () => {
  it('shows the address in the list and on the profile, and names it on the reset code sheet', async () => {
    mocks.answers['/api/admin/users'] = { users: [{ id: 'u1', name: 'Mallory', workouts: 0, lastSync: null, disabled: false, password: true, email: 'mallory@example.com' }], invite_only: false, password_login: true }
    mocks.answers['/api/admin/user'] = detail({ password: true, email: 'mallory@example.com', resetUntil: null })
    const page = render(<Admin />)
    await settle()
    expect([...page.querySelectorAll('.item')].find(el => el.textContent.includes('Mallory')).textContent).toContain('mallory@example.com')
    const sheet = await openMallory()
    expect([...sheet.querySelectorAll('.adm-pill')].map(p => p.textContent)).toContain('mallory@example.com')
    act(() => button(sheet, 'Reset password').click())
    const before = mocks.sheets.length
    await act(async () => { await mocks.confirm.mock.calls[0][0].onConfirm() })
    await settle()
    const code = render(mocks.sheets.slice(before).find(s => s.opts?.locked).render(() => {}))
    expect(code.textContent).toContain('or their sign-in e-mail mallory@example.com')
  })

  it('shows nothing where the server sends no address', async () => {
    mocks.answers['/api/admin/user'] = detail({ password: true, email: null, resetUntil: null })
    const sheet = await openMallory()
    expect(sheet.textContent).not.toContain('@')
  })
})
