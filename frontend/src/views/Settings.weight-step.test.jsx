// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { confirmSheet } from '../sheets.jsx'
import { bindUI } from '../components/ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

// SelectRow opens its choices through the bound UI store; capture the sheet to render it here.
let sheet = null
bindUI({ getState: () => ({ openSheet: render => { sheet = render; return { close: () => {} } } }) })

let host, root
beforeEach(() => {
  sheet = null
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], exWeights: {},
    routines: [{ id: 'r', ex: [{ id: '0025', sets: 3, reps: 5, inc: 2.5 }, { id: '0031', sets: 3, reps: 8, inc: 5 }, { id: '0032', sets: 3, reps: 8 }] }],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings page="units" />))
const rowOf = text => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(text))
const choose = label => {
  act(() => { rowOf('Weight step').click() })
  const box = document.createElement('div')
  document.body.appendChild(box)
  const sheetRoot = createRoot(box)
  act(() => sheetRoot.render(sheet(() => {})))
  const option = [...box.querySelectorAll('button.lrow')].find(b => b.querySelector('.lrow-t')?.textContent === label)
  expect(option).toBeTruthy()
  act(() => { option.click() })
  act(() => sheetRoot.unmount())
  box.remove()
}

describe('Settings: one weight step for every exercise', () => {
  it('starts on Automatic and offers no bulk change', () => {
    mount()
    expect(rowOf('Weight step').textContent).toContain('Automatic')
    expect(rowOf('Apply to all exercises')).toBeUndefined()
  })

  it('picks 0.25 kg for this unit only, then applies it to every exercise after asking how many', () => {
    mount()
    choose('0.25 kg')
    expect(mocks.S.wstep).toEqual({ kg: 0.25 })
    mount()
    const apply = rowOf('Apply to all exercises')
    expect(apply.textContent).toContain('2 exercises have a step of their own.')
    act(() => { apply.click() })
    const ask = confirmSheet.mock.calls.at(-1)[0]
    expect(ask.title).toBe('Use 0.25 kg for every exercise?')
    expect(ask.message).toContain('2 exercises in your routines change to it.')
    act(() => ask.onConfirm())
    expect(mocks.S.routines[0].ex.map(e => e.inc)).toEqual([undefined, undefined, undefined])
    mount()
    expect(rowOf('Apply to all exercises')).toBeUndefined()
  })

  it('offers 0.1 in pounds as well', () => {
    mocks.S.unit = 'lb'
    mount()
    choose('0.1 lb')
    expect(mocks.S.wstep).toEqual({ lb: 0.1 })
  })
})
