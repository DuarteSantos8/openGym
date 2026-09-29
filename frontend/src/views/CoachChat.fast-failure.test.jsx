// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachChat from './CoachChat.jsx'
import { CONSENT_VERSION } from '../lib/coach.js'   // the consent a fixture grants is the current one, whatever its number
import { requestPlan, settleAwaited } from '../lib/coach-api.js'

// A run that fails before the first status poll. A provider that refuses the connection fails
// the job in milliseconds, so by the time the chat asks for the status the job is already gone
// and the server's last outcome is `failed` / `provider`. The chat used to write a reply only
// when it had seen the job running and then gone, so these runs ended with no reply at all —
// three questions in a row, three silences. The real lib/coach-api.js runs here; only the HTTP
// layer is faked, answering the way the server does.
const mocks = vi.hoisted(() => {
  const state = { S: null, nav: vi.fn(), toast: vi.fn(), openSheet: vi.fn(), server: null, statusGate: null }
  state.storeSnapshot = () => ({
    S: state.S, user: { id: 'u1' }, ready: true,
    config: { coach: { enabled: true } }, coachLocal: null,
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
  const useUI = selector => (selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot())
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({ startFlow: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../coach.css', () => ({}))
// The server: a start bumps the day's count and the run fails at once, before anyone polls.
vi.mock('../lib/api.js', () => ({
  IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
  api: vi.fn(async (path, opts) => {
    const srv = mocks.server
    if (path === '/api/coach/status') {
      const snap = { job: null, pending: null, cap: { used: srv.used, limit: 10 }, last: srv.last, maxMessageLen: 1000 }
      if (mocks.statusGate) { const gate = mocks.statusGate; mocks.statusGate = null; await gate }
      return snap
    }
    if (opts?.method === 'POST' && /^\/api\/coach\/(review|plan|debrief)$/.test(path)) {
      const id = 'job' + (++srv.n)
      srv.used++
      srv.last = { id, kind: path.endsWith('plan') ? 'create' : 'review', outcome: 'failed', errorClass: 'provider', at: Date.now() }
      return { job: { id } }
    }
    return {}
  }),
}))

const FAILED = 'The Coach couldn’t run — the instance owner needs to check its setup.'
let root, container

function installDom() {
  document.body.innerHTML = '<div id="root"></div>'
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const settle = async () => { await act(async () => { await flush() }) }
const chip = re => [...container.querySelectorAll('.qchip')].find(b => re.test(b.textContent || ''))
async function click(el) {
  expect(el).toBeTruthy()
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
}
async function mount() {
  installDom()
  await act(async () => { root.render(React.createElement(CoachChat)) })
  await settle()
}

const state = routines => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [{ id: 'w1', name: 'Push Day', d: '2026-09-01', entries: [] }], bodyweight: [], exWeights: {},
  dayPlan: {}, routines, week: {},
  coach: {
    consent: { agreedAt: '2026-07-01T00:00:00Z', version: CONSENT_VERSION },
    profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
    log: [], snapshots: [], chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }], timings: []
  },
})
const routine = { id: 'r1', name: 'Day A', ex: [{ id: '0001', sets: 3, reps: 10 }, { id: '0002', sets: 3, reps: 10 }] }
const replies = () => mocks.S.coach.chat.filter(m => m.role === 'coach')

beforeEach(() => {
  vi.clearAllMocks()
  settleAwaited()
  mocks.statusGate = null
  // An earlier run that failed the same way: already answered, and must not be answered again.
  mocks.server = { n: 0, used: 4, last: { id: 'old', kind: 'review', outcome: 'failed', errorClass: 'provider', at: 1 } }
})
afterEach(async () => {
  if (root) { await act(async () => { root.unmount() }); root = null }
  container = null
})

describe('a Coach run that fails before the first poll', () => {
  it('“Review my training” gets the error reply, once, and the counter reads what the server counted', async () => {
    mocks.S = state([routine])
    await mount()
    expect(replies()).toHaveLength(0)                         // opening the chat answers nothing old

    await click(chip(/Review my training/))
    expect(mocks.S.coach.chat.at(-1)).toMatchObject({ role: 'coach', kind: 'error', text: FAILED })
    expect(mocks.S.coach.chat.at(-2)).toMatchObject({ role: 'user', kind: 'text' })
    expect(container.querySelector('.composer-cap').textContent).toBe('5 of 10 Coach runs used today')

    await settle()
    expect(replies()).toHaveLength(1)                         // written once, not on every render

    await click(chip(/Review my training/))
    expect(replies()).toHaveLength(2)
    expect(container.querySelector('.composer-cap').textContent).toBe('6 of 10 Coach runs used today')
  })

  it('a message asking for a plan gets the error reply', async () => {
    mocks.S = state([])                                       // no routines: a message asks for a plan
    await mount()
    const ta = container.querySelector('.composer textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(ta.constructor.prototype, 'value').set.call(ta, 'Add more legs please')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(container.querySelector('.composer .send'))
    expect(mocks.S.coach.chat.at(-2)).toMatchObject({ role: 'user', kind: 'text', text: 'Add more legs please' })
    expect(mocks.S.coach.chat.at(-1)).toMatchObject({ role: 'coach', kind: 'error', text: FAILED })
    expect(mocks.server.last.kind).toBe('create')
  })

  it('the plan the intake asked for, failed before the chat opened, is answered when it opens', async () => {
    mocks.S = state([])
    await requestPlan(mocks.S.coach.profile)                 // CoachIntake's finish(), then nav('/coach')
    await mount()
    expect(replies()).toHaveLength(1)
    expect(replies()[0]).toMatchObject({ kind: 'error', text: FAILED })
  })

  it('a status answer taken before the start and landing after it does not put back the old count', async () => {
    mocks.S = state([routine])
    // The chat's first poll is still on its way when the run is started: its snapshot is from
    // before the start, and it arrives after the refresh that follows the start.
    let release
    mocks.statusGate = new Promise(r => { release = r })
    await mount()
    await click(chip(/Review my training/))
    expect(container.querySelector('.composer-cap').textContent).toBe('5 of 10 Coach runs used today')
    await act(async () => { release(); await flush() })
    expect(container.querySelector('.composer-cap').textContent).toBe('5 of 10 Coach runs used today')
    expect(replies()).toHaveLength(1)
    expect(replies()[0]).toMatchObject({ kind: 'error', text: FAILED })
  })
})
