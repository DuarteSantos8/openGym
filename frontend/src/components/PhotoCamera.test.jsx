// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoCamera, { cameraError } from './PhotoCamera.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* #951: the progress-photo camera. happy-dom has no camera, so getUserMedia is stood in for. */
let host, root, saved
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  saved = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  if (saved) Object.defineProperty(navigator, 'mediaDevices', saved)
  else delete navigator.mediaDevices
})
const setDevices = v => Object.defineProperty(navigator, 'mediaDevices', { value: v, configurable: true })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const photo = n => ({ key: 'k' + n, d: '2026-10-0' + n, m: { kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg', size: 1, width: 3, height: 4 } })

describe('PhotoCamera', () => {
  it('reads a refused camera as denied and anything else as unavailable', () => {
    expect(cameraError({ name: 'NotAllowedError' })).toBe('denied')
    expect(cameraError({ name: 'SecurityError' })).toBe('denied')
    expect(cameraError({ name: 'NotFoundError' })).toBe('unavailable')
    expect(cameraError(null)).toBe('unavailable')
  })
  it('without a camera it says so and offers the camera app, a file input for the front camera', async () => {
    setDevices(undefined)
    act(() => root.render(<PhotoCamera photos={[]} close={() => {}} onUse={() => {}} />))
    await flush()
    expect(host.textContent).toContain('No live camera here')
    expect(host.textContent).toContain('Use the camera app')
    const input = host.querySelector('input[type=file]')
    expect(input.getAttribute('capture')).toBe('user')
    expect(input.getAttribute('accept')).toBe('image/*')
  })
  it('a refusal says how to allow it, and a file from the camera app is used and closes', async () => {
    const stop = vi.fn()
    setDevices({ getUserMedia: vi.fn(async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e }) })
    const onUse = vi.fn(async () => {}), close = vi.fn()
    act(() => root.render(<PhotoCamera photos={[photo(1)]} close={close} onUse={onUse} />))
    await flush()
    expect(host.textContent).toContain('The camera is switched off for openGym')
    const input = host.querySelector('input[type=file]')
    const f = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    Object.defineProperty(input, 'files', { value: [f], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(onUse).toHaveBeenCalledWith(f)
    expect(close).toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })
  it('opens the front camera first, a flip asks for the rear one, and closing stops the stream', async () => {
    const stop = vi.fn()
    const stream = () => { const s = typeof MediaStream === 'function' ? new MediaStream() : {}; s.getTracks = () => [{ stop }]; return s }
    const gum = vi.fn(async () => stream())
    setDevices({ getUserMedia: gum })
    act(() => root.render(<PhotoCamera photos={[photo(1), photo(2)]} close={() => {}} onUse={() => {}} />))
    expect(host.textContent).toContain('Waking up the camera')
    expect(host.querySelector('.pc-shutter').disabled).toBe(true)     // until the video plays
    await flush()
    expect(gum.mock.calls[0][0].video.facingMode).toEqual({ ideal: 'user' })
    expect(host.querySelector('video').className).toContain('mirror')
    await act(async () => { host.querySelector('[aria-label="Switch camera"]').click() })
    await flush()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(gum.mock.calls[1][0].video.facingMode).toEqual({ ideal: 'environment' })
    expect(host.querySelector('video').className).not.toContain('mirror')
    // The overlay picker: the latest photo first, and Off.
    act(() => host.querySelector('.pc-side').click())
    const opts = [...host.querySelectorAll('.pc-pick')]
    expect(opts.map(o => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    act(() => opts[0].click())
    expect(host.textContent).toContain('No overlay')
    act(() => root.render(null))
    expect(stop).toHaveBeenCalledTimes(2)
  })
})
