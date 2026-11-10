// @vitest-environment happy-dom
// Settings > Workout > Live widget on a phone: the Dynamic Island tab only on an iPhone that has
// one, and "Try it", which shows the real Live Activity (or Android's notification) with the moment
// previewed, marked a preview, never over a running workout, gone by itself after two minutes.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, calls: [], status: { supported: true, island: false } }
  state.snapshot = () => ({ S: state.S, ready: true, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  state.plugin = {
    status: async () => state.status,
    update: async x => { state.calls.push(['update', x]); return { shown: true } },
    end: async () => { state.calls.push(['end']) },
    drain: async () => ({ events: [] }),
    ack: async () => {},
    addListener: async () => ({ remove () {} }),
  }
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ timer: null, toast: () => {} })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: true, nativePlatform: async () => 'ios' }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => mocks.plugin }))

const { default: LiveWidgetSettings, surfacesFor } = await import('./LiveWidgetSettings.jsx')
const LA = await import('../lib/live-activity.js')

let host, root
const render = async el => { await act(async () => { root.render(el) }) }
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = async el => { await act(async () => { el.click() }) }

beforeEach(() => {
  globalThis.Capacitor = { getPlatform: () => 'ios' }
  mocks.S = { unit: 'kg', restSec: 90, effort: 'rir', lang: 'en', workouts: [], routines: [], exWeights: {} }
  mocks.calls = []
  mocks.status = { supported: true, island: false }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete globalThis.Capacitor; LA._resetLiveActivity(); vi.useRealTimers() })

describe('which surfaces a phone previews', () => {
  it('the Dynamic Island only on an iPhone that has one; unknown means none', () => {
    const ids = (os, st) => surfacesFor(os, st, false).map(x => x.id)
    expect(ids('ios', null)).toEqual(['lock'])
    expect(ids('ios', { island: false })).toEqual(['lock'])
    expect(ids('ios', { island: true })).toEqual(['lock', 'island'])
    expect(ids('android', { island: true })).toEqual(['android'])
    expect(ids(null, null)).toEqual(['lock', 'island', 'android'])
  })
  it('the page asks the plugin and shows the island tab when it says so', async () => {
    mocks.status = { supported: true, island: true }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-surface').textContent).toMatch(/Dynamic Island/)
  })
  it('no island: no tab at all, the Lock Screen is the preview', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-surface')).toBeNull()
    expect(host.querySelector('.gl-lock')).toBeTruthy()
  })
})

describe('Try it', () => {
  const button = () => host.querySelector('.gl-try button')
  it('shows the sample as a preview activity, with the hint, and Stop ends it', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    expect(host.querySelector('.gl-try-hint').textContent).toBe('Lock your phone to see it on the Lock Screen.')
    await click(button())
    await settle()
    const up = mocks.calls.find(c => c[0] === 'update')
    expect(up).toBeTruthy()
    const attrs = JSON.parse(up[1].attributes)
    expect(attrs.pv).toBe(true)
    expect(attrs.wid).toMatch(/^preview-/)
    expect(JSON.parse(up[1].state).cur.exName).toBe('Barbell Bench Press')
    expect(button().textContent).toBe('Stop')
    await click(button())
    await settle()
    expect(mocks.calls.at(-1)).toEqual(['end'])
  })
  it('follows the moment picked while it runs', async () => {
    await render(<LiveWidgetSettings />)
    await settle()
    await click(button())
    await settle()
    await click([...host.querySelectorAll('.gl-sample')].find(b => b.textContent === 'Resting'))
    await settle()
    const last = mocks.calls.filter(c => c[0] === 'update').at(-1)
    expect(JSON.parse(last[1].state).restEndsAt).toBeGreaterThan(Date.now())
  })
  it('never over a running workout: disabled, with the reason', async () => {
    mocks.S.active = { id: 'w1', start: Date.now(), cur: 0, entries: [{ id: '0025', sets: [{ w: 80, r: 8 }] }] }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(button().disabled).toBe(true)
    expect(host.querySelector('.gl-try-hint').textContent).toMatch(/Not while a workout is running/)
    expect(await LA.tryLive({ attributes: {}, state: {} }, mocks.S)).toBe(false)
  })
  it('Live Activities switched off: disabled, says where to turn them on', async () => {
    mocks.status = { supported: false, island: false }
    await render(<LiveWidgetSettings />)
    await settle()
    expect(button().disabled).toBe(true)
    expect(host.querySelector('.gl-try-hint').textContent).toMatch(/Live Activities are off/)
  })
  it('ends by itself after two minutes, and on leaving the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await render(<LiveWidgetSettings />)
    await settle()
    await click(button())
    await settle()
    await act(async () => { vi.advanceTimersByTime(LA.TRY_SECONDS * 1000 + 10) })
    await settle()
    expect(mocks.calls.some(c => c[0] === 'end')).toBe(true)
    mocks.calls = []
    await click(button())
    await settle()
    await act(async () => root.unmount())
    await settle()
    expect(mocks.calls.at(-1)).toEqual(['end'])
    root = createRoot(host)
  })
  it('a workout that started meanwhile keeps its card: ending the preview leaves it alone', async () => {
    LA._setLivePluginForTest(mocks.plugin, mocks.snapshot)
    expect(await LA.tryLive(SMlive(), mocks.S)).toBe(true)
    mocks.S = { ...mocks.S, active: { id: 'w2', entries: [] } }
    mocks.calls = []
    await LA.endTryLive(() => mocks.S)
    expect(mocks.calls).toEqual([])
  })
})

const SM = await import('../lib/live-samples.js')
function SMlive () { return SM.sampleLive(mocks.S, 'strength', { now: Date.now() }) }
