// @vitest-environment happy-dom
// #378 / #358: a custom exercise stored without `custom: true` — what a plan import (a shared
// plan file, a plan from the AI coach) wrote before 1.3.8 — showed no Edit and no Delete, in the
// exercise sheet or in the routine's exercise settings, and its thumbnail went through the
// built-in renderer. Every one of those now asks where the exercise lives, not for the flag.
import React, { act } from 'react'
import { ruleOccurrence } from './lib/test-fixtures.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'

import { registerCustom } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { Thumb } from './components/Media.jsx'
import { customExSheet, exerciseDetailSheet, exConfigSheet } from './sheets.jsx'

bindUI(useUI)

const mounted = []
const S = () => useStore.getState().S

function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const renderTop = () => {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const buttons = host => [...host.querySelectorAll('button')].map(b => b.textContent.trim())
const click = (host, sel, text) => {
  const el = [...host.querySelectorAll(sel)].find(e => e.textContent.trim() === text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  act(() => el.click())
}

// Exactly what a pre-1.3.8 plan import stored: no flag, no equipment.
const legacy = () => ({ id: 'cx1', n: 'My row', bp: 'back' })
function seed(ex, extra = {}) {
  useStore.setState(s => ({ S: { ...s.S, customEx: [ex], ...extra } }))
  registerCustom([ex])
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null, config: null })
  registerCustom([])
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  registerCustom([])
})

describe('a custom exercise stored without the flag', () => {
  it('its sheet offers Edit and Delete', () => {
    const ex = legacy()
    seed(ex)
    exerciseDetailSheet(ex)
    const host = renderTop()
    expect(buttons(host)).toEqual(expect.arrayContaining(['Edit', 'Delete']))
  })

  it('Edit opens the form filled in with it', () => {
    const ex = legacy()
    seed(ex)
    exerciseDetailSheet(ex)
    click(renderTop(), 'button', 'Edit')
    const form = renderTop()
    expect(form.textContent).toContain('Edit custom exercise')
    expect(form.querySelector('input.input').value).toBe('My row')
    expect(form.querySelector('.chip.on').textContent).toBe('back')
  })

  it('Delete takes it out of the routines and keeps the name in history', () => {
    const ex = legacy()
    seed(ex, {
      routines: [{ id: 'r1', name: 'A', ex: [ruleOccurrence('cx1'), ruleOccurrence('0027')] }],
      workouts: [{ d: '2026-09-01', exposures: [{ exposureId: 'x1', exerciseId: 'cx1', mode: 'reps', performance: { sets: [] } }] }],
    })
    exerciseDetailSheet(ex)
    click(renderTop(), 'button', 'Delete')
    click(renderTop(), 'button', 'Delete')   // the confirmation
    expect(S().customEx).toEqual([])
    expect(S().routines[0].ex.map(e => e.exerciseId)).toEqual(['0027'])
    expect(S().workouts[0].exposures[0].exerciseNameSnapshot).toBe('My row')
  })

  it('the routine exercise settings offer "Edit or delete this exercise"', () => {
    const ex = legacy()
    seed(ex)
    exConfigSheet(ex, ruleOccurrence('cx1'), () => {})
    expect(buttons(renderTop())).toContain('Edit or delete this exercise')
  })

  it('its thumbnail is the custom one, never a dataset image', () => {
    const ex = { ...legacy(), img: 'stray.jpg' }
    seed(ex)
    const host = render(<Thumb ex={ex} />)
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.thumb-x')).toBeTruthy()
  })

  it('equipment from an import that the list lacks counts as picked, so Save works', () => {
    const ex = { ...legacy(), eq: 'custom', custom: true }
    seed(ex)
    customExSheet(ex)
    const form = renderTop()
    expect([...form.querySelectorAll('.chip.on')].map(c => c.textContent)).toContain('custom')
    act(() => {
      const el = form.querySelector('input.input')
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, 'My cable row')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(form, 'button', 'Save')
    expect(S().customEx[0]).toMatchObject({ id: 'cx1', n: 'My cable row', eq: 'custom' })
  })
})

describe('the store heals it', () => {
  it('a copy that enters the store gets the flag back, without a new stamp on the entry', () => {
    useStore.getState().replaceState({ ...structuredClone(DEF), customEx: [{ ...legacy(), _ts: 7 }] })
    expect(S().customEx[0]).toMatchObject({ id: 'cx1', custom: true, eq: '', _ts: 7 })
    const healed = S().customEx
    useStore.getState().update(s => { s.restDefault = 90 })
    expect(S().customEx[0]._ts).toBe(7)   // healing twice changes nothing
    expect(S().customEx[0]).toEqual(healed[0])
  })
})
