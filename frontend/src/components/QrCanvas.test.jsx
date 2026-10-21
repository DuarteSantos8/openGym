// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QrCanvas from './QrCanvas.jsx'
import { renderCodeToCanvas } from '../lib/qr.js'

vi.mock('../lib/qr.js', async importOriginal => ({
  ...await importOriginal(),
  renderCodeToCanvas: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, drawImage
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage })
  renderCodeToCanvas.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('QrCanvas', () => {
  it('keeps the default QR square and labels it as a QR code', async () => {
    renderCodeToCanvas.mockImplementation(async canvas => {
      canvas.width = 29
      canvas.height = 29
      return 25
    })
    await act(async () => root.render(<QrCanvas value="MEMBER-42" size={150} />))

    const canvas = host.querySelector('canvas')
    expect(renderCodeToCanvas).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 'MEMBER-42', 'qrcode')
    expect(canvas.getAttribute('aria-label')).toBe('QR code')
    expect(canvas.style.width).toBe('150px')
    expect(canvas.style.height).toBe('auto')
    expect(canvas.style.aspectRatio).toBe('1 / 1')
    expect(canvas.style.opacity).toBe('1')
    expect([canvas.width, canvas.height]).toEqual([29, 29])
  })

  it('passes the saved barcode format to the renderer and keeps its wide aspect ratio', async () => {
    renderCodeToCanvas.mockImplementation(async canvas => {
      canvas.width = 400
      canvas.height = 130
      return 400
    })
    await act(async () => root.render(<QrCanvas value="001234" fmt="CODE_128" size={150} />))

    const canvas = host.querySelector('canvas')
    expect(renderCodeToCanvas).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), '001234', 'CODE_128')
    expect(canvas.getAttribute('aria-label')).toBe('Barcode')
    expect(canvas.style.width).toBe('280px')
    expect(canvas.style.maxWidth).toBe('100%')
    expect(canvas.style.height).toBe('auto')
    expect(canvas.style.opacity).toBe('1')
    expect([canvas.width, canvas.height]).toEqual([400, 130])
  })

  it('ignores an older pending render after the value and format change', async () => {
    const pending = []
    renderCodeToCanvas.mockImplementation(canvas => new Promise(resolve => pending.push({ canvas, resolve })))
    await act(async () => root.render(<QrCanvas value="OLD-QR" />))
    await act(async () => root.render(<QrCanvas value="NEW-123" fmt="code128" />))

    const canvas = host.querySelector('canvas')
    expect(canvas.style.opacity).toBe('0')
    await act(async () => {
      pending[1].canvas.width = 400
      pending[1].canvas.height = 130
      pending[1].resolve(400)
    })
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(pending[1].canvas, 0, 0)
    expect(canvas.style.opacity).toBe('1')

    await act(async () => {
      pending[0].canvas.width = 29
      pending[0].canvas.height = 29
      pending[0].resolve(25)
    })
    expect(drawImage).toHaveBeenCalledTimes(1)
    expect([canvas.width, canvas.height]).toEqual([400, 130])
    expect(canvas.getAttribute('aria-label')).toBe('Barcode')
    expect(canvas.style.opacity).toBe('1')
  })
})
