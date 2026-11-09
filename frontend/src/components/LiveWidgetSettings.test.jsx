// @vitest-environment happy-dom
// Settings > Workout > Live widget (v2): the preview draws the real glance for the moment picked,
// every switch writes S.liveWidget (never S.liveLayout), and Per exercise type toggles one choice
// per tap, for its own kind only.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, navs: [], toasts: [] }
  state.snapshot = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ timer: null, toast: (m, o) => mocks.toasts.push([m, o]) })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a) => mocks.navs.push(a) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, nativePlatform: async () => null }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const { default: LiveWidgetSettings, LiveWidgetCustomise } = await import('./LiveWidgetSettings.jsx')
const LL = await import('../lib/live-layout.js')

let host, root
const render = async el => { await act(async () => { root.render(el) }) }
const rerender = async el => render(el)
const rowSwitch = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)?.querySelector('[role="switch"]')
const click = async el => { await act(async () => { el.click() }) }

beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, effort: 'rir', lang: 'en', workouts: [], routines: [], exWeights: {} }
  mocks.navs = []
  mocks.toasts = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Live widget settings', () => {
  it('previews a moment and switches between them', async () => {
    await render(<LiveWidgetSettings />)
    expect(host.querySelector('.gl-lock .gl-big').textContent).toBe('80 kg × 8')
    const resting = [...host.querySelectorAll('.gl-sample')].find(b => b.textContent === 'Resting')
    await click(resting)
    expect(host.querySelector('.gl-lock.gl-rest')).toBeTruthy()
    expect(host.querySelector('.gl-countdown').textContent).toMatch(/^\d:\d\d$/)
    const hold = [...host.querySelectorAll('.gl-sample')].find(b => b.textContent === 'Timed hold')
    await click(hold)
    expect(host.querySelector('.gl-lock.gl-hold')).toBeTruthy()
  })
  it('each switch writes v2 and leaves a v1 layout alone', async () => {
    mocks.S.liveLayout = LL.presetLayout('lifter')
    const v1 = JSON.stringify(mocks.S.liveLayout)
    await render(<LiveWidgetSettings />)
    // Migrated: Lifter had − and +.
    expect(rowSwitch('Weight and reps').getAttribute('aria-checked')).toBe('true')
    await click(rowSwitch('Calories'))
    expect(mocks.S.liveWidget.show.calories).toBe(true)
    expect(mocks.S.liveWidget.buttons.adjust).toBe(true)
    expect(JSON.stringify(mocks.S.liveLayout)).toBe(v1)
  })
  it('the strip switch adds the In the app preview', async () => {
    await render(<LiveWidgetSettings />)
    expect([...host.querySelectorAll('.gl-surface button')].map(b => b.textContent)).not.toContain('In the app')
    await click(rowSwitch('Show a strip in the workout'))
    await rerender(<LiveWidgetSettings />)
    expect(mocks.S.liveWidget.card).toBe(true)
    expect([...host.querySelectorAll('.gl-surface button')].map(b => b.textContent)).toContain('In the app')
  })
  it('back to the defaults, with an undo', async () => {
    mocks.S.liveWidget = { look: 'clean' }
    await render(<LiveWidgetSettings />)
    const reset = [...host.querySelectorAll('.lrow')].find(r => r.textContent === 'Back to the defaults')
    await click(reset)
    expect(mocks.S.liveWidget.look).toBe('detailed')
    const [, opts] = mocks.toasts.pop()
    await act(async () => opts.onAction())
    expect(mocks.S.liveWidget).toEqual({ look: 'clean' })
  })
  it('opens Per exercise type', async () => {
    await render(<LiveWidgetSettings />)
    await click([...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Per exercise type'))
    expect(mocks.navs).toEqual([['/settings/live-custom']])
  })
})

describe('Per exercise type', () => {
  const row = name => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent.startsWith(name))
  it('one tap toggles one choice, for this kind only', async () => {
    await render(<LiveWidgetCustomise />)
    expect(row('Notes').textContent).toMatch(/Off$/)
    await click(row('Notes'))
    expect(mocks.S.liveWidget.kinds.lift.d).toContain('notes')
    await rerender(<LiveWidgetCustomise />)
    expect(row('Notes').textContent).toMatch(/On$/)
    await click(row('Pause'))
    expect(mocks.S.liveWidget.kinds.lift.b).toContain('pause')
    expect(mocks.S.liveWidget.kinds.hold).toBeUndefined()
    // No button inside a button: the row is the control.
    expect(host.querySelector('button button')).toBeNull()
    await rerender(<LiveWidgetCustomise />)
    await click([...host.querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Use the defaults')))
    expect(mocks.S.liveWidget.kinds.lift).toBeUndefined()
  })
})
