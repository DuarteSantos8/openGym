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
    expect(row('Notes').querySelector('.lrow-t').textContent).toMatch(/Off$/)
    await click(row('Notes'))
    expect(mocks.S.liveWidget.kinds.lift.d).toContain('notes')
    await rerender(<LiveWidgetCustomise />)
    expect(row('Notes').querySelector('.lrow-t').textContent).toMatch(/On$/)
    // A pick that waits for something says so, instead of a dead checkmark.
    expect(row('Notes').querySelector('.lrow-s').textContent).toBe('When the exercise has a note.')
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

describe('TestFlight 67 and after: the page itself', () => {
  const row = name => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent.startsWith(name))
  it('the preview sits in a sticky block, with the moments under it', async () => {
    await render(<LiveWidgetSettings />)
    const sticky = host.querySelector('.gl-sticky')
    expect(sticky).toBeTruthy()
    expect(sticky.querySelector('.gl-stage')).toBeTruthy()
    expect(sticky.querySelector('.gl-samples')).toBeTruthy()
    // The switches are outside it, so they scroll under it.
    expect(sticky.querySelector('[role="switch"]')).toBeNull()
  })
  it('switching "Time since start" or "Effort" on changes what the preview says', async () => {
    const said = () => host.querySelector('.gl-stage .vh').textContent
    const lockText = () => host.querySelector('.gl-lock').textContent
    await render(<LiveWidgetSettings />)
    expect(host.querySelector('.gl-elapsed')).toBeNull()
    await click(rowSwitch('Time since start'))
    await rerender(<LiveWidgetSettings />)
    expect(host.querySelector('.gl-elapsed')).toBeTruthy()
    expect(said()).toMatch(/Last set: RIR 2/)
    await click(rowSwitch('Effort (RIR)'))
    await rerender(<LiveWidgetSettings />)
    expect(lockText()).not.toMatch(/Last set/)
  })
  it('Strength set and Resting look different', async () => {
    await render(<LiveWidgetSettings />)
    const pick = async name => click([...host.querySelectorAll('.gl-sample')].find(b => b.textContent === name))
    await pick('Strength set')
    expect(host.querySelector('.gl-countdown')).toBeNull()
    await pick('Resting')
    expect(host.querySelector('.gl-countdown')).toBeTruthy()
    expect(host.querySelector('.gl-lock .gl-kicker').textContent).toBe('Rest')
  })
  it('everything on: steppers, no record line, Log set as an icon', async () => {
    mocks.S.liveWidget = { v: 2, look: 'detailed', show: { heart: true, next: true, elapsed: true, picture: true, effort: true, record: true, calories: true }, buttons: { adjust: true, addRest: true, nextEx: true, pause: true }, card: false, kinds: {} }
    await render(<LiveWidgetSettings />)
    expect(host.querySelectorAll('.gl-lock .gl-step').length).toBe(2)
    expect(host.querySelector('.gl-lock .gl-note')).toBeNull()
    const log = host.querySelector('.gl-lock .gl-primary')
    expect(log.getAttribute('aria-label')).toBe('Log set')
    expect(log.textContent).toBe('')
  })
  it('kinds with their own picks are named on the main page', async () => {
    mocks.S.liveWidget = { kinds: { hold: { b: ['pause'] } } }
    await render(<LiveWidgetSettings />)
    expect(host.textContent).toMatch(/Holds use their own picks from Per exercise type/)
  })
  it('no Try it button on the web', async () => {
    await render(<LiveWidgetSettings />)
    expect(host.querySelector('.gl-try')).toBeNull()
  })
})

