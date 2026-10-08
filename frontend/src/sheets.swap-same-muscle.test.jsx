// @vitest-environment happy-dom
// #473: a swap opens on what trains the same muscle. Mid-workout (Swap exercise) and in the
// routine editor (Replace exercise) the picker starts on the exercises sharing the swapped one's
// target muscle, same equipment first, and "All" is one tap back to the whole list.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB } from './lib/exercises.js'
import { exercisePicker, swapActiveWorkoutExercise } from './sheets.jsx'
import { sameMuscleFirst } from './lib/similar-exercises.js'

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
const chips = host => [...host.querySelectorAll('.chips .chip')]
const chipByText = (host, text) => chips(host).find(b => b.textContent.trim() === text)
const sameChip = host => chips(host).find(b => b.textContent.trim().startsWith('Same muscle'))
const isOn = el => el.className.split(/\s+/).includes('on')
const rows = host => [...host.querySelectorAll('.list .item:not(.ex-new)')].map(r => r.querySelector('.ss').textContent)

// A cable triceps exercise: the catalogue has plenty of other triceps work, on cables and off.
const CABLE_TRI = EXDB.find(e => e.tg === 'triceps' && e.eq === 'cable')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('sameMuscleFirst', () => {
  it('keeps the same target muscle, drops the exercise itself, same equipment first, order kept otherwise', () => {
    const ex = { id: 'x', tg: 'triceps', eq: 'cable' }
    const list = [
      { id: 'a', tg: 'triceps', eq: 'dumbbell' },
      { id: 'x', tg: 'triceps', eq: 'cable' },
      { id: 'b', tg: 'biceps', eq: 'cable' },
      { id: 'c', tg: 'triceps', eq: 'cable' },
      { id: 'd', tg: 'triceps', eq: 'barbell' },
      { id: 'e', tg: 'triceps', eq: 'cable' }
    ]
    expect(sameMuscleFirst(list, ex).map(e => e.id)).toEqual(['c', 'e', 'a', 'd'])
    expect(sameMuscleFirst(list, { id: 'y' })).toEqual([])
  })
})

describe('swap picker opens on the same muscle', () => {
  it('mid-workout: Swap exercise starts on the target muscle, same equipment first, All goes back', () => {
    expect(CABLE_TRI).toBeTruthy()
    const S = structuredClone(DEF)
    const A = {
      id: 'w', d: '2026-10-08', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0,
      entries: [{ exposureId: 'tri-exposure', id: CABLE_TRI.id, target: { mode: 'reps', sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: false }] }]
    }
    useStore.setState({ S, A, user: null })
    swapActiveWorkoutExercise(0)
    const host = renderTop()

    const chip = sameChip(host)
    expect(chip.textContent).toContain('Triceps')
    expect(isOn(chip)).toBe(true)
    expect(isOn(chipByText(host, 'All'))).toBe(false)

    const listed = rows(host)
    expect(listed.length).toBeGreaterThan(1)
    expect(listed.every(s => s.startsWith('Triceps'))).toBe(true)
    // Cable first: once something else shows up, no cable exercise follows it.
    const firstOther = listed.findIndex(s => !s.endsWith('cable'))
    expect(listed[0].endsWith('cable')).toBe(true)
    if (firstOther > 0) expect(listed.slice(firstOther).some(s => s.endsWith('cable'))).toBe(false)
    // The exercise being swapped away is not offered as its own replacement.
    expect([...host.querySelectorAll('.list .item .tt')].map(x => x.textContent)).not.toContain(CABLE_TRI.n)

    act(() => chipByText(host, 'All').click())
    expect(isOn(chipByText(host, 'All'))).toBe(true)
    expect(rows(host).some(s => !s.startsWith('Triceps'))).toBe(true)
    // …and back again.
    act(() => sameChip(host).click())
    expect(rows(host).every(s => s.startsWith('Triceps'))).toBe(true)
  })

  // The routine editor hands its slot's exercise in (views/RoutineEdit.replace.test.jsx).
  it('routine editor: a picker told what it replaces opens on that muscle', () => {
    const pick = vi.fn()
    exercisePicker(pick, { title: 'Replace exercise', like: CABLE_TRI.id })
    const host = renderTop()
    expect(isOn(sameChip(host))).toBe(true)
    expect(rows(host).every(s => s.startsWith('Triceps'))).toBe(true)
  })

  it('an add opens on the whole list, with no same-muscle chip', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    expect(sameChip(host)).toBeUndefined()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
  })

  it('opens on All when nothing else trains that muscle, so a swap never starts on an empty list', () => {
    const S = structuredClone(DEF)
    // Every catalogue muscle has body-weight work, which no equipment profile hides, so the empty
    // case is one of your own exercises on a muscle nothing else names.
    S.customEx = [{ id: 'cOnly', n: 'My odd lift', bp: 'neck', tg: 'nothing-else', eq: 'body weight', custom: true }]
    useStore.setState({ S, A: null, user: null })
    exercisePicker(vi.fn(), { like: 'cOnly' })
    const host = renderTop()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
    expect(sameChip(host)).toBeUndefined()
  })
})
