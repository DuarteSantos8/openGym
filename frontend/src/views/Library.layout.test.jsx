// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Library from './Library.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.jsx'
import { capWords } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, user: state.user, config: state.config, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...args) => mocks.navigate(...args) }))
vi.mock('../sheets.jsx', () => ({ exerciseDetailSheet: vi.fn(), addToRoutineSheet: vi.fn(), customExSheet: vi.fn() }))

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Library />))
  return host
}
const rows = host => [...host.querySelectorAll('.iv-lib-row')]
const primary = host => host.querySelector('.iv-lib-primary .btn.primary')
const select = row => row.querySelector('.iv-lib-select')
beforeEach(() => {
  mocks.S = { unit: 'kg', lang: 'en', routines: [], workouts: [], customEx: [], exWeights: {}, equipProfiles: [], activeEquipId: null, equipFilterOn: false }
  mocks.user = null
  mocks.config = null
  mocks.navigate = vi.fn()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('approved Library layout', () => {
  it('has a labelled search, one main action, and no icon-only row Add buttons', () => {
    const host = render()
    expect(host.querySelector('h1').textContent).toBe('Library')
    expect(host.querySelector('label[for="iv-library-search"]').textContent).toBe('Search')
    expect(host.querySelectorAll('.lib-add')).toHaveLength(0)
    // nothing is picked until the user picks, so no Add action is armed yet
    expect(rows(host).every(r => select(r).getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(host.querySelector('.iv-lib-primary')).toBeNull()
    expect(select(rows(host)[0]).textContent).toContain('Select')
    act(() => select(rows(host)[0]).click())
    expect(host.querySelectorAll('.iv-lib-primary .btn.primary')).toHaveLength(1)
    expect(primary(host).textContent).toBe('Add to my plan')
  })

  it('adds several picked exercises together, keeps picks across a search, and clears them', () => {
    const host = render()
    const [a, b] = rows(host).slice(0, 2).map(r => r.querySelector('.tt').textContent)
    act(() => select(rows(host)[0]).click())
    act(() => select(rows(host)[1]).click())
    expect(primary(host).querySelector('.iv-lib-count').textContent).toBe('2')
    // a pick hidden by a search stays picked
    const input = host.querySelector('#iv-library-search')
    act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'zzzz-no-match'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(primary(host)).not.toBeNull()
    act(() => primary(host).click())
    expect(addToRoutineSheet).toHaveBeenCalledTimes(1)
    expect(addToRoutineSheet.mock.calls[0][0].map(e => e.n)).toEqual([a, b])
    expect(host.querySelector('.iv-lib-primary')).toBeNull()
    act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => select(rows(host)[0]).click())
    act(() => host.querySelector('.iv-lib-unpick').click())
    expect(host.querySelector('.iv-lib-primary')).toBeNull()
  })

  it('opens on what you train, not the catalogue’s alphabetical start', () => {
    mocks.S.routines = [{ id: 'r', name: 'R', ex: [{ id: '0025' }] }]
    const host = render()
    expect(rows(host)[0].querySelector('.item-open').textContent).toMatch(/bench press/i)
  })

  it('adds the exercise chosen with the visible Select control through the existing flow', () => {
    const host = render(), second = rows(host)[1]
    const name = second.querySelector('.tt').textContent
    act(() => select(second).click())
    expect(select(rows(host)[1]).getAttribute('aria-pressed')).toBe('true')
    expect(primary(host).getAttribute('aria-label')).toBe(`Add “${capWords(name)}” to my plan`)
    act(() => primary(host).click())
    expect(addToRoutineSheet).toHaveBeenCalledTimes(1)
    expect(addToRoutineSheet.mock.calls[0][0].n).toBe(name)
  })

  it('keeps exercise details and custom creation on their existing actions', () => {
    const host = render(), first = rows(host)[0]
    const name = first.querySelector('.tt').textContent
    act(() => first.querySelector('.item-open').click())
    expect(exerciseDetailSheet.mock.calls[0][0].n).toBe(name)
    act(() => host.querySelector('.ex-new').click())
    expect(customExSheet).toHaveBeenCalled()
  })

  it('keeps secondary destinations and the labelled list/card preference one tap away', () => {
    const host = render(), more = host.querySelector('.iv-lib-more')
    expect(more.querySelector('summary').textContent).toBe('More')
    expect(more.textContent).toContain('By muscle')
    expect(more.textContent).toContain('Ladders')
    const view = more.querySelector('.ex-view-btn.with-label')
    expect(view.textContent).toBe('Cards')
    expect(view.getAttribute('aria-label')).toBe('Cards')
    act(() => view.click())
    expect(mocks.S.exerciseView).toBe('cards')
  })

  it('keeps the signed-in Community destination with the other secondary actions', () => {
    mocks.user = { id: 'u' }
    mocks.config = { shared: { types: ['exercises'] } }
    const host = render()
    const community = [...host.querySelectorAll('.iv-lib-more-actions .btn')].find(b => b.textContent === 'Community')
    expect(community).toBeTruthy()
    act(() => community.click())
    expect(mocks.navigate).toHaveBeenCalledWith('/community')
  })

  it('a Select tap again unpicks, and the Add bar goes with the last pick', () => {
    const host = render()
    act(() => select(rows(host)[0]).click())
    act(() => select(rows(host)[0]).click())
    expect(select(rows(host)[0]).getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('.iv-lib-primary')).toBeNull()
  })
})
