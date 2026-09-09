import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachChat from './CoachChat.jsx'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'

// The chat is where a plan is imported. These pin that the Import button applies the pending
// plan through the store, writes the decision into the thread, and leaves today startable.
const mocks = vi.hoisted(() => {
  const state = { S: null, pending: null, job: null, community: false, nav: vi.fn(), toast: vi.fn(), openSheet: vi.fn(), refresh: vi.fn() }
  state.storeSnapshot = () => ({
    S: state.S,
    user: { id: 'u1' },
    ready: true,
    config: { coach: { enabled: true, ...(state.community ? { community: true } : {}) } },
    coachLocal: null,
    update: mut => mut(state.S),
  })
  state.uiSnapshot = () => ({ toast: state.toast, openSheet: state.openSheet })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot()
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/coach-api.js', () => ({
  useCoachStatus: () => ({ pending: mocks.pending, job: mocks.job, cap: null, loading: false, lastError: null, last: null, refresh: mocks.refresh }),
  resolvePending: vi.fn(() => Promise.resolve({})),
  refinePlan: vi.fn(() => Promise.resolve({})),
  requestReview: vi.fn(() => Promise.resolve({})),
  requestDebrief: vi.fn(() => Promise.resolve({})),
  cohortStats: vi.fn(() => Promise.resolve({ ok: false, enabled: true, sharing: false })),
  setCohortShare: vi.fn(() => Promise.resolve({ ok: true, sharing: true })),
  JOB_ERRORS: { internal: 'x' },
}))
vi.mock('../sheets.jsx', () => ({ startFlow: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
  IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))
vi.mock('../coach.css', () => ({}))

let dom, root, container
const TODAY_WD = new Date(todayISO() + 'T12:00:00').getDay()

const bundle = week => ({
  opengym_plan: 1, name: 'Coach plan', summary: 'a plan',
  week,
  routines: [
    { id: 'x1', name: 'Full body A', emoji: '💪', why: 'first', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps', why: 'because' }] },
    { id: 'x2', name: 'Full body B', emoji: '🏋️', ex: [{ id: '0002', sets: 3, reps: 8, mode: 'reps' }] }
  ],
  customEx: [],
})
const everyDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, 'x1']))

const state = () => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {},
  dayPlan: {}, routines: [], week: {},
  coach: {
    consent: { agreedAt: '2026-07-01T00:00:00Z', version: 1 },
    profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
    log: [], snapshots: [], chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }], timings: []
  },
})

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

async function mount(pending, job = null, { community = false, S = state() } = {}) {
  mocks.S = S
  mocks.pending = pending
  mocks.job = job
  mocks.community = community
  installDom()
  await act(async () => { root.render(React.createElement(CoachChat)) })
}

const byText = re => [...container.querySelectorAll('button')].find(b => re.test(b.textContent || ''))
async function click(el) {
  expect(el).toBeTruthy()
  await act(async () => { el.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(async () => {
  if (root) { await act(async () => { root.unmount() }); root = null }
  container = null; dom = null
})

describe('the Coach chat', () => {
  it('opens with the questionnaire summary and pitches the plan as a card with routine tabs', async () => {
    await mount({ id: 'p1', kind: 'create', bundle: bundle(everyDay) })
    expect(container.textContent).toContain('Build muscle')
    expect(container.textContent).toContain('3 days a week')
    expect(container.querySelectorAll('.pcard-tab').length).toBe(2)
    expect(container.textContent).toContain('because')
    await click([...container.querySelectorAll('.pcard-tab')][1])
    expect(container.querySelector('.pcard-rt-h b').textContent).toContain('Full body B')
  })

  it('imports the plan through the store, records it in the thread, and leaves today startable', async () => {
    await mount({ id: 'p1', kind: 'create', bundle: bundle(everyDay) })
    await click(byText(/Import this plan/))
    const s = mocks.S
    expect(s.routines.length).toBe(2)
    expect(s.week[TODAY_WD]).toBeTruthy()
    const todays = effectiveRoutine(s, todayISO())
    expect(todays && todays.ex.length).toBeGreaterThan(0)
    expect(s.coach.chat.at(-1).kind).toBe('applied')
    expect(s.coach.snapshots).toHaveLength(1)
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('leaves the week alone when the schedule switch is off', async () => {
    await mount({ id: 'p1', kind: 'create', bundle: bundle(everyDay) })
    const sw = container.querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    await click(sw)
    await click(byText(/Import this plan/))
    expect(Object.keys(mocks.S.week)).toHaveLength(0)
    expect(mocks.S.routines.length).toBe(2)
  })

  it('shows the typing bubble with an estimate while a job runs, and disables the composer', async () => {
    await mount(null, { id: 'j1', kind: 'create', state: 'running', startedAt: Date.now() })
    expect(container.querySelector('.typing')).toBeTruthy()
    expect(container.textContent).toContain('usually takes')
    expect(container.querySelector('.composer textarea').disabled).toBe(true)
  })

  it('applies the accepted subset of a review and logs it', async () => {
    mocks.S = state()
    await mount({ id: 'r1', kind: 'review', summary: 's', changes: [
      { id: 'a', type: 'week', target: { weekday: 1 }, before: null, after: null, why: 'rest' },
      { id: 'b', type: 'add-routine', target: {}, before: null, after: { name: 'Legs', ex: [{ id: '0001', sets: 3, reps: 10 }] }, why: 'legs' }
    ] })
    expect(container.querySelectorAll('[role="checkbox"]').length).toBe(2)
    await click([...container.querySelectorAll('[role="checkbox"]')][0])   // drop the week change
    await click(byText(/Apply 1 change/))
    expect(mocks.S.routines.map(r => r.name)).toEqual(['Legs'])
    expect(mocks.S.coach.chat.at(-1).kind).toBe('applied')
    expect(mocks.S.coach.log.at(-1).decisions.map(d => d.status)).toEqual(['accepted', 'rejected'])
  })

  it('keeps an applied review in the thread as a card that opens the whole proposal', async () => {
    await mount({ id: 'r1', kind: 'review', summary: 'a reading', changes: [
      { id: 'a', type: 'week', target: { weekday: 1 }, before: null, after: null, why: 'rest' },
      { id: 'b', type: 'add-routine', target: {}, before: null, after: { name: 'Legs', ex: [{ id: '0001', sets: 3, reps: 10 }] }, why: 'legs' }
    ] })
    await click([...container.querySelectorAll('[role="checkbox"]')][0])
    await click(byText(/Apply 1 change/))
    // The decision is in the store; re-render with the proposal gone, as the poll would.
    mocks.pending = null
    await act(async () => { root.render(React.createElement(CoachChat)) })
    const recap = container.querySelector('.recap')
    expect(recap).toBeTruthy()
    expect(recap.textContent).toContain('1 accepted · 1 declined')
    expect(recap.querySelectorAll('.recap-chip.yes').length).toBe(1)
    expect(recap.querySelectorAll('.recap-chip.no').length).toBe(1)
    expect(mocks.S.coach.chat.at(-1).ref).toBe(mocks.S.coach.log.at(-1).id)
    await click(recap)
    expect(mocks.openSheet).toHaveBeenCalled()
  })

  it('shows a debrief with its score ring and files it on "Got it"', async () => {
    await mount({ id: 'd1', kind: 'debrief', workout: { id: 'w1', name: 'Push', d: '2026-08-29' }, summary: 'ok', score: 8, highlights: ['a'], watch: [], nextTime: ['b'] })
    expect(container.querySelector('.deb-ring')).toBeTruthy()
    expect(container.textContent).toContain('Good session')
    expect(container.textContent).toContain('What went well')
    expect(container.textContent).not.toContain('Worth watching')
    await click(byText(/Got it/))
    expect(mocks.S.coach.log.at(-1).kind).toBe('debrief')
    expect(mocks.S.coach.log.at(-1).score).toBe(8)
    expect(mocks.S.coach.chat.at(-1).kind).toBe('debrief')
    expect(mocks.S.coach.chat.at(-1).ref).toBe(mocks.S.coach.log.at(-1).id)
  })

  it('offers the quick actions only when nothing is running', async () => {
    await mount(null)
    expect(byText(/Review my training/)).toBeTruthy()
    expect(byText(/Last workout/)).toBeFalsy()          // no workout logged yet
    await mount(null, { id: 'j1', kind: 'review', state: 'running', startedAt: Date.now() })
    expect(byText(/Review my training/)).toBeFalsy()
  })

  it('offers the comparison only when the instance allows it', async () => {
    await mount(null)
    expect(byText(/^Compare$/)).toBeFalsy()
    await mount(null, null, { community: true })
    expect(byText(/^Compare$/)).toBeTruthy()
  })
})
