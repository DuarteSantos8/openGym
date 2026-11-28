// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useListReorder, HOLD_MS } from './use-list-reorder.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Rows of every height, the live workout's case: a superset card is three times an exercise's.
let HEIGHTS = [60, 200, 60]
let host, root, moves
function List() {
  const r = useListReorder(HEIGHTS.length, (from, to) => moves.push([from, to]))
  return <div ref={r.listRef}>{HEIGHTS.map((h, i) => <div key={i} data-reorder-row data-reorder-key={'k' + i} style={r.rowStyle(i)} {...r.press(i)}>row {i}</div>)}</div>
}
function mount() {
  moves = []
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<List />))
  const list = host.firstChild
  list.getBoundingClientRect = () => ({ top: 0, bottom: 360, height: 360, left: 0, right: 300, width: 300 })
  let top = 0
  ;[...list.children].forEach((row, i) => {
    const t = top
    row.getBoundingClientRect = () => ({ top: t, bottom: t + HEIGHTS[i], height: HEIGHTS[i], left: 0, right: 300, width: 300 })
    top += HEIGHTS[i] + 10
  })
  return [...list.children]
}
const at = (el, type, y) => act(() => { el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, button: 0, clientX: 20, clientY: y })) })
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; vi.useRealTimers() })

describe('useListReorder with rows of every height', () => {
  it('a short row gets past a tall one at the end, instead of stopping at its top (owner 2026-11-24)', () => {
    vi.useFakeTimers()
    HEIGHTS = [60, 60, 200]
    const rows = mount()
    // row 0 (0..60) to under the tall last row (140..340): past its middle (240)
    at(rows[0], 'pointerdown', 30)
    act(() => vi.advanceTimersByTime(HOLD_MS + 10))
    at(rows[0], 'pointermove', 30 + 230)
    at(rows[0], 'pointerup', 30 + 230)
    expect(moves).toEqual([[0, 2]])
  })
  it('a tall row lifted over a short one makes it slide by the tall row\'s height', () => {
    vi.useFakeTimers()
    HEIGHTS = [60, 200, 60]
    const rows = mount()
    at(rows[1], 'pointerdown', 170)
    act(() => vi.advanceTimersByTime(HOLD_MS + 10))
    at(rows[1], 'pointermove', 170 + 150)
    expect(rows[2].style.transform).toBe('translateY(-210px)')
    at(rows[1], 'pointerup', 170 + 150)
    expect(moves).toEqual([[1, 2]])
  })
  it('a tall row gets above a short first one too', () => {
    vi.useFakeTimers()
    HEIGHTS = [60, 200, 60]
    const rows = mount()
    at(rows[1], 'pointerdown', 170)
    act(() => vi.advanceTimersByTime(HOLD_MS + 10))
    at(rows[1], 'pointermove', 170 - 150)
    at(rows[1], 'pointerup', 170 - 150)
    expect(moves).toEqual([[1, 0]])
  })
})
