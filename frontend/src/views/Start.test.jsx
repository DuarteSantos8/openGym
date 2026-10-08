// @vitest-environment happy-dom
// Start is the dedicated workout launch point: today's planned session, fixed
// duration presets (never a slider), an optional weigh-in, then the start.
// Starting goes straight into the session — no weigh-in sheet interrupts —
// carrying the last logged weight (or none).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { setNav } from '../lib/nav.js'
import Start, { START_PRESETS, presetExerciseCount, presetExerciseIds } from './Start.jsx'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
// Real session builders (beginWorkout/beginSubsetWorkout), stubbed sheets: the
// tests pin that starting creates the session and where it navigates.
vi.mock('../sheets.jsx', async importOriginal => {
  const mod = await importOriginal()
  return { ...mod, bwSheet: vi.fn(), starterPlanSheet: vi.fn() }
})
import { bwSheet } from '../sheets.jsx'

const ex = n => Array.from({ length: n }, (_, i) => ({ id: 'e' + i }))
const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: ex(6) }]

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  nav.mockClear(); bwSheet.mockClear()
  setNav(nav)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); setNav(() => {}) })
afterEach(() => useStore.setState(s => ({ S: { ...s.S, active: null } })))

const setS = (over = {}) => useStore.setState(s => ({
  S: {
    ...s.S, routines, dayPlan: {}, workouts: [], active: null, bodyweight: [], workoutLength: 35,
    week: { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] }, ...over,
  },
  user: null,
}))
const mount = el => act(() => root.render(el))
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const active = () => useStore.getState().S.active

describe('Start presets', () => {
  it('offers exactly the four duration presets, not a slider', () => {
    expect(START_PRESETS).toEqual([15, 25, 35, 45])
    setS(); mount(<Start />)
    expect(host.querySelector('input[type="range"], .sld')).toBeFalsy()
    for (const p of START_PRESETS) expect(button(p + ' min')).toBeTruthy()
  })

  it('maps presets onto the routine as a strictly increasing ladder', () => {
    const r = { ex: ex(6) }
    const counts = START_PRESETS.map(p => presetExerciseCount(r, p))
    expect(counts).toEqual([3, 4, 5, 6])
    expect(presetExerciseCount(null, 25)).toBe(0)
    // Small routines clamp instead of inventing exercises.
    expect(START_PRESETS.map(p => presetExerciseCount({ ex: ex(2) }, p))).toEqual([2, 2, 2, 2])
    expect(START_PRESETS.map(p => presetExerciseCount({ ex: ex(5) }, p))).toEqual([3, 4, 5, 5])
  })

  it('picking a preset persists the preference and previews the session', () => {
    setS(); mount(<Start />)
    click(button('25 min'))
    expect(useStore.getState().S.workoutLength).toBe(25)
    expect(host.querySelector('.narrow').textContent).toContain('4 exercises')
  })

  it('a short preset starts the trimmed session, a full one the whole plan', () => {
    setS({ bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }] }); mount(<Start />)
    click(button('15 min'))
    click(button('Start Push'))
    expect(bwSheet).not.toHaveBeenCalled()
    expect(active().entries.map(e => e.id)).toEqual(['e0', 'e1', 'e2'])
    expect(active().bw).toBe(80)
    expect(nav).toHaveBeenCalledWith('/workout')
  })

  it('35 and 45 minutes generate genuinely different sessions', () => {
    setS(); mount(<Start />)
    click(button('35 min'))
    expect(host.querySelector('.narrow').textContent).toContain('5 exercises')
    click(button('Start Push'))
    expect(active().entries.map(e => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
    act(() => useStore.setState(s => ({ S: { ...s.S, active: null } })))
    click(button('45 min'))
    click(button('Start Push'))
    expect(active().entries.map(e => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
  })

  it('a full preset starts the whole plan without asking for weight', () => {
    setS(); mount(<Start />)
    click(button('45 min'))
    click(button('Start Push'))
    expect(bwSheet).not.toHaveBeenCalled()
    expect(active().entries.map(e => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
    expect(active().bw).toBe(null)
    expect(nav).toHaveBeenCalledWith('/workout')
  })

  it('the weigh-in stays optional and separate from starting', () => {
    setS({ bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }] }); mount(<Start />)
    click(button('Update'))
    expect(bwSheet).toHaveBeenCalled()
    expect(active()).toBe(null)
  })

  it('a rest day shows recovery with the secondary doors, and freestyle starts directly', () => {
    setS({ week: {} }); mount(<Start />)
    expect(host.querySelector('.narrow').textContent).toContain('Recovery')
    click(button('Freestyle workout'))
    expect(bwSheet).not.toHaveBeenCalled()
    expect(active().name).toBe('Freestyle')
    expect(nav).toHaveBeenCalledWith('/workout')
  })

  it('other routines and the exercise browser stay reachable', () => {
    setS({ routines: [...routines, { id: 'r2', name: 'Pull', emoji: null, ex: ex(2) }], week: {} }); mount(<Start />)
    expect(host.querySelector('.narrow').textContent).toContain('Pull')
    const pullRow = [...host.querySelectorAll('.item')].find(el => el.textContent.includes('Pull'))
    click(pullRow)
    expect(active().routineIds).toEqual(['r2'])
    expect(nav).toHaveBeenCalledWith('/workout')
    act(() => useStore.setState(s => ({ S: { ...s.S, active: null } })))
    click(button('Browse exercises'))
    expect(nav).toHaveBeenCalledWith('/library')
  })

  it('a running session resumes instead of offering a new start', () => {
    setS({ active: { id: 'a', name: 'Push', start: Date.now(), cur: 0, entries: [] } }); mount(<Start />)
    click(button('Resume workout'))
    expect(nav).toHaveBeenCalledWith('/workout')
    expect(bwSheet).not.toHaveBeenCalled()
  })

  it('the started session is persisted, so a reload resumes it intact', () => {
    setS({ bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }] }); mount(<Start />)
    click(button('25 min'))
    click(button('Start Push'))
    const stored = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(stored.active.id).toBe(active().id)
    expect(stored.active.entries.map(e => e.id)).toEqual(['e0', 'e1', 'e2', 'e3'])
    expect(stored.active.bw).toBe(80)
  })
})

describe('preset selection scenarios', () => {
  // Real catalogue ids across four primary groups (0025 and 0047 share one).
  const fiveIds = ['0025', '0031', '0047', '0334', '0241']
  const fiveRoutine = () => ({ id: 'r1', name: 'Five', emoji: null, ex: fiveIds.map(id => ({ id, sets: 3, reps: 10, weight: 20 })) })
  // Saved sessions as the app writes them, stamped to this routine.
  const logged = (id, n, d0) => Array.from({ length: n }, (_, i) => ({
    d: `2026-02-${String(d0 + i).padStart(2, '0')}`, routineIds: ['r1'],
    entries: [{
      id, rid: 'r1', planned: { sets: 3, reps: 10, weight: 20 }, target: { sets: 3, reps: 10, weight: 20 },
      sets: [{ w: 20, r: 10, done: true }, { w: 20, r: 10, done: true }, { w: 20, r: 10, done: true }],
    }],
  }))
  const fiveS = (...workouts) => ({ routines: [fiveRoutine()], workouts })
  const S = () => useStore.getState().S

  it('a new user with no history gets group coverage in routine order, not the head slice', () => {
    setS(fiveS())
    // The head slice would repeat the first group (…0025, 0047…); coverage keeps
    // one movement per group instead.
    expect(presetExerciseIds(fiveRoutine(), S(), 15)).toEqual(['0025', '0031', '0334'])
  })

  it('a returning user gets proven movements with coverage, and longer presets extend the same list', () => {
    // Old dates on purpose: a missed period still counts as evidence, deterministically.
    setS(fiveS(...logged('0025', 1, 1), ...logged('0031', 1, 2), ...logged('0047', 1, 3), ...logged('0241', 3, 4)))
    const ids = p => presetExerciseIds(fiveRoutine(), S(), p)
    expect(ids(15)).toEqual(['0025', '0031', '0241'])
    expect(ids(25)).toEqual(['0025', '0031', '0241', '0047'])
    expect(ids(35)).toEqual(fiveIds)
    expect(ids(45)).toEqual(fiveIds)
    // Shorter presets are strict prefixes of longer ones, always inside the
    // routine — so a short session can never demand equipment the plan does
    // not already need. Order is the coverage-ranked core first (each tier in
    // routine order), which is what keeps one movement per group up front.
    for (const p of START_PRESETS) {
      const list = ids(p)
      expect(list.every(id => fiveIds.includes(id))).toBe(true)
    }
    expect(ids(25).slice(0, 3)).toEqual(ids(15))
    // The full session is the plan itself, in exact routine order — trimmed
    // presets nest inside each other, not inside the full list.
    expect(ids(35)).toEqual(fiveIds)
    expect(ids(45)).toEqual(fiveIds)
  })

  it('a 15-minute start trains the proven subset in the session itself', () => {
    setS(fiveS(...logged('0025', 1, 1), ...logged('0031', 1, 2), ...logged('0047', 1, 3), ...logged('0241', 3, 4)))
    mount(<Start />)
    click(button('15 min'))
    click(button('Start Five'))
    expect(bwSheet).not.toHaveBeenCalled()
    expect(active().entries.map(e => e.id)).toEqual(['0025', '0031', '0241'])
    expect(nav).toHaveBeenCalledWith('/workout')
  })
})

describe('Home and Start share one today', () => {
  it('names the same planned workout from the same plan data', () => {
    setS()
    mount(<Home />)
    const homeName = host.querySelector('.today-row .ttl').textContent
    mount(<Start />)
    expect(host.querySelector('.narrow').textContent).toContain(homeName)
    expect(homeName).toContain('Push')
  })

  it('the Home shortcut enters the same flow as the Start tab', () => {
    setS()
    mount(<Home />)
    click(host.querySelector('.today-row'))
    expect(nav).toHaveBeenCalledWith('/start')
  })
})
