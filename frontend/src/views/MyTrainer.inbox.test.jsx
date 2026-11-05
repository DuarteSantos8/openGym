// @vitest-environment happy-dom
// Settings → Trainer & gym, the inbox half: a suggestion to take, the offer to stay with a trainer
// privately, undoing a trainer change (asking first when it moved since), a gym join code.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MyTrainerPage from './MyTrainer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ answers: {}, posts: [], sheets: [], toasts: [], search: '' }))
vi.mock('../lib/api.js', () => ({
  api: (path, opts) => {
    const key = path.split('?')[0]
    if (opts?.method === 'POST') {
      mocks.posts.push([key, JSON.parse(opts.body)])
      const a = mocks.answers['POST ' + key]
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a || { ok: true })
    }
    return key in mocks.answers ? Promise.resolve(mocks.answers[key]) : Promise.reject(new Error('not found'))
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: { id: 'lea', name: 'Lea' }, S: { lang: 'en' } })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: m => mocks.toasts.push(m), openSheet: render => mocks.sheets.push(render) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useLocation: () => ({ search: mocks.search }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))

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
const consent = { kind: 'trainer', v: 1, hash: 'h1', text: 'x' }
const scopes = { metrics: 'view', workouts: 'view', plans: 'suggest', bodyweight: 'off', measurements: 'off', photos: 'off', notes: 'off', nutrition: 'off' }
const sharing = {
  leadMode: 'row', consent, gyms: [], leadOnly: [], nutrition: 'not-linked',
  connections: [{ id: 'gr1', status: 'active', paused: null, scopes, since: Date.parse('2026-11-03'), trainer: { id: 'marco', name: 'Marco' }, gym: null, lead: null }],
}
const inbox = () => ({
  unseen: 2,
  items: [
    { id: 'i1', kind: 'suggest', status: 'open', seen: false, at: Date.parse('2026-11-04'), from: { kind: 'trainer', id: 'marco', name: 'Marco' },
      summary: [{ kind: 'routine.put', isNew: true, name: 'Strong 5x5' }, { kind: 'week.add', day: 1, name: 'Strong 5x5' }], message: 'Easy first week' },
    { id: 'i2', kind: 'offer', status: 'open', seen: false, at: Date.parse('2026-11-04'), grantId: 'gr7', names: ['Sara', 'FitBox'], expires: Date.parse('2026-12-04'), from: { kind: 'trainer', id: 'sara', name: 'Sara' } },
    { id: 'i3', kind: 'comment', status: 'open', seen: true, at: Date.parse('2026-11-03'), workoutId: 'w1', workout: { d: '2026-11-03', name: 'Push A' }, text: 'Clean reps!', from: { kind: 'trainer', id: 'marco', name: 'Marco' } },
    { id: 'i4', kind: 'notice', notice: 'connected', status: 'open', seen: true, at: 1, names: ['Marco'] },
  ],
  undo: [{ id: 'u1', at: Date.now() - 1000, by: { kind: 'trainer', name: 'Marco' }, accepted: false, cats: ['plans'], summary: [{ kind: 'routine.put', isNew: true, name: 'Legs' }], canUndo: true, undoneAt: null }],
})

beforeEach(() => {
  document.body.innerHTML = ''
  mocks.posts.length = 0; mocks.sheets.length = 0; mocks.toasts.length = 0; mocks.search = ''
  mocks.answers = { '/api/sharing': sharing, '/api/sharing/log': { log: [] }, '/api/sharing/inbox': inbox() }
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('the inbox in Trainer & gym', () => {
  it('shows what is waiting, marks it seen, and takes a suggestion', async () => {
    const page = render(<MyTrainerPage />)
    await settle()
    const text = page.textContent
    expect(text).toContain('Marco suggests')
    expect(text).toContain('New routine: Strong 5x5')
    expect(text).toContain('On Mondays: Strong 5x5')
    expect(text).toContain('Easy first week')
    expect(text).toContain('Sara left FitBox')
    expect(text).toContain('Marco on Push A')
    expect(text).toContain('Marco is now your trainer')
    expect(text).toContain('See what Marco sees')
    expect(mocks.posts).toContainEqual(['/api/sharing/inbox/seen', {}])
    await click(button(page, 'Take it'))
    expect(mocks.posts).toContainEqual(['/api/sharing/inbox/answer', { id: 'i1', accept: true }])
  })
  it('keeps a trainer privately with the current consent', async () => {
    const page = render(<MyTrainerPage />)
    await settle()
    await click(button(page, 'Stay connected'))
    expect(mocks.posts).toContainEqual(['/api/sharing/inbox/answer', { id: 'i2', accept: true, consent: { v: 1, hash: 'h1' }, lang: 'en' }])
  })
  it('undoes a trainer change, and asks first when it moved since', async () => {
    const { confirmSheet } = await import('../sheets.jsx')
    mocks.answers['POST /api/sharing/undo'] = Object.assign(new Error('changed'), { data: { code: 'changed-since' } })
    const page = render(<MyTrainerPage />)
    await settle()
    expect(page.textContent).toContain('What your trainers changed')
    await click(button(page, 'Undo'))
    await settle()
    expect(mocks.posts).toContainEqual(['/api/sharing/undo', { id: 'u1', force: false }])
    expect(confirmSheet).toHaveBeenCalled()
    expect(confirmSheet.mock.calls.at(-1)[0].title).toBe('Undo anyway?')
  })
  it('a gym code opens the join screen with the lead row only', async () => {
    mocks.answers['POST /api/sharing/code'] = { kind: 'gym', gym: { id: 'g1', name: 'FitBox', contact: '', leads: ['Anna'] }, leadMode: 'row', member: false,
      leadDefaults: { metrics: 'view', workouts: 'view' }, consent: { kind: 'lead', v: 1, hash: 'hl', text: 'You are joining this gym. Its gym lead sees your name and the categories you mark here, never more than view. You can change this or leave the gym any time, and it stops working the moment you do.' } }
    mocks.search = '?code=GY-AAAAA-BBBBB'
    render(<MyTrainerPage />)
    await settle(); await settle()
    const sheet = render(mocks.sheets.at(-1)(() => {}))
    expect(sheet.textContent).toContain('Join FitBox?')
    expect(sheet.textContent).toContain('Gym lead (Anna)')
    await click(button(sheet, 'Join'))
    expect(mocks.posts.find(p => p[0] === '/api/sharing/connect')[1]).toMatchObject({ code: 'GY-AAAAA-BBBBB', consent: { v: 1, hash: 'hl' } })
  })
})
