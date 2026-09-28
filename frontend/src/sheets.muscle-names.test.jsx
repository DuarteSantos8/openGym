// @vitest-environment happy-dom
// QA C9. Custom exercises and the newer exercise metadata name muscles by the map's ids. The
// picker row, the routine config sheet and the Muscles rows printed those ids ("gluteal",
// "forearm", "hip-flexors") where the detail sheet already said Glutes / Forearms / Hip flexors —
// and in German "forearm" stayed English, because only the display names have translations.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX, registerCustom } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import de from './locales/de.js'
import { exercisePicker, exConfigSheet } from './sheets.jsx'
import MuscleExplorer from './components/MuscleExplorer.jsx'

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
function render(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const rowFor = (host, name) => [...host.querySelectorAll('.item')].find(e => e.textContent.includes(name))
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

describe('muscle names in the rows and tags (QA C9)', () => {
  it('picker row shows the display name, not the map id', () => {
    seed(custom())
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => type(host.querySelector('input.input'), 'QA Custom'))
    expect(rowFor(host, 'QA Custom Thrust').querySelector('.ss').textContent).toBe('Glutes · barbell')
  })

  it('config sheet tags read like the detail sheet, for a custom exercise and for power clean', () => {
    seed(custom())
    exConfigSheet(EXIDX.cqa1, null, vi.fn())
    const tags = h => [...h.querySelectorAll('.tag')].map(e => e.textContent.trim())
    expect(tags(renderTop())).toEqual(['Glutes', 'barbell', 'Forearms', 'Hip flexors'])
    // #207 Olympic lifts list their secondaries as map ids ('forearm', 'deltoids').
    exConfigSheet(EXIDX['0648'], null, vi.fn())
    expect(tags(renderTop())).toEqual(['hamstrings', 'barbell', 'Calves', 'Forearms', 'Shoulders'])
  })

  it('translates them in German too — "forearm" was staying English', () => {
    _setLangState('de', de, null, null)
    seed(custom())
    exConfigSheet(EXIDX['0648'], null, vi.fn())
    const tags = [...renderTop().querySelectorAll('.tag')].map(e => e.textContent.trim())
    expect(tags).toEqual(['Beinbeuger', 'Langhantel', 'Waden', 'Unterarme', 'Schultern'])
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => type(host.querySelector('input.input'), 'QA Custom'))
    expect(rowFor(host, 'QA Custom Thrust').querySelector('.ss').textContent).toBe('Gesäß · Langhantel')
  })

  // The dataset's cardio target "cardiovascular system" is both a map id and a translated key
  // of its own. Routing it through MUSCLE_NAME must not cost it its translation: the 29
  // built-in cardio exercises read "Herz-Kreislauf" in German, never "Cardiovascular system".
  it('keeps the cardio target translated (burpee, de)', () => {
    _setLangState('de', de, null, null)
    exercisePicker(vi.fn())
    const host = renderTop()
    act(() => type(host.querySelector('input.input'), 'burpee'))
    expect(rowFor(host, 'burpee').querySelector('.ss').textContent).toBe('Herz-Kreislauf · Körpergewicht')
    exConfigSheet(EXIDX['1160'], null, vi.fn())
    const tags = [...renderTop().querySelectorAll('.tag')].map(e => e.textContent.trim())
    expect(tags).toEqual(['Cardio', 'Herz-Kreislauf', 'Körpergewicht'])
  })

  it('Muscles explorer row names the target the same way', () => {
    seed(custom())
    const host = render(<MuscleExplorer onDetail={vi.fn()} onPlan={vi.fn()} />)
    const chip = [...host.querySelectorAll('.chip[aria-pressed]')].find(e => e.textContent.startsWith('Glutes'))
    act(() => chip.click())
    act(() => type(host.querySelector('.search input'), 'QA Custom'))
    expect(rowFor(host, 'QA Custom Thrust').querySelector('.ss').textContent).toBe('Primary target · Glutes · barbell')
  })
})
