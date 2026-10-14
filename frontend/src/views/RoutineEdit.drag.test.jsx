// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({
  exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => sheets)
vi.mock('../components/Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))

import RoutineEdit, { ROUTINE_DRAG_SLOP, ROUTINE_LONG_PRESS_MS, reorderRoutineUnit } from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { addSection, SECTION_PRESETS, removeSection } from '../lib/workout-sections.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const configured = (id, extra = {}) => ({ id, mode: 'reps', sets: 3, reps: 5, weight: 0, ...extra })
let root
let host

function stateFor(entries) {
  const S = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Drag routine', emoji: 'dumbbell', prog: 'linear', ex: entries }]
  return S
}
function rect(top, height, left = 20, width = 340) {
  return { x: left, y: top, left, right: left + width, top, bottom: top + height, width, height }
}
const rows = () => [...host.querySelectorAll('[data-routine-row]')]
function geometry(heights = rows().map(() => 70)) {
  const list = host.querySelector('.routine-list')
  let top = 100
  const tops = [], bottoms = [], centers = []
  rows().forEach((row, i) => {
    const height = heights[i] ?? 70
    tops.push(top); bottoms.push(top + height); centers.push(top + height / 2)
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rect(tops[i], height))
    top += height + 10
  })
  const listRect = rect(80, top - 80)
  vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => listRect)
  return { list, tops, bottoms, centers, listRect }
}
function mount(entries) {
  useStore.setState({ S: stateFor(entries), user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
  return geometry()
}
function remountCurrentState() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
  return geometry()
}
function pointer(target, type, { id = 7, kind = 'touch', primary = true, button = 0, x = 120, y = 120 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({ pointerId: id, pointerType: kind, isPrimary: primary, button, clientX: x, clientY: y })) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  act(() => target.dispatchEvent(event))
  return event
}
function lift(row, y, x = 120) {
  pointer(row.querySelector('.item'), 'pointerdown', { x, y })
  act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
}
const exercises = () => useStore.getState().S.routines[0].ex

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => window.setTimeout(() => cb(Date.now()), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
  localStorage.clear()
  Object.values(sheets).forEach(mock => mock.mockReset())
  root = null; host = null
})
afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers()
})

describe('routine long-press reorder', () => {
  it('exports the frozen threshold/slop and keeps a short press as a normal click', () => {
    expect(ROUTINE_LONG_PRESS_MS).toBe(380)
    expect(ROUTINE_DRAG_SLOP).toBe(8)
    const layout = mount([configured('1001'), configured('1002')])
    const item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(379))
    expect(host.querySelector('.is-dragging')).toBeNull()
    pointer(item, 'pointerup', { y: layout.centers[0] })
    act(() => item.click())
    expect(sheets.exConfigSheet).toHaveBeenCalledOnce()
    expect(exercises().map(e => e.id)).toEqual(['1001', '1002'])
  })

  it('lifts at exactly 380 ms and yields pre-lift movement strictly over 8 px to scrolling', () => {
    let layout = mount([configured('1001'), configured('1002')])
    let item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { x: 100, y: layout.centers[0] })
    const atEight = pointer(item, 'pointermove', { x: 108, y: layout.centers[0] })
    expect(atEight.defaultPrevented).toBe(false)
    act(() => vi.advanceTimersByTime(380))
    expect(rows()[0].classList.contains('is-dragging')).toBe(true)
    pointer(item, 'pointercancel', { x: 108, y: layout.centers[0] })

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = mount([configured('1001'), configured('1002')])
    item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { x: 100, y: layout.centers[0] })
    const atNine = pointer(item, 'pointermove', { x: 109, y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(380))
    expect(atNine.defaultPrevented).toBe(false)
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('owns active movement, renders an indicator, and suppresses the compatibility click after cancel', () => {
    const layout = mount([configured('1001'), configured('1002'), configured('1003')])
    const row = rows()[1], item = row.querySelector('.item')
    const capture = vi.fn(), release = vi.fn()
    item.setPointerCapture = capture; item.releasePointerCapture = release
    lift(row, layout.centers[1])
    expect(capture).toHaveBeenCalledWith(7)
    expect(row.classList.contains('is-dragging')).toBe(true)
    expect(host.querySelector('[data-testid="routine-drop-indicator"]')).toBeTruthy()
    const move = pointer(item, 'pointermove', { y: layout.centers[2] })
    expect(move.defaultPrevented).toBe(true)
    pointer(item, 'pointercancel', { y: layout.centers[2] })
    expect(release).toHaveBeenCalledWith(7)
    act(() => item.click())
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
    expect(exercises().map(e => e.id)).toEqual(['1001', '1002', '1003'])
  })

  it('moves across measured slots and persists one complete changed order', () => {
    const layout = mount([configured('a'), configured('b'), configured('c'), configured('d')])
    const before = localStorage.getItem('gym_state_v1')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const row = rows()[0], item = row.querySelector('.item')
    lift(row, layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).routines[0].ex.map(e => e.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(localStorage.getItem('gym_state_v1')).not.toBe(before)
    // one save of the copy (beside it the write id other tabs read, useStore persist)
    expect(writes.mock.calls.filter(([k]) => k === 'gym_state_v1')).toHaveLength(1)
  })

  it('suppresses the compatibility click after a successful changed drop', () => {
    const layout = mount([configured('a'), configured('b'), configured('c')])
    const item = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a'])

    act(() => item.click())
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('lets a real tap shortly after a drop open the row again', () => {
    const layout = mount([configured('a'), configured('b'), configured('c')])
    const item = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a'])

    act(() => vi.advanceTimersByTime(200))
    const target = rows()[1].querySelector('.item')
    pointer(target, 'pointerdown', { y: layout.centers[1] })
    pointer(target, 'pointerup', { y: layout.centers[1] })
    act(() => target.click())
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(1)
  })

  it('never eats a tap that starts with its own pointerdown, even right after a drop', () => {
    const layout = mount([configured('a'), configured('b'), configured('c')])
    const item = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })

    const target = rows()[1].querySelector('.item')
    pointer(target, 'pointerdown', { y: layout.centers[1] })
    pointer(target, 'pointerup', { y: layout.centers[1] })
    act(() => target.click())
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(1)
  })

  it('moves a whole grouped unit, never splits another group, and preserves every occurrence payload', () => {
    const pairA = configured('dup', { sg: 'pair', weight: 11, note: 'first', future: { a: 1 } })
    const pairB = configured('dup', { sg: 'pair', weight: 22, note: 'second', future: { b: 2 } })
    const layout = mount([pairA, pairB, configured('c'), configured('d')])
    const row = rows()[1], item = row.querySelector('.item')
    lift(row, layout.centers[1])
    expect(rows().slice(0, 2).every(node => node.classList.contains('is-dragging'))).toBe(true)
    pointer(item, 'pointermove', { y: layout.listRect.bottom - 1 })
    pointer(item, 'pointerup', { y: layout.listRect.bottom - 1 })
    expect(exercises()).toEqual([configured('c'), configured('d'), pairA, pairB])

    act(() => root.unmount()); host.remove(); root = null; host = null
    const splitLayout = mount([configured('a'), configured('b', { sg: 'g' }), configured('c', { sg: 'g' }), configured('tail')])
    const tail = rows()[3], tailItem = tail.querySelector('.item')
    lift(tail, splitLayout.centers[3])
    const betweenMembers = (splitLayout.bottoms[1] + splitLayout.tops[2]) / 2
    pointer(tailItem, 'pointermove', { y: betweenMembers })
    pointer(tailItem, 'pointerup', { y: betweenMembers })
    expect(exercises().map(e => e.id)).toEqual(['a', 'tail', 'b', 'c'])
  })

  it('moves the selected duplicate occurrence rather than finding by catalogue id', () => {
    const first = configured('dup', { weight: 10, reps: 3, note: 'first' })
    const second = configured('dup', { weight: 20, reps: 9, note: 'second' })
    const layout = mount([first, configured('middle'), second, configured('tail')])
    const row = rows()[2], item = row.querySelector('.item')
    lift(row, layout.centers[2])
    pointer(item, 'pointermove', { y: layout.tops[0] + 1 })
    pointer(item, 'pointerup', { y: layout.tops[0] + 1 })
    expect(exercises()).toEqual([second, first, configured('middle'), configured('tail')])
  })

  it('cancels without persistence on outside release, lost capture, Escape, blur, hidden document, or second pointer', () => {
    const cancelCases = ['outside', 'lost', 'escape', 'blur', 'hidden', 'second']
    for (const cancel of cancelCases) {
      if (root) { act(() => root.unmount()); host.remove(); root = null; host = null }
      const layout = mount([configured('a'), configured('b'), configured('c')])
      const row = rows()[0], item = row.querySelector('.item')
      const before = localStorage.getItem('gym_state_v1')
      lift(row, layout.centers[0])
      pointer(item, 'pointermove', { y: layout.centers[2] })
      if (cancel === 'outside') pointer(item, 'pointerup', { x: layout.listRect.right + 20, y: layout.centers[2] })
      if (cancel === 'lost') pointer(item, 'lostpointercapture', { y: layout.centers[2] })
      if (cancel === 'escape') act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      if (cancel === 'blur') act(() => window.dispatchEvent(new Event('blur')))
      if (cancel === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        act(() => document.dispatchEvent(new Event('visibilitychange')))
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      }
      if (cancel === 'second') pointer(rows()[1].querySelector('.item'), 'pointerdown', { id: 8, y: layout.centers[1] })
      expect(exercises().map(e => e.id), cancel).toEqual(['a', 'b', 'c'])
      expect(localStorage.getItem('gym_state_v1'), cancel).toBe(before)
      expect(host.querySelector('.is-dragging'), cancel).toBeNull()
    }
  })

  it('ignores non-primary/control pointers and leaves accessible move buttons working', () => {
    const layout = mount([configured('a'), configured('b')])
    const down = host.querySelector('button[aria-label="Move down"]')
    pointer(down, 'pointerdown', { y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(380))
    expect(host.querySelector('.is-dragging')).toBeNull()
    act(() => down.click())
    expect(exercises().map(e => e.id)).toEqual(['b', 'a'])
    const item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { primary: false, y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(380))
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('autoscrolls only after lift and stops frames on cancel', () => {
    const layout = mount([configured('a'), configured('b'), configured('c'), configured('d')])
    host.style.overflowY = 'auto'
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 320 })
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 900 })
    host.scrollTop = 100
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => rect(0, 320))
    const row = rows()[2], item = row.querySelector('.item')
    pointer(item, 'pointerdown', { y: 310 })
    act(() => vi.advanceTimersByTime(16))
    expect(host.scrollTop).toBe(100)
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS - 16 + 16))
    expect(host.scrollTop).toBeGreaterThan(100)
    pointer(item, 'pointercancel', { y: 310 })
    const stopped = host.scrollTop
    act(() => vi.advanceTimersByTime(64))
    expect(host.scrollTop).toBe(stopped)
  })

  it('fails closed when row geometry disappears during an active drag', () => {
    const layout = mount([configured('a'), configured('b'), configured('c')])
    const row = rows()[0], item = row.querySelector('.item')
    const before = localStorage.getItem('gym_state_v1')
    lift(row, layout.centers[0])
    rows()[1].getBoundingClientRect.mockReturnValue(undefined)
    pointer(item, 'pointermove', { y: layout.centers[2] })
    pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('cleans pending and active gestures on unmount without late writes', () => {
    const layout = mount([configured('a'), configured('b')])
    const item = rows()[0].querySelector('.item')
    const before = localStorage.getItem('gym_state_v1')
    pointer(item, 'pointerdown', { y: layout.centers[0] })
    act(() => root.unmount()); root = null
    act(() => vi.advanceTimersByTime(1000))
    expect(localStorage.getItem('gym_state_v1')).toBe(before)

    const activeLayout = mount([configured('a'), configured('b')])
    const activeItem = rows()[0].querySelector('.item')
    const release = vi.fn()
    activeItem.releasePointerCapture = release
    lift(rows()[0], activeLayout.centers[0])
    act(() => root.unmount()); root = null
    act(() => vi.advanceTimersByTime(1000))
    expect(release).toHaveBeenCalledWith(7)
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
  })

  it('covers reverse measured slots and an unchanged original slot', () => {
    let layout = mount([configured('a'), configured('b'), configured('c'), configured('d')])
    let item = rows()[3].querySelector('.item')
    lift(rows()[3], layout.centers[3])
    pointer(item, 'pointermove', { y: layout.tops[1] + 1 })
    pointer(item, 'pointerup', { y: layout.tops[1] + 1 })
    expect(exercises().map(e => e.id)).toEqual(['a', 'd', 'b', 'c'])

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = mount([configured('a'), configured('b'), configured('c')])
    const before = localStorage.getItem('gym_state_v1')
    item = rows()[1].querySelector('.item')
    lift(rows()[1], layout.centers[1])
    pointer(item, 'pointermove', { y: layout.centers[1] + ROUTINE_DRAG_SLOP + 1 })
    pointer(item, 'pointerup', { y: layout.centers[1] + ROUTINE_DRAG_SLOP + 1 })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
  })

  it('reads the persisted changed order back after a fresh remount', () => {
    const layout = mount([configured('a'), configured('b'), configured('c')])
    const item = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    act(() => root.unmount()); host.remove(); root = null; host = null
    useStore.setState({ S: saved, user: null })
    remountCurrentState()
    expect(exercises().map(e => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('cancels active ownership for a second pointer outside the list and pending lost capture', () => {
    let layout = mount([configured('a'), configured('b'), configured('c')])
    let item = rows()[0].querySelector('.item')
    const before = localStorage.getItem('gym_state_v1')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] })
    pointer(document.body, 'pointerdown', { id: 8, y: 20 })
    pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
    expect(host.querySelector('.is-dragging')).toBeNull()

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = mount([configured('a'), configured('b')])
    item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { y: layout.centers[0] })
    pointer(item, 'lostpointercapture', { y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('cancels when equal serialized exercises acquire a new current routine/list identity', () => {
    let layout = mount([configured('a'), configured('b'), configured('c')])
    let item = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] })
    act(() => useStore.getState().update(s => {
      const current = s.routines[0]
      s.routines[0] = { ...current, ex: clone(current.ex) }
    }))
    pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(host.querySelector('.is-dragging')).toBeNull()

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = mount([configured('a'), configured('b')])
    item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { y: layout.centers[0] })
    act(() => useStore.getState().update(s => {
      const current = s.routines[0]
      s.routines[0] = { ...current, ex: clone(current.ex) }
    }))
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('never owns nested link, Move up, or Move down controls', () => {
    const layout = mount([configured('a'), configured('b')])
    const controls = [
      rows()[1].querySelector('button[title]'),
      rows()[1].querySelector('button[aria-label="Move up"]'),
      rows()[1].querySelector('button[aria-label="Move down"]'),
    ]
    for (const control of controls) {
      pointer(control, 'pointerdown', { y: layout.centers[1] })
      act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
      expect(host.querySelector('.is-dragging')).toBeNull()
      pointer(control, 'pointerup', { y: layout.centers[1] })
    }
  })

  it('falls back to page/window autoscroll without a nested scroll host', () => {
    const layout = mount([configured('a'), configured('b'), configured('c')])
    const rootElement = document.documentElement
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: rootElement })
    Object.defineProperty(rootElement, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(rootElement, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 100 })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation((_, delta) => { window.scrollY += delta })
    const item = rows()[2].querySelector('.item')
    lift(rows()[2], 295)
    act(() => vi.advanceTimersByTime(16))
    expect(scrollBy).toHaveBeenCalled()
    expect(window.scrollY).toBeGreaterThan(100)
    pointer(item, 'pointercancel', { y: 295 })
  })

  it('invalidates ownership before cleanup synchronously emits lost capture', () => {
    const layout = mount([configured('a'), configured('b')])
    const item = rows()[0].querySelector('.item')
    const release = vi.fn(pointerId => pointer(document, 'lostpointercapture', { id: pointerId, y: layout.centers[0] }))
    item.releasePointerCapture = release
    lift(rows()[0], layout.centers[0])
    act(() => root.unmount()); root = null
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('reorderRoutineUnit', () => {
  it('splices complete units at canonical slots and cleans true orphans', () => {
    const items = [configured('a', { sg: 'pair' }), configured('b', { sg: 'pair' }), configured('c', { sg: 'orphan' }), configured('d')]
    expect(reorderRoutineUnit(items, 3, 1)).toBe(true)
    expect(items.map(e => e.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(items[0].sg).toBe('pair'); expect(items[1].sg).toBe('pair'); expect(items[3].sg).toBeUndefined()
  })
})

describe('direct phase controls', () => {
  const addWarmup = () => act(() => useStore.getState().update(s => { addSection(s.routines[0], SECTION_PRESETS[0]) }))
  const phase = type => useStore.getState().S.routines[0].sections.find(s => s.type === type)
  const addToWarmup = () => act(() => host.querySelector('[aria-label="Add exercise to Warm-up"]').click())

  it('adds quick and configured exercises to the selected phase and rejects a removed destination', () => {
    mount([configured('0025')]); addWarmup()
    const warm = phase('warmup').id
    addToWarmup()
    expect(sheets.exercisePicker.mock.lastCall[1]).toBe('Add exercise to Warm-up')
    act(() => sheets.exercisePicker.mock.lastCall[0]({ id: '0047' }, true))
    expect(exercises().find(e => e.id === '0047').sectionId).toBe(warm)
    addToWarmup()
    act(() => sheets.exercisePicker.mock.lastCall[0]({ id: '1259' }, false))
    act(() => sheets.exConfigSheet.mock.lastCall[2]({ mode: 'time', sets: 1, sec: 30 }))
    expect(exercises().find(e => e.id === '1259')).toMatchObject({ sectionId: warm, section: { countsAsWork: false }, sec: 30 })
    addToWarmup()
    act(() => sheets.exercisePicker.mock.lastCall[0]({ id: '1001' }, false))
    const commit = sheets.exConfigSheet.mock.lastCall[2]
    act(() => useStore.getState().update(s => { removeSection(s.routines[0], warm, phase('work').id) }))
    const before = clone(exercises())
    act(() => commit({ sets: 1, reps: 5 }))
    expect(exercises()).toEqual(before)
  })

  it('drags a whole superset into an empty phase using the visible handle', () => {
    mount([configured('0025', { sg: 'pair' }), configured('0047', { sg: 'pair' })]); addWarmup()
    const layout = geometry()
    vi.mocked(layout.list.getBoundingClientRect).mockReturnValue(rect(80, 450))
    const zones = host.querySelectorAll('[data-section-zone]')
    vi.spyOn(zones[0], 'getBoundingClientRect').mockReturnValue(rect(80, 200))
    vi.spyOn(zones[1], 'getBoundingClientRect').mockReturnValue(rect(290, 200))
    const ids = exercises().map(e => e.occurrenceId)
    const handle = rows()[1].querySelector('[data-drag-handle]')
    pointer(handle, 'pointerdown', { kind: 'mouse', y: 200 })
    expect(host.querySelectorAll('.is-dragging')).toHaveLength(2)
    pointer(handle, 'pointermove', { kind: 'mouse', y: 350 })
    expect(zones[1].classList.contains('is-drop-target')).toBe(true)
    pointer(handle, 'pointerup', { kind: 'mouse', y: 350 })
    expect(exercises().map(e => e.occurrenceId)).toEqual(ids)
    expect(exercises().every(e => e.sectionId === phase('warmup').id && e.sg === 'pair')).toBe(true)
    expect(host.querySelector('[data-section-zone]').textContent).toContain('Add an exercise or drag one here.')
  })

  it('moves a group inline and scopes removal to that phase without removing its neighbours', () => {
    mount([configured('0025', { sg: 'pair' }), configured('0047', { sg: 'pair' }), configured('1259')]); addWarmup()
    act(() => [...rows()[0].querySelectorAll('.section-move button')].find(b => b.textContent === 'Warm-up').click())
    expect(exercises().filter(e => e.sectionId === phase('warmup').id)).toHaveLength(2)
    act(() => host.querySelector('[aria-label="Remove exercise from Warm-up"]').click())
    const sheet = useUI.getState().sheets.at(-1)
    act(() => root.render(sheet.render(() => {})))
    expect(host.querySelectorAll('.section-remove-choices button')).toHaveLength(2)
    act(() => host.querySelector('.section-remove-choices button').click())
    expect(sheets.confirmSheet.mock.lastCall[0].title.toLowerCase()).toContain('barbell bench press')
    act(() => sheets.confirmSheet.mock.lastCall[0].onConfirm())
    expect(exercises().map(e => e.id)).toEqual(['1259', '0047'])
    expect(exercises().find(e => e.id === '0047').sg).toBeUndefined()
    useUI.setState({ sheets: [] })
  })

  it('keeps non-drag reorder buttons available in phases without splitting groups or crossing boundaries', () => {
    mount([configured('0025', { sg: 'pair' }), configured('0047', { sg: 'pair' }), configured('1259')]); addWarmup()
    const occurrenceIds = exercises().map(e => e.occurrenceId)
    const menu = rows()[0].querySelector('.compact-actions')
    expect(menu.open).toBe(false)
    act(() => menu.querySelector('summary').click())
    const down = menu.querySelector('[aria-label="Move down"]')
    expect(down.disabled).toBe(false)
    act(() => down.click())
    expect(exercises().map(e => e.occurrenceId)).toEqual([occurrenceIds[2], occurrenceIds[0], occurrenceIds[1]])
    expect(exercises().slice(1).every(e => e.sg === 'pair')).toBe(true)
    expect(rows()[1].querySelector('[aria-label="Move down"]').disabled).toBe(true)
    act(() => [...rows()[0].querySelectorAll('.section-move button')].find(b => b.textContent === 'Warm-up').click())
    expect(rows()[0].querySelector('[aria-label="Move down"]').disabled).toBe(true)
    expect(rows()[2].querySelector('[aria-label="Move up"]').disabled).toBe(true)
  })
})
