// @vitest-environment happy-dom
// The × in the exercise search (Library and the exercise picker), beside the live result
// count (search-count.test.jsx). It shows while there is text, one tap empties the search, and it
// clears only the text: a body-part filter that also narrows the list keeps its count.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exercisePicker } from './sheets.jsx'
import Library from './views/Library.jsx'
import { EXDB } from './lib/exercises.js'

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
const clear = host => host.querySelector('.search .clear')
const count = host => host.querySelector('.search .search-count')

beforeEach(() => {
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('exercise search clear button', () => {
  for (const [where, open] of [
    ['Library', () => mount(<MemoryRouter><Library /></MemoryRouter>)],
    ['exercise picker', () => { exercisePicker(vi.fn()); return renderTopSheet() }],
  ]) {
    it(`${where}: shows with text, and one tap empties the search`, () => {
      const host = open()
      const input = host.querySelector('.search input')
      expect(clear(host)).toBeNull()
      act(() => type(input, 'bench press'))
      expect(clear(host).getAttribute('aria-label')).toBe('Clear')
      expect(host.querySelector('.search').classList.contains('has-clear')).toBe(true)
      act(() => clear(host).click())
      expect(input.value).toBe('')
      expect(clear(host)).toBeNull()
      expect(count(host)).toBeNull()
      expect(host.querySelector('.search').classList.contains('has-clear')).toBe(false)
    })

    it(`${where}: clears only the text; a body-part filter keeps its count`, () => {
      const host = open()
      act(() => chip(host, 'neck').click())
      act(() => type(host.querySelector('.search input'), 'stretch'))
      act(() => clear(host).click())
      expect(host.querySelector('.search input').value).toBe('')
      expect(Number(count(host).textContent)).toBe(EXDB.filter(e => e.bp === 'neck').length)
    })
  }
})
