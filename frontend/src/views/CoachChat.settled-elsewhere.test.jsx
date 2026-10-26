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
// The server: a start bumps the day's count and the run ends at once, with `server.outcome`.
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
      srv.last = { id, kind: path.endsWith('plan') ? 'create' : 'review', outcome: srv.outcome, errorClass: null, at: Date.now() }
      return { job: { id } }
    }
    return {}
  }),
}))

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
  mocks.server = { n: 0, used: 4, outcome: 'nochange', last: { id: 'old', kind: 'review', outcome: 'nochange', at: 1 } }
})
afterEach(async () => {
  if (root) { await act(async () => { root.unmount() }); root = null }
  container = null
})

describe('a Coach run settled on another device', () => {
  it('a run that really found nothing says so', async () => {
    mocks.S = state([routine])
    await mount()
    await click(chip(/Review my training/))
    expect(replies()).toHaveLength(1)
    expect(replies()[0]).toMatchObject({ kind: 'nochange' })
  })

  for (const outcome of ['applied', 'dismissed']) {
    it(`a proposal already ${outcome} elsewhere gets no false "nothing to change"`, async () => {
      mocks.S = state([routine])
      mocks.server.outcome = outcome
      await mount()
      await click(chip(/Review my training/))
      await settle()
      expect(mocks.S.coach.chat.at(-1)).toMatchObject({ role: 'user', kind: 'text' })
      expect(replies()).toHaveLength(0)
    })
  }
})
