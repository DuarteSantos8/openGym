// @vitest-environment happy-dom
// The admin drill-down (QA C16): a profile whose stored workouts hold a null or otherwise
// shapeless entry must still open, because the sheet host sits outside the route's
// ErrorBoundary — a throw here blanked the whole app and left the account un-disableable.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Admin from './Admin.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ answers: {}, sheets: [] }))
vi.mock('../lib/api.js', () => ({
  api: path => {
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
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
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

const good = { id: 'w1', name: 'Push day', d: '2026-09-10', start: 1000, end: 61000, entries: [{ sets: [{ done: true }, { done: false }] }] }
const goodV2 = { id: 'w2', name: 'Pull day', d: '2026-09-11', start: 1000, end: 61000, exposures: [{ exerciseId: '0025', performance: { sets: [
  { role: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 60 } },
  { role: 'warmup', status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 20 } }
] } }] }

beforeEach(() => {
  document.body.innerHTML = ''
  mocks.sheets.length = 0
  mocks.answers = {
    '/api/admin/users': { users: [{ id: 'u1', name: 'Mallory', workouts: 2, lastSync: null, disabled: false }], invite_only: false },
    '/api/admin/invites': { invites: [] },
    '/api/admin/audit': { rows: [] },
    '/api/admin/user': {
      user: { id: 'u1', name: 'Mallory', created: '2026-09-01T00:00:00Z', disabled: false, admin: false },
      unit: 'kg', lastSync: null, routines: [], bodyweight: [],
      // What GET /api/admin/user hands over for a document written before PUT /api/data dropped
      // such entries: a null, and a bare object without entries, next to a real session.
      workouts: [null, good, {}, goodV2]
    }
  }
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Admin user drill-down', () => {
  it('opens a profile with malformed workout entries and still offers "Disable account"', async () => {
    const page = render(<Admin />)
    await settle()
    const row = [...page.querySelectorAll('.item')].find(el => el.textContent.includes('Mallory'))
    expect(row).toBeTruthy()
    act(() => row.click())
    expect(mocks.sheets.length).toBe(1)
    const sheet = render(mocks.sheets[0](() => {}))
    await settle()
    const buttons = [...sheet.querySelectorAll('button')].map(b => b.textContent)
    expect(buttons).toContain('Disable account')
    // The two real sessions are listed; the two shapeless entries are skipped, not drawn as blanks.
    const rows = [...sheet.querySelectorAll('.list > div')]
    expect(rows.length).toBe(2)
    expect(rows[0].textContent).toContain('Push day')
    expect(rows[0].textContent).toContain('1 sets')
    expect(sheet.textContent).toContain('Pull day')
    expect(rows[1].textContent).toContain('2 sets')
  })
})
