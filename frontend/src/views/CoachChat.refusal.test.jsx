// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachChat from './CoachChat.jsx'
import { requestReview } from '../lib/coach-api.js'
import { CONSENT_VERSION } from '../lib/coach.js'

// When the server refuses a Coach request at enqueue it answers in English, with the refusal's
// class beside the words: { error: 'the Coach is already thinking about your training',
// code: 'busy' }. The composer and the quick actions toasted e.message, those English words,
// in the middle of a translated screen. The class now picks the app's own line (JOB_ERRORS,
// translated); a class with no line of its own keeps the server's words.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: vi.fn(), toast: vi.fn(), openSheet: vi.fn(), refresh: vi.fn() }
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
vi.mock('../lib/coach-api.js', () => ({
  awaitedJob: () => null,
  settleAwaited: vi.fn(),
  useCoachStatus: () => ({ pending: null, job: null, cap: null, loading: false, lastError: null, last: null, refresh: mocks.refresh, maxMessageLen: 2200 }),
  resolvePending: vi.fn(() => Promise.resolve({})),
  refinePlan: vi.fn(() => Promise.resolve({})),
  requestReview: vi.fn(() => Promise.resolve({})),
  requestDebrief: vi.fn(() => Promise.resolve({})),
  requestPlan: vi.fn(() => Promise.resolve({})),
  cohortStats: vi.fn(() => Promise.resolve({ ok: false })),
  setCohortShare: vi.fn(() => Promise.resolve({ ok: true })),
  jobErrorText: () => 'err',
  JOB_ERRORS: { busy: 'the app’s busy line' },
}))
vi.mock('../sheets.jsx', () => ({ startFlow: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))
vi.mock('../coach.css', () => ({}))

// Setting el.value directly does not notify React's value tracker, so the native prototype
// setter has to be called first.
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

const state = () => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {},
  dayPlan: {}, routines: [{ id: 'r1', name: 'Full body', ex: [] }], week: {},
  coach: {
    consent: { agreedAt: '2026-07-01T00:00:00Z', version: CONSENT_VERSION },
    profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
    log: [], snapshots: [], chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }], timings: []
  },
})
// What api.js throws for a refusal: the server's words as the message, its body on `data`.
const refusal = (error, code, status = 409) => Object.assign(new Error(error), { status, data: { error, code } })

let host, root
beforeEach(() => {
  vi.clearAllMocks()
  mocks.S = state()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

const mount = () => act(() => { root.render(<CoachChat />) })
const send = async text => {
  act(() => { type(host.querySelector('.composer textarea'), text) })
  await act(async () => { host.querySelector('.composer .send').dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve() })
}
const chip = re => [...host.querySelectorAll('button')].find(b => re.test(b.textContent || ''))

describe('a request the server refuses', () => {
  it('from the composer, toasts the app\'s line for its class, not the server\'s English', async () => {
    vi.mocked(requestReview).mockRejectedValueOnce(refusal('the Coach is already thinking about your training', 'busy'))
    mount()
    await send('x')
    expect(mocks.toast).toHaveBeenCalledWith('the app’s busy line')
  })

  it('whose class has no line of its own keeps the server\'s words', async () => {
    vi.mocked(requestReview).mockRejectedValueOnce(refusal('this Coach account is shared; ask the owner', 'shared'))
    mount()
    await send('x')
    expect(mocks.toast).toHaveBeenCalledWith('this Coach account is shared; ask the owner')
  })

  it('from a quick action, toasts the app\'s line for its class too', async () => {
    vi.mocked(requestReview).mockRejectedValueOnce(refusal('the Coach is already thinking about your training', 'busy'))
    mount()
    await act(async () => { chip(/Review my training/).dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve() })
    expect(mocks.toast).toHaveBeenCalledWith('the app’s busy line')
  })

  it('with no class at all (a network failure) still shows what went wrong', async () => {
    vi.mocked(requestReview).mockRejectedValueOnce(new Error('Network unreachable'))
    mount()
    await send('x')
    expect(mocks.toast).toHaveBeenCalledWith('Network unreachable')
  })
})
