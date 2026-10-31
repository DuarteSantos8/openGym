// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../lib/format.js'

vi.mock('./CustomMedia.jsx', () => ({
  useMediaUrl: m => ({ url: m ? 'blob:' + m.hash : null }),
  CustomThumb: () => null,
}))
import PhotoCamera from './PhotoCamera.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The progress-photo camera (#951): the live view, the earlier photo over it, and the shutter. The
   camera, the canvas and the fingers are stood in for; lib/camera-overlay.js has the maths. */
const ref = n => ({ kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg', size: 10, width: 3, height: 4, at: 1 })
const photos = [{ key: 'a', d: '2026-10-20', m: ref(1) }, { key: 'b', d: '2026-10-01', m: ref(2) }]

let host, root, tracks, getUserMedia, props
let reported   // what the fake camera says about itself
const stream = () => { const track = { stop: vi.fn(), getSettings: () => ({ facingMode: reported }) }; tracks.push(track); return { getTracks: () => [track], getVideoTracks: () => [track] } }
const mount = (extra = {}) => {
  props = { photos, onTaken: vi.fn(), close: vi.fn(), capture: vi.fn(async () => new Blob(['jpg'], { type: 'image/jpeg' })), ...extra }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  return act(async () => { root.render(<PhotoCamera {...props} />) })
}
const button = label => [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label)
const overlay = () => host.querySelector('.pp-cam-overlay')
const fire = (type, init) => act(() => { host.querySelector('.pp-cam-stage').dispatchEvent(Object.assign(new Event(type, { bubbles: true }), init)) })

beforeEach(() => {
  tracks = []
  reported = undefined
  getUserMedia = vi.fn(async () => stream())
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { set() {}, get() { return null }, configurable: true })   // happy-dom only takes a real MediaStream
  HTMLMediaElement.prototype.play = vi.fn(async () => {})
  URL.createObjectURL = vi.fn(() => 'blob:shot'); URL.revokeObjectURL = vi.fn()
  Element.prototype.getBoundingClientRect = () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600 })
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete navigator.mediaDevices })

describe('the camera', () => {
  it('opens the front camera and stops it when it goes', async () => {
    await mount()
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'user' } }, audio: false })
    expect(tracks[0].stop).not.toHaveBeenCalled()
    act(() => root.unmount())
    expect(tracks[0].stop).toHaveBeenCalled()
    root = createRoot(document.createElement('div'))   // for afterEach
  })
  it('flips to the rear camera and stops the first stream', async () => {
    await mount()
    await act(async () => { button('Flip camera').click() })
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    expect(tracks[0].stop).toHaveBeenCalled()
  })
  it('says so in place when the camera is refused or there is none, and the shutter waits', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    await mount()
    expect(host.textContent).toContain('Camera access was denied.')
    expect(button('Take photo').disabled).toBe(true)
    act(() => root.unmount()); host.remove()
    delete navigator.mediaDevices
    await mount()
    expect(host.textContent).toContain('No camera available here.')
  })
})

describe('the overlay', () => {
  it('starts as the latest photo, semi-transparent, and says which', async () => {
    await mount()
    expect(overlay().getAttribute('src')).toBe('blob:' + ref(1).hash)
    expect(overlay().style.opacity).toBe('0.45')
    const label = [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Overlay: ')).textContent
    expect(label).toMatch(/^Overlay: .*20/)                        // the day of the latest photo
  })
  it('can be changed to another photo, or to none', async () => {
    await mount()
    const ov = () => [...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Overlay: '))
    act(() => ov().click())
    expect(host.querySelectorAll('.pp-cam-pick')).toHaveLength(2)
    act(() => host.querySelectorAll('.pp-cam-pick')[1].click())
    expect(overlay().getAttribute('src')).toBe('blob:' + ref(2).hash)
    expect(host.querySelector('.pp-cam-choose')).toBeNull()
    act(() => ov().click())
    act(() => host.querySelector('.pp-cam-none').click())
    expect(overlay()).toBeNull()
    expect(ov().textContent).toBe('Overlay: None')
  })
  it('has no overlay to start with when there is no photo', async () => {
    await mount({ photos: [] })
    expect(overlay()).toBeNull()
  })
  it('takes its opacity from the slider', async () => {
    await mount()
    const slider = host.querySelector('.pp-cam-op input')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    act(() => { set.call(slider, '80'); slider.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(overlay().style.opacity).toBe('0.8')
  })
  it('moves with one finger and scales with two', async () => {
    await mount()
    expect(overlay().style.transform).toBe('translate(0px, 0px) scale(1.000)')
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    fire('pointermove', { pointerId: 1, clientX: 140, clientY: 80 })
    expect(overlay().style.transform).toBe('translate(40px, -20px) scale(1.000)')
    fire('pointerup', { pointerId: 1 })
    // a second drag carries on from where the first ended
    fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    fire('pointermove', { pointerId: 1, clientX: 10, clientY: 0 })
    expect(overlay().style.transform).toBe('translate(50px, -20px) scale(1.000)')
    fire('pointerup', { pointerId: 1 })
    // two fingers apart: twice the distance, twice the size
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 300 })
    fire('pointerdown', { pointerId: 2, clientX: 200, clientY: 300 })
    fire('pointermove', { pointerId: 2, clientX: 300, clientY: 300 })
    expect(overlay().style.transform).toContain('scale(2.000)')
  })
  it('does not move for a drag that leaves the view far behind', async () => {
    await mount()
    fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    fire('pointermove', { pointerId: 1, clientX: 5000, clientY: 0 })
    expect(overlay().style.transform).toBe('translate(360px, 0px) scale(1.000)')
  })
})

describe('the shutter', () => {
  it('shows the picture taken, which can be retaken or used', async () => {
    await mount()
    await act(async () => { button('Take photo').click() })
    expect(props.capture).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.pp-cam-shot').getAttribute('src')).toBe('blob:shot')
    expect(overlay()).toBeNull()                                 // nothing of the overlay is in the picture
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(expect.arrayContaining(['Retake', 'Use photo']))
    act(() => button('Retake').click())
    expect(host.querySelector('.pp-cam-shot')).toBeNull()
    expect(overlay()).not.toBeNull()
    expect(props.onTaken).not.toHaveBeenCalled()
  })
  it('hands the picture over as a JPEG named for today, and closes', async () => {
    await mount()
    await act(async () => { button('Take photo').click() })
    act(() => button('Use photo').click())
    const file = props.onTaken.mock.calls[0][0]
    expect(file.name).toBe('progress-' + todayISO() + '.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(props.close).toHaveBeenCalledTimes(1)
  })
  it('takes nothing when the frame cannot be read', async () => {
    await mount({ capture: vi.fn(async () => null) })
    await act(async () => { button('Take photo').click() })
    expect(host.querySelector('.pp-cam-shot')).toBeNull()
  })
})

describe('the front and the rear camera', () => {
  const video = () => host.querySelector('.pp-cam-stage video')
  it('shows the rear camera as it is, and keeps the frame as it is', async () => {
    reported = 'environment'
    await mount()
    expect(video().style.transform).toBe('')
    await act(async () => { button('Take photo').click() })
    expect(props.capture).toHaveBeenCalledWith(video(), { mirror: false })
  })
  it('shows the front camera mirrored and keeps the picture mirrored too: what is on the screen is what is saved', async () => {
    reported = 'user'
    await mount()
    expect(video().style.transform).toBe('scaleX(-1)')
    await act(async () => { button('Take photo').click() })
    expect(props.capture).toHaveBeenCalledWith(video(), { mirror: true })
    expect(host.querySelector('.pp-cam-shot').style.transform).toBe('')     // the picture is already the mirrored one
  })
  it('mirrors the first camera when it does not say which it is, because it was asked for the front one, and not the rear one after a flip', async () => {
    reported = undefined
    await mount()
    expect(video().style.transform).toBe('scaleX(-1)')
    await act(async () => { button('Flip camera').click() })
    expect(video().style.transform).toBe('')
    await act(async () => { button('Flip camera').click() })
    expect(video().style.transform).toBe('scaleX(-1)')
  })
  it('leaves the overlay as the photo looks in the gallery, and a drag goes the way the finger does', async () => {
    reported = 'user'
    await mount()
    expect(overlay().style.transform).toBe('translate(0px, 0px) scale(1.000)')
    fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
    fire('pointermove', { pointerId: 1, clientX: 130, clientY: 100 })
    expect(overlay().style.transform).toBe('translate(30px, 0px) scale(1.000)')
  })
})

describe('before the video plays', () => {
  it('shows no overlay and takes no photo until it does, then both', async () => {
    let release
    HTMLMediaElement.prototype.play = vi.fn(() => new Promise(res => { release = res }))
    await mount()
    expect(overlay()).toBeNull()
    expect(button('Take photo').disabled).toBe(true)
    await act(async () => { release() })
    expect(overlay()).not.toBeNull()
    expect(button('Take photo').disabled).toBe(false)
  })
  it('also starts when the browser says the video is playing, after an autoplay refusal', async () => {
    HTMLMediaElement.prototype.play = vi.fn(async () => { throw new Error('NotAllowedError') })
    await mount()
    expect(overlay()).toBeNull()
    act(() => { host.querySelector('.pp-cam-stage video').dispatchEvent(new Event('playing', { bubbles: true })) })
    expect(overlay()).not.toBeNull()
  })
  it('hides the overlay again while the other camera starts', async () => {
    await mount()
    expect(overlay()).not.toBeNull()
    let release
    HTMLMediaElement.prototype.play = vi.fn(() => new Promise(res => { release = res }))
    await act(async () => { button('Flip camera').click() })
    expect(overlay()).toBeNull()
    await act(async () => { release() })
    expect(overlay()).not.toBeNull()
  })
})
