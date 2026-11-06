// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Student from './Student.jsx'
import Students from './Students.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The teacher's module: the list of students, and one student's page with its plans, performance
   and workouts. The api is a table of answers; POSTs are recorded. */
const mocks = vi.hoisted(() => ({ answers: {}, posts: [], sheets: [], nav: vi.fn(), me: { id: 'tch', name: 'Teacher', admin: true } }))
vi.mock('../lib/api.js', () => ({
  api: (path, init) => {
    if (init?.method === 'POST') mocks.posts.push({ path, body: JSON.parse(init.body) })
    const key = path.split('?')[0]
    return key in mocks.answers ? Promise.resolve(mocks.answers[key]) : Promise.reject(new Error('not found'))
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: mocks.me, S: { unit: 'kg', routines: [], customEx: [] } })
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
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav, useParams: () => ({ id: 'u1' }), useLocation: () => ({ state: null }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: opts => mocks.sheets.push({ confirm: opts }), menuSheet: opts => mocks.sheets.push({ menu: opts }) }))
vi.mock('../components/StudentPlanSheet.jsx', () => ({ default: ({ student }) => <div>plan sheet for {student.name}</div> }))

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
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const good = { id: 'w1', name: 'Push day', d: '2026-09-10', start: 1000, end: 61000, entries: [{ id: '0001', sets: [{ w: 50, r: 8, done: true }] }] }

beforeEach(() => {
  document.body.innerHTML = ''
  mocks.sheets.length = 0
  mocks.posts.length = 0
  mocks.nav.mockClear()
  mocks.me = { id: 'tch', name: 'Teacher', admin: true }
  mocks.answers = {
    '/api/admin/users': { users: [
      { id: 'tch', name: 'Teacher', admin: true, workouts: 0, lastSync: Date.now(), routines: 1 },
      { id: 'u1', name: 'Mallory', workouts: 2, lastSync: Date.now() - 20 * 86400000, routines: 0, pending: 0 },
      { id: 'u2', name: 'Bob', workouts: 5, lastSync: Date.now(), routines: 2, pending: 1, live: { name: 'Legs' } }
    ] },
    '/api/admin/user': {
      user: { id: 'u1', name: 'Mallory', created: '2026-09-01T00:00:00Z', disabled: false, admin: false, teacherName: 'Teacher' },
      unit: 'kg', lastSync: null, plannedDays: 3, bodyweight: [], measurements: [], customEx: [],
      routines: [{ id: 'r1', name: 'Legs A', count: 1, ex: [{ id: '0001', sets: 3, reps: 10 }] }],
      pending: [{ id: 'p1', name: 'Plan from Teacher', from: 'Teacher', at: 1, routines: 2 }],
      // A null and a bare object next to a real session, the way an old state file can answer.
      workouts: [null, good, {}]
    },
    '/api/admin/user/plan/cancel': { ok: true, pending: 0 }
  }
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Students (the list)', () => {
  it('lists the students, not the teacher, with who needs a word', async () => {
    const page = render(<Students />)
    await settle()
    const text = page.textContent
    expect(text).toContain('Mallory')
    expect(text).toContain('Bob')
    expect(text).not.toContain('Teacher ·')
    expect(text).toContain('20 days away')
    expect(text).toContain('No plan yet')
    expect(text).toContain('plan on its way')
    expect(text).toContain('2 students')
  })
  it('opens a student on tap and builds a plan from the row without opening the page', async () => {
    const page = render(<Students />)
    await settle()
    const row = [...page.querySelectorAll('.item')].find(el => el.textContent.includes('Mallory'))
    act(() => row.querySelector('button[aria-label="New plan for Mallory"]').click())
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(mocks.sheets).toHaveLength(1)
    act(() => row.click())
    expect(mocks.nav).toHaveBeenCalledWith('/students/u1')
  })
  it('searches by name', async () => {
    const page = render(<Students />)
    await settle()
    const box = page.querySelector('input[type="search"]')
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'bob'); box.dispatchEvent(new Event('input', { bubbles: true })) })
    const names = [...page.querySelectorAll('.item .tt')].map(e => e.textContent)
    expect(names).toHaveLength(1)
    expect(names[0]).toContain('Bob')
  })
  it('only the owner is offered the download of everyone\'s workouts', async () => {
    let page = render(<Students />)
    await settle()
    expect(page.textContent).not.toContain('Download everyone')
    mocks.answers['/api/admin/users'].users[0].owner = true
    page = render(<Students />)
    await settle()
    expect(page.textContent).toContain('Download everyone')
  })
  it('renders nothing for someone who is not an admin', async () => {
    mocks.me = { id: 'x', name: 'X' }
    const page = render(<Students />)
    await settle()
    expect(page.textContent).toBe('')
  })
})

describe('Student (one page)', () => {
  it('says whose page it is and offers a plan for them, with the plan already on its way shown', async () => {
    const page = render(<Student />)
    await settle()
    const text = page.textContent
    expect(text).toContain('Mallory')
    expect(text).toContain('Plans made here are for Mallory')
    expect(button(page, 'New plan for Mallory')).toBeTruthy()
    expect(text).toContain('Plan from Teacher')
    expect(text).toContain('Legs A')
  })
  it('offers to download a plan, send it to another student, or download them all', async () => {
    const page = render(<Student />)
    await settle()
    expect(button(page, 'Download all plans')).toBeTruthy()
    act(() => page.querySelector('button[aria-label="Plan options"]').click())
    const labels = mocks.sheets.at(-1).menu.items.filter(Boolean).map(i => i.label)
    expect(labels).toEqual(expect.arrayContaining(['Download plan file', 'Send to another student…', 'Archive', 'Delete']))
  })
  it('explains in the download menu that workouts are a history, not a plan', async () => {
    const page = render(<Student />)
    await settle()
    act(() => button(page, 'Workouts').click())
    act(() => button(page, 'Download all').click())
    expect(mocks.sheets.at(-1).menu.subtitle).toMatch(/not a plan/)
  })
  it('takes back a plan that has not been added yet', async () => {
    const page = render(<Student />)
    await settle()
    act(() => button(page, 'Take back').click())
    mocks.sheets.at(-1).confirm.onConfirm()
    await settle()
    expect(mocks.posts).toEqual([{ path: '/api/admin/user/plan/cancel', body: { id: 'u1', plan: 'p1' } }])
  })
  it('skips shapeless workout entries and offers archive, delete and download', async () => {
    const page = render(<Student />)
    await settle()
    act(() => button(page, 'Workouts').click())
    await settle()
    const rows = [...page.querySelectorAll('.list > div')]
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Push day')
    act(() => button(page, 'Select').click())
    act(() => button(page, 'Select all').click())
    for (const label of ['Download (1)', 'Archive (1)', 'Delete (1)']) expect(button(page, label), label).toBeTruthy()
  })
  it('a teacher gets no Delete on an admin\'s record', async () => {
    mocks.answers['/api/admin/user'].user.admin = true
    const page = render(<Student />)
    await settle()
    act(() => button(page, 'Workouts').click())
    act(() => button(page, 'Select').click())
    act(() => button(page, 'Select all').click())
    expect(button(page, 'Archive (1)')).toBeTruthy()
    expect(button(page, 'Delete (1)')).toBeFalsy()
  })
  it('the owner can delete an admin\'s workouts', async () => {
    mocks.answers['/api/admin/users'].users[0].owner = true
    mocks.answers['/api/admin/user'].user.admin = true
    const page = render(<Student />)
    await settle()
    act(() => button(page, 'Workouts').click())
    act(() => button(page, 'Select').click())
    act(() => button(page, 'Select all').click())
    expect(button(page, 'Delete (1)')).toBeTruthy()
  })
})
