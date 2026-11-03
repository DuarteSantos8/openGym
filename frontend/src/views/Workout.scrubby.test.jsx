// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { withExUnit } from '../lib/ex-unit.js'
import { makeSideSet } from '../lib/workout-model.js'
import { vibrate } from '../lib/sound.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, writes
const row = (over = {}) => ({ w: 60, r: 8, done: false, ...over })
const entry = (sets = [row(), row()], target = {}, id = '0025') => ({ id, target: { sets: sets.length, reps: 8, mode: 'reps', ...target }, sets })
function mount(layout = 'cards', item = entry(), extra = {}) {
  const S = { ...structuredClone(DEF), wc: { ...DEF.wc, scrubby: true }, ...extra }
  S.active = { id: 'scrub-test', d: '2026-11-03', start: Date.now(), name: 'Scrub', cur: 0, workoutView: layout, entries: [item] }
  useStore.setState({ S, user: null })
  writes = vi.spyOn(useStore.getState(), 'update')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
  writes.mockClear()
}
const sets = () => useStore.getState().S.active.entries[0].sets
const pointer = (el, name, y = 100) => act(() => (el.matches('input') ? el.parentElement.querySelector('.scrubby-hit') || el : el).dispatchEvent(new PointerEvent(name, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: y, bubbles: true, cancelable: true })))
const begin = el => { pointer(el, 'pointerdown'); act(() => vi.advanceTimersByTime(300)); pointer(el, 'pointermove', 78) }
const end = el => pointer(el, 'pointerup', 78)
const field = () => host.querySelector('.stp input')
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); vi.clearAllMocks()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
})
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); root = host = null
  useUI.getState().stopRest(); vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers()
})

describe('workout scrub integration', () => {
  it.each(['cards', 'list', 'compact', 'focus'])('%s: previews locally then performs one numeric edit and cascades weights', layout => {
    mount(layout)
    const input = field()
    begin(input)
    expect(input.value).toBe('62.5'); expect(sets().map(s => s.w)).toEqual([60, 60]); expect(writes).not.toHaveBeenCalled()
    end(input)
    expect(sets().map(s => s.w)).toEqual([62.5, 62.5]); expect(writes).toHaveBeenCalledOnce()
    expect(sets()[0].weightOrigin).toBe('manual')
    expect(sets()[0].done).toBe(false); expect(useUI.getState().timer).toBeNull()
    expect(vibrate).toHaveBeenCalledWith(6)
  })
  it('scrubs lb display values and stores kg through the existing unit boundary', () => {
    mount('list', entry([row({ w: 61.235 }), row({ w: 61.235 })]), { exUnit: withExUnit({}, '0025', 'lb', 1) })
    begin(field()); expect(field().value).toBe('140'); end(field())
    expect(sets().map(s => s.w)).toEqual([63.5029, 63.5029]); expect(writes).toHaveBeenCalledOnce()
  })
  it.each(['cards', 'focus'])('%s: walks irregular owned equipment lists', layout => {
    mount(layout, entry([row({ w: 11 })], { dbLoad: 'each' }, '0289'), { dumbbells: { kg: { weights: [9, 11, 13], _ts: 1 } } })
    begin(field()); expect(field().value).toBe('13'); end(field()); expect(sets()[0].w).toBe(13)
  })
  it.each(['cards', 'list', 'compact', 'focus'])('%s: effort scrub does not complete or start rest; tapping still opens picker', layout => {
    mount(layout, entry(), { effort: 'rir' })
    const effort = host.querySelector('button[aria-label="RIR"]')
    begin(effort); expect(effort.textContent).toBe('0'); expect(writes).not.toHaveBeenCalled(); end(effort)
    expect(sets()[0].rir).toBe(0); expect(sets()[0].done).toBe(false); expect(useUI.getState().timer).toBeNull()
    expect(writes).toHaveBeenCalledOnce(); expect(useUI.getState().sheets).toHaveLength(0)
    act(() => host.querySelector('button[aria-label="RIR"]').click())
    expect(useUI.getState().sheets).toHaveLength(1)
  })
  it.each(['cards', 'list', 'compact', 'focus'])('%s: populated effort previews one tint and commits without completion', layout => {
    mount(layout, entry([row({ rir: 1 })]), { effort: 'rir' })
    const effort = host.querySelector('button[aria-label="RIR"]')
    const surface = () => host.querySelector('.effcell-stp') || host.querySelector('.focus-effort')
    begin(effort); pointer(effort, 'pointermove', 60)
    expect(effort.textContent).toBe('2'); expect(surface().style.color).toBe('var(--yellow)')
    expect(sets()[0].rir).toBe(1); expect(writes).not.toHaveBeenCalled()
    pointer(effort, 'pointercancel', 60)
    expect(effort.textContent).toBe('1'); expect(surface().style.color).toBe('var(--orange)')
    begin(effort); pointer(effort, 'pointermove', 60); pointer(effort, 'pointerup', 60)
    expect(sets()[0].rir).toBe(2); expect(surface().style.color).toBe('var(--yellow)')
    expect(writes).toHaveBeenCalledOnce(); expect(sets()[0].done).toBe(false)
    expect(useUI.getState().timer).toBeNull()
  })
  it.each(['cards', 'focus'])('%s: drop and burst values use their existing update paths', layout => {
    mount(layout, entry([row({ type: 'dropset', drops: [{ w: 40, r: 8 }] })]))
    const drop = host.querySelector(layout === 'focus' ? '.focus-extra input' : '.subrow input')
    begin(drop); expect(sets()[0].drops[0].w).toBe(40); end(drop)
    expect(sets()[0].drops[0].w).toBe(42.5); expect(writes).toHaveBeenCalledOnce()
  })
  it.each(['cards', 'focus'])('%s: individual side reps step by one without completing either side', layout => {
    mount(layout, entry([makeSideSet(row())], { side: true }))
    const side = host.querySelector(layout === 'focus' ? '[data-focus-side="L"]' : '.setrow.side')
    const reps = (side || host).querySelectorAll('.stp input')[1]
    const before = sets()[0].sides.L.r
    begin(reps); end(reps)
    expect(sets()[0].sides.L.r).toBe(before + 1)
    expect(sets()[0].sides.R.r).toBe(before)
    expect(sets()[0].done).toBe(false); expect(writes).toHaveBeenCalledOnce()
  })
  it.each(['cards', 'focus'])('%s: side weight edits cascade only to the matching inherited side', layout => {
    mount(layout, entry([makeSideSet(row()), makeSideSet(row())], { side: true }))
    const left = host.querySelector(layout === 'focus' ? '[data-focus-side="L"] input' : '.setrow.side input')
    begin(left); end(left)
    expect(sets().map(s => s.sides.L.w)).toEqual([62.5, 62.5])
    expect(sets().map(s => s.sides.R.w)).toEqual([60, 60])
    expect(sets()[0].sides.L.weightOrigin).toBe('manual')
    expect(writes).toHaveBeenCalledOnce()
  })
  it.each(['cards', 'focus'])('%s: burst reps use their existing aggregation rules', layout => {
    mount(layout, entry([row({ r: 10, type: 'restpause', clusters: [{ r: 2, restSec: 15 }] })]))
    const burst = host.querySelector(layout === 'focus' ? '.focus-extra input' : '.subrow input')
    begin(burst); end(burst)
    expect(sets()[0].clusters[0].r).toBe(3)
    expect(sets()[0].r).toBe(11)
    expect(writes).toHaveBeenCalledOnce()
  })
  it('reramps only unfinished, unedited warm-ups on the committed load', () => {
    mount('list', entry([row({ w: 20, phase: 'warmup', done: true }), row({ w: 40, phase: 'warmup' }), row({ w: 60 }), row({ w: 60 })]))
    const work = host.querySelectorAll('.stp.w input')[2]
    begin(work); pointer(work, 'pointermove', 24)
    expect(sets().map(s => s.w)).toEqual([20, 40, 60, 60])
    pointer(work, 'pointerup', 24)
    expect(sets().map(s => s.w)).toEqual([20, 45, 70, 70])
    expect(writes).toHaveBeenCalledOnce()
  })
  it('steps combined unilateral warm-up repetitions by two', () => {
    mount('cards', entry([row({ phase: 'warmup' }), makeSideSet(row())], { side: true }))
    const reps = host.querySelector('.stp.r input')
    begin(reps); end(reps)
    expect(sets()[0].r).toBe(10); expect(writes).toHaveBeenCalledOnce()
  })
  it('persists the new setting through the existing profile writer', () => {
    mount()
    act(() => useStore.getState().update(s => { s.wc.scrubby = false }))
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).wc.scrubby).toBe(false)
    act(() => useStore.getState().update(s => { s.wc.scrubby = true }))
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).wc.scrubby).toBe(true)
  })
  it.each([[true, true], [true, false], [false, true], [false, false]])('independent settings: buttons %s, scrub %s', (steppers, scrubby) => {
    mount('focus', entry(), { wc: { ...DEF.wc, steppers, scrubby } })
    expect(!!host.querySelector('.stp button')).toBe(steppers)
    begin(field()); end(field())
    expect(sets()[0].w).toBe(scrubby ? 62.5 : 60)
  })
  it('cancels a preview when workout data changes elsewhere', () => {
    mount(); const input = field(); begin(input)
    act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].r = 10 }))
    writes.mockClear(); end(input)
    expect(sets()[0].w).toBe(60); expect(sets()[0].r).toBe(10); expect(writes).not.toHaveBeenCalled()
  })
  it('leaves set swiping usable after a held value was released unchanged', () => {
    mount()
    const input = field()
    pointer(input, 'pointerdown'); act(() => vi.advanceTimersByTime(300)); pointer(input, 'pointerup')
    pointer(input, 'pointerdown')
    act(() => input.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 150, clientY: 100, bubbles: true, cancelable: true })))
    expect(host.querySelector('.swrow').classList.contains('dragging')).toBe(true)
    pointer(input, 'pointercancel')
    expect(writes).not.toHaveBeenCalled()
  })
})
