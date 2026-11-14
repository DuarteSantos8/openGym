// @vitest-environment happy-dom
// A closing sheet leaves as an inert copy (a ghost) that slides down while the state is already gone.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modals from './Modals.jsx'

const mocks = vi.hoisted(() => {
  const listeners = new Set()
  const state = { sheets: [], closeSheet(id) { state.sheets = state.sheets.filter(s => s.id !== id); listeners.forEach(l => l()) } }
  return { state, subscribe(l) { listeners.add(l); return () => listeners.delete(l) }, setSheets(s) { state.sheets = s; listeners.forEach(l => l()) } }
})
vi.mock('../store/useUI.js', async () => {
  const React = await import('react')
  const useUI = (sel = s => s) => React.useSyncExternalStore(mocks.subscribe, () => sel(mocks.state), () => sel(mocks.state))
  useUI.getState = () => mocks.state
  return { useUI }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const set = sheets => act(async () => { mocks.setSheets(sheets) })
const ghosts = () => [...document.querySelectorAll('.sheet-ghost')]
const a = { id: 1, kind: 'sheet', render: () => <><h3>Menu</h3><button id="pick">Pick</button></> }
const b = { id: 2, kind: 'sheet', render: () => <h3>Colour</h3> }

beforeEach(async () => {
  window.scrollTo = vi.fn()
  vi.spyOn(history, 'pushState').mockImplementation(() => {})
  vi.spyOn(history, 'go').mockImplementation(() => {})
  document.documentElement.className = ''
  document.body.innerHTML = '<div id="host"></div>'
  host = document.getElementById('host')
  root = createRoot(host)
  mocks.state.sheets = []
  await act(async () => { root.render(<Modals />) })
})
afterEach(async () => { await act(async () => { root.unmount() }); vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = '' })

describe('sheet exit ghost', () => {
  it('leaves an inert, id-free copy with its dim when the sheet closes; the state is gone at once', async () => {
    await set([a])
    expect(ghosts().length).toBe(0)
    await set([])
    expect(document.querySelector('#modal-root')).toBeNull()
    const [g] = ghosts()
    expect(g).toBeTruthy()
    expect(g.getAttribute('aria-hidden')).toBe('true')
    expect(g.inert).toBe(true)
    expect(g.querySelector('.sheet h3').textContent).toBe('Menu')
    expect(g.querySelector('.mback')).toBeTruthy()
    expect(g.classList.contains('is-handoff')).toBe(false)
    expect(g.querySelector('[id]')).toBeNull()
  })

  it('goes on animationend, and by a fallback timer', async () => {
    await set([a]); await set([])
    ghosts()[0].querySelector('.sheet').dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(ghosts().length).toBe(0)
    vi.useFakeTimers()
    await set([a]); await set([])
    expect(ghosts().length).toBe(1)
    vi.advanceTimersByTime(400)
    expect(ghosts().length).toBe(0)
  })

  it('takes no focus', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="op">x</button>')
    const op = document.getElementById('op'); op.focus()
    await set([a]); await set([])
    expect(ghosts()[0].querySelector('[tabindex],button')?.matches(':focus') ?? false).toBe(false)
  })

  it('a hand-off keeps one dim: the ghost of the old sheet has none', async () => {
    await set([a])
    await set([b])
    const [g] = ghosts()
    expect(g.querySelector('.sheet h3').textContent).toBe('Menu')
    expect(g.querySelector('.mback')).toBeNull()
    expect(g.classList.contains('is-handoff')).toBe(true)   // its rows fade while it slides
    expect(document.querySelectorAll('#modal-root .mback').length).toBe(1)
  })

  it('makes no ghost under Reduce Motion', async () => {
    document.documentElement.classList.add('reduce-motion')
    await set([a]); await set([])
    expect(ghosts().length).toBe(0)
  })
})
