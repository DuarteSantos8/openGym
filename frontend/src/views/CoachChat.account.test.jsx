// @vitest-environment happy-dom
//
// On an instance where each profile brings its own provider account (authMode: profile), the
// Coach screen has to say so: a "Your account" row in the Coach menu, a way in from the
// composer while nothing is connected, and a refusal that points at the row instead of saying
// the Coach is off. In instance mode none of it exists. The sheet itself is CoachAccount.test.jsx.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachChat from './CoachChat.jsx'
import { requestReview } from '../lib/coach-api.js'
import { CONSENT_VERSION } from '../lib/coach.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, account: null, nav: vi.fn(), toast: vi.fn(), openSheet: vi.fn(), refresh: vi.fn(), refreshAccount: vi.fn() }
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
  ensureAiConsent: vi.fn(() => Promise.resolve(true)),
  isDeclined: e => e?.code === 'declined',
  JOB_ERRORS: { account: 'Connect your own account first: Coach menu → Your account.' },
}))
vi.mock('../lib/coach-account.js', () => ({
  useCoachAccount: () => ({ account: mocks.account, refresh: mocks.refreshAccount }),
  needsOwnAccount: a => !!a && a.mode === 'profile',
  fetchAccount: vi.fn(() => Promise.resolve(mocks.account)),
  connectOwn: vi.fn(), disconnectOwn: vi.fn(), testOwn: vi.fn(),
}))
vi.mock('../sheets.jsx', () => ({ startFlow: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))
vi.mock('../coach.css', () => ({}))

const state = () => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {},
  dayPlan: {}, routines: [{ id: 'r1', name: 'Full body', ex: [] }], week: {},
  coach: {
    consent: { agreedAt: '2026-07-01T00:00:00Z', version: CONSENT_VERSION },
    profile: { goal: 'muscle', experience: 'new', daysPerWeek: 3, sessionMin: 60, preferredDays: [1, 3, 5], equipment: [] },
    log: [], snapshots: [], chat: [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }], timings: []
  },
})
const acct = (over = {}) => ({ mode: 'profile', provider: 'claude', providerLabel: 'Claude (Anthropic)', account: null, connected: false, reason: 'no-credential', accepts: ['cli-token', 'apikey'], type: null, ...over })
const refusal = (error, code, status = 409) => Object.assign(new Error(error), { status, data: { error, code } })

let host, root, sheetHost, sheetRoot
beforeEach(() => {
  vi.clearAllMocks()
  mocks.S = state()
  mocks.account = null
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  sheetHost = document.createElement('div'); document.body.appendChild(sheetHost); sheetRoot = createRoot(sheetHost)
})
afterEach(() => {
  act(() => { root.unmount() }); host.remove()
  act(() => { sheetRoot.unmount() }); sheetHost.remove()
})

const mount = () => act(() => { root.render(<CoachChat />) })
const chip = re => [...host.querySelectorAll('button')].find(b => re.test(b.textContent || ''))
const click = async el => { await act(async () => { el.dispatchEvent(new Event('click', { bubbles: true })); await Promise.resolve() }) }
// The Coach menu is a sheet handed to openSheet as a render function: draw it the way the app would.
const openMenu = async () => {
  await click(host.querySelector('button[aria-label="More"]'))
  const render = mocks.openSheet.mock.calls.at(-1)[0]
  act(() => { sheetRoot.render(render(vi.fn())) })
}
const menuRow = title => [...sheetHost.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)

describe('profile mode, nothing connected', () => {
  beforeEach(() => { mocks.account = acct() })

  it('shows "Your account" in the Coach menu, saying it is not connected', async () => {
    mount()
    await openMenu()
    const row = menuRow('Your account')
    expect(row).toBeTruthy()
    expect(row.querySelector('.lrow-s').textContent).toBe('Not connected. Connect it to use the Coach')
  })

  it('offers a way in from the composer, which opens the account sheet', async () => {
    mount()
    const c = chip(/Connect your account to use the Coach/)
    expect(c).toBeTruthy()
    await click(c)
    expect(mocks.openSheet).toHaveBeenCalledTimes(1)
  })

  it('a refusal for having no account toasts the line that points at the row, and opens the sheet', async () => {
    vi.mocked(requestReview).mockRejectedValueOnce(refusal('This instance has every profile use its own account.', 'account'))
    mount()
    await click(chip(/Review my training/))
    expect(mocks.toast).toHaveBeenCalledWith('Connect your own account first: Coach menu → Your account.')
    expect(mocks.openSheet).toHaveBeenCalledTimes(1)
    expect(mocks.refreshAccount).toHaveBeenCalled()
  })
})

describe('profile mode, connected', () => {
  it('the row says whose account, and there is no nudge above the composer', async () => {
    mocks.account = acct({ connected: true, reason: null, account: 'me@example.com', type: 'cli-token' })
    mount()
    expect(chip(/Connect your account to use the Coach/)).toBeFalsy()
    await openMenu()
    expect(menuRow('Your account').querySelector('.lrow-s').textContent).toBe('Connected · me@example.com')
  })
})

describe('instance mode', () => {
  it('has no "Your account" row and no nudge: the admin\'s account pays', async () => {
    mocks.account = acct({ mode: 'instance', connected: true, reason: null })
    mount()
    expect(chip(/Connect your account to use the Coach/)).toBeFalsy()
    await openMenu()
    expect(menuRow('Your account')).toBeFalsy()
    expect(menuRow('Ask for a review')).toBeTruthy()      // the menu itself is there
  })

  it('a refusal of another class opens no sheet', async () => {
    mocks.account = acct({ mode: 'instance', connected: true, reason: null })
    vi.mocked(requestReview).mockRejectedValueOnce(refusal('busy', 'busy'))
    mount()
    await click(chip(/Review my training/))
    expect(mocks.openSheet).not.toHaveBeenCalled()
  })
})
