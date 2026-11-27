// @vitest-environment happy-dom
// Discord "Zoom and pan on a custom exercise photo": a tap on your own exercise's photo opens it
// full screen, where two fingers pinch it and one drags it; a still tap or the × closes it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/media-store.js', () => ({
  mediaStore: { url: async () => 'blob:photo', release: () => {}, subscribe: () => () => {} },
}))
const { default: CustomMedia } = await import('./CustomMedia.jsx')

const ex = { id: 'c1', n: 'My row', custom: true, media: { kind: 'image', mime: 'image/jpeg', hash: 'a'.repeat(64), size: 1000, width: 600, height: 800 } }
const mounted = []
const mount = el => {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  act(() => root.render(el))
  return host
}
const pointer = (el, type, id, x, y) => act(() => { el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, clientX: x, clientY: y })) })

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; useUI.setState({ sheets: [] }); document.body.innerHTML = '' })
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('custom exercise photo, full screen', () => {
  it('opens on a tap, pinches in, drags, and a still tap closes it once back at fit', async () => {
    const host = mount(<CustomMedia ex={ex} />)
    await act(async () => {})
    act(() => { host.querySelector('.exmedia').click() })
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet.kind).toBe('viewer')
    const v = mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
    await act(async () => {})
    const stage = v.querySelector('.pzoom')
    const img = stage.querySelector('img')
    Object.defineProperty(img, 'offsetWidth', { value: 300 })
    Object.defineProperty(img, 'offsetHeight', { value: 400 })
    pointer(stage, 'pointerdown', 1, 100, 200)
    pointer(stage, 'pointerdown', 2, 200, 200)
    pointer(stage, 'pointermove', 2, 300, 200)
    expect(img.style.transform).toBe('translate(0px, 0px) scale(2)')
    pointer(stage, 'pointerup', 2, 300, 200)
    pointer(stage, 'pointermove', 1, 400, 200)
    // twice as big: 150 px of room on each side, no further
    expect(img.style.transform).toBe('translate(150px, 0px) scale(2)')
    pointer(stage, 'pointerup', 1, 400, 200)
    // zoomed in, a tap does not close it
    pointer(stage, 'pointerdown', 3, 50, 50)
    pointer(stage, 'pointerup', 3, 50, 50)
    expect(useUI.getState().sheets.length).toBe(1)
    act(() => { v.querySelector('button[aria-label="Close"]').click() })
    expect(useUI.getState().sheets.length).toBe(0)
  })

  it('a tap on the fitted photo closes it', async () => {
    const host = mount(<CustomMedia ex={ex} />)
    await act(async () => {})
    act(() => { host.querySelector('.exmedia').click() })
    const sheet = useUI.getState().sheets.at(-1)
    const v = mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
    await act(async () => {})
    const stage = v.querySelector('.pzoom')
    pointer(stage, 'pointerdown', 1, 100, 100)
    pointer(stage, 'pointerup', 1, 101, 100)
    expect(useUI.getState().sheets.length).toBe(0)
  })
})
