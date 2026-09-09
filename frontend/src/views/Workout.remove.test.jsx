// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { removeActiveExercise } from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { LANGS } from '../lib/i18n-core.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const entry = (id, sg) => ({
  id,
  ...(sg ? { sg } : {}),
  target: { sets: 1, reps: 1 },
  sets: [{ w: 0, r: 1, done: false }]
})

let root
let container
let sheetRoot
let sheetContainer

function setActive(entries, cur = 0) {
  const S = clone(DEF)
  S.wc = { ...S.wc, exerciseButtons: true }   // the removal button is opt-in now; the menu path is covered in Workout.test.jsx
  S.active = {
    id: 'remove-test', d: '2026-08-11', start: Date.now(), routineId: null,
    name: 'Remove test', bw: null, cur, entries
  }
  useStore.setState({ S, user: null })
}

function renderWorkout(entries) {
  setActive(entries)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

function removeButton() {
  return [...container.querySelectorAll('button')].find(button => button.textContent.includes('Remove exercise'))
}

function renderTopSheet() {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  const sheet = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  sheetContainer = document.createElement('div')
  document.body.appendChild(sheetContainer)
  sheetRoot = createRoot(sheetContainer)
  act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return sheetContainer
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  useStore.setState({ S: clone(DEF), user: null })
  root = null
  container = null
  sheetRoot = null
  sheetContainer = null
})

afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('active-session exercise removal', () => {
  it('disables removal for the whole duration of a timed hold', () => {
    renderWorkout([entry('1001')])
    expect(removeButton()).toBeTruthy()
    expect(removeButton().disabled).toBe(false)

    act(() => useUI.getState().startWork(30, 'Hold', vi.fn()))

    expect(removeButton().disabled).toBe(true)
  })

  it('cancels a pending timed callback before indexes shift and cleans a one-member group', () => {
    setActive([entry('1001', 'sg-1'), entry('1002', 'sg-1'), entry('1003')], 1)
    expect(useStore.getState().S.active.cur).toBe(1)
    const wrongWrite = vi.fn(elapsed => {
      useStore.getState().update(s => { s.active.entries[0].sets[0].sec = elapsed })
    })
    useUI.getState().startWork(5, 'Hold', wrongWrite)

    removeActiveExercise(0)
    vi.advanceTimersByTime(10_000)

    const active = useStore.getState().S.active
    expect(useUI.getState().work).toBeNull()
    expect(wrongWrite).not.toHaveBeenCalled()
    expect(active.entries.map(e => e.id)).toEqual(['1002', '1003'])
    expect(active.cur).toBe(0)
    expect(active.entries[0].sg).toBeUndefined()
    expect(active.entries[0].sets[0].sec).toBeUndefined()
  })

  it('cancels a running rest countdown when the exercise it belongs to is removed', () => {
    setActive([entry('1001'), entry('1002')], 0)
    useUI.getState().startRest(90, 0)
    expect(useUI.getState().timer).not.toBeNull()

    act(() => { removeActiveExercise(0) })

    expect(useUI.getState().timer).toBeNull()
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1002'])
  })

  it('keeps a rest countdown that belongs to another exercise, re-pointed at it', () => {
    setActive([entry('1001'), entry('1002'), entry('1003')], 1)
    useUI.getState().startRest(90, 1)

    act(() => { removeActiveExercise(0) })
    expect(useUI.getState().timer?.forIdx).toBe(0)
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1002', '1003'])

    act(() => { removeActiveExercise(1) })
    expect(useUI.getState().timer?.forIdx).toBe(0)
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1002'])

    act(() => { removeActiveExercise(0) })
    expect(useUI.getState().timer).toBeNull()
  })

  it('leaves a rest countdown without a known owner running', () => {
    setActive([entry('1001'), entry('1002')], 0)
    useUI.getState().startRest(90)

    act(() => { removeActiveExercise(0) })
    expect(useUI.getState().timer).not.toBeNull()
  })

  it('does not mutate before confirmation, leaves state unchanged on Cancel, and removes on Confirm', () => {
    renderWorkout([entry('1001'), entry('1002')])

    act(() => removeButton().click())
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1001', '1002'])

    let dialog = renderTopSheet()
    const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Cancel')
    act(() => cancel.click())
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1001', '1002'])

    act(() => removeButton().click())
    dialog = renderTopSheet()
    const confirm = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Remove')
    act(() => confirm.click())
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1002'])
  })

  it('uses the selected superset member occurrence rather than its exercise id', () => {
    renderWorkout([entry('1001', 'pair'), entry('1001', 'pair'), entry('1002')])
    useStore.getState().update(s => {
      s.active.entries[0].target.marker = 'keep-first'
      s.active.entries[1].target.marker = 'remove-second'
    }, false)

    act(() => removeButton().click())
    const chooser = renderTopSheet()
    const choices = [...chooser.querySelectorAll('.item')]
    expect(choices).toHaveLength(2)
    act(() => choices[1].click())

    const dialog = renderTopSheet()
    const confirm = [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Remove')
    act(() => confirm.click())

    const active = useStore.getState().S.active
    expect(active.entries.map(e => e.id)).toEqual(['1001', '1002'])
    expect(active.entries[0].target.marker).toBe('keep-first')
    expect(active.entries[0].sg).toBeUndefined()
  })

  it('hides the remove control for an empty freestyle session', () => {
    renderWorkout([])
    expect(removeButton()).toBeUndefined()
  })
})

describe('remove-exercise locale coverage', () => {
  const required = [
    'Remove {0}?',
    'The sets you logged for this exercise in this session will be lost.',
    'This removes the exercise from your current session.',
    'Remove',
    'Which exercise in this superset do you want to remove?'
  ]
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  // Every non-English language has its own pack (English is the source, so it has none) —
  // derived from LANGS rather than hardcoded so adding a language doesn't silently
  // understate this test's own coverage.
  const nonEnglishLangCount = Object.keys(LANGS).length - 1

  it('defines every new prompt in every non-English locale pack', () => {
    expect(Object.keys(packs)).toHaveLength(nonEnglishLangCount)
    Object.entries(packs).forEach(([path, pack]) => {
      required.forEach(key => expect(pack, `${path} is missing ${key}`).toHaveProperty(key))
    })
  })
})

describe('remove-exercise edge cases', () => {
  it('removing the last remaining exercise leaves an empty, coherent session', () => {
    setActive([entry('a')], 0)
    act(() => { removeActiveExercise(0) })
    const A = useStore.getState().S.active
    expect(A.entries).toHaveLength(0)
    expect(A.cur).toBe(0)
  })

  it('removing one half of a two-member superset dissolves the group', () => {
    setActive([entry('a', 'g1'), entry('b', 'g1'), entry('c')], 0)
    act(() => { removeActiveExercise(1) })
    const A = useStore.getState().S.active
    expect(A.entries.map(e => e.id)).toEqual(['a', 'c'])
    // A superset of one is not a superset.
    expect(A.entries[0].sg).toBeUndefined()
  })

  it('removing an entry below the active one keeps cur on the same exercise', () => {
    setActive([entry('a'), entry('b'), entry('c')], 2)
    act(() => { removeActiveExercise(0) })
    const A = useStore.getState().S.active
    expect(A.entries.map(e => e.id)).toEqual(['b', 'c'])
    expect(A.entries[A.cur].id).toBe('c')
  })

  it('persists the shortened active session for reload without changing completed history', () => {
    const first = entry('same')
    first.target.marker = 'keep-first'
    const second = entry('same')
    second.target.marker = 'remove-second'
    setActive([first, second, entry('other')], 1)
    const workouts = [{ id: 'completed', d: '2026-08-10', entries: [{ id: 'same', sets: [{ w: 42, r: 5, done: true }] }] }]
    useStore.setState(state => ({ S: { ...state.S, workouts: clone(workouts) } }))

    act(() => { removeActiveExercise(1) })

    const persisted = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(persisted.workouts).toEqual(workouts)
    expect(persisted.active.entries.map(e => e.id)).toEqual(['same', 'other'])
    expect(persisted.active.entries[0].target.marker).toBe('keep-first')
    expect(persisted.active.cur).toBe(1)

    useStore.setState({ S: Object.assign(clone(DEF), persisted), user: null })
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['same', 'other'])
    expect(useStore.getState().S.workouts).toEqual(workouts)
  })
})
