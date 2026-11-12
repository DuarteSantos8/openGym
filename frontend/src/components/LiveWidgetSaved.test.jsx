// @vitest-environment happy-dom
// Settings > Workout > Live widget after its rework (1.4.5), from two sides the page's own tests
// do not take: a profile saved before the rework comes up as it was saved (v2 as stored, v1 through
// its migration, a kind's own picks as "Own setup" on), and every control of the page reaches the
// thing it claims to change: the payload the phone draws (lib/live-activity.js buildLiveActivity,
// through the samples), or the strip on the workout screen for the one switch that is the app's.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, navs: [], toasts: [], sheets: [] }
  state.snapshot = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ timer: null, toast: (m, o) => mocks.toasts.push([m, o]), openSheet: fn => mocks.sheets.push(fn) })
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
  mocks.sheets = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

const moment = name => [...host.querySelectorAll('.gl-moments button')].find(b => b.textContent === name)
const tab = name => [...host.querySelectorAll('.gl-surface button')].find(b => b.textContent === name)
const rowOf = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const subOf = title => rowOf(title)?.querySelector('.lrow-s')?.textContent
const said = () => host.querySelector('.gl-stage').getAttribute('aria-label')
const flip = async title => { await click(rowSwitch(title)); await rerender(<LiveWidgetSettings />) }

const { sampleLive } = await import('../lib/live-samples.js')
const { glanceOf, normalizeGlance, detailsFor } = await import('../lib/live-glance.js')

// What the phone is sent for the three moments and a superset, with the profile as it is now.
const payload = () => ['strength', 'rest', 'done', 'superset'].map(m => JSON.stringify(sampleLive(mocks.S, m, { glance: glanceOf(mocks.S), now: 1e12 }))).join('\n')
const checked = title => rowSwitch(title).getAttribute('aria-checked') === 'true'

describe('a profile saved before the rework', () => {
  it('v2 as stored: every switch stands where it was left, and opening the page writes nothing', async () => {
    const stored = { v: 2, look: 'clean', show: { heart: false, next: false, elapsed: true, picture: true, effort: false, record: false, calories: true }, buttons: { adjust: true, addRest: false, nextEx: false, pause: true }, card: true, kinds: { hold: { b: ['pause'] } } }
    mocks.S.liveWidget = structuredClone(stored)
    await render(<LiveWidgetSettings />)
    const want = { 'Heart rate': false, 'What’s next': false, 'Time since start': true, 'Exercise picture': true, 'Effort (RIR)': false, 'Record hints': false, Calories: true, 'Weight and reps': true, '+15 s on rests': false, 'Next exercise': false, Pause: true, 'Show a strip in the workout': true }
    for (const [title, on] of Object.entries(want)) expect(checked(title), title).toBe(on)
    expect(host.querySelector('.gl-look button.on').textContent).toBe('Clean')
    expect(rowOf('Per exercise type').querySelector('.lrow-v').textContent).toBe('Holds')
    expect(mocks.S.liveWidget).toEqual(stored)
  })
  it('a partial or damaged v2 keeps what it says and takes the defaults for the rest', async () => {
    mocks.S.liveWidget = { look: 'nonsense', show: { calories: true, heart: 'yes' }, buttons: null, kinds: { lift: { b: ['pause', 'made-up'] }, yoga: { d: [] } } }
    await render(<LiveWidgetSettings />)
    expect(checked('Calories')).toBe(true)
    expect(checked('Heart rate')).toBe(true)
    expect(checked('+15 s on rests')).toBe(true)
    expect(host.querySelector('.gl-look button.on').textContent).toBe('Detailed')
    expect(rowOf('Per exercise type').querySelector('.lrow-v').textContent).toBe('Strength')
    // The first flip stores a clean v2 with the old choices in it.
    await flip('Pause')
    expect(mocks.S.liveWidget).toMatchObject({ v: 2, look: 'detailed', kinds: { lift: { b: ['pause'] } } })
    expect(mocks.S.liveWidget.show.calories).toBe(true)
    expect(mocks.S.liveWidget.kinds.yoga).toBeUndefined()
  })
  it('only the v1 builder’s layout: its choices come up migrated, and stay until a switch is flipped', async () => {
    mocks.S.liveLayout = LL.presetLayout('everything')
    await render(<LiveWidgetSettings />)
    for (const title of ['Heart rate', 'Calories', 'Time since start', 'Exercise picture', 'Weight and reps', 'Pause', 'Next exercise', '+15 s on rests']) expect(checked(title), title).toBe(true)
    expect(mocks.S.liveWidget).toBeUndefined()
    await flip('Calories')
    expect(mocks.S.liveWidget.show).toMatchObject({ calories: false, heart: true, elapsed: true, picture: true })
    expect(mocks.S.liveWidget.buttons).toMatchObject({ adjust: true, pause: true })
  })
  it('a kind with its own picks opens Per exercise type with “Own setup” on and those picks ticked', async () => {
    mocks.S.liveWidget = { kinds: { lift: { d: ['notes'], b: ['pause', 'addSet'] } } }
    await render(<LiveWidgetCustomise />)
    const row = name => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === name)
    const on = name => row(name).querySelector('[role="switch"]').getAttribute('aria-checked') === 'true'
    expect(on('Own setup for Strength')).toBe(true)
    expect(on('Notes')).toBe(true)
    expect(on('Effort')).toBe(false)
    expect(on('Pause')).toBe(true)
    expect(on('Add set')).toBe(true)
    expect(on('Next exercise')).toBe(false)
  })
  it('the master switch is no part of the profile: nothing of it is ever written to S', async () => {
    mocks.S.liveWidget = { look: 'clean' }
    await render(<LiveWidgetSettings />)
    await flip('Pause')
    expect(Object.keys(mocks.S.liveWidget).sort()).toEqual(['buttons', 'card', 'kinds', 'look', 'show', 'v'])
  })
})

describe('every control reaches what it claims to change', () => {
  const ROWS = ['Weight and reps', 'Next exercise', 'Pause', 'Effort (RIR)', 'Record hints', 'Exercise picture', 'What’s next', '+15 s on rests', 'Heart rate', 'Calories', 'Time since start']
  it('each switch of the page changes the payload the phone draws, both ways', async () => {
    await render(<LiveWidgetSettings />)
    expect([...host.querySelectorAll('.gl-settings [role="switch"]')].map(x => x.getAttribute('aria-label'))).toEqual([...ROWS.map(x => x.replace(' (RIR)', '')), 'Show a strip in the workout'])
    for (const title of ROWS) {
      const before = payload()
      await flip(title)
      const flipped = payload()
      expect(flipped, title).not.toBe(before)
      await flip(title)
      expect(payload(), title + ' back').toBe(before)
    }
  })
  it('the look changes the payload too', async () => {
    await render(<LiveWidgetSettings />)
    const before = payload()
    await click([...host.querySelectorAll('.gl-look button')].find(b => b.textContent === 'Clean'))
    expect(mocks.S.liveWidget.look).toBe('clean')
    expect(payload()).not.toBe(before)
  })
  it('the strip switch is the app’s own: it leaves the phone’s payload alone and sets what LiveCard reads', async () => {
    await render(<LiveWidgetSettings />)
    const before = payload()
    await flip('Show a strip in the workout')
    expect(payload()).toBe(before)
    expect(glanceOf(mocks.S).card).toBe(true)
  })
  it('Record hints sets the detail the Home Screen widget’s line is built from (lib/widget-logger.js), as Android’s row says', async () => {
    mocks.S.liveWidget = normalizeGlance(null)
    expect(detailsFor(glanceOf(mocks.S), 'lift')).toContain('record')
    await render(<LiveWidgetSettings />)
    await flip('Record hints')
    expect(detailsFor(glanceOf(mocks.S), 'lift')).not.toContain('record')
  })
  it('Per exercise type: each pick of a kind with its own setup changes that kind’s payload', async () => {
    mocks.S.liveWidget = { buttons: { adjust: true }, kinds: { lift: { d: [], b: [] } } }
    await render(<LiveWidgetCustomise />)
    const rows = () => [...host.querySelectorAll('.lrow')].slice(1)
    const names = rows().map(r => r.querySelector('.lrow-t').textContent)
    expect(names.length).toBeGreaterThan(8)
    const stored = () => JSON.stringify(mocks.S.liveWidget.kinds.lift)
    for (const name of names) {
      const was = stored()
      const before = payload()
      await click(rows().find(r => r.querySelector('.lrow-t').textContent === name).querySelector('[role="switch"]'))
      await rerender(<LiveWidgetCustomise />)
      expect(stored(), name).not.toBe(was)
      // Equipment and Notes wait for an exercise that has them, Warm-up for a warm-up row: the
      // samples have none, and the rows say what they wait for (detailNote). All others show now.
      if (!['Equipment', 'Notes', 'Warm-up'].includes(name)) expect(payload(), name).not.toBe(before)
    }
  })
})
