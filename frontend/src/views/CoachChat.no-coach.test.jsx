// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachChat from './CoachChat.jsx'
import { CONSENT_VERSION } from '../lib/coach.js'
import { api } from '../lib/api.js'

// Console noise on a server without a Coach (round 1.4.5, P5). The chat is routed whenever the
// Coach module is on, and it started its status poll on mount, before it knew whether this server
// has a Coach at all: opened straight on #/coach (a reload, a bookmark), it asked once, got
// 503 (401 as a guest), and only then left for Home. Browsers print both as errors. The server's
// answers stay what they are (paired phones, older apps and scripts read them); the app knows
// from /api/config not to ask. The real lib/coach-api.js and lib/use-coach-gate.js run here.
const mocks = vi.hoisted(() => {
  const state = { S: null, user: { id: 'u1' }, config: null, nav: vi.fn(), refreshConfig: vi.fn(async () => state.config), status: null }
  state.storeSnapshot = () => ({
    S: state.S, user: state.user, ready: true, config: state.config, coachLocal: null,
    update: mut => mut(state.S), refreshConfig: state.refreshConfig,
  })
  state.uiSnapshot = () => ({ toast: vi.fn(), openSheet: vi.fn() })
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
vi.mock('../lib/api.js', () => ({
  IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
  api: vi.fn(async path => (path === '/api/coach/status' ? mocks.status() : {})),
}))

let root
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
async function mount() {
  document.body.innerHTML = '<div id="root"></div>'
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(CoachChat)) })
  await act(async () => { await flush() })
}
const asked = () => api.mock.calls.map(c => c[0])
const off = () => { throw Object.assign(new Error('the Coach is not set up on this instance'), { status: 503, data: { error: 'the Coach is not set up on this instance', code: 'off' } }) }
const idle = () => ({ job: null, pending: null, cap: { used: 0, limit: 10 }, last: null, maxMessageLen: 1000 })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refreshConfig.mockImplementation(async () => mocks.config)
  mocks.user = { id: 'u1' }
  mocks.status = idle
  mocks.S = {
    unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {}, dayPlan: {}, routines: [], week: {},
    coach: {
      consent: { agreedAt: '2026-07-01T00:00:00Z', version: CONSENT_VERSION },
      profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
      log: [], snapshots: [], chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }], timings: []
    },
  }
})
afterEach(async () => {
  if (root) { await act(async () => { root.unmount() }); root = null }
})

describe('the chat opened on a server without a Coach', () => {
  it('signed in, the server said it has none: no status request, straight home', async () => {
    mocks.config = { allow_guest: true, signed_in: true, coach: null }
    mocks.status = off
    await mount()
    expect(asked()).not.toContain('/api/coach/status')
    expect(mocks.nav).toHaveBeenCalledWith('/home', { replace: true })
  })

  it('a guest asks nothing either (it would be a 401)', async () => {
    mocks.user = null
    mocks.config = { allow_guest: true, signed_in: false }
    mocks.status = () => { throw Object.assign(new Error('not signed in'), { status: 401, data: { error: 'not signed in' } }) }
    await mount()
    expect(asked()).toEqual([])
    expect(mocks.nav).toHaveBeenCalledWith('/home', { replace: true })
  })

  it('a config that was made for nobody is asked again first, and still no status request', async () => {
    mocks.config = { allow_guest: true }           // no `coach` key: not an answer for this session
    mocks.refreshConfig.mockImplementation(async () => { mocks.config = { allow_guest: true, coach: null }; return mocks.config })
    mocks.status = off
    await mount()
    expect(mocks.refreshConfig).toHaveBeenCalledTimes(1)
    expect(asked()).not.toContain('/api/coach/status')
  })
})

describe('the chat on a server with a Coach', () => {
  it('polls the status as before', async () => {
    mocks.config = { allow_guest: true, signed_in: true, coach: { enabled: true } }
    await mount()
    expect(asked().filter(p => p === '/api/coach/status')).toHaveLength(1)
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(mocks.refreshConfig).not.toHaveBeenCalled()
  })

  // An admin switched the Coach off since this app read the config: the poll is refused with 503
  // and code off. The refusal is swallowed as it always was, and the config is asked again, so
  // the chat learns the Coach is gone and leaves, where it used to collect a 503 a minute.
  it('a 503 "off" against a config that says on asks the config again, and the chat leaves once that says off', async () => {
    mocks.config = { allow_guest: true, signed_in: true, coach: { enabled: true } }
    mocks.refreshConfig.mockImplementation(async () => { mocks.config = { allow_guest: true, signed_in: true, coach: null }; return mocks.config })
    mocks.status = off
    await mount()
    expect(asked().filter(p => p === '/api/coach/status')).toHaveLength(1)
    expect(mocks.refreshConfig).toHaveBeenCalledTimes(1)
    await act(async () => { root.render(React.createElement(CoachChat)); await flush() })   // the store's new config reaches the screen
    expect(mocks.nav).toHaveBeenCalledWith('/home', { replace: true })
    expect(asked().filter(p => p === '/api/coach/status')).toHaveLength(1)
  })

  // A server that keeps saying on in its config and off in its status (it should not happen, but
  // the app must not spin on it): one question per refused poll, and the chat stays.
  it('a 503 "off" from a server whose config still says on does not take the chat down', async () => {
    mocks.config = { allow_guest: true, signed_in: true, coach: { enabled: true } }
    mocks.status = off
    await mount()
    expect(mocks.refreshConfig).toHaveBeenCalledTimes(1)
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(document.querySelector('.composer')).toBeTruthy()
  })

  it('any other failure of the poll leaves the config alone', async () => {
    mocks.config = { allow_guest: true, signed_in: true, coach: { enabled: true } }
    mocks.status = () => { throw Object.assign(new Error('HTTP 502'), { status: 502, data: {} }) }
    await mount()
    expect(mocks.refreshConfig).not.toHaveBeenCalled()
  })
})
