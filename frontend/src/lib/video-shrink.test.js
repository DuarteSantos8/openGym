// @vitest-environment happy-dom
// Videos made smaller on the device before upload (lib/video-shrink.js): the server's cap was too
// tight for clips as phones film them.
import { describe, expect, it, vi } from 'vitest'
import { recorderType, shouldShrink, scaledSize, bitrateFor, shrinkVideo, MAX_BITRATE, MIN_BITRATE } from './video-shrink.js'
import { MB } from './media-limits.js'

const MR = supported => Object.assign(function () {}, { isTypeSupported: t => supported.includes(t) })
const file = (size, type = 'video/mp4', name = 'clip.mp4') => ({ size, type, name })
const limits = { videoMB: 100, videoSec: 60 }

describe('what is shrunk', () => {
  it('writes MP4 where it can, WebM otherwise, nothing without a recorder', () => {
    expect(recorderType(MR(['video/mp4;codecs=avc1.42E01E', 'video/webm']))).toBe('video/mp4;codecs=avc1.42E01E')
    expect(recorderType(MR(['video/webm;codecs=vp8']))).toBe('video/webm;codecs=vp8')
    expect(recorderType(MR([]))).toBe(null)
    expect(recorderType(undefined)).toBe(null)
  })

  it('with MP4: any video over 12 MB; with WebM only: one over the cap; never a photo', () => {
    const mp4 = 'video/mp4;codecs=avc1'
    expect(shouldShrink(file(13 * MB), limits, mp4)).toBe(true)
    expect(shouldShrink(file(11 * MB), limits, mp4)).toBe(false)
    expect(shouldShrink(file(13 * MB, '', 'IMG_1.MOV'), limits, mp4)).toBe(true)
    expect(shouldShrink(file(50 * MB), limits, 'video/webm')).toBe(false)
    expect(shouldShrink(file(120 * MB), limits, 'video/webm')).toBe(true)
    expect(shouldShrink(file(30 * MB, 'image/jpeg', 'a.jpg'), limits, mp4)).toBe(false)
    expect(shouldShrink(file(30 * MB), limits, null)).toBe(false)
    // A server with a tiny cap: the cap is the threshold.
    expect(shouldShrink(file(6 * MB), { videoMB: 5 }, mp4)).toBe(true)
  })

  it('scales to 1280 on the long side, even numbers, never up', () => {
    expect(scaledSize(3840, 2160)).toEqual({ width: 1280, height: 720 })
    expect(scaledSize(1080, 1920)).toEqual({ width: 720, height: 1280 })
    expect(scaledSize(640, 360)).toEqual({ width: 640, height: 360 })
    expect(scaledSize(1001, 563, 1000)).toEqual({ width: 1000, height: 562 })
    expect(scaledSize(0, 100)).toBe(null)
  })

  it('aims the bitrate inside the cap', () => {
    expect(bitrateFor(60, 100)).toBe(MAX_BITRATE)
    const b = bitrateFor(60, 5)
    expect(b * 60 / 8).toBeLessThan(5 * MB)
    expect(bitrateFor(600, 1)).toBe(MIN_BITRATE)
  })
})

describe('shrinkVideo', () => {
  // A fake <video>, canvas and recorder: the clip "plays" in a few frames.
  const setup = ({ duration = 4, outSize = 1000, width = 1920, height = 1080 } = {}) => {
    const listeners = {}
    const video = {
      duration, videoWidth: width, videoHeight: height, currentTime: 0, ended: false,
      setAttribute () {}, removeAttribute () {}, load () {}, pause () {},
      addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn) },
      removeEventListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn) },
      fire: ev => (listeners[ev] || []).slice().forEach(f => f()),
      play: async () => { setTimeout(() => { video.currentTime = duration; video.ended = true; video.fire('ended') }, 5) },
      requestVideoFrameCallback: fn => setTimeout(fn, 1),
      set src (v) { setTimeout(() => video.fire('loadedmetadata'), 1) },
    }
    const ctx = { drawImage: vi.fn() }
    const canvas = { getContext: () => ctx, captureStream: () => ({}) }
    const doc = { createElement: tag => (tag === 'video' ? video : canvas) }
    const made = {}
    function Rec (stream, opts) { made.opts = opts; this.state = 'inactive' }
    Rec.isTypeSupported = t => t === 'video/mp4;codecs=avc1.42E01E'
    Rec.prototype.start = function () { this.state = 'recording' }
    Rec.prototype.stop = function () { this.state = 'inactive'; this.ondataavailable({ data: new Blob([new Uint8Array(outSize)]) }); setTimeout(() => this.onstop(), 1) }
    return { doc, MR: Rec, ctx, made }
  }
  globalThis.URL.createObjectURL ||= () => 'blob:x'
  globalThis.URL.revokeObjectURL ||= () => {}

  it('plays the clip onto a 1280 px canvas and hands back a smaller MP4, with progress', async () => {
    const { doc, MR: Rec, ctx, made } = setup()
    const progress = []
    const big = new File([new Uint8Array(5000)], 'big.mov', { type: 'video/quicktime' })
    const out = await shrinkVideo(big, { limits, onProgress: p => progress.push(p), doc, MR: Rec })
    expect(out.type).toBe('video/mp4')
    expect(out.size).toBe(1000)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 720)
    expect(made.opts).toMatchObject({ mimeType: 'video/mp4;codecs=avc1.42E01E', videoBitsPerSecond: MAX_BITRATE })
    expect(progress.at(-1)).toBe(1)
  })

  it('keeps the original when the result is no smaller, the clip has no length or runs too long', async () => {
    const big = new File([new Uint8Array(500)], 'a.mp4', { type: 'video/mp4' })
    let s = setup({ outSize: 900 })
    expect(await shrinkVideo(big, { limits, doc: s.doc, MR: s.MR })).toBe(null)
    s = setup({ duration: Infinity })
    expect(await shrinkVideo(big, { limits, doc: s.doc, MR: s.MR })).toBe(null)
    s = setup({ duration: 90 })
    expect(await shrinkVideo(big, { limits, doc: s.doc, MR: s.MR })).toBe(null)
    expect(await shrinkVideo(big, { limits, doc: s.doc, MR: undefined })).toBe(null)
  })
})
