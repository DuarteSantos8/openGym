// @vitest-environment happy-dom
// The trainer dashboard: the list with its flags and week dots, the detail with only what was
// shared, assigning to several at once, the gym lead's view, and nobody else getting in.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
let TrainerPage   // imported fresh per test: the page keeps the last list for 15 s, and the gym lead's is empty

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ answers: {}, calls: [], posts: [], sheets: [], toasts: [], navs: [], params: {}, search: '', config: null }))
vi.mock('../lib/api.js', () => ({
  api: (path, opts) => {
    const key = path.split('?')[0]
    mocks.calls.push(path)
    if (opts?.method === 'POST') { mocks.posts.push([key, JSON.parse(opts.body)]); return Promise.resolve(mocks.answers['POST ' + key] || { ok: true }) }
    return key in mocks.answers ? Promise.resolve(typeof mocks.answers[key] === 'function' ? mocks.answers[key](path) : mocks.answers[key]) : Promise.reject(Object.assign(new Error('nope'), { data: { code: 'not-found' } }))
  }
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ user: { id: 'u_marco', name: 'Marco' }, config: mocks.config, S: { lang: 'en', routines: [{ id: 'm1', name: 'Strong 5x5', ex: [{ id: '0025' }] }] } })
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
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ search: mocks.search, pathname: '/trainer' }), useNavigate: () => to => mocks.navs.push(to),
  useParams: () => mocks.params, Navigate: ({ to }) => { mocks.navs.push('redirect:' + to); return null },
}))
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
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const byText = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const today = new Date().toISOString().slice(0, 10)
const lv = (o = {}) => ({ metrics: 'view', workouts: 'view', plans: 'apply', bodyweight: 'off', measurements: 'off', photos: 'off', notes: 'off', nutrition: 'off', ...o })

beforeEach(async () => {
  vi.resetModules()
  TrainerPage = (await import('./Trainer.jsx')).default
  document.body.innerHTML = ''
  for (const k of ['calls', 'posts', 'sheets', 'toasts', 'navs']) mocks[k].length = 0
  mocks.params = {}; mocks.search = ''
  mocks.config = { trainers: { on: true, roles: { trainer: true, lead: false } } }
  mocks.answers = {
    '/api/trainer/members': { today, leads: [], requests: 0, members: [
      { grantId: 'g1', member: { id: 'u_lea', name: 'Lea Sommer' }, gym: null, levels: lv(), paused: null, since: 1, exNames: [],
        summary: { shares: ['metrics'], lastWorkout: today, streak: 11, week: { done: 2, planned: 4 }, flags: [{ kind: 'pr', n: 2 }] } },
      { grantId: 'g2', member: { id: 'u_tim', name: 'Tim Roth' }, gym: null, levels: lv({ plans: 'suggest' }), paused: null, since: 1, exNames: [],
        summary: { shares: ['metrics'], lastWorkout: '2026-10-01', streak: 0, week: { done: 0, planned: 2 }, flags: [{ kind: 'inactive', days: 30 }] } },
      { grantId: 'g3', member: { id: 'u_jo', name: 'Jo Keller' }, gym: null, levels: lv({ plans: 'off' }), paused: 'left-gym', since: 1, exNames: [], summary: { flags: [] } },
    ] },
    '/api/trainer': { gyms: [], canInviteFree: true, codes: [], requests: [{ id: 'gr9', member: { id: 'u_mia', name: 'Mia' }, scopes: { metrics: 'view' } }], members: [] },
    '/api/trainer/member': { member: { id: 'u_lea', name: 'Lea Sommer' }, today, levels: lv(), grants: [{ id: 'g1', kind: 'trainer', gym: null }],
      shared: ['metrics', 'workouts', 'plans'], unit: 'kg', customEx: [],
      metrics: { lastWorkout: today, streak: 11, week: { done: 2, planned: 4 }, perWeek: 2.5, flags: [], stats: { weeks: [{ week: today, sessions: 2 }] } },
      workouts: { list: [{ id: 'w1', d: today, name: 'Push A', entries: [], prs: [], volume: 900, sets: 6, mins: 45 }], next: null },
      plans: { routines: [{ id: 'tr_1', name: 'Strong 5x5', ex: [{ id: '0025' }], _by: { kind: 'trainer', name: 'Marco' }, origin: { kind: 'trainer' } }], week: { 1: ['tr_1'] }, dayPlan: {}, weekStart: 1 },
      comments: [{ id: 'c1', workoutId: 'w1', text: 'Lovely bench', at: 1, seen: true }], suggestions: [], changes: [] },
  }
})
afterEach(() => { for (const r of mounted.splice(0)) act(() => r.unmount()) })

describe('the trainer list', () => {
  it('lists people, who needs a nudge first, paused last, with flags and this week as dots', async () => {
    const host = render(<TrainerPage />)
    await settle()
    const names = [...host.querySelectorAll('.tr-row-t')].map(n => n.textContent)
    expect(names).toEqual(['Tim Roth', 'Lea Sommer', 'Jo Keller'])
    expect(host.textContent).toContain('Quiet for 30 days')
    expect(host.textContent).toContain('2 new PRs')
    expect(host.querySelector('.tr-dots').getAttribute('aria-label')).toBe('0 of 2 this week')
    expect(host.textContent).toContain('Paused for now')
    // The connection request waits on top.
    expect(host.textContent).toContain('Mia')
    await click(byText(host, 'Confirm'))
    expect(mocks.posts).toContainEqual(['/api/trainer/requests/answer', { id: 'gr9', accept: true }])
  })
  it('searches and filters', async () => {
    const host = render(<TrainerPage />)
    await settle()
    await click(byText(host, 'PRs'))
    expect([...host.querySelectorAll('.tr-row-t')].map(n => n.textContent)).toEqual(['Lea Sommer'])
  })
  it('opens a member, and assigns to several at once', async () => {
    const host = render(<TrainerPage />)
    await settle()
    await click(host.querySelectorAll('.tr-row-b')[1])
    expect(mocks.navs).toContain('/trainer/m/u_lea')
    await click(byText(host, 'Select'))
    for (const b of host.querySelectorAll('.tr-row .chk')) await click(b)
    expect(host.querySelector('.tr-bulk').textContent).toContain('3 selected')
    await click(byText(host, 'Assign a routine'))
    expect(mocks.sheets.length).toBe(1)
    // The sheet says per person how it will land, before anything is sent.
    const sheet = render(mocks.sheets[0](() => {}))
    expect(sheet.textContent).toContain('Added directly')
    expect(sheet.textContent).toContain('As a suggestion')
    expect(sheet.textContent).toContain('Skipped, plans not shared')
    await click(byText(sheet, 'Send to 2'))
    expect(mocks.posts.find(p => p[0] === '/api/trainer/assign')[1]).toMatchObject({ routineId: 'm1' })
    expect(mocks.posts.find(p => p[0] === '/api/trainer/assign')[1].memberIds.sort()).toEqual(['u_jo', 'u_lea', 'u_tim'])
  })
  it('nobody else: no roles, no dashboard', async () => {
    mocks.config = { trainers: { on: true, roles: { trainer: false, lead: false } } }
    render(<TrainerPage />)
    expect(mocks.navs).toContain('redirect:/home')
    expect(mocks.calls.length).toBe(0)
  })
})

describe('one member', () => {
  it('shows only the shared tabs, the comments, and who assigned what', async () => {
    mocks.params = { id: 'u_lea' }
    const host = render(<TrainerPage />)
    await settle()
    expect(mocks.calls.some(c => c.startsWith('/api/trainer/member?id=u_lea'))).toBe(true)
    const tabs = [...host.querySelectorAll('.tr-tabs button')].map(b => b.textContent)
    expect(tabs).toEqual(['Overview', 'Workouts', 'Plan', 'You'])
    expect(host.textContent).toContain('Not shared: Body weight, Body measurements, Progress photos, Notes, Nutrition.')
    await click(byText(host, 'Workouts'))
    expect(host.textContent).toContain('Lovely bench')
    await click(byText(host, 'Plan'))
    expect(host.textContent).toContain('from Marco')
    expect(host.textContent).toContain('Assign a routine')
  })
  it('corrects a workout, logs one and a check-in, each as the member allows', async () => {
    mocks.params = { id: 'u_lea' }
    const m = mocks.answers['/api/trainer/member']
    mocks.answers['/api/trainer/member'] = { ...m, levels: lv({ workouts: 'apply', measurements: 'suggest' }), shared: ['metrics', 'workouts', 'plans', 'measurements'],
      measurements: { entries: [], custom: [] },
      workouts: { list: [{ ...m.workouts.list[0], entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 3, done: true }] }], _edit: { kind: 'trainer', name: 'Marco' } }], next: null } }
    mocks.answers['POST /api/trainer/ops'] = { ok: true, applied: 1, suggested: 0 }
    const host = render(<TrainerPage />)
    await settle()
    await click(byText(host, 'Workouts'))
    expect(host.textContent).toContain('Corrected by Marco')
    await click(byText(host, 'Correct'))
    const sheet = render(mocks.sheets.at(-1)(() => {}))
    expect(sheet.textContent).toContain('Correct this workout')
    const save = byText(sheet, 'Save')
    expect(save.disabled).toBe(true)                            // nothing changed yet
    const reps = sheet.querySelector('[aria-label="Set 2: reps"]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(() => { set.call(reps, '5'); reps.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(byText(sheet, 'Save'))
    expect(mocks.posts.at(-1)).toEqual(['/api/trainer/ops', { memberId: 'u_lea', ops: [{ op: 'workout.edit', id: 'w1', sets: [{ e: 0, s: 1, ex: '0025', r: 5 }] }] }])
    // Log a workout: the button is there at "Change directly".
    await click(byText(host, 'Log a workout'))
    const add = render(mocks.sheets.at(-1)(() => {}))
    expect(add.textContent).toContain('For a session you ran together.')
    expect([...add.querySelectorAll('.tr-pick-i')].length).toBe(1)   // her recent exercise as a quick pick
    // Measurements at "Suggest": the button says so.
    await click(byText(host, 'Body'))
    await click(byText(host, 'Suggest a check-in'))
    const ms = render(mocks.sheets.at(-1)(() => {}))
    const waist = ms.querySelector('[aria-label="Waist"]')
    await act(() => { set.call(waist, '80'); waist.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(byText(ms, 'Send'))
    expect(mocks.posts.at(-1)[1].ops[0]).toMatchObject({ op: 'measurement.put', values: { waist: 80 } })
  })
  it('says it plainly when the connection ended', async () => {
    mocks.params = { id: 'u_lea' }
    mocks.answers['/api/trainer/member'] = undefined
    delete mocks.answers['/api/trainer/member']
    const host = render(<TrainerPage />)
    await settle()
    expect(host.querySelector('[role=alert]')).toBeTruthy()
  })
})

describe('the gym lead', () => {
  it('sees the gym: its trainers, its members, who shares with them', async () => {
    mocks.config = { trainers: { on: true, roles: { trainer: false, lead: true } } }
    mocks.answers['/api/trainer/members'] = { today, members: [], leads: [{ id: 'g_1', name: 'FitBox' }] }
    mocks.answers['/api/gym'] = { gym: { id: 'g_1', name: 'FitBox', leads: ['Anna'] }, today, codes: [], leadMode: 'row',
      trainers: [{ id: 'u_marco', name: 'Marco', members: 1 }],
      members: [
        { member: { id: 'u_lea', name: 'Lea' }, trainers: [{ id: 'u_marco', name: 'Marco' }], sharesWithLead: true, levels: lv(), summary: { lastWorkout: today, streak: 2, flags: [] } },
        { member: { id: 'u_ruth', name: 'Ruth' }, trainers: [], sharesWithLead: false, levels: {}, summary: { flags: [] } },
      ] }
    const host = render(<TrainerPage />)
    await settle(); await settle()
    expect(host.querySelector('h1').textContent).toBe('FitBox')
    expect(host.textContent).toContain('Shares nothing with you')
    await click(byText(host, 'No trainer'))
    expect([...host.querySelectorAll('.tr-row-t')].map(n => n.textContent)).toEqual(['Ruth'])
    expect(host.querySelector('.tr-row-b').disabled).toBe(true)
  })
})
