// @vitest-environment happy-dom
// Saving the #203 editor with every set unticked or removed: it would save a workout with nothing
// in it, which the history still lists and counts as a training day. It offers to delete the
// workout instead, with Keep editing as the way back to the sets.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { editCompletedSession } from '../lib/session-edit.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), restOver: vi.fn(), vibrate: vi.fn(), unlock: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const done = (id, w) => ({ id, target: { sets: 1, reps: 5, weight: w }, sets: [{ w, r: 5, done: true }] })
const saved = { id: 'saved', d: '2026-09-22', start: 1000, end: 2000, routineIds: [], name: 'Push', entries: [done('0025', 80), done('0027', 60)], prs: [] }
const other = { id: 'other', d: '2026-09-20', start: 0, end: 1, routineIds: [], name: 'Pull', entries: [done('0027', 55)], prs: [] }

let root
let container
let sheetRoot
let sheetContainer

function renderEditor(extra = {}) {
  const S = clone(DEF)
  S.workouts = [clone(other), { ...clone(saved), ...extra }]
  S.workoutView = 'list'
  editCompletedSession(S, 'saved')
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
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
// Sheets render through nested act() calls, so they are opened before an act() that taps them.
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const S = () => useStore.getState().S
const untickAll = () => act(() => useStore.getState().update(s => { s.active.entries.forEach(e => e.sets.forEach(set => { set.done = false })) }))
const tapSave = () => act(() => container.querySelector('button[aria-label="Save changes"]').click())

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  root = null; container = null; sheetRoot = null; sheetContainer = null
})

afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('saving an edit that leaves no set', () => {
  it('asks to delete the workout instead; Keep editing goes back with nothing saved', () => {
    renderEditor()
    untickAll()
    tapSave()

    const dialog = renderTopSheet()
    expect(dialog.querySelector('h3').textContent).toBe('Delete workout?')
    expect(dialog.textContent).toContain('No sets are left in this workout, so there is nothing to save. Delete it from your history?')
    expect(button(dialog, 'Delete workout').className).toContain('danger')
    act(() => button(dialog, 'Keep editing').click())

    expect(useUI.getState().sheets).toHaveLength(0)
    expect(S().active.editingWorkoutId).toBe('saved')
    expect(S().workouts.find(w => w.id === 'saved').entries).toHaveLength(2)
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('says the workout\'s photos and videos go with it, when it has any', () => {
    const ref = n => ({ kind: 'image', hash: String(n).repeat(64), mime: 'image/webp', size: 10, width: 8, height: 6, at: 1 })
    renderEditor({ media: [ref(1), ref(2), ref(3)] })
    untickAll()
    tapSave()
    expect(renderTopSheet().textContent).toContain('Delete it from your history? Its 3 photos or videos are deleted with it.')
  })

  it('Delete workout takes it out of the history and closes the editor', () => {
    renderEditor()
    untickAll()
    tapSave()
    const remove = button(renderTopSheet(), 'Delete workout')
    act(() => remove.click())

    expect(S().active).toBeNull()
    expect(S().workouts.map(w => w.id)).toEqual(['other'])
    expect(useUI.getState().toastMsg).toBe('Workout deleted')
  })

  it('asks the same when every exercise was removed, and from the close button’s Save changes', () => {
    renderEditor()
    act(() => useStore.getState().update(s => { s.active.entries = [] }))
    act(() => container.querySelector('button[aria-label="Close editor"]').click())
    const save = button(renderTopSheet(), 'Save changes')
    act(() => save.click())

    const dialog = renderTopSheet()
    expect(dialog.querySelector('h3').textContent).toBe('Delete workout?')
    act(() => button(dialog, 'Delete workout').click())
    expect(S().workouts.map(w => w.id)).toEqual(['other'])
  })

  it('an edit with a set left saves as before, with no question', () => {
    renderEditor()
    act(() => useStore.getState().update(s => { s.active.entries[1].sets[0].done = false }))
    tapSave()

    expect(useUI.getState().sheets).toHaveLength(0)
    expect(S().active).toBeNull()
    const kept = S().workouts.find(w => w.id === 'saved')
    expect(kept.entries.map(e => e.id)).toEqual(['0025'])
    expect(useUI.getState().toastMsg).toBe('Workout updated')
  })
})
