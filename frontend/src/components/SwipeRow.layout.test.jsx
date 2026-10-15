// @vitest-environment happy-dom
// #431: the row's width was read on every move, right after the move before had written the
// panes' widths, which forces a layout per frame on a phone. It is read once as the swipe locks.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import SwipeRow from './SwipeRow.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const pe = (type, x, t) => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'touch' }, clientX: { value: x }, clientY: { value: 100 }, timeStamp: { value: t } })
  return e
}
let widthDesc
let reads = 0
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
  widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { reads++; return 360 }, configurable: true })
})
afterEach(() => { if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc); else delete HTMLElement.prototype.clientWidth })

it('reads the row width once per swipe, not once per move', async () => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<SwipeRow onDelete={() => {}}><span>row</span></SwipeRow>) })
  const row = host.querySelector('.swrow')
  await act(async () => { row.dispatchEvent(pe('pointerdown', 300, 0)) })
  await act(async () => { row.dispatchEvent(pe('pointermove', 290, 16)) })   // locks
  reads = 0
  for (let k = 1; k <= 10; k++) await act(async () => { row.dispatchEvent(pe('pointermove', 290 - k * 5, 16 + k * 16)) })
  expect(reads).toBe(0)
  expect(host.querySelector('.swfront').style.transform).toBe('translateX(-60px)')
  act(() => root.unmount()); host.remove()
})
