// @vitest-environment happy-dom
// P2 (1.4.5 UX round): "Last time and next time" listed lifts, cardio had its own block, and a
// plank appeared nowhere. Holds now read like the rep lines: "Front Plank: 0:45, 0:45, 0:45".
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout, holdsLine, workoutDetailSheet } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'
import { isHold } from './lib/exercises.js'

const clone = v => JSON.parse(JSON.stringify(v))
const HOLD = EXDB.find(e => isHold(e.id) && e.bp !== 'cardio').id
const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq === 'barbell').id
const mounted = []
function topSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const hold = (sec, more = {}) => ({ sec, w: 0, done: true, ...more })
const cfg = { id: HOLD, sets: 3, sec: 45, weight: 0, mode: 'time', bodyweight: true }

function install(entries, { routines = [], workouts = [] } = {}) {
  const st = clone(DEF)
  Object.assign(st, { unit: 'kg', routines, workouts })
  st.active = { id: 'fin', d: '2026-11-10', start: Date.now() - 20 * 60000, routineId: routines[0]?.id || null, name: 'Core', bw: null, cur: 0, entries }
  useStore.setState({ S: st, user: null })
}
const block = host => [...host.querySelectorAll('h4')].find(h => h.textContent === 'Last time and next time')?.parentElement

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ now: new Date(2026, 10, 10, 18) })
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(r => r.unmount()) })
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('timed holds in the finish summary', () => {
  it('writes a hold line like a rep line', () => {
    expect(holdsLine([{ sec: 45, w: 0 }, { sec: 45, w: 0 }, { sec: 45, w: 0 }], 'kg')).toBe('0:45, 0:45, 0:45')
    expect(holdsLine([{ sec: 60, w: 10 }, { sec: 75, w: 10, f: true }], 'kg')).toBe('10 kg × 1:00, 1:15 F')
    expect(holdsLine([{ sec: 60, w: 10 }, { sec: 60, w: 12.5 }], 'lb')).toBe('10×1:00 · 12.5×1:00')
    expect(holdsLine([{ sec: 30, w: 0, side: 'L' }, { sec: 30, w: 0, side: 'R' }, { sec: 30, w: 0, side: 'L' }, { sec: 25, w: 0, side: 'R' }], 'kg'))
      .toBe('L 0:30, 0:30  ·  R 0:30, 0:25')
  })

  it('a session of planks shows them, with last time and what the next session opens at', () => {
    const routine = { id: 'r1', name: 'Core', prog: 'time', ex: [cfg] }
    const before = { id: 'w0', d: '2026-11-08', start: new Date(2026, 10, 8, 18).getTime(), end: new Date(2026, 10, 8, 18, 20).getTime(), name: 'Core', routineIds: ['r1'],
      entries: [{ id: HOLD, rid: 'r1', target: { ...cfg }, sets: [hold(45), hold(40), hold(30)] }] }
    install([{ id: HOLD, rid: 'r1', target: { ...cfg }, sets: [hold(45), hold(45), hold(45)] }], { routines: [routine], workouts: [before] })
    act(() => finishWorkout())
    const host = topSheet()
    const box = block(host)
    expect(box, 'the block is there for a holds-only session').toBeTruthy()
    const lines = [...box.querySelectorAll('.item .small')].map(n => n.textContent)
    expect(lines[0]).toBe('Today: 0:45, 0:45, 0:45')
    expect(lines[1]).toBe('Last time: 0:45, 0:40, 0:30')
    expect(lines[2]).toMatch(/^Next time: 0:\d\d · step up$/)
    expect(box.querySelector('[aria-label="Up on last time"]')).toBeTruthy()
  })

  it('a first plank without a routine: today only, marked First time', () => {
    install([{ id: HOLD, target: { ...cfg }, sets: [hold(45), hold(45)] }])
    act(() => finishWorkout())
    const box = block(topSheet())
    expect([...box.querySelectorAll('.item .small')].map(n => n.textContent)).toEqual(['Today: 0:45, 0:45'])
    expect(box.textContent).toContain('First time')
  })

  it('per side and mixed: sides are named, and reps and holds of one exercise share its row', () => {
    install([
      { id: HOLD, target: { ...cfg, side: true, sets: 1 }, sets: [hold(30, { side: 'L' }), hold(25, { side: 'R' })] },
      { id: LIFT, target: { id: LIFT, sets: 3, reps: 5, weight: 60, mode: 'reps' }, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, hold(20, { w: 60 })] },
    ])
    act(() => finishWorkout())
    const rows = [...block(topSheet()).querySelectorAll('.item')].map(n => n.querySelector('.small').textContent)
    expect(rows).toEqual(['Today: L 0:30  ·  R 0:25', 'Today: 60 kg × 5, 5  ·  60 kg × 0:20'])
  })

  it('History detail names the side of a per-side hold too', () => {
    const w = { id: 'w1', d: '2026-11-08', start: new Date(2026, 10, 8, 18).getTime(), end: new Date(2026, 10, 8, 18, 20).getTime(), name: 'Core', vol: 0, prs: [], routineIds: [],
      entries: [{ id: HOLD, target: { ...cfg, side: true, sets: 1 }, sets: [hold(30, { side: 'L' }), hold(25, { side: 'R' })] }] }
    const st = clone(DEF)
    Object.assign(st, { unit: 'kg', routines: [], workouts: [w], active: null })
    useStore.setState({ S: st, user: null })
    act(() => { workoutDetailSheet(w) })
    const sets = [...topSheet().querySelectorAll('.wd-set')].map(n => n.textContent)
    expect(sets).toEqual(['L 0:30', 'R 0:25'])
  })
})
