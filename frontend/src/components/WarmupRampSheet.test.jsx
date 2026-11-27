// @vitest-environment happy-dom
// Settings → Your warm-up ramp (#1423): saved once as S.warmupRamp, back to the built-in clears it.
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
import WarmupRampSheet, { rampLine } from './WarmupRampSheet.jsx'

let host, root
beforeEach(() => { mocks.S = {}; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const btn = label => [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label)

describe('Your warm-up ramp', () => {
  it('starts from the built-in heavy ramp, saves an edit, and goes back to built-in', async () => {
    const close = vi.fn()
    expect(rampLine(mocks.S)).toBe('Built-in')
    act(() => root.render(<WarmupRampSheet close={close} />))
    expect(btn('Back to the built-in ramp')).toBeUndefined()
    await act(async () => { btn('Remove warm-up 4').click() })
    await act(async () => { btn('Save').click() })
    expect(mocks.S.warmupRamp).toEqual([{ wb: true, r: 10 }, { wp: 40, r: 5 }, { wp: 60, r: 3 }])
    expect(rampLine(mocks.S)).toBe('Bar × 10 · 40% × 5 · 60% × 3')
    expect(close).toHaveBeenCalled()
    act(() => root.render(<WarmupRampSheet close={close} key="2" />))
    await act(async () => { btn('Back to the built-in ramp').click() })
    expect('warmupRamp' in mocks.S).toBe(false)
  })
  it('removing every row saves no ramp at all', async () => {
    mocks.S = { warmupRamp: [{ wp: 50, r: 5 }] }
    act(() => root.render(<WarmupRampSheet close={vi.fn()} />))
    await act(async () => { btn('Remove warm-up 1').click() })
    await act(async () => { btn('Save').click() })
    expect('warmupRamp' in mocks.S).toBe(false)
  })
})
