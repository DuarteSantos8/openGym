// @vitest-environment happy-dom
// QA 1.3.11, Library: an imported custom exercise named like a catalogue one could not be saved
// unchanged, the detail sheet tagged muscles the catalogue credits with nothing (#359), and a long
// name could push the favourite star off a 320 px screen.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'

import { EXIDX, registerCustom } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { customExSheet, exerciseDetailSheet } from './sheets.jsx'

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
const click = (host, sel, text) => {
  const el = [...host.querySelectorAll(sel)].find(e => e.textContent.trim() === text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  act(() => el.click())
}
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
function seed(ex) {
  useStore.setState(s => ({ S: { ...s.S, customEx: [ex] } }))
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

describe('editing a custom exercise named like a catalogue one', () => {
  const trap = () => ({ id: 'cx9', n: 'trap bar deadlift', bp: 'upper legs', eq: 'custom', custom: true, desc: '' })

  it('saves it unchanged', () => {
    expect(Object.values(EXIDX).some(e => e.id !== 'cx9' && e.n.toLowerCase() === 'trap bar deadlift')).toBe(true)
    seed(trap())
    customExSheet(trap())
    const form = renderTop()
    type(form.querySelector('textarea'), 'Hex bar')
    click(form, 'button', 'Save')
    expect(useUI.getState().toastMsg).toBe('Saved')
    expect(S().customEx[0]).toMatchObject({ n: 'trap bar deadlift', desc: 'Hex bar' })
  })

  it('still refuses a rename onto another exercise', () => {
    const own = { id: 'cx8', n: 'My row', bp: 'back', eq: 'barbell', custom: true }
    seed(own)
    customExSheet(own)
    const form = renderTop()
    type(form.querySelector('input.input'), 'Trap Bar Deadlift')
    click(form, 'button', 'Save')
    expect(useUI.getState().toastMsg).toMatch(/already exists/)
    expect(S().customEx[0].n).toBe('My row')
  })

  it('caps the name at 80 characters', () => {
    customExSheet(null)
    expect(renderTop().querySelector('input.input').maxLength).toBe(80)
  })
})

describe('the exercise detail sheet', () => {
  it('does not tag a muscle the exercise gets no credit for', () => {
    const bench = EXIDX['0025']
    expect(bench.muscleWeights.biceps).toBe(0)
    exerciseDetailSheet(bench)
    const tags = [...renderTop().querySelectorAll('.tag')].map(t => t.textContent.trim())
    expect(tags).toEqual(expect.arrayContaining(['Triceps']))
    expect(tags).not.toContain('Biceps')
  })

  it('lets a long name wrap instead of pushing the star out', () => {
    exerciseDetailSheet(EXIDX['0025'])
    expect(renderTop().querySelector('h3').classList.contains('exdetail-name')).toBe(true)
  })
})
