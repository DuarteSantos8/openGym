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

  // 1000009779 is set C: start + 5 digit pairs + checksum = 7 symbols x 11, stop 13 = 90 modules,
  // plus 10 quiet modules each side = 110. Bars are drawn a whole number of physical pixels wide, never stretched
  // by a fractional factor (which makes neighbouring bars come out 2 and 3 px wide at random).
  it.each([
    [1, 2, 220, 220],           // floor(280 / 110) = 2 px a module
    [2, 5, 550, 275],           // floor(560 / 110) = 5 device px a module, shown at 275 CSS px
    [3, 7, 770, 770 / 3],       // floor(840 / 110) = 7
    [1.25, 3, 330, 264],        // floor(350 / 110) = 3: fractional ratios still land on whole pixels
  ])('at devicePixelRatio %s draws %s px a module: a %s px canvas shown at %s', (dpr, _k, px, css) => {
    vi.stubGlobal('devicePixelRatio', dpr)
    act(() => root.render(<CardCode value="1000009779" fmt="code128" size={280} />))
    expect(container.querySelector('[data-qr]')).toBeFalsy()
    const canvas = container.querySelector('canvas')
    expect(canvas.getAttribute('aria-label')).toBe('Barcode')
    expect(canvas.width).toBe(px)
    expect(parseFloat(canvas.style.width)).toBeCloseTo(css, 2)
    expect(parseInt(canvas.style.height, 10)).toBeLessThan(280)
    vi.unstubAllGlobals()
  })

  it('a code too long to fit is drawn at one pixel a module and overflows, rather than squeezed into blur', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    // set B: start + 30 + checksum = 32 symbols x 11, stop 13, quiet 20 = 385 modules > 280
    act(() => root.render(<CardCode value={'X'.repeat(30)} fmt="code128" size={280} />))
    const canvas = container.querySelector('canvas')
    expect(canvas.width).toBe(385)
    expect(canvas.style.width).toBe('385px')
    vi.unstubAllGlobals()
  })
})
