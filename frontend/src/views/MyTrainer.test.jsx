// @vitest-environment happy-dom
// Settings → Trainer & gym: what each trainer and the gym lead see, the consent screen a code
// opens, changing a level, and the sharing log.
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

beforeEach(() => {
  document.body.innerHTML = ''
  mocks.posts.length = 0; mocks.sheets.length = 0; mocks.toasts.length = 0; mocks.search = ''
  mocks.answers = {
    '/api/sharing': {
      leadMode: 'row', consent, gyms: [{ id: 'g1', name: 'FitBox', contact: 'privacy@fitbox.test', leads: ['Lena'], since: 1 }],
      connections: [{ id: 'gr1', status: 'active', paused: null, scopes, since: Date.parse('2026-11-03'),
        trainer: { id: 'marco', name: 'Marco' }, gym: { id: 'g1', name: 'FitBox', leads: ['Lena'] },
        lead: { id: 'gr2', status: 'active', scopes: { ...scopes, plans: 'view' } } }],
      leadOnly: []
    },
    '/api/sharing/log': { log: [{ id: 'l1', at: Date.parse('2026-11-03'), ev: 'grant.create', actor: { kind: 'self', name: 'Lea' }, peer: { kind: 'trainer', name: 'Marco' } }] },
    'POST /api/sharing/code': { trainer: { id: 'sara', name: 'Sara' }, gym: null, leadMode: 'row', defaults: scopes, leadDefaults: null, consent: { ...consent, hash: 'h2' } },
  }
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Trainer & gym page', () => {
  it('says what Marco and the gym lead see, per category, and lists the log', async () => {
    const page = render(<MyTrainerPage />)
    await settle()
    const text = page.textContent
    expect(text).toContain('Marco at FitBox')
    expect(text).toContain('Sees: Key numbers, Workouts, Plans & routines. May suggest: Plans & routines')
    expect(text).toContain('Gym lead (Lena)')
    expect(text).toContain('You connected Marco')
    expect(text).toContain('Leave')
    expect(text).toContain('Download my sharing record')
  })

  it('a code opens the consent screen; Connect sends the scopes with the consent version and hash', async () => {
    const page = render(<MyTrainerPage />)
    await settle()
    const input = page.querySelector('#trainer-code')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    act(() => { setter.call(input, 'tr-abcde-fghjk'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => [...page.querySelectorAll('button')].find(b => b.textContent === 'Check code').click())
    await settle()
    expect(mocks.posts[0]).toEqual(['/api/sharing/code', { code: 'tr-abcde-fghjk' }])
    const sheet = render(mocks.sheets[0](() => {}))
    expect(sheet.textContent).toContain('Connect with Sara?')
    expect(sheet.textContent).not.toContain('Gym lead', 'a free trainer has no gym lead row')
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Connect').click())
    await settle()
    const [path, body] = mocks.posts[1]
    expect(path).toBe('/api/sharing/connect')
    expect(body.consent).toEqual({ v: 1, hash: 'h2' })
    expect(body.scopes.plans).toBe('suggest')
    expect(body.leadScopes).toBe(null)
  })

  it('opened from a QR, the code is checked straight away', async () => {
    mocks.search = '?code=TR-ABCDE-FGHJK'
    render(<MyTrainerPage />)
    await settle(); await settle()
    expect(mocks.posts[0]).toEqual(['/api/sharing/code', { code: 'TR-ABCDE-FGHJK' }])
  })

  it('a wrong code says so and opens nothing', async () => {
    mocks.answers['POST /api/sharing/code'] = Object.assign(new Error('x'), { data: { code: 'code-invalid' } })
    mocks.search = '?code=TR-NOPE'
    render(<MyTrainerPage />)
    await settle(); await settle()
    expect(mocks.sheets.length).toBe(0)
    expect(mocks.toasts[0]).toMatch(/wrong, used up or expired/)
  })

  it('a pending connection says who has to say yes', async () => {
    mocks.answers['/api/sharing'].connections[0].status = 'pending'
    const page = render(<MyTrainerPage />)
    await settle()
    expect(page.textContent).toContain('Waiting for Marco to say yes')
  })
})
