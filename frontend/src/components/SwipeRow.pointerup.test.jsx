// @vitest-environment happy-dom
// QA round 2 (2026-10-06): on a busy phone the last moves of a fast swipe can be dropped, so the
// row stopped where the last move left it (84 of 310 px) and only opened. The release now counts
// where the finger lifted.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SwipeRow from './SwipeRow.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const pe = (type, x, t) => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'touch' }, clientX: { value: x }, clientY: { value: 100 }, timeStamp: { value: t } })
  return e
}
let widthDesc
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
  widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 360 }, configurable: true })
})
afterEach(() => { if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc); else delete HTMLElement.prototype.clientWidth })

async function swipe(moves, upX) {
  const onDelete = vi.fn()
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<SwipeRow onDelete={onDelete}><span>row</span></SwipeRow>) })
  const row = host.querySelector('.swrow')
  await act(async () => { row.dispatchEvent(pe('pointerdown', 340, 0)) })
  let t = 0
  for (const x of moves) await act(async () => { row.dispatchEvent(pe('pointermove', x, t += 20)) })
  await act(async () => { row.dispatchEvent(pe('pointerup', upX, 300)) })
  await act(async () => { await new Promise(r => setTimeout(r, 900)) })
  const out = { deleted: onDelete.mock.calls.length, transform: host.querySelector('.swfront').style.transform }
  act(() => root.unmount()); host.remove()
  return out
}

it('a swipe whose last moves were dropped still deletes: the finger lifted far past the line', async () => {
  const r = await swipe([316, 291, 274, 256], 30)
  expect(r.deleted).toBe(1)
})

it('every move delivered deletes as before', async () => {
  const r = await swipe([316, 291, 274, 256, 180, 100, 30], 30)
  expect(r.deleted).toBe(1)
})

it('a short swipe lifted where the last move was still only opens the row', async () => {
  const r = await swipe([316, 291, 274, 256], 256)
  expect(r.deleted).toBe(0)
})
