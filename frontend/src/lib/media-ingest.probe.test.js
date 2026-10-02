// probeVideo's poster frame on a slow device. The ingest tests swap the probe for a stand-in;
// here the probe is the real one and the <video> is: it answers after the delays each test sets,
// so the time budget is what is under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeVideo } from './media-ingest.js'

class FakeVideo extends EventTarget {
  constructor(opts) {
    super()
    this.opts = opts
    this.duration = NaN; this.videoWidth = 0; this.videoHeight = 0; this.readyState = 0
    this._t = 0
  }
  setAttribute() {}
  removeAttribute() {}
  load() {}
  set src(v) {
    setTimeout(() => {
      this.duration = 6; this.videoWidth = 1280; this.videoHeight = 720; this.readyState = 1
      this.dispatchEvent(new Event('loadedmetadata'))
    }, 300)
  }
  play() {
    return new Promise(resolve => setTimeout(() => { this.readyState = this.opts.afterPlay ?? 4; resolve() }, this.opts.playMs))
  }
  pause() {}
  get currentTime() { return this._t }
  set currentTime(v) {
    this._t = v
    this.readyState = Math.min(this.readyState, this.opts.whileSeeking ?? 1)
    if (this.opts.seekMs != null) setTimeout(() => { this.readyState = 4; this.dispatchEvent(new Event('seeked')) }, this.opts.seekMs)
  }
}

let made
const doc = opts => ({ createElement: () => { const v = new FakeVideo(opts); made.push(v); return v } })
const encode = vi.fn(async (pic, edge) => ({ blob: new Blob(['p']), mime: 'image/webp', width: edge, height: Math.round(edge * pic.height / pic.width) }))
const probe = async opts => {
  const p = probeVideo(new Blob(['x']), 'video/mp4', { doc: doc(opts), encode })
  await vi.advanceTimersByTimeAsync(60000)
  return p
}

beforeEach(() => {
  made = []
  encode.mockClear()
  vi.useFakeTimers()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('probeVideo — the poster', () => {
  it('draws the frame half a second in once the seek lands', async () => {
    const out = await probe({ playMs: 50, seekMs: 50 })
    expect(out).toMatchObject({ width: 1280, height: 720, duration: 6 })
    expect(out.poster).toMatchObject({ mime: 'image/webp', width: 480 })
    expect(made[0].currentTime).toBe(0.5)
  })

  // QA, v1.3.9 on the emulator: the play took 4 s and the seek after it more than the 3 s it was
  // given, so a playable H.264 clip was saved without a poster, silently and for good.
  it('a seek that takes seconds on a slow device still gets its poster', async () => {
    const out = await probe({ playMs: 4000, seekMs: 4500 })
    expect(out.poster).toBeTruthy()
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('a seek that never lands draws the frame the element holds, when it holds one', async () => {
    const out = await probe({ playMs: 4000, seekMs: null, whileSeeking: 2 })
    expect(out.poster).toBeTruthy()
    expect(out).toMatchObject({ width: 1280, height: 720 })
  })

  it('with no frame to draw it gives up without one, and still says what the video is', async () => {
    const out = await probe({ playMs: 100, seekMs: null, whileSeeking: 1 })
    expect(out.poster).toBeNull()
    expect(encode).not.toHaveBeenCalled()
    expect(out).toMatchObject({ width: 1280, height: 720, duration: 6 })
  })
})
