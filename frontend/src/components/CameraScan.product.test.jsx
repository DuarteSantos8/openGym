// @vitest-environment happy-dom
// The product-barcode mode of the camera scanner, with the camera and the decoder mocked: frames
// are decoded until a barcode shows, which is handed over once, and the camera stops.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const decode = vi.fn()
vi.mock('../lib/scan-web.js', () => ({ decodeSource: (...args) => decode(...args) }))
import CameraScan from './CameraScan.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, stopTrack
const wait = async ms => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }

beforeEach(() => {
  decode.mockReset()
  stopTrack = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get: () => 4 })
  // happy-dom only takes a real MediaStream here; the test's stream is a stub.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null })
  HTMLVideoElement.prototype.play = vi.fn(async () => {})
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('CameraScan in product mode', () => {
  it('takes a code only once two reads agree: one stray read of another code is not enough', async () => {
    decode.mockResolvedValueOnce({ value: '8001190000001', fmt: 'ean13' }).mockResolvedValue({ value: '3017620422003', fmt: 'ean13' })
    const onFound = vi.fn()
    await act(async () => { root.render(<CameraScan product onFound={onFound} />) })
    await wait(500)
    expect(decode.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(onFound).toHaveBeenCalledTimes(1)
    expect(onFound).toHaveBeenCalledWith({ value: '3017620422003', fmt: 'ean13' })
  })

  it('asks the decoder for product barcodes, reports the first one once, and stops the camera', async () => {
    decode.mockResolvedValueOnce(null).mockResolvedValue({ value: '3017620422003', fmt: 'ean13' })
    const onFound = vi.fn()
    await act(async () => { root.render(<CameraScan product onFound={onFound} />) })
    await wait(500)
    expect(decode).toHaveBeenCalledWith(expect.anything(), { product: true })
    expect(onFound).toHaveBeenCalledTimes(1)
    expect(onFound).toHaveBeenCalledWith({ value: '3017620422003', fmt: 'ean13' })
    expect(stopTrack).toHaveBeenCalled()
    expect(host.textContent).toContain('Point the camera at the barcode')
    expect(host.querySelector('h3')).toBeNull()
  })

  it('says so when the camera is refused, and the sheet around it keeps its typed field', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    await act(async () => { root.render(<CameraScan product onFound={vi.fn()} />) })
    await wait(20)
    expect(host.textContent).toContain('Camera access was denied.')
    expect(host.querySelector('video')).toBeNull()
  })

  it('lets go of the camera while the tab is hidden and opens it again on return', async () => {
    decode.mockResolvedValue(null)
    const setVisibility = state => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    await act(async () => { root.render(<CameraScan product onFound={vi.fn()} />) })
    await wait(30)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
    await act(async () => { setVisibility('hidden') })
    expect(stopTrack).toHaveBeenCalledTimes(1)
    const calls = decode.mock.calls.length
    await wait(400)
    expect(decode.mock.calls.length).toBeLessThanOrEqual(calls + 1)
    await act(async () => { setVisibility('visible') })
    await wait(30)
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('stops the camera when it goes away', async () => {
    decode.mockResolvedValue(null)
    await act(async () => { root.render(<CameraScan product onFound={vi.fn()} />) })
    await wait(30)
    act(() => root.render(<div />))
    expect(stopTrack).toHaveBeenCalled()
  })
})
