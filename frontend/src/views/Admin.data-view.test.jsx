// @vitest-environment happy-dom
// ADMIN_DATA_VIEW off (the default since 1.4.5): the drill-down shows counts and says honestly
// where the data is, with no workout history and no "Download their data". And the Gyms card,
// which shows only on a server with TRAINERS on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Admin from './Admin.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ answers: {}, sheets: [], posts: [] }))
vi.mock('../lib/api.js', () => ({
  api: (path, opts) => {
    if (opts?.method === 'POST') { mocks.posts.push([path, JSON.parse(opts.body)]); return Promise.resolve({ ok: true }) }
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
  const snap = () => ({ toast: () => {}, openSheet: render => mocks.sheets.push(render) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useLocation: () => ({ state: null }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
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

beforeEach(() => {
  document.body.innerHTML = ''
  mocks.sheets.length = 0
  mocks.posts.length = 0
  mocks.answers = {
    '/api/admin/users': { users: [{ id: 'u1', name: 'Lea', workouts: 12, lastSync: null, disabled: false, live: { startedAt: 1 } }], invite_only: false, data_view: false, trainers: true },
    '/api/admin/invites': { invites: [] },
    '/api/admin/audit': { events: [], total: 0, retention: {}, enabled: true },
    '/api/admin/gyms': { gyms: [{ id: 'g1', name: 'FitBox', contact: 'privacy@fitbox.test', disabled: false, counts: { members: 4, leads: 1, trainers: 1 }, staff: [{ userId: 'u2', name: 'Marco', role: 'trainer' }] }], freeTrainers: [] },
    '/api/admin/user': {
      user: { id: 'u1', name: 'Lea', created: '2026-09-01T00:00:00Z', disabled: false, admin: false },
      unit: 'kg', lastSync: null, bytes: 20480, data_view: false,
      counts: { workouts: 12, bodyweight: 30, measurements: 2, routines: 4 },
      roles: { freeTrainer: false, staff: [], memberOf: ['g1'] }, grants: 1
    }
  }
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Admin without ADMIN_DATA_VIEW', () => {
  it('says why there is no training data, and a running session shows no routine', async () => {
    const page = render(<Admin />)
    await settle()
    expect(page.textContent).toContain('readable on disk, not in the app')
    expect(page.textContent).toContain('training now')
    expect(page.textContent).not.toContain('undefined')
  })

  it('the drill-down is counts, storage and roles, no history, no download', async () => {
    const page = render(<Admin />)
    await settle()
    act(() => [...page.querySelectorAll('.item')].find(el => el.textContent.includes('Lea')).click())
    const sheet = render(mocks.sheets[0](() => {}))
    await settle()
    const text = sheet.textContent
    expect(text).toContain('12')
    expect(text).toContain('30')
    expect(text).toContain('20 KB')
    expect(text).not.toContain('Workout history')
    expect([...sheet.querySelectorAll('button')].map(b => b.textContent)).not.toContain('Download their data')
    expect(text).toContain('readable on disk, not in the app')
    expect(text).toContain('member of 1 gym')
    const allow = [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Allow as free trainer')
    act(() => allow.click())
    await settle()
    expect(mocks.posts).toContainEqual(['/api/admin/user/trainer', { id: 'u1', free: true }])
  })
})

describe('Gyms card', () => {
  it('lists gyms with staff and counts, and adds a trainer', async () => {
    const page = render(<Admin />)
    await settle()
    expect(page.textContent).toContain('FitBox')
    expect(page.textContent).toContain('4 members')
    expect(page.textContent).toContain('Marco · trainer')
    act(() => [...page.querySelectorAll('button')].find(b => b.textContent === 'Add trainer').click())
    const sheet = render(mocks.sheets[mocks.sheets.length - 1](() => {}))
    act(() => [...sheet.querySelectorAll('.item')].find(el => el.textContent.includes('Lea')).click())
    await settle()
    expect(mocks.posts).toContainEqual(['/api/admin/gyms/staff', { gymId: 'g1', userId: 'u1', role: 'trainer' }])
  })

  it('is not there without TRAINERS', async () => {
    mocks.answers['/api/admin/users'].trainers = false
    const page = render(<Admin />)
    await settle()
    expect(page.textContent).not.toContain('New gym')
  })
})
