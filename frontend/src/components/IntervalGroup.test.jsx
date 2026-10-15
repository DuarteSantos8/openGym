// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock('../lib/sound.js', () => ({ unlock: vi.fn(), beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
import IntervalGroup from './IntervalGroup.jsx'
import { useStore } from '../store/useStore.js'
import { useUI, restoreWork, WORK_KEY } from '../store/useUI.js'

let root, el, original
const entry = (id, sg, count = 2) => ({ id, sg, target: { mode: 'time', sgMode: 'interval', sgIntervalRest: 1, sgRest: 2 }, sets: Array.from({ length: count }, () => ({ sec: 2, done: false })) })
const advance = ms => act(() => vi.advanceTimersByTime(ms))
const state = () => useStore.getState().S.active
const start = () => act(() => [...el.querySelectorAll('button')].find(b => b.textContent.includes('Start intervals')).click())
beforeEach(() => {
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
  act(() => root.unmount())
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
it('stops when hidden without logging the interrupted set or restarting on return', () => {
  start(); advance(1000)
  act(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  advance(10000)
  expect(state().entries[0].sets[0].done).toBe(false)
  expect(useUI.getState().work).toBeNull()
})
it('stops on a replacement workout and never writes to it', () => {
  start()
  act(() => useStore.getState().update(s => { s.active.id = 'replacement' }))
  advance(5000)
  expect(state().entries[0].sets[0].done).toBe(false)
})
it('stops on a sheet or an exercise edit', () => {
  start()
  act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].sec = 10 }))
  expect(useUI.getState().work).toBeNull()
  start()
  act(() => useUI.setState({ sheets: [{ id: 'settings' }] }))
  expect(useUI.getState().work).toBeNull()
})
it('does not restore or complete an automatic hold after a reload', () => {
  localStorage.setItem(WORK_KEY, JSON.stringify({ endsAt: Date.now() - 1000, total: 2, owner: { idx: 0, i: 0, id: '0025', interval: 'old-run' } }))
  expect(restoreWork()).toBe(false)
  expect(state().entries[0].sets[0].done).toBe(false)
})
it('stops its rest when unmounted', () => {
  start(); advance(2000)
  act(() => root.render(null))
  expect(useUI.getState().timer).toBeNull()
  advance(5000)
  expect(state().entries[1].sets[0].done).toBe(false)
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
