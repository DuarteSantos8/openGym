import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachChat from './CoachChat.jsx'

// The demo Coach's failure state, end to end. Every other CoachChat test mocks lib/coach-api.js;
// this one runs the real thing with DEMO forced on, so the chain under test is exactly what the
// GitHub Pages build ships: a builder throws inside lib/coach-demo.js's timer → demoStatus()
// reports `lastError` → useCoachStatus hands it over on the next poll → the job-ended effect
// writes an error line into the thread, and the next request is taken rather than 409'd.
// Before the catch in coach-demo.js the job stayed 'running' for ever and the demo Coach was
// bricked until the page was reloaded.
const mocks = vi.hoisted(() => {
  const state = { S: null, nav: vi.fn(), toast: vi.fn(), openSheet: vi.fn() }
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
  useStore.getState = mocks.storeSnapshot          // coach-api.js reads S() from here in demo mode
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => (selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot())
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/demo.js', () => ({ DEMO: true, DEMO_SEEDED: 'gym_demo_seeded_v1', REPO: '' }))
vi.mock('../sheets.jsx', () => ({ startFlow: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))
vi.mock('../coach.css', () => ({}))

const DELAY = 2200        // coach-demo.js's thinking time
const POLL_MS = 3000      // coach-api.js's cadence while a job is in flight

let dom, root, container

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

const chip = re => [...container.querySelectorAll('.qchip')].find(b => re.test(b.textContent || ''))
async function click(el) {
  expect(el).toBeTruthy()
  await act(async () => { el.dispatchEvent(new dom.Event('click', { bubbles: true })); await flush() })
}
// Microtasks only: the dynamic import of coach-demo.js and the status refresh both settle here.
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const settle = async () => { await act(async () => { await flush() }) }
const elapse = async ms => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); await flush() }) }

// A workout the chat can list (it reads `d` and `name` only) but the debrief builder cannot
// read: `entries` throws the moment buildDebrief touches it, inside the demo's timer.
const brokenWorkout = () => ({ id: 'w1', name: 'Push Day', d: '2026-09-01', get entries() { throw new Error('boom') } })
const state = () => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [brokenWorkout()], bodyweight: [], exWeights: {},
  dayPlan: {}, routines: [], week: {},
  coach: {
    consent: { agreedAt: '2026-07-01T00:00:00Z', version: 1 },
    profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
    log: [], snapshots: [], chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }], timings: []
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  // Only what the demo and the poll use. Module loading and React's scheduler stay on real clocks.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})
afterEach(async () => {
  if (root) { await act(async () => { root.unmount() }); root = null }
  container = null; dom = null
  vi.useRealTimers()
})

describe('the demo Coach failing inside its timer', () => {
  it('ends as an error line in the thread, and the next request is taken', async () => {
    mocks.S = state()
    installDom()
    await act(async () => { root.render(React.createElement(CoachChat)) })
    await settle()

    await click(chip(/Last workout/))
    expect(mocks.toast).not.toHaveBeenCalled()                       // the request was accepted
    expect(mocks.S.coach.chat.at(-1)).toMatchObject({ role: 'user', kind: 'text', text: 'How did my Push Day session go?' })
    const lines = mocks.S.coach.chat.length

    await elapse(DELAY)                                              // the builder throws in here
    await elapse(POLL_MS)                                            // the poll sees the job gone
    expect(mocks.S.coach.chat).toHaveLength(lines + 1)
    expect(mocks.S.coach.chat.at(-1)).toMatchObject({
      role: 'coach', kind: 'error', text: 'The Coach couldn’t read your training data.'
    })
    expect(mocks.S.coach.timings).toHaveLength(1)                    // the effect ran once, as for a real job

    // Not bricked: a second ask goes through instead of "already thinking".
    await click(chip(/Last workout/))
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.S.coach.chat.at(-1)).toMatchObject({ role: 'user', kind: 'text' })
    await elapse(DELAY); await elapse(POLL_MS)                       // drain it, so nothing is left running
  })
})
