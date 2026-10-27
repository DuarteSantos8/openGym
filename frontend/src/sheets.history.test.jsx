// @vitest-environment happy-dom
// The history sheet (issue #43) is the one place the workout screen answers "what did I do
// on this last time, and the time before" — worth pinning that it reads the log newest
// first, labels sets the way the rest of the app does, and does not pretend an exercise
// with no sessions has a curve.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exerciseHistorySheet, exerciseDetailSheet } from './sheets.jsx'
import { EXIDX } from './lib/exercises.js'

const mounted = []

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}

const EX = Object.keys(EXIDX).find(id => (EXIDX[id].bp || '') !== 'cardio' && !EXIDX[id].custom)
const DAY = 86400000
const T0 = Date.UTC(2026, 2, 2, 9)
const iso = i => new Date(T0 + i * DAY).toISOString().slice(0, 10)
const session = (i, rows) => ({
  id: 'w' + i, d: iso(i), start: T0 + i * DAY, end: T0 + i * DAY + 3600000, name: 'Push', vol: 0,
  entries: [{ id: EX, target: { mode: 'reps', bodyweight: false }, sets: rows }],
})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', workouts: [], active: null } }))
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('exercise history sheet', () => {
  it('shows an empty state instead of a chart when nothing was logged', () => {
    exerciseHistorySheet(EX)
    const host = renderTop()
    expect(host.querySelector('.empty').textContent).toContain('No sessions logged yet')
    expect(host.querySelector('.chart')).toBeNull()
  })

  it('lists sessions newest first with labelled sets, volume and one PR marker', () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [
      session(0, [{ w: 40, r: 8, done: true, phase: 'warmup' }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }]),
      session(2, [{ w: 70, r: 5, done: true }]),
      session(4, [{ w: 70, r: 3, done: true }, { w: 90, r: 1, done: false }]),
    ] } }))
    exerciseHistorySheet(EX)
    const host = renderTop()
    const rows = [...host.querySelectorAll('.list .item')]
    expect(rows).toHaveLength(3)
    // newest first, oldest last; the warm-up and the unfinished set never show up
    expect(rows[0].querySelector('.ss').textContent).toBe('70×3')
    expect(rows[2].querySelector('.ss').textContent).toBe('60×5  ·  60×5')
    expect(rows[2].textContent).toContain('Volume 600 kg')
    // the record was set in the middle session and only that one carries the badge
    expect(rows.map(r => !!r.querySelector('.pr'))).toEqual([false, true, false])
    expect(host.querySelector('.chart svg')).toBeTruthy()
    expect(host.textContent).toContain('Best:')
    expect(host.textContent).toContain('70 kg')
  })

  it('offers a Bodyweight curve only with two sessions that have a body weight, and Best becomes a percentage', () => {
    const rel = (i, w, bw) => ({ ...session(i, [{ w, r: 5, done: true }]), bw })
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [], workouts: [session(0, [{ w: 60, r: 5, done: true }]), session(2, [{ w: 70, r: 5, done: true }])] } }))
    exerciseHistorySheet(EX)
    const none = renderTop()
    expect([...none.querySelectorAll('.seg button')].map(b => b.textContent)).not.toContain('Bodyweight')

    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, workouts: [rel(0, 60, 80), rel(2, 80, 80)] } }))
    exerciseHistorySheet(EX)
    const host = renderTop()
    const btn = [...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Bodyweight')
    expect(btn).toBeTruthy()
    act(() => { btn.click() })
    expect(host.textContent).toMatch(/Best:\s*\d+(\.\d+)? % BW/)
    expect(host.textContent).toContain('Estimated 1RM as a share of body weight, per workout')
  })

  it('gives a bare bodyweight exercise a Max reps / Bodyweight toggle, counting body weight as the load', () => {
    const bare = (i, r) => ({ ...session(i, [{ w: 0, r, done: true }]), bw: 80,
      entries: [{ id: EX, target: { mode: 'reps', bodyweight: true }, sets: [{ w: 0, r, done: true }] }] })
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [], workouts: [bare(0, 5), bare(2, 10)] } }))
    exerciseHistorySheet(EX)
    const host = renderTop()
    expect([...host.querySelectorAll('.seg button')].map(b => b.textContent)).toEqual(['Max reps', 'Bodyweight'])
    act(() => { [...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Bodyweight').click() })
    // 80 kg moved for 10 reps estimates above body weight, so the best is over 100 % BW.
    const best = Number(host.textContent.match(/Best:\s*([\d.]+) % BW/)?.[1])
    expect(best).toBeGreaterThan(100)
  })

  it('on an assisted machine, less help reads as a higher percentage of body weight', () => {
    const AS = '1431'
    const at = (i, help) => ({ ...session(i, []), bw: 80, entries: [{ id: AS, target: { mode: 'reps' }, sets: [{ w: help, r: 5, done: true }] }] })
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [], workouts: [at(0, 30), at(2, 10)] } }))
    exerciseHistorySheet(AS)
    const host = renderTop()
    act(() => { [...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Bodyweight').click() })
    const best = Number(host.textContent.match(/Best:\s*([\d.]+) % BW/)?.[1])
    // The heaviest set, not an extrapolated 1RM: 70 of 80 kg is 87.5 %, so it can never pass 100.
    expect(best).toBeCloseTo(87.5, 1)
    expect(host.textContent).toContain('Heaviest set as a share of body weight, per workout')
  })

  it('keeps a Bodyweight curve for high-rep work the 1RM estimate refuses, following the heaviest set', () => {
    // 20 reps is above the estimate's cap, so there is no Est. 1RM; leg press and calf raises live here.
    const high = (i, w) => ({ ...session(i, [{ w, r: 20, done: true }]), bw: 80 })
    useStore.setState(s => ({ S: { ...s.S, bodyweight: [], workouts: [high(0, 100), high(2, 120)] } }))
    exerciseHistorySheet(EX)
    const host = renderTop()
    expect([...host.querySelectorAll('.seg button')].map(b => b.textContent)).toEqual(['Top set', 'Bodyweight'])
    act(() => { [...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Bodyweight').click() })
    expect(Number(host.textContent.match(/Best:\s*([\d.]+) % BW/)?.[1])).toBeCloseTo(150, 1)
    expect(host.textContent).toContain('Heaviest set as a share of body weight, per workout')
  })

  it('is reachable from the exercise detail sheet once there is history', () => {
    exerciseDetailSheet(EXIDX[EX])
    const before = renderTop()
    expect([...before.querySelectorAll('button')].some(b => b.textContent === 'History')).toBe(false)

    useStore.setState(s => ({ S: { ...s.S, workouts: [session(0, [{ w: 60, r: 5, done: true }])] } }))
    useUI.setState({ sheets: [] })
    exerciseDetailSheet(EXIDX[EX])
    const host = renderTop()
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent === 'History')
    expect(btn).toBeTruthy()
    act(() => { btn.click() })
    expect(useUI.getState().sheets).toHaveLength(2)
    const top = renderTop()
    expect(top.querySelectorAll('.list .item')).toHaveLength(1)
  })
})
