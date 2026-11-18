// @vitest-environment happy-dom
// Approved Exercise-sheet retrofit: useful history first, one How-to card, visible labels,
// progressive setup disclosure, one primary action, and destructive actions kept last.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'

import { EXIDX, registerCustom } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState, _setDetails } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { exerciseDetailSheet } from './sheets.jsx'

bindUI(useUI)

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

function openBench() {
  exerciseDetailSheet(EXIDX['0025'])
  return renderTop()
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

describe('approved exercise sheet layout', () => {
  it('shows Last, Best and estimated 1RM tiles from the existing log', () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [{
      d: '2026-11-10', start: Date.UTC(2026, 10, 10, 10), end: Date.UTC(2026, 10, 10, 11),
      entries: [{ id: '0025', target: {}, sets: [
        { w: 60, r: 8, done: true },
        { w: 60, r: 7, done: true },
      ] }],
    }] } }))
    const host = openBench()
    expect([...host.querySelectorAll('.exd-stat dt')].map(el => el.textContent)).toEqual(['Last', 'Best', 'Est. 1RM'])
    expect(host.querySelector('.exd-stats').textContent).toContain('60×8')
    expect(host.querySelector('.exd-stats').textContent).toContain('76 kg')
  })

  it('uses a visible word label for the favourite action and preserves its state', () => {
    const host = openBench()
    const button = host.querySelector('.fav-btn')
    expect(button.textContent).toContain('Add to favourites')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    act(() => button.click())
    expect(useStore.getState().S.favEx).toEqual(['0025'])
    expect(button.textContent).toContain('Remove from favourites')
  })

  it('keeps one How-to card and folds the existing exercise setup into a labelled disclosure', () => {
    _setDetails({ '0025': ['Set your position', 'Press with control'] }, { '0025': 'Use a weight you can control.' }, {}, 'en')
    const host = openBench()
    expect(host.querySelectorAll('.exd-howto')).toHaveLength(1)
    expect(host.querySelector('.exd-howto h4').textContent).toContain('How to do it')
    const setup = host.querySelector('details.exd-setup')
    expect(setup.open).toBe(false)
    expect(setup.querySelector('summary').textContent).toBe('Exercise settings')
    expect(setup.textContent).toContain('Weight unit')
    expect(setup.textContent).toContain('Estimated 1RM')
  })

  it('makes the detail animation pause action keyboard operable', () => {
    const host = openBench()
    const media = host.querySelector('.exmedia')
    expect(media.getAttribute('role')).toBe('button')
    expect(media.getAttribute('tabIndex')).toBe('0')
    expect(media.getAttribute('aria-label')).toContain('tap to pause')
    act(() => media.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(media.getAttribute('aria-label')).toContain('tap to play')
  })

  it('keeps History working and exposes only one dominant Add to my plan action', () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [{
      d: '2026-11-10', start: Date.UTC(2026, 10, 10, 10),
      entries: [{ id: '0025', target: {}, sets: [{ w: 60, r: 8, done: true }] }],
    }] } }))
    const host = openBench()
    expect(host.querySelectorAll('.btn.primary')).toHaveLength(1)
    expect(host.querySelector('.exd-primary').textContent).toBe('Add to my plan')
    act(() => host.querySelector('.exd-history').click())
    expect(useUI.getState().sheets).toHaveLength(2)
  })

  it('keeps custom-exercise deletion last and apart from the primary action', () => {
    const ex = { id: 'cx-redesign', n: 'My bench', bp: 'chest', eq: 'barbell', custom: true }
    useStore.setState(s => ({ S: { ...s.S, customEx: [ex] } }))
    registerCustom([ex])
    exerciseDetailSheet(ex)
    const host = renderTop()
    const sheet = host.querySelector('.exd-redesign')
    expect(sheet.lastElementChild.textContent).toContain('Delete exercise')
    expect(sheet.lastElementChild.classList.contains('ex-del')).toBe(true)
    expect(host.querySelector('.exd-primary-dock').nextElementSibling.textContent).toContain('Merge into')
  })
})
