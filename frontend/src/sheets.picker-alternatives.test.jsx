// @vitest-environment happy-dom
// Issue #473: a Swap (and the routine editor's Replace) used to open the picker on the full
// list. It now opens on the replaced exercise's body part with its closest alternatives first:
// the same target muscle, then the same equipment, and the exercise itself last.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exercisePicker, swapActiveWorkoutExercise } from './sheets.jsx'
import { EXIDX } from './lib/exercises.js'

const BENCH = '0025'   // barbell bench press: chest, pectorals, barbell
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

const chipByText = (host, text) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim() === text)
const isOn = el => el.className.split(/\s+/).includes('on')
// The exercise rows, without the "Create your own exercise" row at the top.
const rowNames = host => [...host.querySelectorAll('.list .item .tt')].map(el => el.textContent.trim()).slice(1)
const byName = Object.fromEntries(Object.values(EXIDX).map(e => [e.n, e]))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('exercise picker opened for a replacement', () => {
  it('starts on the exercise’s body part with the closest alternatives first', () => {
    exercisePicker(vi.fn(), { title: 'Swap exercise', like: EXIDX[BENCH] })
    const host = renderTop()

    expect(isOn(chipByText(host, 'chest'))).toBe(true)
    expect(isOn(chipByText(host, 'All'))).toBe(false)
    const first = byName[rowNames(host)[0]]
    expect(first.id).not.toBe(BENCH)
    expect(first).toMatchObject({ tg: 'pectorals', eq: 'barbell' })
  })

  it('still lets you leave for the full list', () => {
    exercisePicker(vi.fn(), { like: EXIDX[BENCH] })
    const host = renderTop()
    act(() => chipByText(host, 'All').click())
    expect(isOn(chipByText(host, 'All'))).toBe(true)
  })

  it('opens on All for a plain add', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
  })

  it('a workout Swap hands the picker the exercise being swapped', () => {
    const S = structuredClone(DEF)
    S.active = {
      id: 'w', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0,
      entries: [{ id: BENCH, target: { mode: 'reps', sets: 3, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: false }] }],
    }
    useStore.setState({ S })
    swapActiveWorkoutExercise(0)
    const host = renderTop()
    expect(isOn(chipByText(host, 'chest'))).toBe(true)
  })
})
