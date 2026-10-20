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
import { suggestWarmup } from '../lib/warmup-suggestions.js'
import { exerciseNameFor } from '../lib/i18n.js'
import * as equipment from '../lib/equipment.js'
import { WARMUP_IDS, defaultWarmupStep } from '../../../api/training/guided-warmup.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, sheets
const first = WARMUP_IDS[0], second = WARMUP_IDS[1]
const stored = () => useStore.getState().S.routines[0]?.warmup
const button = (label, container = host) => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label)

function mount(warmup, ex = []) {
  const S = structuredClone(DEF)
  S.routines = [{ id: 'r1', name: 'Push day', ex, ...(warmup ? { warmup } : {}) }]
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

  it('reads the current sequence in a picker callback and allows the full curated collection once', () => {
    mount()
    act(() => button('Add movement').click())
    const onPick = exercisePicker.mock.calls.at(-1)[0]
    act(() => { for (const id of [...WARMUP_IDS, first]) onPick(EXIDX[id], true) })
    expect(stored().steps.map(step => step.id)).toEqual(WARMUP_IDS)
    expect(host.textContent).toContain(`Up to ${WARMUP_IDS.length} movements per warm-up.`)
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

describe('warm-up suggestions in Plan', () => {
  const lifting = [{ id: '0025', sets: 3, mode: 'reps', reps: 8 }]
  const preview = () => {
    act(() => button('Suggest for this routine').click())
    return openLastSheet()
  }

  it('disables suggestions until the routine has main exercises', () => {
    mount()
    expect(button('Suggest for this routine').disabled).toBe(true)
  })

  it('previews ordered movement names, targets and muscle context before adding', () => {
    mount(undefined, lifting)
    const expected = suggestWarmup(useStore.getState().S, lifting)
    expect(expected.length).toBeGreaterThan(0)
    const sheet = preview()
    expect(stored()).toBeUndefined()
    expect(sheet.textContent).toContain('Based on this routine’s muscles:')
    expect(sheet.textContent).toContain('Chest')
    expect([...sheet.querySelectorAll('li .tt')].map(el => el.textContent)).toEqual(expected.map(step => exerciseNameFor(EXIDX[step.id])))
    expect([...sheet.querySelectorAll('li .ss')].every(el => /\d+ (s|reps)/.test(el.textContent))).toBe(true)
    act(() => button('Add warm-up', sheet).click())
    expect(stored()).toEqual({ enabled: true, steps: expected })
    // Suggestions become the same editable rows as a manually selected sequence.
    act(() => host.querySelector('.item-open').click())
    expect(openLastSheet().querySelector('input')).not.toBeNull()
  })

  it('requires explicit replacement and Cancel preserves the manual sequence', () => {
    const manual = { enabled: false, steps: [defaultWarmupStep(first)] }
    mount(manual, lifting)
    let sheet = preview()
    expect(button('Add warm-up', sheet)).toBeUndefined()
    expect(sheet.textContent).toContain('Replace your current warm-up with these movements?')
    act(() => button('Cancel', sheet).click())
    expect(stored()).toEqual(manual)
    sheet = preview()
    const expected = suggestWarmup(useStore.getState().S, lifting)
    act(() => button('Replace warm-up', sheet).click())
    expect(stored()).toEqual({ enabled: true, steps: expected })
  })

  it.each(['exercises', 'warmup', 'deleted'])('refuses to overwrite a routine when %s changed during preview', kind => {
    mount({ enabled: true, steps: [defaultWarmupStep(first)] }, lifting)
    const sheet = preview()
    const toast = vi.spyOn(useUI.getState(), 'toast')
    act(() => useStore.getState().update(s => {
      if (kind === 'exercises') s.routines[0].ex.push({ id: '0025', reps: 12 })
      if (kind === 'warmup') s.routines[0].warmup.steps = [defaultWarmupStep(second)]
      if (kind === 'deleted') s.routines = []
    }))
    const afterChange = structuredClone(useStore.getState().S.routines)
    act(() => button('Replace warm-up', sheet).click())
    expect(useStore.getState().S.routines).toEqual(afterChange)
    expect(toast).toHaveBeenCalledWith('Plan or equipment changed. Open suggestions again to review an updated warm-up.')
    toast.mockRestore()
  })

  it('explains an empty result without changing the routine', () => {
    mount(undefined, [{ id: 'unknown-exercise' }])
    const toast = vi.spyOn(useUI.getState(), 'toast')
    act(() => button('Suggest for this routine').click())
    expect(stored()).toBeUndefined()
    expect(useUI.getState().sheets).toEqual([])
    expect(toast).toHaveBeenCalledWith('No warm-up suggestions are available for this routine. Add movements manually.')
    toast.mockRestore()
  })

  it('rejects a preview after the source custom exercise’s muscle metadata changes', () => {
    mount(undefined, [{ id: 'custom-press' }])
    act(() => useStore.getState().update(s => { s.customEx = [{ id: 'custom-press', primaries: ['chest'] }] }))
    const sheet = preview()
    expect(sheet.textContent).toContain('Chest')
    act(() => useStore.getState().update(s => { s.customEx[0].primaries = ['calves'] }))
    const toast = vi.spyOn(useUI.getState(), 'toast')
    act(() => button('Add warm-up', sheet).click())
    expect(stored()).toBeUndefined()
    expect(toast).toHaveBeenCalledWith('Plan or equipment changed. Open suggestions again to review an updated warm-up.')
    toast.mockRestore()
  })

  it('keeps a preview valid after an unrelated custom exercise changes', () => {
    mount(undefined, lifting)
    act(() => useStore.getState().update(s => { s.customEx = [{ id: 'unused', primaries: ['chest'] }] }))
    const sheet = preview()
    const expected = suggestWarmup(useStore.getState().S, lifting)
    act(() => useStore.getState().update(s => { s.customEx[0].primaries = ['calves'] }))
    act(() => button('Add warm-up', sheet).click())
    expect(stored()).toEqual({ enabled: true, steps: expected })
  })

  it('rejects a preview if equipment availability changes its proposal', () => {
    const available = vi.spyOn(equipment, 'exAvailable').mockImplementation((state, ex) =>
      !(state.activeEquipId === 'restricted' && ex.id === '3905'))
    try {
      mount(undefined, lifting)
      const sheet = preview()
      act(() => useStore.getState().update(s => { s.activeEquipId = 'restricted' }))
      act(() => button('Add warm-up', sheet).click())
      expect(stored()).toBeUndefined()
    } finally { available.mockRestore() }
  })

  it.each(['confirm', 'cancel'])('keeps edited, reordered and removed preview movements as drafts until %s', action => {
    const manual = { enabled: false, steps: [defaultWarmupStep(first)] }
    const exercises = [...lifting, { id: '0043' }, { id: '0293' }]
    mount(manual, exercises)
    const expected = suggestWarmup(useStore.getState().S, exercises)
    expect(expected.length).toBeGreaterThan(2)
    const sheet = preview()
    const firstTarget = sheet.querySelector('li .ss').textContent
    act(() => sheet.querySelector('.item-open').click())
    let settings = openLastSheet()
    // A nested cancel leaves both the sequence and the parent preview open.
    act(() => settings.querySelector('[role="switch"]').click())
    act(() => button('Cancel', settings).click())
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(sheet.querySelector('li .ss').textContent).toBe(firstTarget)
    act(() => sheet.querySelector('.item-open').click())
    settings = openLastSheet()
    act(() => button('Repetitions', settings).click())
    const input = settings.querySelector('input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '42')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    if (settings.querySelector('[role="switch"]').getAttribute('aria-checked') !== 'true') act(() => settings.querySelector('[role="switch"]').click())
    act(() => button('Save', settings).click())
    expect(useUI.getState().sheets).toHaveLength(1)
    expected[0] = { id: expected[0].id, mode: 'reps', reps: 42, perSide: true }
    expect(sheet.querySelector('li .ss').textContent).toBe('42 reps · Per side')
    act(() => sheet.querySelector('[aria-label="Move down"]').click())
    expected.splice(1, 0, expected.shift())
    act(() => [...sheet.querySelectorAll('.item-open')].at(-1).click())
    settings = openLastSheet()
    act(() => button('Remove', settings).click())
    expected.pop()
    expect(sheet.querySelectorAll('li')).toHaveLength(expected.length)
    expect(stored()).toEqual(manual)
    act(() => button(action === 'confirm' ? 'Replace warm-up' : 'Cancel', sheet).click())
    expect(stored()).toEqual(action === 'confirm' ? { enabled: true, steps: expected } : manual)
  })
})
