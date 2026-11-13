// @vitest-environment happy-dom
// Issue #71 (the same rule Library and the exercise picker already keep): choosing a body part
// after picking an equipment type must not reset the equipment filter back to "any equipment"
// when the new body part still has exercises under it. MuscleExplorer used to clear it on every
// body-part tap regardless — the only one of the three exercise browsers that did.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The first render indexes all 5,600+ catalogue exercises for search and the muscle map, which
// takes over a second here on its own and longer on a busy runner.
vi.setConfig({ testTimeout: 15000 })
import { createRoot } from 'react-dom/client'
import MuscleExplorer from './MuscleExplorer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, user: null, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})

const mounted = []
function render(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MuscleExplorer {...props} />))
  return host
}
const chipByText = (host, text) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim() === text)
const muscleChip = (host, label) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.startsWith(label))
const isOn = el => el.className.split(/\s+/).includes('on')

beforeEach(() => {
  mocks.S = {
    unit: 'kg', lang: 'en', body: 'male', routines: [], workouts: [], customEx: [], exWeights: {},
    equipProfiles: [], activeEquipId: null, equipFilterOn: false, favEx: [],
  }
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('MuscleExplorer body-part chips keep the equipment filter', () => {
  // Biceps has dumbbell exercises under both "lower arms" and "upper arms" in the catalog, the
  // same shape as issue #71's original repro (lower arms/upper arms + dumbbell).
  it('keeps the dumbbell filter when switching from lower arms to upper arms', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })

    act(() => { chipByText(host, 'lower arms').click() })
    const dumbbell = chipByText(host, 'dumbbell')
    expect(dumbbell, 'dumbbell chip should be offered under lower arms').toBeTruthy()
    act(() => { dumbbell.click() })
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    act(() => { chipByText(host, 'upper arms').click() })
    expect(isOn(chipByText(host, 'upper arms'))).toBe(true)
    const dumbbellAfter = chipByText(host, 'dumbbell')
    expect(dumbbellAfter, 'dumbbell chip should still be present under upper arms').toBeTruthy()
    expect(isOn(dumbbellAfter)).toBe(true)
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(false)
  })

  // "All" body parts is the one chip that does clear the equipment filter — it spans every
  // body part, so there is no "still valid here" question to answer.
  it('"All" body parts still clears the equipment filter', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    act(() => { chipByText(host, 'lower arms').click() })
    act(() => { chipByText(host, 'dumbbell').click() })
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    act(() => { chipByText(host, 'All').click() })
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(true)
  })
})

describe('MuscleExplorer search: the × and live count the Library has (#338)', () => {
  function type(el, value) {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  it('shows a count while narrowed and a × that empties only the text', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    const input = host.querySelector('.search input')
    const count = () => host.querySelector('.search .search-count')
    const clear = () => host.querySelector('.search .clear')
    const rows = () => host.querySelectorAll('.list .item').length
    expect(count()).toBeNull()
    expect(clear()).toBeNull()
    act(() => type(input, 'curl'))
    expect(clear().getAttribute('aria-label')).toBe('Clear')
    expect(Number(count().textContent)).toBeGreaterThan(0)
    expect(rows()).toBe(Math.min(40, Number(count().textContent)))
    act(() => clear().click())
    expect(input.value).toBe('')
    expect(clear()).toBeNull()
    expect(count()).toBeNull()
    act(() => { chipByText(host, 'upper arms').click() })
    expect(count()).toBeTruthy()
    expect(clear()).toBeNull()
  })
})

// #553: Stats' untrained muscles open the explorer on that muscle.
describe('MuscleExplorer opened on a muscle', () => {
  it('starts with it chosen and its exercises listed', () => {
    const host = render({ initial: 'biceps', onDetail: vi.fn() })
    expect(isOn(muscleChip(host, 'Biceps'))).toBe(true)
    expect(host.textContent).toContain('Exercises for Biceps')
  })
})

// #669: the Add exercise picker's "By muscle" lost the Favourites chip its list view has.
describe('MuscleExplorer Favourites chip', () => {
  it('lists the favourites that train the chosen muscle', async () => {
    const { EXDB } = await import('../lib/exercises.js')
    const { musclesOf } = await import('../lib/muscles.js')
    const curl = EXDB.find(e => musclesOf(e).biceps === 1)
    const press = EXDB.find(e => !musclesOf(e).biceps && e.bp === 'chest')
    mocks.S.favEx = [curl.id, press.id]
    const onPick = vi.fn()
    const host = render({ onPick })
    act(() => { muscleChip(host, 'Biceps').click() })
    const fav = muscleChip(host, 'Favourites')
    expect(fav, 'a Favourites chip next to All').toBeTruthy()
    expect(fav.textContent).toContain('(1)')
    act(() => { fav.click() })
    expect(isOn(muscleChip(host, 'Favourites'))).toBe(true)
    const rows = [...host.querySelectorAll('.list .item')]
    expect(rows).toHaveLength(1)
    act(() => { rows[0].querySelector('.tap-main').click() })
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: curl.id }))
    act(() => { chipByText(host, 'All').click() })
    expect(host.querySelectorAll('.list .item').length).toBeGreaterThan(1)
  })

  it('is not there without favourites', () => {
    const host = render({ onPick: vi.fn() })
    act(() => { muscleChip(host, 'Biceps').click() })
    expect(muscleChip(host, 'Favourites')).toBeUndefined()
  })
})

// #885, #900: several muscles at once, AND by default, and groups that open into their muscles.
describe('MuscleExplorer with several muscles and groups', () => {
  const rows = host => host.querySelectorAll('.list .item').length
  const count = host => { const c = host.querySelector('.search .search-count'); return c ? Number(c.textContent.replace(/\D/g, '')) : null }
  const groupChip = (host, name) => [...host.querySelectorAll('.mx-groups .chip')].find(b => b.textContent.trim() === name)
  it('two muscles show what trains both, and Any of them widens it again', async () => {
    const { allExercises } = await import('../lib/exercises.js')
    const { musclesOf } = await import('../lib/muscles.js')
    const both = allExercises(mocks.S).filter(e => { const w = musclesOf(e); return w.quadriceps > 0 && w.hamstring > 0 }).length
    const host = render({ onDetail: vi.fn() })
    act(() => { muscleChip(host, 'Quads').click() })
    act(() => { muscleChip(host, 'Hamstrings').click() })
    expect(host.textContent).toContain('Exercises for Quads + Hamstrings')
    expect(isOn(muscleChip(host, 'Quads'))).toBe(true)
    expect(isOn(muscleChip(host, 'Hamstrings'))).toBe(true)
    // several muscles narrow the list, so the live count shows
    expect(count(host)).toBe(both)
    act(() => { [...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Any of them').click() })
    expect(count(host)).toBeGreaterThan(both)
    expect(host.textContent).toContain('Exercises for Quads / Hamstrings')
  })
  it('a group picks all of its muscles and opens them; one of them then stands for itself', () => {
    const host = render({ onDetail: vi.fn() })
    act(() => { groupChip(host, 'Legs').click() })
    expect(isOn(groupChip(host, 'Legs'))).toBe(true)
    expect(groupChip(host, 'Legs').getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('Exercises for Legs')
    // the strip below holds only the legs now
    expect(muscleChip(host, 'Biceps')).toBeUndefined()
    expect(rows(host)).toBeGreaterThan(0)
    act(() => { muscleChip(host, 'Calves').click() })
    expect(isOn(groupChip(host, 'Legs'))).toBe(false)
    expect(host.textContent).toContain('Exercises for Calves')
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Clear selection').click() })
    expect(host.textContent).not.toContain('Exercises for')
  })
})

// QA 1.4.5: the per-muscle counts are tallied in one pass over the catalogue now (they asked
// musclesOf once per muscle per exercise before: a 450 ms freeze on opening the page). Same numbers.
describe('MuscleExplorer per-muscle counts', () => {
  it('each muscle chip shows how many exercises train it', async () => {
    const { allExercises } = await import('../lib/exercises.js')
    const { MUSCLES, MUSCLE_NAME, musclesOf } = await import('../lib/muscles.js')
    const host = render()
    const all = allExercises(mocks.S)
    let checked = 0
    for (const m of MUSCLES) {
      const chip = [...host.querySelectorAll('.chips .chip')].find(b => b.querySelector('.dim') && b.textContent.trim().startsWith(MUSCLE_NAME[m] + ' '))
      if (!chip) continue
      expect(Number(chip.querySelector('.dim').textContent), m).toBe(all.filter(e => musclesOf(e)[m]).length)
      checked++
    }
    expect(checked).toBeGreaterThan(5)
  })
})
