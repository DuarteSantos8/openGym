// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock('../lib/sound.js', () => ({ unlock: vi.fn(), beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
import IntervalGroup from './IntervalGroup.jsx'
import { stopIntervals, useIntervalRun } from '../store/interval-run.js'
import RestTimer, { adjustRestSheet } from './RestTimer.jsx'
import Modals from './Modals.jsx'
import { useStore } from '../store/useStore.js'
import { useUI, restoreWork, WORK_KEY } from '../store/useUI.js'

let root, el, original
const entry = (id, sg, count = 2) => ({ id, sg, target: { mode: 'time', sgMode: 'interval', sgIntervalRest: 1, sgRest: 2 }, sets: Array.from({ length: count }, () => ({ sec: 2, done: false })) })
const advance = ms => act(() => vi.advanceTimersByTime(ms))
const state = () => useStore.getState().S.active
const start = () => act(() => [...el.querySelectorAll('button')].find(b => b.textContent.includes('Start intervals')).click())
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  original = useStore.getState().S
  useStore.setState({ S: { ...original, sound: false, timedSetOvertime: true, active: { id: 'interval-test', cur: 0, entries: [entry('0025', 'g'), entry('0007', 'g'), entry('0001', null)] } } })
  useUI.setState({ sheets: [], work: null, timer: null })
  el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el)
  act(() => root.render(<IntervalGroup unit={[0, 1]} onComplete={(idx, i, elapsed) => useStore.getState().update(s => {
    s.active.entries[idx].sets[i].sec = elapsed
    s.active.entries[idx].sets[i].done = true
  })} />))
})
afterEach(() => {
  act(() => { stopIntervals(); root.unmount() })
  el.remove()
  useUI.getState().stopWork(); useUI.getState().stopRest()
  useStore.setState({ S: original })
  vi.useRealTimers()
})
it('runs two rounds with exercise and round rests, overrides overtime, and stops at the group boundary', () => {
  start()
  expect(useUI.getState().work.overtime).toBe(false)
  advance(2000)
  expect(state().entries[0].sets[0].done).toBe(true)
  expect(useUI.getState().timer.total).toBe(1)
  advance(1000); expect(useUI.getState().work.owner.idx).toBe(1)
  advance(2000); expect(useUI.getState().timer.total).toBe(2)
  advance(2000); expect(useUI.getState().work.owner.idx).toBe(0)
  advance(2000); advance(1000); advance(2000)
  expect(state().entries.slice(0, 2).every(e => e.sets.every(s => s.done))).toBe(true)
  expect(state().entries[2].sets.some(s => s.done)).toBe(false)
  expect(useUI.getState().work).toBeNull()
})
it('continues the whole group while hidden', () => {
  start(); advance(1000)
  act(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  advance(12000)
  expect(state().entries.slice(0, 2).every(e => e.sets.every(s => s.done))).toBe(true)
  expect(useUI.getState().work).toBeNull()
})
it('stops on a replacement workout and never writes to it', () => {
  start()
  act(() => useStore.getState().update(s => { s.active.id = 'replacement' }))
  advance(5000)
  expect(state().entries[0].sets[0].done).toBe(false)
})

it.each(['visibilitychange', 'pagehide'])('keeps recovery through %s and catches up after suspended ticks', event => {
  start(); advance(2000)
  act(() => useUI.getState().addRest(30))
  const endsAt = useUI.getState().timer.endsAt
  act(() => {
    // pagehide can arrive before visibilitychange reports hidden.
    if (event === 'visibilitychange') Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    ;(event === 'pagehide' ? window : document).dispatchEvent(new Event(event))
  })
  expect(useUI.getState().timer?.endsAt).toBe(endsAt)
  act(() => {
    vi.setSystemTime(Date.now() + 5000)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(useUI.getState().timer?.left).toBe(26)
  advance(26000)
  expect(useUI.getState().work?.owner.idx).toBe(1)
  advance(10000)
  expect(state().entries.slice(0, 2).every(e => e.sets.every(s => s.done))).toBe(true)
})
it('stops on an exercise edit but not on a sheet', () => {
  start()
  act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].sec = 10 }))
  expect(useUI.getState().work).toBeNull()
  start()
  act(() => useUI.setState({ sheets: [{ id: 'settings' }] }))
  expect(useUI.getState().work).not.toBeNull()
})
it('does not restore or complete an automatic hold after a reload', () => {
  localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() - 1000, total: 2, owner: { idx: 0, i: 0, id: '0025', interval: 'old-run' } }))
  expect(restoreWork()).toBe(false)
  expect(state().entries[0].sets[0].done).toBe(false)
})
it('continues every remaining set after leaving the workout', () => {
  start(); advance(2000)
  act(() => useUI.getState().addRest(30))
  const endsAt = useUI.getState().timer.endsAt
  act(() => root.render(null))
  expect(useUI.getState().timer?.endsAt).toBe(endsAt)
  advance(5000)
  expect(useUI.getState().timer?.left).toBe(26)
  advance(26000)
  expect(useUI.getState().work?.owner.idx).toBe(1)
  advance(10000)
  expect(state().entries.slice(0, 2).every(e => e.sets.every(s => s.done))).toBe(true)
})

it('still stops its rest when Stop intervals is explicitly pressed', () => {
  start(); advance(2000)
  act(() => el.querySelector('button').click())
  expect(useUI.getState().timer).toBeNull()
  advance(5000)
  expect(state().entries[1].sets[0].done).toBe(false)
})

it('keeps an interval rest running when its editor is swiped closed unchanged', () => {
  start(); advance(2000)
  act(() => useUI.getState().addRest(30))
  const endsAt = useUI.getState().timer.endsAt
  const overlay = document.createElement('div')
  document.body.appendChild(overlay)
  const overlayRoot = createRoot(overlay)
  vi.spyOn(history, 'go').mockImplementation(() => {})
  try {
    act(() => overlayRoot.render(<><RestTimer /><Modals /></>))
    act(() => adjustRestSheet())
    expect(useUI.getState().timer?.endsAt).toBe(endsAt)
    advance(1000)
    const sheet = overlay.querySelector('.sheet')
    act(() => {
      sheet.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 100 }))
      sheet.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 220 }))
      sheet.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 220 }))
    })
    advance(200)
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().timer?.endsAt).toBe(endsAt)
    expect(overlay.querySelector('#timer .t').textContent).toBe('0:30')
    advance(30000)
    expect(useUI.getState().work?.owner.idx).toBe(1)
  } finally {
    act(() => overlayRoot.unmount())
    overlay.remove()
    useUI.setState({ sheets: [] })
    vi.restoreAllMocks()
  }
})

it('continues through work and rest while a sheet is open', () => {
  start(); advance(2000)
  let editor
  act(() => { editor = useUI.getState().openSheet(() => null) })
  advance(5000)
  expect(state().entries[1].sets[0].done).toBe(true)
  act(() => editor.close())
  advance(10000)
  expect(useIntervalRun.getState().run).toBeNull()
})

it('still cancels a resting interval if its workout is edited under a sheet', () => {
  start(); advance(2000)
  act(() => adjustRestSheet())
  act(() => useStore.getState().update(s => { s.active.entries[0].sets[1].sec = 10 }))
  expect(useUI.getState().timer).toBeNull()
  act(() => useUI.getState().closeAll())
  advance(5000)
  expect(useUI.getState().work).toBeNull()
})

it('prepares once without logging a set, uses group work time, and allows zero round rest', () => {
  act(() => useStore.getState().update(s => s.active.entries.slice(0, 2).forEach(e => Object.assign(e.target, { sgPrep: 3, sgWork: 4, sgRoundRest: 0 }))))
  start()
  expect(useUI.getState().work.label).toBe('Preparation before starting')
  advance(3000)
  expect(state().entries[0].sets[0].done).toBe(false)
  expect(useUI.getState().work.total).toBe(4)
  advance(4000); advance(1000); advance(4000)
  expect(useUI.getState().work.owner.idx).toBe(0)
  expect(useUI.getState().work.owner.i).toBe(1)
  expect(useUI.getState().work.total).toBe(4)
})
it('stopping preparation leaves every set unfinished', () => {
  act(() => useStore.getState().update(s => { s.active.entries[0].target.sgPrep = 3 }))
  start(); advance(1000)
  act(() => el.querySelector('button').click())
  advance(5000)
  expect(state().entries.every(e => e.sets.every(s => !s.done))).toBe(true)
  expect(useUI.getState().work).toBeNull()
})

it('a manually started replacement timer is not cancelled by the old sequence', () => {
  start(); advance(2000)
  act(() => useUI.getState().startRest(90, 2))
  expect(useIntervalRun.getState().run).toBeNull()
  expect(useUI.getState().timer).toMatchObject({ total: 90, forIdx: 2 })
})

it('holds a paused rest without progressing, then continues when resumed', () => {
  start(); advance(2000)
  act(() => useUI.getState().pauseRest())
  advance(60000)
  expect(state().entries[1].sets[0].done).toBe(false)
  expect(useUI.getState().timer.paused).toBe(true)
  act(() => useUI.getState().resumeRest())
  advance(1000)
  expect(useUI.getState().work?.owner.idx).toBe(1)
})
