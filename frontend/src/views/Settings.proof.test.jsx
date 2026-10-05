// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { rememberProof, recallProof } from '../lib/pending-proof.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The way back from a provider round trip requested as ProveOwner's third proof: the route query
   carries the outcome once (the same once-only effect the link round trip already uses), Settings
   reopens the sheet that was pending - already past its proof step - or says why not, and replaces
   the route so a reload or a back gesture never announces it a second time. */
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, sync: null, config: null, webauthn: true, sheets: [], toasts: [], kept: [], search: '', navs: [], answers: {}, calls: [] }
  state.passkeyLogin = vi.fn(async () => ({ id: 'u1', name: 'andi' }))
  state.list = { passkeys: [], password: false, lastWayIn: false, identity: null }
  state.api = vi.fn(async (path, init) => {
    const method = init?.method || 'GET'
    state.calls.push({ path, method, body: init?.body ? JSON.parse(init.body) : null })
    if (path === '/api/account/passkeys' && method === 'GET') return state.list
    if (path === '/api/account/password' && method === 'GET') return state.status
    const a = state.answers[method + ' ' + path.split('?')[0]]
    if (a instanceof Error) throw a
    return typeof a === 'function' ? a() : a ?? {}
  })
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync, config: state.config, coachLocal: null,
    update: vi.fn(), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
    syncNow: vi.fn(), unsyncedChanges: () => ({ owed: false, count: 0 }), keptChanges: async () => state.kept,
    disconnectServer: vi.fn(), signOut: vi.fn(), signOutAll: vi.fn(), adoptProfile: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toasts.push(a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({
  useNavigate: () => (...a) => mocks.navs.push(a),
  useLocation: () => ({ pathname: '/settings', search: mocks.search }),
}))
vi.mock('../lib/api.js', () => ({
  api: (...a) => mocks.api(...a), webauthnOK: () => mocks.webauthn, passkeyLogin: (...a) => mocks.passkeyLogin(...a), passkeyRegister: vi.fn(), IS_ANDROID: false,
  passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(), createPasskey: vi.fn(),
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(), askAddDeviceData: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
const byPlaceholder = (host, p) => host.querySelector(`input[placeholder="${p}"]`)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
// The sheet a resume opener opened, mounted on its own.
const openedSheet = (i = mocks.sheets.length - 1) => mount(mocks.sheets[i].render(() => {}))

beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: 'u1', name: 'andi' }
  mocks.sync = { status: 'ok', offline: false, pending: false, auth: false, lastError: null, lastSynced: Date.now(), server: null }
  mocks.config = { password_login: true, oidc: { name: 'Example ID' } }
  mocks.webauthn = true
  mocks.sheets.length = 0
  mocks.toasts.length = 0
  mocks.navs.length = 0
  mocks.answers = {}
  mocks.calls.length = 0
  mocks.search = ''
  mocks.list = { passkeys: [], password: false, lastWayIn: false, identity: null }
  mocks.status = { set: false, setAt: null, passkeys: 0, name: 'andi', nameTaken: false, email: null, identity: false }
  mocks.passkeyLogin.mockClear()
  mocks.api.mockClear()
  sessionStorage.clear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const asked = path => mocks.api.mock.calls.filter(([p]) => p === path).length

describe('Settings: the way back from a provider proof round trip', () => {
  it('"proof=ok" with a remembered passkey-add change reopens AddPasskeySheet, already past its proof step', async () => {
    rememberProof({ act: 'passkey-add', draft: { name: 'Phone' } })
    mocks.search = '?proof=ok'
    mocks.list = { passkeys: [], password: false, lastWayIn: true, identity: { providerName: 'Example ID', email: null, linkedAt: '2026-01-01T00:00:00.000Z', usable: true } }
    mocks.answers['POST /api/account/passkeys/options'] = { cid: 'add-cid', options: { challenge: 'abc' } }
    mount(<Settings />)
    await settle()
    const sheet = openedSheet()
    await settle()
    expect(sheet.querySelector('h3').textContent).toBe('Add a passkey')
    expect(byPlaceholder(sheet, 'Name, e.g. Work laptop').value).toBe('Phone')
    expect(mocks.calls.at(-1)).toEqual({ path: '/api/account/passkeys/options', method: 'POST', body: { identityProof: true } })
    // No toast for the proof itself - only the eventual passkey-added toast, which this step
    // has not reached yet.
    expect(mocks.toasts).toEqual([])
    expect(mocks.navs).toEqual([['/settings', { replace: true }]])
    // Spent: a reload of the same URL must not replay it.
    expect(recallProof()).toBeNull()
    // The round trip proved it - the sheet moved straight past its own proof step, ready for
    // the passkey ceremony that finishes adding it, the same as if it had never left the page.
    expect(button(sheet, 'Create passkey')).toBeDefined()
    expect(button(sheet, 'Confirm with Example ID')).toBeUndefined()
  })

  it('"proof=ok" with nothing remembered says the confirmation expired and opens nothing', async () => {
    mocks.search = '?proof=ok'
    mount(<Settings />)
    await settle()
    expect(mocks.sheets).toEqual([])
    expect(mocks.toasts.at(-1)[0]).toBe('The confirmation attempt expired - try again.')
    expect(mocks.navs).toEqual([['/settings', { replace: true }]])
  })

  it('"proof=ok" with an expired remembered record also says so and opens nothing', async () => {
    rememberProof({ act: 'passkey-add', draft: { name: 'Phone' } }, { now: Date.now() - 6 * 60 * 1000 })
    mocks.search = '?proof=ok'
    mount(<Settings />)
    await settle()
    expect(mocks.sheets).toEqual([])
    expect(mocks.toasts.at(-1)[0]).toBe('The confirmation attempt expired - try again.')
  })

  it('"proof-err=identity-mismatch" toasts its own sentence, forgets the pending change, opens nothing', async () => {
    rememberProof({ act: 'passkey-add', draft: { name: 'Phone' } })
    mocks.search = '?proof-err=identity-mismatch'
    mount(<Settings />)
    await settle()
    expect(mocks.sheets).toEqual([])
    expect(mocks.toasts.at(-1)[0]).toBe("That wasn't the linked identity for this profile - try again with the right account.")
    expect(mocks.navs).toEqual([['/settings', { replace: true }]])
    expect(recallProof()).toBeNull()
  })

  it('"proof-err=stale-sign-in" toasts its own retry sentence and forgets the pending change', async () => {
    rememberProof({ act: 'passkey-add', draft: { name: 'Phone' } })
    mocks.search = '?proof-err=stale-sign-in'
    mount(<Settings />)
    await settle()
    expect(mocks.toasts.at(-1)[0]).toMatch(/didn't confirm a new sign-in/)
    expect(recallProof()).toBeNull()
  })

  it('"oidc-err=state-unknown" (a return the server could not tie to a link or a proof) toasts the expired sentence and forgets the pending change', async () => {
    rememberProof({ act: 'passkey-add', draft: { name: 'Phone' } })
    mocks.search = '?oidc-err=state-unknown'
    mount(<Settings />)
    await settle()
    expect(mocks.sheets).toEqual([])
    expect(mocks.toasts.at(-1)[0]).toBe('The attempt at the sign-in provider expired - try again.')
    expect(mocks.navs).toEqual([['/settings', { replace: true }]])
    expect(recallProof()).toBeNull()
  })

  it('"proof-err=__proto__" never resolves to anything but the generic sentence', async () => {
    mocks.search = '?proof-err=__proto__'
    mount(<Settings />)
    await settle()
    expect(mocks.toasts.at(-1)[0]).toBe("Something went wrong confirming it's you - try again.")
  })

  it('a link marker and a proof marker are handled by the same once-only effect: no route query does neither', async () => {
    mount(<Settings />)
    await settle()
    expect(mocks.toasts).toEqual([])
    expect(mocks.navs).toEqual([])
  })

  it('"link=ok" still works exactly as before, alongside the proof markers on the same effect', async () => {
    mocks.search = '?link=ok'
    mount(<Settings />)
    await settle()
    expect(mocks.toasts).toContainEqual(['Identity linked'])
    expect(asked('/api/account/passkeys')).toBe(2)   // the initial read, and the one this triggers
    expect(mocks.navs).toEqual([['/settings', { replace: true }]])
  })

  it('"proof=ok" reopens AddPasskeySheet even when the passkeys list answers before /api/config', async () => {
    rememberProof({ act: 'passkey-add', draft: { name: 'Phone' } })
    mocks.search = '?proof=ok'
    mocks.config = null   // a fresh page load: boot()'s /api/config has not answered yet
    mocks.list = { passkeys: [], password: false, lastWayIn: true, identity: { providerName: 'Example ID', email: null, linkedAt: '2026-01-01T00:00:00.000Z', usable: true } }
    mocks.answers['POST /api/account/passkeys/options'] = { cid: 'add-cid', options: { challenge: 'abc' } }
    mount(<Settings />)
    await settle()
    mocks.config = { password_login: true, oidc: { name: 'Example ID' } }
    act(() => mounted[0].root.render(<Settings />))
    await settle()
    expect(mocks.toasts).toEqual([])
    expect(mocks.sheets.length).toBe(1)
    const sheet = openedSheet()
    await settle()
    expect(mocks.calls.at(-1)).toEqual({ path: '/api/account/passkeys/options', method: 'POST', body: { identityProof: true } })
  })
})
