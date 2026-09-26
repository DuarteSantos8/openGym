// @vitest-environment happy-dom
import { LANGS, DERIVED_LOCALES } from './lib/i18n-core.js'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { swapActiveWorkoutExercise } from './sheets.jsx'
import { EXDB } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { occurrenceFor } from './lib/session-start.js'

const clone = value => JSON.parse(JSON.stringify(value))
const ids = EXDB.slice(0, 3).map(exercise => exercise.id)

function entry(id, done = false, index = 0) {
  return {
    id, exposureId: `exposure-${index}`,
    target: { mode: 'reps', sets: 1, reps: 5, weight: 40 },
    sets: [{ w: 40, r: 5, done }]
  }
}

function installActive() {
  const S = clone(DEF)
  Object.assign(S, { prescriptions: {}, oneRepMaxes: {}, progression: {} })
  const A = {
    id: 'swap-test', d: '2026-08-27', start: Date.now(), routineId: null,
    name: 'Swap test', bw: null, cur: 1,
    entries: [entry(ids[0], false, 0), entry(ids[0], false, 1), entry(ids[1], false, 2)],
    exposures: [0, 1, 2].map(index => ({
      exposureId: `exposure-${index}`,
      exerciseId: index < 2 ? ids[0] : ids[1],
      occurrenceId: `occurrence-${index}`,
    })),
  }
  useStore.setState({ S, A, user: null })
}

function submitSwap(index, exercise, config) {
  swapActiveWorkoutExercise(index)
  const picker = useUI.getState().sheets.at(-1)
  const pickerView = picker.render(picker.close)
  act(() => pickerView.props.onPick(exercise))
  const configSheet = useUI.getState().sheets.at(-1)
  const configView = configSheet.render(configSheet.close)
  act(() => configView.props.onSave(config))
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], timer: null, work: null })
  installActive()
})

describe('active exercise swap sheet flow', () => {
  it('invalidates a timed callback and replaces only the selected duplicate', () => {
    const callback = vi.fn()
    useUI.getState().startWork(5, 'Hold', callback)

    submitSwap(1, EXDB[2], { ...occurrenceFor(EXDB[2].id, { sets: 2, reps: 8, weight: 30 }, { id: 'replacement' }), note: 'New target' })
    vi.advanceTimersByTime(10_000)

    const active = useStore.getState().A
    expect(useUI.getState().work).toBeNull()
    expect(callback).not.toHaveBeenCalled()
    expect(active.entries.map(value => value.id)).toEqual([ids[0], ids[2], ids[1]])
    expect(active.entries[1].target).toMatchObject({ sets: 2, reps: 8, weight: 30 })
    expect(active.entries.map(value => value.exposureId)).toEqual(active.exposures.map(value => value.exposureId))
    expect(prescriptionAt(active, 1).preset).toBe('manual')
    expect(active.entries[0].sets).toEqual([{ w: 40, r: 5, done: false }])
    expect(active.entries[2].sets).toEqual([{ w: 40, r: 5, done: false }])
    expect(active.cur).toBe(1)
  })

  it('keeps logged work on its old exposure and inserts a fresh replacement pair', () => {
    useStore.getState().updateActive(active => { active.entries[1].sets[0].done = true })
    submitSwap(1, EXDB[2], occurrenceFor(EXDB[2].id, { sets: 1, reps: 8, weight: 30 }, { id: 'replacement' }))
    const confirm = useUI.getState().sheets.at(-1)
    act(() => { confirm.render(confirm.close).props.onConfirm() })

    const active = useStore.getState().A
    expect(active.entries.map(value => value.id)).toEqual([ids[0], ids[0], ids[2], ids[1]])
    expect(active.entries.map(value => value.exposureId)).toEqual(active.exposures.map(value => value.exposureId))
    expect(active.entries[1].sets[0].done).toBe(true)
  })
})

function prescriptionAt(active, index) {
  return useStore.getState().S.prescriptions[active.exposures[index].prescriptionId]
}

describe('active exercise swap locale coverage', () => {
  const required = [
    'Swap exercise',
    'Swap exercise?',
    'Logged sets stay with the original exercise. Choose where the replacement belongs.',
    'Keep replacement in this group',
    'Insert after this group',
    'Logged sets stay with the original exercise. The replacement will be inserted afterward.'
  ]
  const packs = import.meta.glob('./locales/*.js', { eager: true, import: 'default' })

  it('defines every new prompt in all twelve locale packs', () => {
    // Minus English (the source language) and minus any derived locale, which transforms its
    // base language's pack at load time instead of shipping one.
    const packed = Object.keys(LANGS).filter(code => code !== 'en' && !DERIVED_LOCALES[code])
    expect(Object.keys(packs)).toHaveLength(packed.length)
    Object.entries(packs).forEach(([path, pack]) => {
      required.forEach(key => expect(pack, `${path} is missing ${key}`).toHaveProperty(key))
    })
  })
})
