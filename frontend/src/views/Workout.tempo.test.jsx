// @vitest-environment happy-dom
// Tempo in the workout (#572): the exercise's tempo shows as a tag that opens the guide, and a
// set can be given its own from its menu, which the tag then follows.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn(), queueTones: vi.fn(() => () => {}) }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025'
const mounted = []
let root, container
beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null }) })
afterEach(() => {
  act(() => { mounted.splice(0).forEach(r => r.unmount()) })
  if (root) act(() => root.unmount()); container?.remove(); root = container = null
})
function mount(sets, target = { mode: 'reps', sets: 2, reps: 8, tempo: '3-1-1-0' }) {
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', workoutView: 'list' })
  S.active = { id: 'a', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0, workoutView: 'list', entries: [{ id: BENCH, target, sets }] }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}
const renderTop = () => {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const r = createRoot(host)
  mounted.push(r)
  act(() => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const typeInto = (input, v) => act(() => {
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('tempo in the workout', () => {
  it('shows the exercise’s tempo and opens the guide for the set up next', () => {
    mount([{ w: 80, r: 8, done: true }, { w: 80, r: 6, done: false }])
    const tag = container.querySelector('.tempo-tag')
    expect(tag.textContent).toContain('Tempo 3-1-1-0')
    act(() => tag.click())
    const guide = renderTop()
    expect(guide.textContent).toContain('6 reps')
    expect(guide.textContent).toContain('30 s under tension')
  })
  // QA 1.4.5: a per-side set's row holds both sides' reps (12 = 6 a side), and the guide counted all
  // twelve for one arm.
  it('counts one side’s reps for a per-side set, the side up next', () => {
    const side = (r, done) => ({ w: 10, r, done })
    mount([{ w: 10, r: 12, done: false, sides: { L: side(6, true), R: side(5, false) } }], { mode: 'reps', sets: 1, reps: 12, side: true, tempo: '3-1-1-0' })
    act(() => container.querySelector('.tempo-tag').click())
    expect(renderTop().textContent).toContain('5 reps')
  })
  it('no tempo, no tag', () => {
    mount([{ w: 80, r: 8, done: false }], { mode: 'reps', sets: 1, reps: 8 })
    expect(container.querySelector('.tempo-tag')).toBeNull()
  })
  it('a set’s own tempo from its menu, which the tag follows', () => {
    mount([{ w: 80, r: 8, done: true }, { w: 80, r: 8, done: false }])
    act(() => container.querySelectorAll('.setrow .n')[1].click())
    const menu = renderTop()
    act(() => menu.querySelector('.menu-more').click())
    const item = [...menu.querySelectorAll('.menu-item')].find(el => el.querySelector('.tt')?.textContent === 'Tempo')
    act(() => item.click())
    const sheet = renderTop()
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent.trim() === '5-0-X-0').click())
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
    expect(useStore.getState().S.active.entries[0].sets[1].tempo).toBe('5-0-X-0')
    expect(container.querySelector('.tempo-tag').textContent).toContain('5-0-X-0')
  })
})
