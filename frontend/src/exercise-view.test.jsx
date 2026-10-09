// @vitest-environment happy-dom
// List or cards (S.exerciseView): one button beside the search field switches every exercise
// list — the Library, the add-exercise picker and the muscle explorer — between rows with a 50px
// thumbnail and a grid of picture cards with the name under the picture. The list stays the default, so a profile that
// never touches the button sees exactly what it saw before.
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exercisePicker } from './sheets.jsx'
import Library from './views/Library.jsx'
import Muscles from './views/Muscles.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))

const mounted = []
const view = () => useStore.getState().S.exerciseView
function render(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
// Renders whatever sheet is on top and returns its host element.
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const toggle = host => host.querySelector('button[aria-label="Cards"]')
// The button belongs to the search row, next to the field — never in a header (see the next test).
const besideSearch = btn => btn.parentElement.classList.contains('search-row') && !!btn.parentElement.querySelector('.search input')
const isCards = host => host.querySelector('.list').classList.contains('ex-grid')
const pickMuscle = host => act(() => host.querySelector('.chip[aria-pressed]').click())
const setView = v => useStore.setState(s => ({ S: { ...s.S, exerciseView: v } }))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('exercise list or cards', () => {
  it('Library: a list until the button beside the search turns the cards on, and back', () => {
    const host = render(<Library />)
    expect(isCards(host)).toBe(false)
    expect(besideSearch(toggle(host))).toBe(true)
    expect(toggle(host).closest('.hdr')).toBeNull()
    expect(toggle(host).getAttribute('aria-pressed')).toBe('false')
    act(() => toggle(host).click())
    expect(view()).toBe('cards')
    expect(isCards(host)).toBe(true)
    expect(toggle(host).getAttribute('aria-pressed')).toBe('true')
    act(() => toggle(host).click())
    expect(view()).toBe('list')
    expect(isCards(host)).toBe(false)
  })

  it('reads a profile saved before the setting existed as the list', () => {
    useStore.setState(s => { const S = { ...s.S }; delete S.exerciseView; return { S } })
    expect(isCards(render(<Library />))).toBe(false)
  })

  it('keeps "Create your own exercise" a full-width row above the cards', () => {
    setView('cards')
    const first = render(<Library />).querySelector('.list.ex-grid > .item')
    expect(first.classList.contains('ex-new')).toBe(true)
  })

  it('picker: follows the same setting and switches it beside its own search, by muscle too', () => {
    exercisePicker(vi.fn())
    const host = renderTop()
    expect(isCards(host)).toBe(false)
    expect(besideSearch(toggle(host))).toBe(true)
    act(() => toggle(host).click())
    expect(view()).toBe('cards')
    expect(isCards(host)).toBe(true)
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'By muscle').click())
    pickMuscle(host)
    expect(isCards(host)).toBe(true)
    expect(besideSearch(toggle(host))).toBe(true)
    expect(toggle(host).getAttribute('aria-pressed')).toBe('true')
    act(() => toggle(host).click())
    expect(isCards(host)).toBe(false)
  })

  it('Muscles page: the results follow the setting, with the button beside their search', () => {
    setView('cards')
    const host = render(<Muscles />)
    pickMuscle(host)
    expect(isCards(host)).toBe(true)
    expect(besideSearch(toggle(host))).toBe(true)
    expect(toggle(host).closest('.hdr')).toBeNull()
  })

  // The desktop layout turns every #app list into two columns and forces every sheet list back
  // into one column, both on an id selector — the grid has to win over each of them.
  it('lays the cards out as a grid over the desktop two-column and the sheet column rules', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const rule = css.match(/^([^{}\n]*\.list\.ex-grid[^{}\n]*)\{([^}]*)\}/m)
    expect(rule?.[1]).toContain('#app .list.ex-grid')
    expect(rule[1]).toContain('#modal-root .list.ex-grid')
    expect(rule[2]).toContain('display:grid')
  })
})
