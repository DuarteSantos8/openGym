// @vitest-environment happy-dom
// The run/walk ladder (lib/circuit.js): a finished session that earns the next level used to move
// the routine the moment the run ended, before the workout was saved, so a run that was then
// discarded still counted. The step is now taken with the save, and the end screen says it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { useCircuit } from './store/useCircuit.js'
import { finishWorkoutNow } from './sheets.jsx'
import CircuitPlayer from './components/CircuitPlayer.jsx'
import { cleanCircuit, PREP_SEC } from './lib/circuit.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []

// The third session on level 1: finishing it as planned earns level 2.
const third = cleanCircuit({ mode: 'intervals', program: 'runwalk', level: 1, n: 2 })
const rows = n => Array.from({ length: n }, () => ({ w: 0, sec: third.work, done: false }))

function install() {
  const st = clone(DEF)
  st.sound = false
  st.spokenCues = false
  st.routines = [{ id: 'rw', name: 'Run/walk', ex: [{ id: '0685', sets: third.rounds, mode: 'time', sec: third.work, sg: 'g', sgCircuit: { ...third } }] }]
  st.workouts = []
  st.active = {
    id: 'w-rw', d: '2026-11-10', start: Date.now(), routineIds: ['rw'], routineId: 'rw', name: 'Run/walk', bw: null, cur: 0,
    entries: [{ id: '0685', rid: 'rw', sg: 'g', target: { mode: 'time', sets: third.rounds, sec: third.work, sg: 'g', sgCircuit: { ...third } }, sets: rows(third.rounds) }],
  }
  useStore.setState({ S: st, user: null })
}

// The whole session, start to end, as the clock runs it.
function runToTheEnd() {
  const c = useCircuit.getState()
  c.openAt(0)
  c.start()
  vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + 2 * 3600_000)
  useCircuit.getState().tick()
}
const level = () => S().routines[0].ex[0].sgCircuit

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  localStorage.clear()
  useCircuit.getState().reset()
  useUI.setState({ sheets: [], timer: null, work: null })
  install()
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
  useCircuit.getState().reset()
  vi.useRealTimers()
})

describe('run/walk: the next level comes with the save', () => {
  it('a finished run leaves the routine alone until the workout is saved', () => {
    runToTheEnd()
    const result = useCircuit.getState().result
    expect(result.ended).toBe('done')
    // noted on the session, not taken yet
    expect(level()).toMatchObject({ level: 1, n: 2 })
    expect(S().active.circuits[0].advance).toMatchObject({ rid: 'rw', sg: 'g', to: { level: 2, n: 0 } })
    act(() => finishWorkoutNow())
    expect(level()).toMatchObject({ level: 2, n: 0 })
    // the saved workout keeps its result without the step
    const saved = S().workouts.at(-1)
    expect(saved.circuits[0]).toMatchObject({ mode: 'intervals', ended: 'done' })
    expect(saved.circuits[0].advance).toBeUndefined()
  })

  it('a discarded workout does not count its run', () => {
    runToTheEnd()
    expect(useCircuit.getState().result.ended).toBe('done')
    // Discard (views/Workout.jsx discardNow): the session goes, nothing is saved.
    act(() => useStore.getState().update(s => { s.active = null }))
    expect(level()).toMatchObject({ level: 1, n: 2 })
    expect(S().workouts).toHaveLength(0)
  })

  it('a run stopped early earns nothing, saved or not', () => {
    const c = useCircuit.getState()
    c.openAt(0); c.start()
    vi.setSystemTime(1_000_000 + PREP_SEC * 1000 + 60_000)
    useCircuit.getState().tick()
    useCircuit.getState().stop()
    if (useCircuit.getState().ask) useCircuit.getState().finish(0)
    expect(S().active.circuits[0].advance).toBeUndefined()
    act(() => finishWorkoutNow())
    expect(level()).toMatchObject({ level: 1, n: 2 })
  })

  it('the end screen says which level is next', () => {
    runToTheEnd()
    useCircuit.setState({ open: true })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    act(() => root.render(<CircuitPlayer />))
    const line = host.querySelector('[data-level-up]')
    expect(line).toBeTruthy()
    expect(line.textContent).toContain('Level 2 next time')
  })

  it('no level line when the session does not finish the level', () => {
    const second = cleanCircuit({ mode: 'intervals', program: 'runwalk', level: 1, n: 1 })
    useStore.getState().update(s => {
      s.routines[0].ex[0].sgCircuit = { ...second }
      s.active.entries[0].target.sgCircuit = { ...second }
    })
    runToTheEnd()
    useCircuit.setState({ open: true })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push(root)
    act(() => root.render(<CircuitPlayer />))
    expect(host.querySelector('[data-level-up]')).toBe(null)
    // the session still counts on the level once saved: 2 of 3
    expect(level()).toMatchObject({ level: 1, n: 1 })
    act(() => finishWorkoutNow())
    expect(level()).toMatchObject({ level: 1, n: 2 })
  })
})
