// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { customExSheet, exerciseDetailSheet } from './sheets.jsx'
import { CATALOGUE, registerCustom, searchExercises } from './lib/exercises.js'
import { registerExerciseAliases } from './lib/exercise-aliases.js'
import { _setLangState } from './lib/i18n-core.js'

bindUI(useUI)
let root, host
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useStore.setState({ S: structuredClone(DEF), user: null, config: null })
  useUI.setState({ sheets: [], toastMsg: '' })
  registerCustom([]); registerExerciseAliases({}); _setLangState('en', null, null, null)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); registerCustom([]); registerExerciseAliases({}) })
const render = () => act(() => root.render(useUI.getState().sheets.at(-1).render(() => {})))
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const field = () => host.querySelector('input[aria-describedby]')
const click = text => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text).click())

const link = () => host.querySelector('.exalias-link')
const openNames = () => act(() => link().click())

it('stays one quiet line until asked: no field on the detail sheet, "Add another name" opens it (#624)', () => {
  exerciseDetailSheet(CATALOGUE.find(e => e.id === '1162')); render()
  expect(field()).toBeNull()
  expect(link().textContent.trim()).toBe('Add another name')
  openNames()
  expect(host.querySelector('label[for="' + field().id + '"]').textContent).toBe('Other names')
  expect(document.activeElement).toBe(field())
})
it('saves, reopens and clears built-in aliases without creating a custom exercise or touching history', () => {
  const ex = CATALOGUE.find(e => e.id === '1162')
  const before = structuredClone(useStore.getState().S)
  exerciseDetailSheet(ex); render()
  openNames()
  type(field(), ' OHP, Military press, ohp '); click('Save names')
  expect(useStore.getState().S.exAliases[ex.id]).toEqual(['OHP', 'Military press'])
  expect(useStore.getState().S.customEx).toEqual([])
  expect(useStore.getState().S.workouts).toEqual(before.workouts)
  // Saved, it folds back into one line that says what it is called.
  expect(field()).toBeNull()
  expect(link().textContent.trim()).toBe('Also called OHP, Military press')
  exerciseDetailSheet(ex); render()
  openNames()
  expect(field().value).toBe('OHP, Military press')
  type(field(), ''); click('Save names')
  expect(useStore.getState().S.exAliases[ex.id]).toEqual([])
})
it('edits custom aliases and preserves its media, name and identity', () => {
  const ex = { id: 'c1', n: 'My press', bp: 'shoulders', eq: 'barbell', custom: true, aliases: ['Old name'], url: 'https://example.com/demo' }
  useStore.setState(s => ({ S: { ...s.S, customEx: [ex] } })); registerCustom([ex])
  customExSheet(ex); render()
  expect(field()).toBeNull()
  expect(link().textContent.trim()).toBe('Also called Old name')
  openNames()
  expect(field().value).toBe('Old name')
  type(field(), 'Viking lift'); click('Save')
  const saved = useStore.getState().S.customEx[0]
  expect(saved).toMatchObject({ id: ex.id, n: ex.n, url: ex.url, aliases: ['Viking lift'] })
  expect(searchExercises([saved], 'Viking lift')).toEqual([saved])
})
it('a custom exercise saved without opening the field keeps the names it had', () => {
  const ex = { id: 'c1', n: 'My press', bp: 'shoulders', eq: 'barbell', custom: true, aliases: ['Old name'] }
  useStore.setState(s => ({ S: { ...s.S, customEx: [ex] } })); registerCustom([ex])
  customExSheet(ex); render()
  click('Save')
  expect(useStore.getState().S.customEx[0].aliases).toEqual(['Old name'])
})
it('leaves unsaved edits out of state', () => {
  exerciseDetailSheet(CATALOGUE.find(e => e.id === '1162')); render()
  openNames()
  type(field(), 'Unsaved name')
  expect(useStore.getState().S.exAliases).toEqual({})
})
