// @vitest-environment happy-dom
// The ingest's own decisions, with the browser parts (decoding, canvas encoding, the <video>
// probe) swapped for stand-ins: which path a file takes, what is refused and why, what the ref
// says, and that what goes into the store is the scrubbed file under its own hash.
import { describe, it, expect, vi } from 'vitest'
import { ingestMediaFile } from './media-ingest.js'
import { sha256Hex } from './sha256.js'
import { bytes, latin1, fill, jpeg, png, gif, gce, frame, comment, appExt, box, mp4, webm } from './media-samples.test-util.js'

const MB = 1024 * 1024
const LIMITS = { imageMB: 2, rawPhotoMB: 40, gifMB: 8, videoMB: 40, videoSec: 60 }
const webpBlob = (n = 100) => new Blob([bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', fill(n))], { type: 'image/webp' })
const has = async (blob, needle) => {
  const hay = new Uint8Array(await blob.arrayBuffer())
  const n = latin1(needle)
  outer: for (let i = 0; i + n.length <= hay.length; i++) { for (let k = 0; k < n.length; k++) if (hay[i + k] !== n[k]) continue outer; return true }
  return false
}
function deps(over = {}) {
  return {
    decodeImage: vi.fn(async (blob, mime) => ({ source: {}, width: 4032, height: 3024, close: vi.fn() })),
    encodeImage: vi.fn(async (pic, edge) => {
      const scale = Math.min(1, edge / Math.max(pic.width, pic.height))
      return { blob: webpBlob(edge), mime: 'image/webp', width: Math.round(pic.width * scale), height: Math.round(pic.height * scale) }
    }),
    probeVideo: vi.fn(async () => ({ width: 1920, height: 1080, duration: 12.5, poster: { blob: webpBlob(7), mime: 'image/webp', width: 480, height: 270 } })),
    playType: m => (m === 'video/quicktime' ? 'video/mp4' : m),
    ...over
  }
}
const file = (b, name = 'file') => new File([b], name)

describe('photos', () => {
  it('re-encodes to at most 1600 px plus a 480 px poster, and keeps neither the file nor its name', async () => {
    const d = deps()
    const out = await ingestMediaFile(file(jpeg(4032, 3024), 'IMG_0001.JPG'), LIMITS, d)
    expect(d.encodeImage.mock.calls.map(c => c[1])).toEqual([1600, 480])
    expect(out.media).toMatchObject({ kind: 'image', mime: 'image/webp', width: 1600, height: 1200, poster: { mime: 'image/webp', width: 480, height: 360 } })
    expect(out.blobs).toHaveLength(2)
    expect(out.media.hash).toBe(await sha256Hex(out.blobs[0].blob))
    expect(out.media.poster.hash).toBe(await sha256Hex(out.blobs[1].blob))
    expect(JSON.stringify(out.media)).not.toContain('IMG_0001')
    expect(out.warnings).toEqual([])
  })

  it('refuses a photo over 52 megapixels on its header, before decoding it', async () => {
    const d = deps()
    await expect(ingestMediaFile(file(jpeg(9000, 7000)), LIMITS, d)).rejects.toMatchObject({ code: 'photo-too-big' })
    expect(d.decodeImage).not.toHaveBeenCalled()
  })

  it('finds the frame header of a JPEG behind more than 256 KB of APP segments, and refuses it before decoding', async () => {
    const d = deps()
    const app = () => bytes([0xff, 0xe2], [0xff, 0xff], fill(0xffff - 2))   // one full-length APP2 segment
    const big = jpeg(9000, 7000)
    const padded = bytes(big.subarray(0, 2), app(), app(), app(), app(), app(), big.subarray(2))
    await expect(ingestMediaFile(file(padded), LIMITS, d)).rejects.toMatchObject({ code: 'photo-too-big' })
    expect(d.decodeImage).not.toHaveBeenCalled()
  })

  it('refuses a raw photo over its cap, and steps the quality down before refusing an encoded one', async () => {
    await expect(ingestMediaFile(file(bytes(jpeg(), fill(41 * MB))), LIMITS, deps())).rejects.toMatchObject({ code: 'too-large', mb: 40 })
    const d = deps({ encodeImage: vi.fn(async (pic, edge) => ({ blob: new Blob([new Uint8Array(3 * MB)]), mime: 'image/webp', width: edge, height: edge })) })
    await expect(ingestMediaFile(file(png()), LIMITS, d)).rejects.toMatchObject({ code: 'too-large', mb: 2 })
    expect(d.encodeImage.mock.calls.length).toBe(4)
  })

  it('reads a HEIC as a photo to re-encode', async () => {
    const d = deps()
    const heic = bytes(box('ftyp', 'heic', [0, 0, 0, 0], 'mif1heic'), fill(100))
    const out = await ingestMediaFile(file(heic), LIMITS, d)
    expect(d.decodeImage.mock.calls[0][1]).toBe('image/heic')
    expect(out.media.mime).toBe('image/webp')
  })

  it('refuses what is not a photo, a GIF or a video, whatever it is called', async () => {
    await expect(ingestMediaFile(file(latin1('<svg onload="alert(1)"/>'), 'x.jpg'), LIMITS, deps())).rejects.toMatchObject({ code: 'type' })
    await expect(ingestMediaFile(file(latin1('%PDF-1.7'), 'x.mp4'), LIMITS, deps())).rejects.toMatchObject({ code: 'type' })
  })

  it('says so when this browser cannot decode it', async () => {
    const d = deps({ decodeImage: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'unreadable' }) }) })
    await expect(ingestMediaFile(file(png()), LIMITS, d)).rejects.toMatchObject({ code: 'unreadable' })
  })
})

describe('GIFs', () => {
  it('keeps the animation without its comment, with a poster and a length', async () => {
    const d = deps({ decodeImage: vi.fn(async () => ({ source: {}, width: 40, height: 30, close: vi.fn() })) })
    const g = gif({ w: 40, h: 30, blocks: [appExt('NETSCAPE2.0', bytes([1, 0, 0])), comment('made at home'), gce(50), frame(40, 30), gce(70), frame(40, 30)] })
    const out = await ingestMediaFile(file(g), LIMITS, d)
    expect(out.media).toMatchObject({ kind: 'gif', mime: 'image/gif', width: 40, height: 30, dur: 1.2 })
    expect(await has(out.blobs[0].blob, 'made at home')).toBe(false)
    expect(await has(out.blobs[0].blob, 'NETSCAPE2.0')).toBe(true)
    expect(out.media.poster.mime).toBe('image/webp')
  })

  it('a GIF of one frame is a photo', async () => {
    const d = deps({ decodeImage: vi.fn(async () => ({ source: {}, width: 40, height: 30, close: vi.fn() })) })
    const out = await ingestMediaFile(file(gif({ delays: [10] })), LIMITS, d)
    expect(out.media).toMatchObject({ kind: 'image', mime: 'image/webp' })
  })

  it('refuses an animation over 52 megapixels on its header, before decoding a frame', async () => {
    const d = deps()
    const g = gif({ w: 16000, h: 16000, blocks: [gce(10), frame(1, 1), gce(10), frame(1, 1)] })
    await expect(ingestMediaFile(file(g), LIMITS, d)).rejects.toMatchObject({ code: 'photo-too-big' })
    expect(d.decodeImage).not.toHaveBeenCalled()
  })

  it('refuses one over the GIF cap', async () => {
    await expect(ingestMediaFile(file(bytes(gif(), fill(9 * MB))), LIMITS, deps())).rejects.toMatchObject({ code: 'too-large', mb: 8 })
  })
})

describe('videos', () => {
  const withGps = (over = {}) => mp4({
    tracks: [{ handler: 'vide', fourcc: 'avc1', w: 1920, h: 1080, payload: fill(64, 0x77) }, { handler: 'meta', fourcc: 'gpmd', payload: latin1('+47.37+008.54/') }],
    moovExtra: [box('udta', box('\xa9xyz', latin1('+47.37+008.54/')))],
    ...over
  }).file

  it('an MP4 is stored scrubbed, under the hash of what is stored, with length, size, codec and poster', async () => {
    const d = deps()
    const out = await ingestMediaFile(file(withGps({ seconds: 12.5 })), LIMITS, d)
    expect(out.media).toMatchObject({ kind: 'video', mime: 'video/mp4', width: 1920, height: 1080, dur: 12.5, codec: 'avc1', poster: { width: 480, height: 270 } })
    const stored = out.blobs[0].blob
    expect(await has(stored, '47.37')).toBe(false)
    expect(out.media.hash).toBe(await sha256Hex(stored))
    expect(out.warnings).toEqual([])
  })

  it('a MOV stays a MOV, and is probed as something this browser plays', async () => {
    const d = deps()
    const out = await ingestMediaFile(file(withGps({ brand: 'qt  ' })), LIMITS, d)
    expect(out.media.mime).toBe('video/quicktime')
    expect(d.probeVideo.mock.calls[0][1]).toBe('video/mp4')
  })

  it('refuses one longer than the cap, one bigger than the cap, and one that does not parse', async () => {
    await expect(ingestMediaFile(file(withGps({ seconds: 75 })), LIMITS, deps())).rejects.toMatchObject({ code: 'too-long', sec: 60 })
    await expect(ingestMediaFile(file(withGps({ seconds: 61 })), LIMITS, deps())).resolves.toBeTruthy()   // the server's +1 s
    await expect(ingestMediaFile(file(bytes(withGps(), fill(41 * MB))), LIMITS, deps())).rejects.toMatchObject({ code: 'too-large', mb: 40 })
    const broken = withGps()
    await expect(ingestMediaFile(file(broken.subarray(0, broken.length - 20)), LIMITS, deps())).rejects.toMatchObject({ code: 'unreadable' })
  })

  it('HEVC is kept with the warning that it may not play everywhere', async () => {
    const hevc = mp4({ tracks: [{ handler: 'vide', fourcc: 'hvc1', w: 1920, h: 1080, payload: fill(10) }] }).file
    const out = await ingestMediaFile(file(hevc), LIMITS, deps())
    expect(out.media.codec).toBe('hvc1')
    expect(out.warnings).toEqual(['codec'])
  })

  it('a video this browser cannot play is kept, without a poster, with the warning', async () => {
    const out = await ingestMediaFile(file(withGps()), LIMITS, deps({ probeVideo: vi.fn(async () => null) }))
    expect(out.media.poster).toBeUndefined()
    expect(out.blobs).toHaveLength(1)
    expect(out.warnings).toEqual(['codec'])
  })

  it('a WebM is kept as it is, its size and codec read from its header, always with the warning', async () => {
    const w = webm({ w: 1280, h: 720, codec: 'V_VP9', durationMs: 5000 })
    const out = await ingestMediaFile(file(w), LIMITS, deps({ probeVideo: vi.fn(async () => ({ width: 0, height: 0, duration: NaN, poster: null })) }))
    expect(out.media).toMatchObject({ kind: 'video', mime: 'video/webm', width: 1280, height: 720, codec: 'vp9', dur: 5 })
    expect(out.media.hash).toBe(await sha256Hex(w))
    expect(out.warnings).toEqual(['codec'])
  })

  it('a length the file does not state comes from the probe, and is checked the same', async () => {
    const w = webm({ durationMs: null })
    const out = await ingestMediaFile(file(w), LIMITS, deps())
    expect(out.media.dur).toBe(12.5)
    await expect(ingestMediaFile(file(w), LIMITS, deps({ probeVideo: vi.fn(async () => ({ width: 640, height: 360, duration: 90, poster: null })) })))
      .rejects.toMatchObject({ code: 'too-long' })
    const unknown = await ingestMediaFile(file(w), LIMITS, deps({ probeVideo: vi.fn(async () => ({ width: 640, height: 360, duration: Infinity, poster: null })) }))
    expect(unknown.media.dur).toBeUndefined()
  })
})
