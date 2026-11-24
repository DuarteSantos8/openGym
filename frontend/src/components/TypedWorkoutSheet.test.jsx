// @vitest-environment happy-dom
// Log a past workout → "Type it out instead": each line says what it was read as while you type,
// a line that cannot be read says why and holds Save back, a tap on a line picks another exercise,
// and Save files the workout through lib/log-workout.js on the day picked.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { logPastWorkoutSheet, typedWorkoutSheet } from '../sheets.jsx'
import { TypedWorkout, typedSetsText } from './TypedWorkoutSheet.jsx'

const mounted = []
const mount = el => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const mountTopSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  return mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const type = (host, value) => act(() => {
  const el = host.querySelector('[data-typed-workout]')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const rows = host => [...host.querySelectorAll('[data-typed-row]')]
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const save = host => button(host, 'Save workout')

let toast
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 24, 21, 0))
  toast = vi.fn()
  useUI.setState({ sheets: [], toasts: [], toast })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', active: null, routines: [], workouts: [], customEx: [], exAliases: {}, exWeights: {} } }))
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }); vi.useRealTimers() })

describe('typing a past workout', () => {
  it('opens from Log a past workout, on the day picked there', () => {
    logPastWorkoutSheet()
    const past = mountTopSheet()
    act(() => { button(past, 'Type it out instead').click() })
    const sheets = useUI.getState().sheets
    expect(sheets).toHaveLength(1)
    const host = mountTopSheet()
    expect(host.querySelector('h3').textContent).toBe('Type a workout')
    expect(host.querySelector('[data-datefield]')).toBeTruthy()
    // nothing typed, nothing to save
    expect(save(host).disabled).toBe(true)
  })

  it('shows every line as it was read, and Save waits for the one it cannot read', () => {
    typedWorkoutSheet()
    const host = mountTopSheet()
    type(host, 'Bench press 60x8, 60x8, 62.5x6\nSquat 100kg\nPlank 3x60s')
    expect(rows(host).map(r => r.dataset.typedRow)).toEqual(['ok', 'reps', 'ok'])
    expect(rows(host)[0].textContent).toMatch(/barbell bench press/i)
    expect(rows(host)[0].textContent).toContain('2 × 8 reps · 60 kg, 6 reps · 62.5 kg')
    expect(rows(host)[1].textContent).toContain('How many reps?')
    expect(rows(host)[2].textContent).toContain('3 × 1:00')
    expect(host.textContent).toContain('1 line still needs a look.')
    expect(save(host).disabled).toBe(true)
    type(host, 'Bench press 60x8, 60x8, 62.5x6\nSquat 100kg 5x5\nPlank 3x60s')
    expect(rows(host).map(r => r.dataset.typedRow)).toEqual(['ok', 'ok', 'ok'])
    expect(save(host).disabled).toBe(false)
  })

  it('Save files the workout on the day, says so and closes', () => {
    typedWorkoutSheet({ date: '2026-11-20', time: '07:30', dur: 45 })
    const host = mountTopSheet()
    type(host, 'Bench press 60x8, 62,5x6\nPull-ups 3x8 felt strong')
    act(() => { save(host).click() })
    const [w] = useStore.getState().S.workouts
    expect(w.d).toBe('2026-11-20')
    expect(w.start).toBe(new Date(2026, 10, 20, 7, 30).getTime())
    expect(w.end - w.start).toBe(45 * 60000)
    expect(w.entries.map(e => e.id)).toEqual(['0025', '0652'])
    expect(w.entries[0].sets).toEqual([{ w: 60, r: 8, done: true }, { w: 62.5, r: 6, done: true }])
    expect(w.entries[1].note).toBe('felt strong')
    expect(toast).toHaveBeenCalledWith('Workout saved')
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('the same workout twice is not filed again', () => {
    typedWorkoutSheet({ date: '2026-11-20' })
    let host = mountTopSheet()
    type(host, 'Squat 100kg 5x5')
    act(() => { save(host).click() })
    typedWorkoutSheet({ date: '2026-11-20' })
    host = mountTopSheet()
    type(host, 'Squat 100kg 5x5')
    act(() => { save(host).click() })
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(toast).toHaveBeenLastCalledWith('That workout is already in your history.')
  })

  it('a day that has not finished yet is refused, as on the other sheet', () => {
    typedWorkoutSheet({ date: '2026-11-24', time: '20:30', dur: 60 })
    const host = mountTopSheet()
    type(host, 'Squat 100kg 5x5')
    act(() => { save(host).click() })
    expect(useStore.getState().S.workouts).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith('That’s still in the future. Try an earlier start.')
  })

  it('a tap on a line picks another exercise for that name', () => {
    const pickExercise = vi.fn()
    const host = mount(<TypedWorkout initial={{ date: '2026-11-20' }} close={() => {}} pickExercise={pickExercise} />)
    type(host, 'bench 60x8')
    expect(rows(host)[0].textContent).toMatch(/barbell bench press/i)
    act(() => { rows(host)[0].querySelector('button').click() })
    expect(pickExercise).toHaveBeenCalledWith(expect.any(Function), { title: 'bench', like: '0025' })
    act(() => { pickExercise.mock.calls[0][0]({ id: '0289' }) })
    expect(rows(host)[0].textContent).toMatch(/dumbbell bench press/i)
    // the pick stays with the name while other lines come and go
    type(host, 'Squat 5x5 100\nbench 60x8')
    expect(rows(host)[1].textContent).toMatch(/dumbbell bench press/i)
  })

  it('a line with no exercise found says so', () => {
    const host = mount(<TypedWorkout initial={{ date: '2026-11-20' }} close={() => {}} pickExercise={vi.fn()} />)
    type(host, 'qwzxv 3x10')
    expect(rows(host)[0].dataset.typedRow).toBe('match')
    expect(rows(host)[0].textContent).toContain('No exercise by that name.')
  })

  it('not while a workout is running', () => {
    useStore.setState(s => ({ S: { ...s.S, active: { id: 'a', entries: [] } } }))
    typedWorkoutSheet()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith('Finish the current workout first.')
  })
})

describe('what a line was read as', () => {
  it('cardio in the profile’s distance unit, body weight said as such', () => {
    expect(typedSetsText({ mode: 'cardio', sets: [{ minutes: 20, distance: 3 }] }, { unit: 'kg' })).toBe('20 min · 3 km')
    expect(typedSetsText({ mode: 'reps', sets: [{ reps: 12, bw: true }, { reps: 10, bw: true }] }, { unit: 'kg' })).toBe('12 reps · Bodyweight, 10 reps · Bodyweight')
    expect(typedSetsText({ mode: 'reps', sets: [{ reps: 5, weight: 225 }, { reps: 5, weight: 225 }, { reps: 5, weight: 225, rpe: 9 }] }, { unit: 'lb' })).toBe('2 × 5 reps · 225 lb, 5 reps · 225 lb · RPE 9')
  })
})
