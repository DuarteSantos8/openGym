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

// Issue #669 (the same gap as #521, in another view): the Add exercise picker has a Favourites
// chip, but its "By muscle" view - this explorer with `onPick` - had none, so the button
// disappeared as soon as you browsed by muscle. 4087 and 0005 are band biceps curls; neither
// trains the calves.
describe('MuscleExplorer in a picker keeps the Favourites chip (#669)', () => {
  const favChip = host =>
    [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim().startsWith('Favourites'))
  const rowNames = host => [...host.querySelectorAll('.list .item .tt')].map(el => el.textContent.trim())

  beforeEach(() => { mocks.S.favEx = ['4087', '0005'] })

  it('offers Favourites for the chosen muscle and narrows the list to them', () => {
    const host = render({ onPick: vi.fn() })
    act(() => { muscleChip(host, 'Biceps').click() })
    const chip = favChip(host)
    expect(chip, 'the picker view has a Favourites chip, so its By muscle view must too').toBeTruthy()
    expect(chip.textContent).toContain('(2)')

    act(() => { chip.click() })
    expect(isOn(favChip(host))).toBe(true)
    expect(rowNames(host).sort()).toEqual(['band 45 degrees biceps curl', 'band alternate biceps curl'])
  })

  it('has no Favourites chip for a muscle none of them train', () => {
    const host = render({ onPick: vi.fn() })
    act(() => { muscleChip(host, 'Calves').click() })
    expect(favChip(host)).toBeFalsy()
  })

  it('falls back to every exercise when the next muscle has no favourites, without forgetting the choice', () => {
    const host = render({ onPick: vi.fn() })
    act(() => { muscleChip(host, 'Biceps').click() })
    act(() => { favChip(host).click() })

    act(() => { muscleChip(host, 'Calves').click() })
    expect(favChip(host)).toBeFalsy()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
    expect(rowNames(host).length).toBeGreaterThan(2)

    act(() => { muscleChip(host, 'Biceps').click() })
    expect(isOn(favChip(host)), 'back on a muscle with favourites, the choice applies again').toBe(true)
  })

  it('leaves the Library\'s muscle browser as it was: no Favourites chip without onPick', () => {
    const host = render({ onDetail: vi.fn(), onPlan: vi.fn() })
    act(() => { muscleChip(host, 'Biceps').click() })
    expect(favChip(host)).toBeFalsy()
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
