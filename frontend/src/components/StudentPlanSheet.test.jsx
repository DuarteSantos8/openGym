// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StudentPlanSheet from './StudentPlanSheet.jsx'
import { planExport } from '../lib/admin-export.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* A plan for a student, built from a plan file: what a teacher does to copy one student's plan
   to another. The api is recorded; the toast is a spy so the messages can be read. */
const mocks = vi.hoisted(() => ({ posts: [], toast: vi.fn(), confirms: [], answers: {}, own: [] }))
vi.mock('../lib/api.js', () => ({
  api: (path, init) => {
    if (init?.method === 'POST') { mocks.posts.push({ path, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true, pending: 1 }) }
    const key = path.split('?')[0]
    return key in mocks.answers ? Promise.resolve(mocks.answers[key]) : Promise.reject(new Error('not found'))
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: { unit: 'kg', routines: mocks.own, customEx: [] } })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({ exercisePicker: () => {}, exConfigSheet: () => {}, confirmSheet: o => mocks.confirms.push(o) }))

const mounted = []
function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 20)))
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
beforeEach(() => { document.body.innerHTML = ''; mocks.posts.length = 0; mocks.confirms.length = 0; mocks.answers = {}; mocks.own = []; mocks.toast.mockClear() })
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

const source = {
  user: { name: 'Karine' }, unit: 'kg', customEx: [],
  routines: [{ id: 'r1', name: 'TREINO A', ex: [{ id: '0001', sets: 3, reps: 10 }] }, { id: 'r2', name: 'TREINO B', ex: [{ id: '0002', sets: 2, reps: 8 }] }],
  week: { 1: ['r1'], 4: ['r2'] }
}
const load = async (host, text, name = 'plan.json') => {
  const input = host.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [new File([text], name, { type: 'application/json' })], configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await settle()
}

describe('StudentPlanSheet: starting a plan', () => {
  it('fills the routines, weekdays and name from a plan file, and sends them to that student', async () => {
    const host = render(<StudentPlanSheet student={{ id: 's2', name: 'Bob' }} close={() => {}} />)
    await load(host, planExport(source, null).text)
    const names = [...host.querySelectorAll('input.input')].map(i => i.value)
    expect(names).toEqual(expect.arrayContaining(['TREINO A', 'TREINO B']))
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('Loaded'))
    await act(async () => { button(host, 'Send to Bob').click() })
    await settle()
    expect(mocks.posts).toHaveLength(1)
    const { path, body } = mocks.posts[0]
    expect(path).toBe('/api/admin/user/plan')
    expect(body.id).toBe('s2')
    expect(body.bundle.routines.map(r => r.name)).toEqual(['TREINO A', 'TREINO B'])
    expect(Object.keys(body.bundle.week).sort()).toEqual(['1', '4'])
  })
  it('refuses a workout history and says what it is', async () => {
    const host = render(<StudentPlanSheet student={{ id: 's2', name: 'Bob' }} close={() => {}} />)
    await load(host, JSON.stringify({ user: { name: 'Karine' }, workouts: [{ id: 'w', entries: [] }] }), 'workouts.json')
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/workout history, not a plan/))
    expect(mocks.posts).toHaveLength(0)
  })
  it('refuses a file that is not JSON at all without throwing', async () => {
    const host = render(<StudentPlanSheet student={{ id: 's2', name: 'Bob' }} close={() => {}} />)
    await load(host, 'not json {', 'x.json')
    expect(mocks.toast).toHaveBeenCalled()
    expect(mocks.posts).toHaveLength(0)
  })
})

describe('StudentPlanSheet: the three steps', () => {
  const student = { id: 's2', name: 'Bob' }
  const text = host => host.textContent

  it('opens on "how do you want to start?" and says whose plan it is', () => {
    const host = render(<StudentPlanSheet student={student} close={() => {}} />)
    expect(text(host)).toContain('Not your own plan: this one is for Bob.')
    for (const option of ['From scratch', 'Copy one of my plans', 'Copy from another student', 'From a plan file']) expect(text(host), option).toContain(option)
  })
  it('"from scratch" goes to the editor with the review below it, and nothing can be sent yet', () => {
    const host = render(<StudentPlanSheet student={student} close={() => {}} />)
    act(() => [...host.querySelectorAll('.item')].find(e => e.textContent.includes('From scratch')).click())
    for (const part of ['1. Name the plan', '2. Routines and exercises', '3. Review and send']) expect(text(host), part).toContain(part)
    expect(text(host)).toContain('0 routines · 0 exercises')
    expect(text(host)).toContain('No days chosen: Bob decides when to train.')
    expect(button(host, 'Send to Bob').disabled).toBe(true)
  })
  it('copies one of the teacher\'s own plans, with its weekdays', async () => {
    mocks.own = [{ id: 'm1', name: 'MY LEGS', ex: [{ id: '0001', sets: 3, reps: 10 }] }, { id: 'm2', name: 'EMPTY', ex: [] }]
    const host = render(<StudentPlanSheet student={student} close={() => {}} />)
    act(() => [...host.querySelectorAll('.item')].find(e => e.textContent.includes('Copy one of my plans')).click())
    expect(text(host)).toContain('MY LEGS')
    expect(text(host)).not.toContain('EMPTY')
    await act(async () => { button(host, 'MY LEGS').click() })
    await settle()
    expect([...host.querySelectorAll('input.input')].map(i => i.value)).toContain('MY LEGS')
    expect(text(host)).toContain('1 routines · 1 exercises')
  })
  it('copies the plans of another student', async () => {
    mocks.answers['/api/admin/users'] = { users: [{ id: 's2', name: 'Bob', routines: 1 }, { id: 's3', name: 'Cy', routines: 2 }, { id: 's4', name: 'Nobody', routines: 0 }, { id: 'a', name: 'Teach', admin: true, routines: 3 }] }
    mocks.answers['/api/admin/user'] = { user: { id: 's3', name: 'Cy' }, unit: 'kg', customEx: [], week: { 2: ['r1'] }, routines: [{ id: 'r1', name: 'CY A', ex: [{ id: '0001', sets: 3, reps: 10 }] }] }
    const host = render(<StudentPlanSheet student={student} close={() => {}} />)
    await act(async () => { [...host.querySelectorAll('.item')].find(e => e.textContent.includes('Copy from another student')).click() })
    await settle()
    const names = [...host.querySelectorAll('button.btn')].map(b => b.textContent)
    expect(names.some(n => n.startsWith('Cy'))).toBe(true)
    expect(names.some(n => n.startsWith('Bob') || n.startsWith('Nobody') || n.startsWith('Teach'))).toBe(false)
    await act(async () => { button(host, 'Cy').click() })
    await settle()
    expect([...host.querySelectorAll('input.input')].map(i => i.value)).toContain('CY A')
    expect(text(host)).toContain('Days:')
  })
  it('asks before throwing away a plan that has exercises in it, and only then', async () => {
    const closed = vi.fn()
    const host = render(<StudentPlanSheet student={student} close={closed} />)
    await load(host, planExport(source, null).text)
    act(() => button(host, 'Cancel').click())
    expect(mocks.confirms).toHaveLength(1)
    expect(closed).not.toHaveBeenCalled()
    mocks.confirms[0].onConfirm()
    expect(closed).toHaveBeenCalled()
    // Nothing built yet: no question.
    const fresh = vi.fn()
    const empty = render(<StudentPlanSheet student={student} close={fresh} />)
    act(() => [...empty.querySelectorAll('.item')].find(e => e.textContent.includes('From scratch')).click())
    act(() => button(empty, 'Cancel').click())
    expect(fresh).toHaveBeenCalled()
    expect(mocks.confirms).toHaveLength(1)
  })
  it('warns about a routine with no exercises in the review', async () => {
    const host = render(<StudentPlanSheet student={student} close={() => {}} />)
    await load(host, planExport(source, null).text)
    act(() => button(host, 'Add routine').click())
    expect(text(host)).toContain('has no exercises and will not be sent.')
    expect(text(host)).toContain('2 routines · 2 exercises')
  })
})
