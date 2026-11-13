// @vitest-environment happy-dom
// gm-live (1.4.5): a set that beats a record wears a trophy line the moment it is ticked, with a
// buzz and two notes; the next open set says how close it is. Both have their own switch.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { beep, vibrate } from '../lib/sound.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const BENCH = '0025'

let root, container
beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null }); vi.mocked(beep).mockClear(); vi.mocked(vibrate).mockClear() })
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null })

function mount(patch = {}) {
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', workoutView: 'list', sound: true }, patch)
  S.workouts = [{ id: 'old', d: '2026-10-01', start: new Date('2026-10-01T17:00:00').getTime(), name: 'Push', entries: [
    { id: BENCH, target: { mode: 'reps', sets: 2, reps: 8 }, sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 6, done: true }] },
  ] }]
  S.active = { id: 'a', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0, workoutView: 'list', entries: [
    { id: BENCH, target: { mode: 'reps', sets: 3, reps: 8 }, sets: [
      { w: 80, r: 8, done: true }, { w: 82.5, r: 8, done: false }, { w: 70, r: 6, done: false },
    ] },
  ] }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

describe('records on the set in the workout', () => {
  it('a set matching the record wears nothing; the next open set says it would be one', () => {
    mount()
    expect(container.querySelectorAll('.setrec')).toHaveLength(0)
    const hint = container.querySelector('.setrec-hint')
    expect(hint.textContent).toContain('Heavier than ever')
    expect(hint.textContent).toContain('Beats your best e1RM')
  })
  it('ticking a record set shows the trophy with its kinds, buzzes and cheers', () => {
    mount()
    const tick = container.querySelectorAll('.setrow')[1].querySelector('[role="checkbox"], input[type="checkbox"], button.ck, .ck')
    act(() => { tick.click() })
    const rec = container.querySelector('.setrec')
    expect(rec.textContent).toContain('Record!')
    expect(rec.textContent).toContain('Heaviest yet')
    expect(rec.textContent).toContain('Best e1RM')
    expect(rec.textContent).toContain('Biggest set')
    expect(vibrate).toHaveBeenCalledWith([40, 60, 40, 60, 120])
    expect(vi.mocked(beep).mock.calls.some(c => c[1] === 1760)).toBe(true)
    // The hint moved to the next open set: 70 × 6, under the 8 reps done at 80.
    expect(container.querySelector('.setrec-hint').textContent).toMatch(/% of your best e1RM/)
  })
  it('the switches hide the trophy and the hint, and keep the sound out', () => {
    mount({ liveRecords: false, recordHints: false })
    const tick = container.querySelectorAll('.setrow')[1].querySelector('[role="checkbox"], input[type="checkbox"], button.ck, .ck')
    act(() => { tick.click() })
    expect(container.querySelectorAll('.setrec, .setrec-hint')).toHaveLength(0)
    expect(vibrate).not.toHaveBeenCalledWith([40, 60, 40, 60, 120])
  })
})
