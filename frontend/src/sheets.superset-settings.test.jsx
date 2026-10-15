// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { activeSupersetSheet } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import * as duration from './components/DurationWheel.jsx'
let root, host
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const S = structuredClone(DEF)
  S.active = { id: 'a', entries: ['0001', '0007'].map(id => ({ id, sg: 'g', target: { mode: 'reps' }, sets: [{ r: 8, done: false }] })) }
  useStore.setState({ S }); useUI.setState({ sheets: [] })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll(); vi.restoreAllMocks() })
const open = () => { activeSupersetSheet('g'); act(() => root.render(useUI.getState().sheets.at(-1).render(() => {}))) }
const save = () => act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
it('exposes Off by default and saves round rest only into the active group', () => {
  open(); expect(host.textContent).toContain('Off')
  vi.spyOn(duration, 'durationSheet').mockImplementation(({ onDone }) => onDone(75))
  act(() => [...host.querySelectorAll('[role="button"],button')].find(b => b.textContent.includes('Rest after each round')).click())
  save()
  expect(useStore.getState().S.active.entries.every(e => e.target.sgRest === 75 && e.sets[0].r === 8 && !e.sets[0].done)).toBe(true)
})
it('does not save settings into a replacement workout', () => {
  open(); useStore.getState().update(s => { s.active.id = 'replacement' })
  const before = structuredClone(useStore.getState().S.active); save()
  expect(useStore.getState().S.active).toEqual(before)
})
