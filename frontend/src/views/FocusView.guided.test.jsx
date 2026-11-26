// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { guideFor } from '../lib/exercise-guide.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'
import * as speech from '../lib/speech.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => structuredClone(value)
let root, container, sheetRoot, sheetContainer
async function mount(settings, active) {
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  useStore.setState({ S: { ...clone(DEF), ...settings, active }, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root.render(<MemoryRouter><Workout /></MemoryRouter>) })
  await act(async () => { await vi.dynamicImportSettled() })
}
afterEach(() => {
  act(() => { sheetRoot?.unmount(); root?.unmount() })
  sheetContainer?.remove()
  container?.remove()
  root = container = sheetRoot = sheetContainer = null
})

describe('Guided workout', () => {
  const row = id => ({ id, rid: 'plan-a', target: { sets: 1, reps: 5 }, sets: [{ w: 0, r: 5, done: false }] })
  const plan = { id: 'plan-a', name: 'Strength', ex: [{ id: '1760', sets: 1, reps: 5 }] }
  const begin = (ids, settings = {}) => mount({ routines: [clone(plan)], ...settings }, {
    id: 'guided', d: '2026-11-26', start: Date.now(), name: 'Strength', cur: 0,
    workoutView: 'guided', routineId: plan.id, entries: ids.map(row),
  })
  const card = () => container.querySelector('.guided-card')
  const button = name => [...(card()?.querySelectorAll('button') || [])].find(b => b.textContent === name)
  const shown = () => [...card().querySelectorAll('li')].map(li => li.textContent)

  it('shows just the current guide; Next visits the next superset member without logging a set', async () => {
    await begin(['1760', '1197'])
    act(() => useStore.getState().update(s => { s.active.entries.forEach(e => { e.sg = 'pair' }) }))
    expect(card()).toBeTruthy()
    expect(shown()).toEqual(guideFor('1760').cues)
    expect(container.querySelectorAll('.focus-card-header h2')).toHaveLength(1)
    act(() => button('Next').click())
    expect(shown()).toEqual(guideFor('1197').cues)
    expect(useStore.getState().S.active.entries.every(e => !e.sets[0].done)).toBe(true)
    expect(button('Next').disabled).toBe(true)
    expect(button('Too hard')).toBeUndefined()
  })

  it('changes only this session to the easier exercise and announces what changed', async () => {
    await begin(['1760'])
    expect(button('Too hard')).toBeTruthy()
    act(() => button('Too hard').click())
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1197'])
    expect(useStore.getState().S.routines).toEqual([plan])
    expect(shown()).toEqual(guideFor('1197').cues)
    expect(useUI.getState().toastMsg).toContain(exerciseNameText(exOr('1197')))
    expect(button('Too hard')).toBeUndefined()
  })

  it('keeps logged work on the original exercise and only confirms the swap after approval', async () => {
    await begin(['1760'])
    act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].done = true }))
    const before = useUI.getState().toastMsg
    expect(button('Too hard')).toBeTruthy()
    act(() => button('Too hard').click())
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1760'])
    expect(useUI.getState().toastMsg).toBe(before)
    const sheet = useUI.getState().sheets.at(-1)
    sheetContainer = document.createElement('div')
    document.body.appendChild(sheetContainer)
    sheetRoot = createRoot(sheetContainer)
    act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    act(() => [...sheetContainer.querySelectorAll('button')].find(b => b.textContent === 'Continue').click())
    expect(useStore.getState().S.active.entries.map(e => e.id)).toEqual(['1760', '1197'])
    expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)
    expect(useUI.getState().toastMsg).toContain(exerciseNameText(exOr('1197')))
    expect(useStore.getState().S.routines).toEqual([plan])
  })

  it('speaks the visible text with an installed voice when enabled; changing sets does not repeat it', async () => {
    const voices = vi.spyOn(speech, 'listVoices').mockResolvedValue([{ id: 'local-en', lang: 'en-US' }])
    const speak = vi.spyOn(speech, 'speak').mockResolvedValue(true)
    const hush = vi.spyOn(speech, 'hush').mockImplementation(() => {})
    try {
      await begin(['1760', '1197'])
      expect(card()).toBeTruthy()
      expect(shown()).toEqual(guideFor('1760').cues)
      expect(speak).not.toHaveBeenCalled()
      await act(async () => useStore.getState().update(s => { s.spokenCues = true }))
      expect(voices).toHaveBeenCalledWith({ lang: 'en', offline: true })
      expect(speak).toHaveBeenCalledWith(shown().join(' '), expect.objectContaining({ lang: 'en' }))
      act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].r++ }))
      expect(speak).toHaveBeenCalledTimes(1)
      await act(async () => button('Next').click())
      expect(speak).toHaveBeenLastCalledWith(shown().join(' '), expect.objectContaining({ lang: 'en' }))
      act(() => useStore.getState().update(s => { s.spokenCues = false }))
      expect(hush).toHaveBeenCalled()
      expect(shown()).toEqual(guideFor('1197').cues)
    } finally { speak.mockRestore(); hush.mockRestore(); voices.mockRestore() }
  })

  it('keeps cues readable without an installed English voice', async () => {
    const voices = vi.spyOn(speech, 'listVoices').mockResolvedValue([])
    const speak = vi.spyOn(speech, 'speak').mockResolvedValue(true)
    try {
      await begin(['1760'], { spokenCues: true })
      await act(async () => {})
      expect(shown()).toEqual(guideFor('1760').cues)
      expect(voices).toHaveBeenCalledWith({ lang: 'en', offline: true })
      expect(speak).not.toHaveBeenCalled()
    } finally { speak.mockRestore(); voices.mockRestore() }
  })

  it('keeps the workout controls usable for a move without a form guide', async () => {
    await begin(['missing-guide'])
    expect(card()).toBeTruthy()
    expect(shown()).toEqual([])
    expect(button('Too hard')).toBeUndefined()
    expect(container.querySelector('button[aria-label="Complete set"]')).toBeTruthy()
  })
})
