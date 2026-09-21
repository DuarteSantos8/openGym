// @vitest-environment happy-dom
// The plate line under a set row (lib/plates.js via Workout.jsx loadLine): which plates make
// this row's weight, shown where the stack changes and once for a run of equal weights.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

const SQUAT = '0043'      // barbell full squat
const DB_BENCH = '0289'   // dumbbell bench press
const COCOONS = '0260'    // body weight, done here with +25
const LUNGE = '0054'      // barbell lunge — the coach runs it per side
const BAND_PULL = '0993'  // band pull-apart (band)
// One pair of each — the home gym the coach plans for.
const HOME = { 45: 1, 35: 1, 25: 1, 15: 1, 10: 1, 5: 1, 2.5: 1 }

const warm = w => ({ w, r: 6, done: false, phase: 'warmup' })
const work = w => ({ w, r: 6, done: false })
const entry = (id, sets, target = {}) => ({ id, target: { sets: sets.length, reps: 6, ...target }, sets })

let root, container

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
})
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = container = null
})

function mount(entries, patch = {}) {
  const S = clone(DEF)
  S.unit = 'lb'
  S.plates = { lb: HOME }
  S.workoutView = 'list'
  Object.assign(S, patch)
  S.active = { id: 'plates-test', d: '2026-09-14', start: Date.now(), routineId: null, name: 'Plates', bw: null, cur: 0, entries, workoutView: S.workoutView }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const lines = () => [...container.querySelectorAll('.plateline')].map(el => ({
  text: el.querySelector('span').textContent,
  moves: el.querySelector('.moves')?.textContent ?? null,
}))

describe('plate line under set rows', () => {
  it('the exercises used here are what the test assumes', () => {
    expect(EXIDX[SQUAT].eq).toBe('barbell')
    expect(EXIDX[DB_BENCH].eq).toBe('dumbbell')
    expect(EXIDX[COCOONS].eq).toBe('body weight')
    expect(EXIDX[LUNGE].eq).toBe('barbell')
    expect(EXIDX[BAND_PULL].eq).toBe('band')
  })

  it('a per-side bar exercise (barbell lunge): the work rows load from the sides\' shared bar', () => {
    const side = (L, R) => ({ w: Math.max(L, R), r: 16, done: false, sides: { L: { w: L, r: 8, done: false }, R: { w: R, r: 8, done: false } } })
    mount([entry(LUNGE, [warm(45), side(65, 65), side(65, 65), side(65, 0)], { w: 65, side: true })])
    expect(lines()).toEqual([
      { text: 'Bar only', moves: null },
      { text: '10 per side', moves: '+10' },
    ])
    expect(container.querySelectorAll('.setrow-side').length).toBe(3)
  })

  it('sides carrying different weights get no line', () => {
    const side = (L, R) => ({ w: Math.max(L, R), r: 16, done: false, sides: { L: { w: L, r: 8, done: false }, R: { w: R, r: 8, done: false } } })
    mount([entry(LUNGE, [side(65, 75)], { w: 65, side: true })])
    expect(lines()).toEqual([])
  })

  it('a band has no plates: no line even with a "weight" logged', () => {
    mount([entry(BAND_PULL, [work(10), work(10)], { w: 10 })])
    expect(lines()).toEqual([])
  })

  it("Monday's squat ramp: a line where the stack changes, once for the three work sets", () => {
    mount([entry(SQUAT, [warm(70), warm(100), warm(120), work(145), work(145), work(145)], { w: 145 })])
    expect(lines()).toEqual([
      { text: '10 + 2.5 per side', moves: null },
      { text: '25 + 2.5 per side', moves: '−10 +25' },
      { text: '35 + 2.5 per side', moves: '−25 +35' },
      { text: '45 + 5 per side', moves: '−35 −2.5 +45 +5' },
    ])
    // The line sits under its own row: six set rows, four lines, the last two rows bare.
    expect(container.querySelectorAll('.setrow').length).toBe(6)
  })

  it('the empty bar is "Bar only"; the first plates after it are all adds', () => {
    mount([entry(SQUAT, [warm(45), work(95), work(95)], { w: 95 })])
    expect(lines()).toEqual([
      { text: 'Bar only', moves: null },
      { text: '25 per side', moves: '+25' },
    ])
  })

  it('what the inventory cannot make says how much is short', () => {
    mount([entry(SQUAT, [work(70)], { w: 70 })], { plates: { lb: { 45: 1, 10: 1 } } })
    expect(lines()).toEqual([{ text: '10 per side · 2.5 lb short', moves: null }])
    expect(container.querySelector('.plateline .short').textContent).toBe('2.5 lb short')
  })

  it('"no bar" (an explicit 0) loads the whole total', () => {
    mount([entry(SQUAT, [work(90)], { w: 90 })], { barWeights: { [SQUAT]: 0 } })
    expect(lines()).toEqual([{ text: '45 per side', moves: null }])
  })

  it('a body-weight exercise with added weight is one stack; a dumbbell gets no line', () => {
    mount([
      entry(COCOONS, [work(25), work(25)], { w: 25 }),
      entry(DB_BENCH, [work(25), work(25)], { w: 25 }),
    ])
    expect(lines()).toEqual([{ text: 'Load 25', moves: null }])
  })

  it('a body-weight exercise without added weight has no line at all', () => {
    mount([entry(COCOONS, [work(0), work(0)])])
    expect(lines()).toEqual([])
  })

  it('a drop set is a weight change too: its line sits under the drop row and the next set restacks', () => {
    const dropped = { w: 145, r: 6, done: false, type: 'dropset', drops: [{ w: 115, r: 8 }] }
    mount([entry(SQUAT, [dropped, work(145)], { w: 145 })])
    expect(lines()).toEqual([
      { text: '45 + 5 per side', moves: null },
      { text: '35 per side', moves: '−45 −5 +35' },
      { text: '45 + 5 per side', moves: '−35 +45 +5' },
    ])
    // The drop's line follows its sub-row, not the main row.
    const sub = container.querySelector('.subrow')
    expect(sub.nextElementSibling.classList.contains('plateline')).toBe(true)
  })

  it('a single stack the inventory cannot make says how much is short', () => {
    mount([entry(COCOONS, [work(30)], { w: 30 })], { plates: { lb: { 25: 1 } } })
    expect(lines()).toEqual([{ text: 'Load 25 · 5 lb short', moves: null }])
  })

  it('the compact view keeps the stacks and drops the strip/add moves', () => {
    mount([entry(SQUAT, [warm(70), warm(100), work(145)], { w: 145 })], { workoutView: 'compact' })
    expect(lines()).toEqual([
      { text: '10 + 2.5 per side', moves: null },
      { text: '25 + 2.5 per side', moves: null },
      { text: '45 + 5 per side', moves: null },
    ])
  })

  it('the ⋯ menu offers Plate loading with the bar as its summary', () => {
    mount([entry(SQUAT, [work(145)], { w: 145 })])
    const more = [...container.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.title || '') === 'More' && !b.classList.contains('n'))
    expect(more).toBeTruthy()
    act(() => more.click())
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet).toBeTruthy()
    const sc = document.createElement('div')
    document.body.appendChild(sc)
    const sr = createRoot(sc)
    act(() => sr.render(sheet.render(() => {})))
    const item = [...sc.querySelectorAll('.menu-item')].find(b => b.textContent.includes('Plate loading'))
    expect(item).toBeTruthy()
    expect(item.textContent).toContain('Bar 45 lb')
    act(() => sr.unmount()); sc.remove()
  })
})
