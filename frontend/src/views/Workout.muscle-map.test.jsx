// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { SessionMuscles } from '../components/SessionMuscles.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { musclesOf } from '../lib/muscles.js'

// #670: the workout header carries a tiny body of what the session hits, brighter where sets are
// already ticked, in every layout, behind a switch that is on by default.

const maps = vi.hoisted(() => [])
vi.mock('../components/BodyMap.jsx', () => ({
  default: props => { maps.push(props); return React.createElement('div', { 'data-body-map': props.className || '' }) },
  BodyMapLegend: () => null,
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH = '0289'
const SQUAT = '0043'
const top = id => Object.entries(musclesOf(EXIDX[id])).sort((a, b) => b[1] - a[1])[0][0]
const CHEST = top(BENCH)
const QUADS = top(SQUAT)
const row = (done = false) => ({ w: 20, r: 8, done })
const entry = (id, sets) => ({ id, target: { sets: sets.length, reps: 8 }, sets })

let root, container
function setActive(entries, { wc, workoutView } = {}) {
  const S = JSON.parse(JSON.stringify(DEF))
  if (wc) S.wc = { ...S.wc, ...wc }
  S.hints = { swipeSets: true }
  S.active = { id: 'mm', d: '2026-10-19', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0, entries, ...(workoutView ? { workoutView } : {}) }
  useStore.setState({ S, user: null })
}
function render(node = <MemoryRouter><Workout /></MemoryRouter>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(node))
}
const headerMap = () => container.querySelector('[data-session-map]')
const lastHeaderLevels = () => maps.filter(p => /bm-mini/.test(p.className)).at(-1)?.levels
const edit = fn => act(() => useStore.getState().update(fn))

afterEach(() => {
  act(() => root?.unmount()); container?.remove(); root = null
  maps.length = 0
  useUI.setState({ sheets: [] })
})

describe('Workout muscle map (#670)', () => {
  for (const view of ['cards', 'list', 'compact', 'focus']) {
    it(`is in the header in ${view}`, () => {
      setActive([entry(BENCH, [row(), row()])], { workoutView: view })
      render()
      expect(headerMap()).toBeTruthy()
      expect(headerMap().getAttribute('aria-label')).toBe('What this session hits')
      // it rides at the end of the exercise chips, not in the crowded header bar
      expect(headerMap().closest('.wchips-row')).toBeTruthy()
      expect(container.querySelector('.whdr-bar [data-session-map]')).toBeNull()
    })
  }

  it('moves into the header bar when the exercise chips are off', () => {
    setActive([entry(BENCH, [row(), row()])], { wc: { exerciseChips: false } })
    render()
    expect(container.querySelector('.whdr-bar [data-session-map]')).toBeTruthy()
  })

  it('lights a muscle up when its set is ticked, still-to-come ones stay faint', () => {
    setActive([entry(BENCH, [row(), row()]), entry(SQUAT, [row(), row()])])
    render()
    expect(lastHeaderLevels()[CHEST]).toBe(1)
    expect(lastHeaderLevels()[QUADS]).toBe(1)
    edit(s => { s.active.entries[0].sets[0].done = true })
    expect(lastHeaderLevels()[CHEST]).toBeGreaterThanOrEqual(3)
    expect(lastHeaderLevels()[QUADS]).toBe(1)
  })

  it('typing a weight does not work the map out again', () => {
    setActive([entry(BENCH, [row(), row()])])
    render()
    const before = lastHeaderLevels()
    edit(s => { s.active.entries[0].sets[1].w = 25 })
    expect(useStore.getState().S.active.entries[0].sets[1].w).toBe(25)
    expect(lastHeaderLevels()).toBe(before)
  })

  it('is gone when switched off, and absent for an empty freestyle session', () => {
    setActive([entry(BENCH, [row()])], { wc: { muscleMap: false } })
    render()
    expect(headerMap()).toBeNull()
    act(() => root.unmount()); container.remove()
    setActive([])
    render()
    expect(headerMap()).toBeNull()
  })

  it('opens the session sheet on a tap', () => {
    setActive([entry(BENCH, [row()])])
    render()
    act(() => headerMap().click())
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})

describe('Session muscles sheet (#670)', () => {
  it('lists done/planned sets per muscle, busiest first, and follows new ticks', () => {
    setActive([entry(BENCH, [row(true), row(), row()]), entry(SQUAT, [row(), row()])])
    render(<SessionMuscles close={() => {}} />)
    const rows = () => [...container.querySelectorAll('[data-muscle-session]')]
    expect(rows()[0].dataset.muscleSession).toBe(CHEST)
    const w = musclesOf(EXIDX[BENCH])[CHEST]
    const r = v => String(Math.round(v))
    const value = m => container.querySelector(`[data-muscle-session="${m}"] .v`).textContent
    expect(value(CHEST)).toBe(`${r(w)}/${r(w * 3)}`)
    expect(value(QUADS)).toMatch(/^0\//)
    edit(s => { s.active.entries[1].sets[0].done = true })
    expect(value(QUADS)).not.toMatch(/^0\//)
    expect(container.textContent).toContain('Already worked')
    expect(container.textContent).toContain('Still to come')
  })

  it('shows whole sets, not the fractions a secondary muscle adds up to', () => {
    // Bench is 0.4 of a set for the shoulders: one ticked of three is 0.4/1.2, a single set 0/0.4.
    const shoulder = Object.entries(musclesOf(EXIDX[BENCH])).find(([, v]) => v > 0 && v < 0.5)[0]
    setActive([entry(BENCH, [row(true), row(), row()])])
    render(<SessionMuscles close={() => {}} />)
    const value = m => container.querySelector(`[data-muscle-session="${m}"] .v`).textContent
    expect(value(shoulder)).toBe('<1/1')
    for (const el of container.querySelectorAll('[data-muscle-session] .v')) expect(el.textContent).not.toMatch(/\./)
    edit(s => { s.active.entries[0].sets = [row()] })
    expect(value(shoulder)).toBe('0/<1')
    expect(value(CHEST)).toBe('0/1')
  })
})
