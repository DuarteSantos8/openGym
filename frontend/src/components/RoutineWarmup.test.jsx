// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ exercisePicker: vi.fn(() => ({ close: vi.fn() })) }))
vi.mock('./Media.jsx', () => ({ Thumb: () => null }))

import RoutineWarmup from './RoutineWarmup.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exercisePicker } from '../sheets.jsx'
import { EXIDX } from '../lib/exercises.js'
import { WARMUP_IDS, defaultWarmupStep } from '../../../api/training/guided-warmup.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, sheets
const first = WARMUP_IDS[0], second = WARMUP_IDS[1]
const stored = () => useStore.getState().S.routines[0]?.warmup
const button = (label, container = host) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label)

function mount(warmup) {
  const S = structuredClone(DEF)
  S.routines = [{ id: 'r1', name: 'Push day', ex: [], ...(warmup ? { warmup } : {}) }]
  useStore.setState({ S, user: null })
  act(() => root.render(<RoutineWarmup routineId="r1" />))
}
function openLastSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const element = document.createElement('div')
  document.body.appendChild(element)
  const sheetRoot = createRoot(element)
  act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  sheets.push({ root: sheetRoot, host: element })
  return element
}
function pick(id, quick = true) {
  act(() => button('Add movement').click())
  act(() => exercisePicker.mock.calls.at(-1)[0](EXIDX[id], quick))
}

beforeEach(() => {
  vi.clearAllMocks()
  useUI.setState({ sheets: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  sheets = []
})
afterEach(() => {
  for (const sheet of sheets) { act(() => sheet.root.unmount()); sheet.host.remove() }
  act(() => root.unmount()); host.remove()
  useUI.setState({ sheets: [] })
})

describe('a routine’s guided warm-up', () => {
  it('starts empty and scopes the existing picker to reviewed movements', () => {
    mount()
    expect(host.textContent).toContain('Add movements to build a guided warm-up.')
    expect(host.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false')
    pick(first)
    expect(exercisePicker.mock.calls[0][1]).toEqual({ title: 'Add warm-up movement', ids: WARMUP_IDS })
    expect(stored()).toEqual({ enabled: true, steps: [defaultWarmupStep(first)] })
    expect(useStore.getState().S.routines[0].ex).toEqual([])
  })

  it('opens movement targets on a picker tap and only adds on Save', () => {
    mount()
    pick(first, false)
    expect(stored()).toBeUndefined()
    const sheet = openLastSheet()
    act(() => button('Repetitions', sheet).click())
    const input = sheet.querySelector('input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '12')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => sheet.querySelector('[role="switch"]').click())
    act(() => button('Save', sheet).click())
    expect(stored()).toEqual({ enabled: true, steps: [{ id: first, mode: 'reps', reps: 12, perSide: true }] })
  })

  it('keeps a disabled sequence, reorders it and removes through its own settings', () => {
    mount({ enabled: true, steps: [defaultWarmupStep(first), defaultWarmupStep(second)] })
    act(() => host.querySelector('[role="switch"]').click())
    expect(stored().enabled).toBe(false)
    expect(stored().steps).toHaveLength(2)
    expect(host.textContent).toContain('Your movements are saved for later.')
    act(() => host.querySelector('[aria-label="Move down"]').click())
    expect(stored().steps.map(s => s.id)).toEqual([second, first])
    act(() => host.querySelector('.item-open').click())
    const sheet = openLastSheet()
    act(() => button('Remove', sheet).click())
    expect(stored().steps.map(s => s.id)).toEqual([first])
    expect(stored().enabled).toBe(false)
  })

  it('reads the current sequence in a picker callback and stops at eight', () => {
    mount()
    act(() => button('Add movement').click())
    const onPick = exercisePicker.mock.calls.at(-1)[0]
    act(() => { for (const id of WARMUP_IDS.slice(0, 9)) onPick(EXIDX[id], true) })
    expect(stored().steps).toHaveLength(8)
    expect(button('Add movement').disabled).toBe(true)
  })

  it('does not recreate a routine deleted while a picker or settings sheet is open', () => {
    mount()
    act(() => button('Add movement').click())
    const onPick = exercisePicker.mock.calls.at(-1)[0]
    act(() => onPick(EXIDX[first], false))
    const sheet = openLastSheet()
    act(() => useStore.getState().update(s => { s.routines = [] }))
    expect(() => act(() => onPick(EXIDX[second], true))).not.toThrow()
    expect(() => act(() => button('Save', sheet).click())).not.toThrow()
    expect(useStore.getState().S.routines).toEqual([])
  })

  it('leaves a movement changed by sync alone when an old settings sheet saves', () => {
    mount({ enabled: true, steps: [defaultWarmupStep(first)] })
    act(() => host.querySelector('.item-open').click())
    const sheet = openLastSheet()
    act(() => useStore.getState().update(s => { s.routines[0].warmup.steps[0] = defaultWarmupStep(second) }))
    act(() => button('Save', sheet).click())
    expect(stored().steps).toEqual([defaultWarmupStep(second)])
  })
})
