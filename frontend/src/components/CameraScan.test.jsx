// @vitest-environment happy-dom
// Night QA 146: Plan → Scan a QR code with no camera said "Import a photo or type the code
// instead" and offered only Cancel. With `importPhoto` the photo import is right there.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/scan-web.js', () => ({ decodeSource: vi.fn() }))
const importCodeFromImage = vi.fn()
vi.mock('../lib/scan.js', () => ({ importCodeFromImage: (...a) => importCodeFromImage(...a) }))
import CameraScan from './CameraScan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
const mount = async el => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); await act(async () => { root.render(el) }); await act(async () => {}) }
afterEach(() => { act(() => root?.unmount()); host?.remove() })
const buttons = () => [...host.querySelectorAll('button')].map(b => b.textContent)

describe('CameraScan without a camera', () => {
  it('offers Import photo when asked to, and hands the code from the image on', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    const found = vi.fn(), err = vi.fn()
    await mount(<CameraScan importPhoto onFound={found} onImportError={err} onCancel={() => {}} />)
    expect(buttons()).toEqual(['Import photo', 'Cancel'])
    importCodeFromImage.mockResolvedValueOnce({ value: 'https://opengym.ch/r/abc', fmt: 'QR_CODE' })
    const input = host.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'code.png', { type: 'image/png' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => {})
    expect(found).toHaveBeenCalledWith({ value: 'https://opengym.ch/r/abc', fmt: 'QR_CODE' })
    importCodeFromImage.mockResolvedValueOnce(null)
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => {})
    expect(err).toHaveBeenCalledWith('No code found in that image')
  })
  it('the gym check-in, whose form offers import itself, keeps only Cancel', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    await mount(<CameraScan onFound={() => {}} onCancel={() => {}} />)
    expect(buttons()).toEqual(['Cancel'])
  })
})
