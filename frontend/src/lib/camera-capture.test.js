// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { frameToBlob } from './camera-capture.js'

/* The frame of the camera as a picture (#951). happy-dom has no canvas, so a stand-in records what
   is drawn on it. */
const video = (w, h) => ({ videoWidth: w, videoHeight: h })
const fakeCanvas = () => {
  const calls = []
  const ctx = { translate: (...a) => calls.push(['translate', ...a]), scale: (...a) => calls.push(['scale', ...a]), drawImage: (...a) => calls.push(['drawImage', ...a.slice(1)]) }
  const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb, type, q) => cb(Object.assign(new Blob(['x']), { asked: [type, q] })) }
  vi.spyOn(document, 'createElement').mockImplementation(tag => (tag === 'canvas' ? canvas : document.createElement.wrappedMethod?.(tag)))
  return { canvas, calls }
}
afterEach(() => vi.restoreAllMocks())

describe('frameToBlob', () => {
  it('draws the frame as it is, as a JPEG, at most 1600 px on its long side', async () => {
    const { canvas, calls } = fakeCanvas()
    const blob = await frameToBlob(video(4032, 3024))
    expect([canvas.width, canvas.height]).toEqual([1600, 1200])
    expect(calls).toEqual([['drawImage', 0, 0, 1600, 1200]])
    expect(blob.asked).toEqual(['image/jpeg', 0.92])
  })
  it('flips it left to right first when the preview was mirrored', async () => {
    const { calls } = fakeCanvas()
    await frameToBlob(video(1280, 720), { mirror: true })
    expect(calls).toEqual([['translate', 1280, 0], ['scale', -1, 1], ['drawImage', 0, 0, 1280, 720]])
  })
  it('makes nothing of a camera that has no frame yet', async () => {
    fakeCanvas()
    expect(await frameToBlob(video(0, 0))).toBeNull()
    expect(await frameToBlob(null)).toBeNull()
  })
})
