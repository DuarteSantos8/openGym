// @vitest-environment happy-dom
// #473: a swap opens on what trains the same muscle. Mid-workout (Swap exercise) and in the
// routine editor (Replace exercise) the picker starts on the exercises sharing the swapped one's
// target muscle, same equipment first, and "All" is one tap back to the whole list.
// #674: suggested substitutes lead that list, and the gym chosen in a swap filters only the list.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB } from './lib/exercises.js'
import { exercisePicker, swapActiveWorkoutExercise } from './sheets.jsx'
import { bindUI } from './components/ui.jsx'
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
  bindUI(useUI)
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
    S.active = {
      id: 'w', d: '2026-10-08', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0,
      entries: [{ id: CABLE_TRI.id, target: { mode: 'reps', sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: false }] }]
    }
    useStore.setState({ S, user: null })
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
    useStore.setState({ S, user: null })
    exercisePicker(vi.fn(), { like: 'cOnly' })
    const host = renderTop()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
    expect(sameChip(host)).toBeUndefined()
    expect(host.textContent).toContain('No suitable suggestions with these filters.')
  })
})

it('shows a labelled suggestions section for Dead Hang Stretch with a gym profile', () => {
  const S = structuredClone(DEF)
  S.equipProfiles = [{ id: 'gm', name: 'gm', equipment: ['pull-up bar'], accV: 1 }]
  S.activeEquipId = 'gm'; S.equipFilterOn = true
  useStore.setState({ S, user: null })
  exercisePicker(vi.fn(), { like: '5055', title: 'Swap exercise' })
  const host = renderTop()
  const section = host.querySelector('section[aria-label="Suggested substitutes"]')
  expect(section).not.toBeNull()
  expect(section.textContent).toContain('Same muscle and exercise type. The movement may differ.')
  expect(section.querySelectorAll('.item')).toHaveLength(3)
  expect(section.textContent).not.toContain('dead hang stretch')
  // the list under the suggestions is the same-muscle one the swap opened on (#473)
  expect([...host.querySelectorAll('h4.sec')].map(h => h.textContent)).toContain('Same muscle: lats')
})

describe('gym selection in a swap', () => {
  function openSwap() {
    const S = structuredClone(DEF)
    S.equipProfiles = [
      { id: 'home', name: 'Home gym', equipment: ['dumbbell', 'bench'], accV: 1 },
      { id: 'travel', name: 'Travel', equipment: [], accV: 1 },
    ]
    S.activeEquipId = 'home'; S.equipFilterOn = true
    useStore.setState({ S, user: null })
    exercisePicker(vi.fn(), { like: '0025', title: 'Swap exercise' })
    return renderTop()
  }
  const suggestedNames = host => [...host.querySelectorAll('section[aria-label="Suggested substitutes"] .tt')].map(e => e.textContent)
  function chooseGym(host, label) {
    act(() => [...host.querySelectorAll('.lrow')].find(e => e.textContent.includes('Gym')).click())
    const selector = renderTop()
    act(() => [...selector.querySelectorAll('button')].find(e => e.textContent.trim() === label).click())
  }
  it('suggests available presses first without duplicates, and switching gym refreshes both lists', () => {
    const host = openSwap()
    const baseline = structuredClone(useStore.getState().S)
    expect(suggestedNames(host)).toContain('dumbbell bench press')
    expect(suggestedNames(host)).toContain('push-up')
    const names = [...host.querySelectorAll('.list .tt')].map(e => e.textContent)
    expect(names.filter(n => n === 'dumbbell bench press')).toHaveLength(1)
    expect(names).not.toContain('barbell bench press')
    expect(host.textContent).toContain('Just for this list. Your gym in Settings stays put.')
    chooseGym(host, 'Travel')
    expect(suggestedNames(host)).toEqual(['push-up'])
    expect(rows(host).every(s => s.endsWith('body weight'))).toBe(true)
    // The list follows the gym picked here, the profile does not: Settings' gym, the filter
    // switch and everything else are exactly as they were.
    expect(useStore.getState().S).toEqual(baseline)
    chooseGym(host, 'All equipment')
    expect(suggestedNames(host)).toContain('band bench press')
    expect(useStore.getState().S).toEqual(baseline)
  })
  it('opens the next swap on the gym from Settings again', () => {
    const host = openSwap()
    chooseGym(host, 'Travel')
    act(() => useUI.setState({ sheets: [] }))
    exercisePicker(vi.fn(), { like: '0025', title: 'Swap exercise' })
    const again = renderTop()
    expect([...again.querySelectorAll('.lrow')].find(e => e.textContent.includes('Gym')).textContent).toContain('Home gym')
  })
  it('searches the entire available library, not just suggested movements', () => {
    const host = openSwap()
    const input = host.querySelector('.search input')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'dumbbell curl')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(suggestedNames(host)).toEqual([])
    expect(host.textContent).toContain('Search results')
    expect(rows(host).length).toBeGreaterThan(0)
    expect(rows(host).some(s => s.startsWith('Biceps'))).toBe(true)
  })
})
