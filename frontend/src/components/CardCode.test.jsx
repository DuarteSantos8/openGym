// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CardCode from './CardCode.jsx'

vi.mock('./QrCanvas.jsx', () => ({ default: ({ value }) => <i data-qr={value} /> }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// CardCode picks the renderer from the card's stored symbology: QR cards keep QrCanvas exactly as
// before, Code 128 cards get a wide barcode canvas (the bars come from lib/code128.js, tested there).

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('CardCode', () => {
  it.each(['qrcode', 'QR_CODE', undefined])('draws a %s card with QrCanvas', fmt => {
    act(() => root.render(<CardCode value="MEMBER-1" fmt={fmt} />))
    expect(container.querySelector('[data-qr]').getAttribute('data-qr')).toBe('MEMBER-1')
    expect(container.querySelector('canvas')).toBeFalsy()
  })

  it('draws a Code 128 card as a wide, short barcode canvas', () => {
    act(() => root.render(<CardCode value="1000009779" fmt="code128" size={280} />))
    expect(container.querySelector('[data-qr]')).toBeFalsy()
    const canvas = container.querySelector('canvas')
    expect(canvas.getAttribute('aria-label')).toBe('Barcode')
    expect(canvas.style.width).toBe('280px')
    expect(parseInt(canvas.style.height, 10)).toBeLessThan(280)
  })
})
