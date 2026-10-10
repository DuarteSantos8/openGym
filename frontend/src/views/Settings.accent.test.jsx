// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { searchSettings } from './settings-pages.js'
import { setRestAccent } from '../lib/rest-alert.js'
import { readableIn } from '../lib/accent.js'

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
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
}))

// The Settings view reads the build-time version constant at render time.
globalThis.__APP_VERSION__ ??= 'test'

vi.mock('../lib/rest-alert.js', () => ({ setRestAccent: vi.fn() }))

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', theme: 'dark', accent: 'lime', workouts: [], routines: [], exWeights: {} }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  setRestAccent.mockClear()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings page="look" />))
const own = () => host.querySelector('.swatch-own')
const picker = () => host.querySelector('.swatch-own input[type="color"]')
// A drag step: the browser sets the value and fires 'input' (React's onChange).
const drag = value => act(() => {
  const input = picker()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
// The picker closing: 'change'.
const release = () => act(() => { picker().dispatchEvent(new Event('change', { bubbles: true })) })
const pick = value => { drag(value); release() }

describe('Settings: your own accent colour', () => {
  it('starts as a rainbow swatch that opens the colour picker', () => {
    mount()
    expect(own().classList.contains('unset')).toBe(true)
    expect(picker()).toBeTruthy()
    expect(picker().getAttribute('aria-label')).toBe('Pick your own color')
  })

  it('picking a colour makes it the accent, and the row says so', () => {
    mount()
    pick('#FF00AA')
    expect(mocks.S.accent).toBe('custom')
    expect(mocks.S.accentCustom).toBe('#ff00aa')
    expect(setRestAccent).toHaveBeenCalledWith('#ff00aa')
    mount()
    expect(host.querySelector('.lrow-v').textContent).toBe('Your own color')
    expect(own().classList.contains('on')).toBe(true)
    expect(own().style.background).toContain('#ff00aa')
  })

  it('dragging only repaints; the colour is saved once, when the picker lets go', () => {
    mount()
    const before = mocks.S
    drag('#ff0000'); drag('#00ff00'); drag('#0000ff')
    expect(mocks.S).toBe(before)                 // no store write per drag step
    expect(setRestAccent).not.toHaveBeenCalled()  // no native call per drag step
    expect(document.documentElement.dataset.accent).toBe('custom')
    expect(document.documentElement.style.getPropertyValue('--acc')).toBe(readableIn('#0000ff', 'dark'))
    release()
    expect(mocks.S.accentCustom).toBe('#0000ff')
    expect(setRestAccent).toHaveBeenCalledTimes(1)
    expect(setRestAccent).toHaveBeenCalledWith('#0000ff')
    mount()                                       // the store re-renders the row
    release()                                     // a second change with nothing new: no second save
    expect(setRestAccent).toHaveBeenCalledTimes(1)
  })

  it('saves after the picker rests, for a browser that sends no change', () => {
    vi.useFakeTimers()
    try {
      mount()
      drag('#ff8800')
      expect(mocks.S.accentCustom).toBe(undefined)
      act(() => vi.advanceTimersByTime(450))
      expect(mocks.S.accentCustom).toBe('#ff8800')
      expect(setRestAccent).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })

  it('a colour still being dragged is saved when Settings closes', () => {
    mount()
    drag('#336699')
    act(() => root.unmount())
    expect(mocks.S.accentCustom).toBe('#336699')
    root = createRoot(host)
  })

  it('a preset in between keeps the colour, and one tap brings it back', () => {
    mocks.S.accent = 'custom'; mocks.S.accentCustom = '#123456'
    mount()
    act(() => host.querySelector('.swatch[aria-label="Blue"]').click())
    expect(mocks.S.accent).toBe('sky')
    expect(mocks.S.accentCustom).toBe('#123456')
    mount()
    expect(picker()).toBe(null)   // not the accent now: a tap selects it, no picker
    act(() => own().click())
    expect(mocks.S.accent).toBe('custom')
    expect(mocks.S.accentCustom).toBe('#123456')
    mount()
    expect(picker().getAttribute('aria-label')).toBe('Change your own color')
  })

  it('says when the colour is drawn lighter in dark mode', () => {
    mocks.S.accent = 'custom'; mocks.S.accentCustom = '#000033'
    mount()
    expect(host.textContent).toContain('A touch lighter in dark mode, so you can still read it.')
    expect(host.textContent).not.toContain('A touch darker in light mode')
    mocks.S.accentCustom = '#0a84ff'
    mount()
    expect(host.querySelector('.swatch-note')).toBe(null)
  })

  it('says so when a grey is drawn darker in light mode', () => {
    mocks.S.accent = 'custom'; mocks.S.accentCustom = '#ffffff'
    mount()
    expect(host.textContent).toContain('Greys show darker in light mode, so buttons don’t look switched off.')
    expect(host.textContent).not.toContain('A touch')
  })

  it('ignores a value that is not a colour', () => {
    mocks.S.accent = 'custom'; mocks.S.accentCustom = 'red;}'
    mount()
    expect(host.querySelector('.lrow-v').textContent).toBe('Monochrome')
    expect(own().classList.contains('unset')).toBe(true)
  })

  it('the settings search finds it', () => {
    for (const q of ['custom color', 'own color', 'picker', 'hex']) {
      expect(searchSettings(q, {}).map(h => h.title), q).toContain('Accent color')
    }
  })
})
