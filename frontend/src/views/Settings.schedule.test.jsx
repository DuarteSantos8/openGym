// @vitest-environment happy-dom
// Settings → Plan & schedule → How you train: the control's selection is DERIVED from the live queue (never stored),
// Fixed Week clears the pass after confirming and keeps the rotation, and Rotation
// either starts a pass from the saved sequence or sends you to Plan.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
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
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(),
}))
vi.mock('../lib/update.js', () => ({ checkForUpdate: vi.fn(), downloadAndInstall: vi.fn() }))

import { confirmSheet } from '../sheets.jsx'
import { todayISO } from '../lib/format.js'

const routines = [{ id: 'a', name: 'A', emoji: null, ex: [] }, { id: 'b', name: 'B', emoji: null, ex: [] }]
const baseS = over => ({
  unit: 'kg', lang: 'en', weekStart: 1, checkIn: true, theme: 'dark', accent: 'lime', restSec: 90,
  workoutView: 'cards', wc: {}, reminder: { on: false, time: '08:00', tz: null }, effort: null,
  routines, week: {}, dayPlan: {}, workouts: [], bodyweight: [], exWeights: {}, customEx: [],
  equipProfiles: [], activeEquipId: null, gymCards: [], favEx: [], exNotes: {}, barWeights: {},
  queue: null, rotation: null, scheduleMode: null, active: null, ...over,
})

let host, root
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.nav = vi.fn(); confirmSheet.mockClear()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = over => { mocks.S = baseS(over); act(() => root.render(<Settings page="plan" />)) }
// the two-option Segmented rendered by the How you train row
const seg = () => [...host.querySelectorAll('button')].filter(b => ['Fixed Week', 'Rotation'].includes(b.textContent))
const pick = label => act(() => seg().find(b => b.textContent === label).dispatchEvent(new MouseEvent('click', { bubbles: true })))
const selected = () => seg().find(b => b.className.includes('on'))?.textContent
const buildRow = () => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Build your loop in Plan'))

describe('Settings — How you train (Plan & schedule)', () => {
  it('selects Fixed Week without a usable queue, Rotation with one this app manages', () => {
    mount()
    expect(selected()).toBe('Fixed Week')
    mount({
      queue: { ids: ['a', 'b'], since: Date.now(), startsOn: todayISO(), label: 'Rotation', rotationId: 'r1' },
      rotation: { id: 'r1', sequence: ['a', 'b'], label: 'Rotation' },
    })
    expect(selected()).toBe('Rotation')
  })

  it('a malformed queue selects Fixed Week, never Rotation', () => {
    mount({ queue: { ids: ['gone'], since: Date.now() } })
    expect(selected()).toBe('Fixed Week')
  })

  it('Rotation stays selected on S.scheduleMode alone, with no live queue at all', () => {
    mount({ scheduleMode: 'rotation' })
    expect(selected()).toBe('Rotation')
  })

  it('a planner-written queue makes How you train read-only text, not a control to flip', () => {
    // No rotationId, and no S.rotation to match it against — this app does not own the queue.
    mount({ queue: { ids: ['a', 'b'], since: Date.now(), startsOn: todayISO(), label: 'US W1' } })
    expect(seg()).toEqual([])
    expect(host.textContent).toContain('Externally managed')
  })

  it('Fixed Week asks first, then drops the pass, sweeps its future pins, and keeps the sequence', () => {
    mount({
      queue: { ids: ['a', 'b'], since: Date.now(), startsOn: todayISO(), label: 'Rotation', rotationId: 'r1' },
      rotation: { id: 'r1', sequence: ['a', 'b'], label: 'Rotation' },
      week: { 1: ['a'] },
      // a pin dated today names a session the dropped pass no longer has to give — left as a
      // plain override, history.js would otherwise read it as a routine choice nobody made
      dayPlan: { [todayISO()]: 'a', '2020-01-01': 'b' },
    })
    pick('Fixed Week')
    expect(mocks.S.queue).not.toBe(null)          // nothing happens before the confirmation
    expect(confirmSheet.mock.calls[0][0]).toMatchObject({ title: 'Back to a fixed week?', confirmText: 'Use Fixed Week' })   // Plan's words
    act(() => confirmSheet.mock.calls[0][0].onConfirm())
    expect(mocks.S.queue).toBe(null)
    expect(mocks.S.scheduleMode).toBe('week')
    expect(mocks.S.rotation.sequence).toEqual(['a', 'b'])
    expect(mocks.S.week).toEqual({ 1: ['a'] })
    expect(mocks.S.dayPlan).toEqual({ '2020-01-01': 'b' })   // today's pin swept; the past one is not this pass's business
  })

  it('Fixed Week with nothing running switches at once, as on Plan', () => {
    mount({ scheduleMode: 'rotation' })
    pick('Fixed Week')
    expect(confirmSheet).not.toHaveBeenCalled()
    expect(mocks.S.scheduleMode).toBe('week')
  })

  it('Rotation starts a fresh pass from the saved sequence', () => {
    mount({ rotation: { id: 'r1', sequence: ['a', 'b'], label: 'My split' } })
    pick('Rotation')
    expect(mocks.S.queue.ids).toEqual(['a', 'b'])
    expect(mocks.S.queue.rotationId).toBe('r1')
    expect(mocks.S.queue.startsOn).toBe(todayISO())
    expect(mocks.S.scheduleMode).toBe('rotation')
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('Rotation with nothing saved stays selected and stays here, with a row that leads to Plan', () => {
    mount()
    expect(buildRow()).toBeUndefined()
    pick('Rotation')
    expect(mocks.S.queue).toBe(null)
    expect(mocks.S.scheduleMode).toBe('rotation')
    expect(mocks.nav).not.toHaveBeenCalled()
    act(() => root.render(<Settings page="plan" key="again" />))
    act(() => buildRow().click())
    expect(mocks.nav).toHaveBeenCalledWith('/plan')
  })

  it('a malformed queue is not started over; the row leads to Plan, which does the recovery', () => {
    mount({ queue: { ids: ['gone'], since: Date.now() }, rotation: { id: 'r1', sequence: ['a'], label: 'x' } })
    pick('Rotation')
    expect(mocks.S.queue.ids).toEqual(['gone'])   // untouched: Plan does the recovery
    expect(mocks.nav).not.toHaveBeenCalled()
    act(() => root.render(<Settings page="plan" key="again" />))
    expect(buildRow()).toBeTruthy()
  })

  it('no row to Plan while a loop is running', () => {
    mount({ queue: { ids: ['a', 'b'], since: Date.now(), rotationId: 'r1' }, rotation: { id: 'r1', sequence: ['a', 'b'], label: 'x' } })
    expect(buildRow()).toBeUndefined()
  })
})
