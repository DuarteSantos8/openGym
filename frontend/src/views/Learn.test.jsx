// @vitest-environment happy-dom
// Learn (EP24): guides that open in place and a glossary with a search, all from the bundle.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Learn from './Learn.jsx'
import Term, { openTerm } from '../components/Term.jsx'
import FirstWins from '../components/FirstWins.jsx'
import { GLOSSARY, GUIDES } from '../lib/learn.js'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null; act(() => useUI.setState({ sheets: [] })); vi.unstubAllGlobals() })

function mount(node, at = '/learn') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>))
}
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('Learn', () => {
  it('lists every guide closed and the whole glossary', () => {
    mount(<Learn />)
    expect(container.querySelectorAll('[data-guide]').length).toBe(GUIDES.length)
    expect(container.querySelectorAll('.iv-learn-body').length).toBe(0)
    expect(container.querySelectorAll('[data-term]').length).toBe(GLOSSARY.length)
  })

  it('opens a guide in place and closes it again, saying so to a screen reader', () => {
    mount(<Learn />)
    const btn = container.querySelector('[data-guide="how-heavy"] button')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    act(() => btn.click())
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const body = container.querySelector('#' + btn.getAttribute('aria-controls'))
    expect(body.textContent).toContain('starting weight')
    expect(body.querySelector('.iv-learn-sources').textContent).toContain('American College of Sports Medicine')
    act(() => btn.click())
    expect(container.querySelector('.iv-learn-body')).toBe(null)
  })

  it('opens the guide named in the address', () => {
    mount(<Learn />, '/learn?g=safety')
    expect(container.querySelector('[data-guide="safety"] button').getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('.iv-learn-body').length).toBe(1)
  })

  it('narrows the glossary as you type and says when nothing matches', () => {
    mount(<Learn />)
    const input = container.querySelector('.searchf input')
    type(input, 'reps in reserve')
    expect(container.querySelector('[data-term]').dataset.term).toBe('rir')
    type(input, 'zzzzqq')
    expect(container.querySelectorAll('[data-term]').length).toBe(0)
    expect(container.querySelector('[role="status"]').textContent).toBe('No term matches.')
    act(() => container.querySelector('.searchf .clear').click())
    expect(container.querySelectorAll('[data-term]').length).toBe(GLOSSARY.length)
  })

  it('makes no request and holds no link out of the app', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network in Learn')))
    vi.stubGlobal('fetch', fetchSpy)
    mount(<Learn />)
    for (const b of container.querySelectorAll('[data-guide] button')) act(() => b.click())
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(container.querySelectorAll('a[href]').length).toBe(0)
    expect(container.querySelectorAll('img, iframe, script').length).toBe(0)
  })
})

describe('Term', () => {
  it('is a button that opens the glossary entry', () => {
    mount(<Term id="rir">reps in reserve</Term>)
    const b = container.querySelector('button.iv-term')
    expect(b.textContent).toBe('reps in reserve')
    expect(b.getAttribute('aria-haspopup')).toBe('dialog')
    act(() => b.click())
    expect(useUI.getState().sheets.length).toBe(1)
    expect(useUI.getState().sheets[0].kind).toBe('center')
  })
  it('shows plain words for a term it does not have', () => {
    mount(<Term id="nope">mystery</Term>)
    expect(container.querySelector('button')).toBe(null)
    expect(container.textContent).toBe('mystery')
    expect(openTerm('nope')).toBe(false)
  })
})

describe('FirstWins', () => {
  const S = days => ({ workouts: days.map(d => ({ d })) })
  it('ticks what is done and names what is next', () => {
    mount(<FirstWins S={S(['2026-11-02'])} />)
    expect(container.querySelector('.iv-wins').dataset.wins).toBe('1')
    expect(container.querySelector('[data-win="first"]').className).toBe('done')
    expect(container.querySelector('[data-win="two-in-week"]').className).toBe('')
    expect(container.querySelector('.card-head-sub').textContent).toBe('1 of 5 done')
    expect(container.querySelector('[data-win="five"]').textContent).toContain('5 workouts logged')
  })
  it('goes away once all five are in', () => {
    mount(<FirstWins S={S(Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`))} />)
    expect(container.querySelector('.iv-wins')).toBe(null)
  })
})
