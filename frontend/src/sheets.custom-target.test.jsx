// @vitest-environment happy-dom
// QA C10. Since the muscles of a custom exercise are stored in the map's order (83b2a14), the
// one-word target `tg` was silently taken from the sorted list: a hip thrust with Traps as an
// extra primary became a "Traps" exercise in the library, the picker and the Muscles view, and
// tap order no longer let the user correct it. The target is the primary picked first; an edit
// keeps the old target while it is still a primary.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX, registerCustom } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { customExSheet } from './sheets.jsx'

bindUI(useUI)   // the multi-select rows open their sheet through the shared controls

const mounted = []
const S = () => useStore.getState().S

// Renders whatever sheet is on top and returns its host element.
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const byText = (host, sel, text) => [...host.querySelectorAll(sel)].find(e => e.textContent.trim() === text)
const click = (host, sel, text) => {
  const el = byText(host, sel, text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  act(() => el.click())
}
// The form's multi-select rows open a nested sheet; tap the given labels there, in order, then Done.
function pickMuscles(form, rowTitle, labels) {
  const row = [...form.querySelectorAll('.lrow')].find(e => e.textContent.includes(rowTitle))
  act(() => row.click())
  const sub = renderTop()
  for (const l of labels) click(sub, 'button', l)
  click(sub, 'button', 'Done')
}
const custom = (over = {}) => ({
  id: 'cqa1', n: 'QA Custom Thrust', bp: 'upper legs', eq: 'barbell', custom: true, desc: '',
  tg: 'gluteal', sm: ['forearm', 'hip-flexors'], primaries: ['gluteal'], secondaries: ['forearm', 'hip-flexors'],
  muscleGroups: ['gluteal', 'forearm', 'hip-flexors'], ...over,
})
function seed(ex) {
  useStore.setState(s => ({ S: { ...s.S, customEx: [ex] } }))
  registerCustom([ex])
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  registerCustom([])
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  _setLangState('en', null, null, null)
  registerCustom([])
})

describe('custom exercise target (QA C10)', () => {
  it('is the primary tapped first, while the stored list keeps the map order', () => {
    customExSheet(null)
    const form = renderTop()
    act(() => type(form.querySelector('input.input'), 'QA Hip Thrust Pull'))
    click(form, '.chip', 'upper legs')
    click(form, '.chip', 'barbell')
    pickMuscles(form, 'Primary muscle groups', ['Hamstrings', 'Glutes', 'Traps'])
    click(form, 'button', 'Create exercise')
    const c = S().customEx.find(x => x.n === 'QA Hip Thrust Pull')
    expect(c.primaries).toEqual(['trapezius', 'gluteal', 'hamstring'])
    expect(c.tg).toBe('hamstring')
    expect(c.muscleGroups).toEqual(['trapezius', 'gluteal', 'hamstring'])
  })

  it('survives an edit that adds a primary higher up the body', () => {
    const ex = custom({ tg: 'hamstring', primaries: ['gluteal', 'hamstring'], secondaries: [], sm: [], muscleGroups: ['gluteal', 'hamstring'] })
    seed(ex)
    customExSheet(EXIDX[ex.id])
    const form = renderTop()
    pickMuscles(form, 'Primary muscle groups', ['Traps'])
    click(form, 'button', 'Save')
    const c = S().customEx[0]
    expect(c.primaries).toEqual(['trapezius', 'gluteal', 'hamstring'])
    expect(c.tg).toBe('hamstring')
  })

  it('moves to another primary only when the old target is dropped', () => {
    const ex = custom({ tg: 'hamstring', primaries: ['gluteal', 'hamstring'], secondaries: [], sm: [], muscleGroups: ['gluteal', 'hamstring'] })
    seed(ex)
    customExSheet(EXIDX[ex.id])
    const form = renderTop()
    pickMuscles(form, 'Primary muscle groups', ['Hamstrings'])   // untick it
    click(form, 'button', 'Save')
    const c = S().customEx[0]
    expect(c.primaries).toEqual(['gluteal'])
    expect(c.tg).toBe('gluteal')
  })

  // Dropping the target used to hand it to the head of the map-sorted list, which is where C10
  // started: an upper-legs exercise read "Traps · barbell" again the moment its target went away.
  it('hands a dropped target to the primary tapped in this sheet, not to the topmost muscle', () => {
    const ex = custom({ tg: 'hamstring', primaries: ['trapezius', 'gluteal', 'hamstring'], secondaries: ['forearm'], sm: ['forearm'],
      muscleGroups: ['trapezius', 'gluteal', 'hamstring', 'forearm'] })
    seed(ex)
    customExSheet(EXIDX[ex.id])
    const form = renderTop()
    pickMuscles(form, 'Primary muscle groups', ['Hamstrings', 'Quads'])   // untick the target, tap another
    click(form, 'button', 'Save')
    const c = S().customEx[0]
    expect(c.primaries).toEqual(['trapezius', 'gluteal', 'quadriceps'])
    expect(c.tg).toBe('quadriceps')
  })

  // Tapping the same chip twice leaves the selection as it was, so it says nothing about what the
  // user wants the target to be — the muscle actually added does.
  it('ignores a primary that was tapped on and off again', () => {
    const ex = custom({ tg: 'hamstring', primaries: ['trapezius', 'hamstring'], secondaries: [], sm: [], muscleGroups: ['trapezius', 'hamstring'] })
    seed(ex)
    customExSheet(EXIDX[ex.id])
    const form = renderTop()
    pickMuscles(form, 'Primary muscle groups', ['Hamstrings', 'Chest', 'Chest', 'Glutes'])
    click(form, 'button', 'Save')
    const c = S().customEx[0]
    expect(c.primaries).toEqual(['trapezius', 'gluteal'])
    expect(c.tg).toBe('gluteal')
  })
})
