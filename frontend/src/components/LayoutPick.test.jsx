// @vitest-environment happy-dom
// The first workout of a new profile asks once how it should look: one exercise per page, or the
// whole session as a list (S.layoutAsk, set by freshState).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const m = vi.hoisted(() => ({ S: {}, sheets: [] }))
vi.mock('../store/useStore.js', () => {
  const update = fn => { const next = JSON.parse(JSON.stringify(m.S)); fn(next); m.S = next }
  const useStore = sel => (sel ? sel({ S: m.S, update }) : { S: m.S, update })
  useStore.getState = () => ({ S: m.S, update })
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const ui = { openSheet: render => { m.sheets.push(render); return { close: vi.fn() } }, toast: vi.fn() }
  const useUI = sel => (sel ? sel(ui) : ui)
  useUI.getState = () => ui
  return { useUI }
})
import { askLayout, shouldAskLayout } from './LayoutPick.jsx'

let host, root
beforeEach(() => { m.sheets = []; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the first workout asks for a layout', () => {
  it('only a fresh profile in a real, live session', () => {
    const S = { layoutAsk: true, active: { entries: [] } }
    expect(shouldAskLayout(S)).toBe(true)
    expect(shouldAskLayout({ ...S, layoutAsk: undefined })).toBe(false)
    expect(shouldAskLayout(S, { sandbox: true })).toBe(false)
    expect(shouldAskLayout(S, { editing: true })).toBe(false)
    expect(shouldAskLayout({ ...S, active: { backfill: true } })).toBe(false)
    expect(shouldAskLayout({ layoutAsk: true })).toBe(false)
  })
  it('asks once, and the list choice sticks for this session and the next', async () => {
    m.S = { layoutAsk: true, workoutView: 'cards', active: { entries: [], workoutView: 'cards' } }
    askLayout()
    expect('layoutAsk' in m.S).toBe(false)
    const close = vi.fn()
    await act(async () => { root.render(<>{m.sheets[0](close)}</>) })
    expect([...host.querySelectorAll('.lp-opt .lp-t')].map(e => e.textContent)).toEqual(['One at a time', 'All on one page'])
    await act(async () => { host.querySelector('[data-layout="list"]').click() })
    expect(m.S.workoutView).toBe('list')
    expect(m.S.active.workoutView).toBeUndefined()
    expect(close).toHaveBeenCalled()
  })
})
