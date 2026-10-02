// @vitest-environment happy-dom
// The live result count in the exercise search (idea: GitLab !31, sagnikpatra301): the Library
// and the exercise picker show how many exercises are left once a search or a filter narrows
// the list, and say it in words to a screen reader.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exercisePicker } from './sheets.jsx'
import Library from './views/Library.jsx'
import { EXDB, searchExercises } from './lib/exercises.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted = []
function mount(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
const renderTopSheet = () => {
  const sheet = useUI.getState().sheets.at(-1)
  return mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const chip = (host, text) => [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim() === text)
const count = host => host.querySelector('.search .search-count')

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

// The screens run the same search over the same catalogue, so the expected numbers come from it.
const matches = q => searchExercises(EXDB, q).length

describe('exercise search result count', () => {
  for (const [where, open] of [
    ['Library', () => mount(<MemoryRouter><Library /></MemoryRouter>)],
    ['exercise picker', () => { exercisePicker(vi.fn()); return renderTopSheet() }],
  ]) {
    it(`${where}: appears with a search, follows it, and goes when the search is cleared`, () => {
      const host = open()
      const input = host.querySelector('.search input')
      expect(count(host)).toBeNull()
      expect(host.querySelector('.search').classList.contains('has-count')).toBe(false)

      act(() => type(input, 'bench press'))
      const n = matches('bench press')
      expect(n).toBeGreaterThan(1)
      expect(count(host).textContent).toBe(String(n))
      expect(count(host).getAttribute('aria-label')).toBe(`${n} exercises`)
      expect(host.querySelector('.search').classList.contains('has-count')).toBe(true)

      act(() => type(input, 'bench press dumbbell incline'))
      expect(Number(count(host).textContent)).toBe(matches('bench press dumbbell incline'))

      act(() => type(input, ''))
      expect(count(host)).toBeNull()
    })

    it(`${where}: counts a body-part filter too, and reads "1 exercise" for one`, () => {
      const host = open()
      act(() => chip(host, 'neck').click())
      const neck = EXDB.filter(e => e.bp === 'neck').length
      expect(Number(count(host).textContent)).toBe(neck)
      const one = EXDB.find(e => searchExercises(EXDB, e.n).length === 1)
      act(() => chip(host, 'All').click())
      act(() => type(host.querySelector('.search input'), one.n))
      expect(count(host).textContent).toBe('1')
      expect(count(host).getAttribute('aria-label')).toBe('1 exercise')
    })
  }
})
