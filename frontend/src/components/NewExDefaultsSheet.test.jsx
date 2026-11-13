// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ S: {} }))
vi.mock('../store/useStore.js', () => {
  const update = fn => { const next = JSON.parse(JSON.stringify(mocks.S)); fn(next); mocks.S = next }
  const useStore = sel => (sel ? sel({ S: mocks.S, update }) : { S: mocks.S, update })
  useStore.getState = () => ({ S: mocks.S, update })
  return { useStore }
})
import NewExDefaultsSheet, { newExLine } from './NewExDefaultsSheet.jsx'

let host, root
beforeEach(() => { mocks.S = {}; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const btn = label => [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label)

describe('New exercises start with', () => {
  it('steps the sets down and saves them; back to 3 × 10 saves nothing at all', async () => {
    const close = vi.fn()
    act(() => root.render(<NewExDefaultsSheet close={close} />))
    expect(newExLine(mocks.S)).toBe('3 × 10 · 3 × 0:45')
    const minus = [...host.querySelectorAll('button')].filter(b => /Decrease|−|-/.test(b.getAttribute('aria-label') || b.textContent))
    await act(async () => { minus[0].click() })
    await act(async () => { btn('Save').click() })
    expect(mocks.S.newExDefaults).toEqual({ sets: 2, reps: 10, sec: 45 })
    expect(newExLine(mocks.S)).toBe('2 × 10 · 2 × 0:45')
    expect(close).toHaveBeenCalled()
    act(() => root.render(<NewExDefaultsSheet close={close} key="2" />))
    await act(async () => { btn('Back to 3 × 10').click() })
    await act(async () => { btn('Save').click() })
    expect('newExDefaults' in mocks.S).toBe(false)
  })
})
