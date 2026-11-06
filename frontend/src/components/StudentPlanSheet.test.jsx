// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StudentPlanSheet from './StudentPlanSheet.jsx'
import { planExport } from '../lib/admin-export.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* A plan for a student, built from a plan file: what a teacher does to copy one student's plan
   to another. The api is recorded; the toast is a spy so the messages can be read. */
const mocks = vi.hoisted(() => ({ posts: [], toast: vi.fn() }))
vi.mock('../lib/api.js', () => ({
  api: (path, init) => { mocks.posts.push({ path, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true, pending: 1 }) }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: { unit: 'kg', routines: [], customEx: [] } })
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
vi.mock('../sheets.jsx', () => ({ exercisePicker: () => {}, exConfigSheet: () => {} }))

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
beforeEach(() => { document.body.innerHTML = ''; mocks.posts.length = 0; mocks.toast.mockClear() })
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

describe('StudentPlanSheet: start from a plan file', () => {
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
