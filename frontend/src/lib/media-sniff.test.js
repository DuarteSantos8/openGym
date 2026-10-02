import { describe, it, expect } from 'vitest'
import { sniffKind, imageDims, inspectGif, cleanGif, inspectMp4, scrubMp4, inspectWebm } from './media-sniff.js'
import { bytes, latin1, fill, jpeg, png, webpVp8, webpVp8l, webpVp8x, gif, gce, frame, appExt, comment, plainText, box, ftyp, mp4, webm } from './media-samples.test-util.js'

const has = (hay, needle) => {
  const n = latin1(needle)
  outer: for (let i = 0; i + n.length <= hay.length; i++) {
    for (let k = 0; k < n.length; k++) if (hay[i + k] !== n[k]) continue outer
    return true
  }
  return false
}

describe('sniffKind', () => {
  it('knows each stored type by its bytes', () => {
    expect(sniffKind(jpeg()).mime).toBe('image/jpeg')
    expect(sniffKind(png()).mime).toBe('image/png')
    expect(sniffKind(gif()).mime).toBe('image/gif')
    expect(sniffKind(gif()).kind).toBe('gif')
    expect(sniffKind(bytes('GIF87a', fill(20))).mime).toBe('image/gif')
    expect(sniffKind(webpVp8()).mime).toBe('image/webp')
    expect(sniffKind(mp4().file)).toMatchObject({ mime: 'video/mp4', kind: 'video', category: 'video' })
    expect(sniffKind(mp4({ brand: 'qt  ' }).file).mime).toBe('video/quicktime')
    expect(sniffKind(webm()).mime).toBe('video/webm')
  })

  it('reads HEIC and AVIF photos as input only', () => {
    expect(sniffKind(ftyp('heic'))).toMatchObject({ mime: 'image/heic', kind: 'image', input: true })
    expect(sniffKind(ftyp('mif1'))).toMatchObject({ mime: 'image/heic', input: true })
    expect(sniffKind(ftyp('avif'))).toMatchObject({ mime: 'image/avif', input: true })
  })

  it('refuses SVG, HTML, PDF, ZIP, BMP, TIFF, ICO, M4A and Matroska', () => {
    for (const b of [
      latin1('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
      latin1('<svg onload="alert(1)">'),
      latin1('<!doctype html><script>alert(1)</script>'),
      latin1('%PDF-1.7\n'),
      bytes([0x50, 0x4b, 0x03, 0x04], fill(20)),
      bytes('BM', fill(40)),
      bytes([0x49, 0x49, 0x2a, 0x00], fill(20)),
      bytes([0, 0, 1, 0, 1, 0], fill(20)),
      ftyp('M4A '),
      ftyp('abcd'),
      webm({ docType: 'matroska' }),
      new Uint8Array(0)
    ]) expect(sniffKind(b)).toBeNull()
  })
})

describe('imageDims', () => {
  it('reads JPEG past an EXIF segment, PNG, the three WebP flavours and GIF', () => {
    expect(imageDims(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 })
    expect(imageDims(png(300, 200))).toEqual({ width: 300, height: 200 })
    expect(imageDims(webpVp8(320, 240))).toEqual({ width: 320, height: 240 })
    expect(imageDims(webpVp8l(100, 50))).toEqual({ width: 100, height: 50 })
    expect(imageDims(webpVp8x(9000, 7000))).toEqual({ width: 9000, height: 7000 })
    expect(imageDims(gif({ w: 64, h: 48 }))).toEqual({ width: 64, height: 48 })
  })
  it('gives null for what it cannot read', () => {
    expect(imageDims(latin1('<svg/>'))).toBeNull()
    expect(imageDims(bytes([0xff, 0xd8, 0xff, 0xda], fill(10)))).toBeNull()
    expect(imageDims(mp4().file)).toBeNull()
  })
})

describe('inspectGif', () => {
  it('counts frames and adds their delays, a delay of 0 counting as 10 ms', () => {
    expect(inspectGif(gif({ w: 40, h: 30, delays: [10, 20, 0] }))).toEqual({ width: 40, height: 30, frames: 3, durMs: 100 + 200 + 10 })
    expect(inspectGif(gif({ delays: [5] })).frames).toBe(1)
  })
  it('reads a GIF that stops after a whole block, and refuses what is not one', () => {
    expect(inspectGif(gif({ delays: [10, 10], trailer: false })).frames).toBe(2)
    expect(inspectGif(png())).toBeNull()
    expect(inspectGif(bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0], [0x99]))).toBeNull()
  })
})

describe('cleanGif', () => {
  const dirty = gif({ blocks: [
    appExt('NETSCAPE2.0', bytes([1, 0, 0])),
    comment('shot on my phone at home'),
    appExt('XMP DataXMP', latin1('<x:xmpmeta><exif:GPSLatitude>47.3</exif:GPSLatitude></x:xmpmeta>')),
    appExt('ICCRGBG1012', fill(40, 0x42)),
    gce(10), frame(40, 30),
    gce(20), plainText(),
    gce(30), frame(40, 30)
  ] })

  it('drops comments, XMP and ICC, keeps the loop block and every frame', () => {
    const out = cleanGif(dirty)
    expect(has(out, 'NETSCAPE2.0')).toBe(true)
    expect(has(out, 'shot on my phone')).toBe(false)
    expect(has(out, 'GPSLatitude')).toBe(false)
    expect(has(out, 'XMP Data')).toBe(false)
    expect(has(out, 'ICCRGBG1')).toBe(false)
    expect(out[out.length - 1]).toBe(0x3b)
    const info = inspectGif(out)
    expect(info.frames).toBe(2)
    // The control block that belonged to the dropped plain-text block went with it.
    expect(info.durMs).toBe(100 + 300)
  })
  it('keeps ANIMEXTS1.0 too, and gives a GIF without a trailer one', () => {
    const out = cleanGif(gif({ blocks: [appExt('ANIMEXTS1.0', bytes([1, 0, 0])), gce(10), frame(4, 4)], trailer: false }))
    expect(has(out, 'ANIMEXTS1.0')).toBe(true)
    expect(out[out.length - 1]).toBe(0x3b)
  })
  it('throws on a GIF cut off inside a block', () => {
    const g = gif()
    expect(() => cleanGif(g.subarray(0, g.length - 8))).toThrow()
  })
})

describe('inspectMp4', () => {
  it('reads length, the display size from tkhd, the codec and every handler', () => {
    const { file } = mp4({ seconds: 12.5, tracks: [
      { handler: 'vide', fourcc: 'avc1', w: 1920, h: 1080, payload: fill(10) },
      { handler: 'soun', fourcc: 'mp4a', payload: fill(10) },
      { handler: 'meta', fourcc: 'mebx', payload: fill(10) }
    ] })
    expect(inspectMp4(file)).toEqual({ brand: 'isom', durationSec: 12.5, width: 1920, height: 1080, codec: 'avc1', handlers: ['vide', 'soun', 'meta'] })
  })
  it('turns an upright phone video round, and names HEVC, AV1 and the rest', () => {
    expect(inspectMp4(mp4({ rotate: true }).file)).toMatchObject({ width: 1080, height: 1920 })
    const codec = fourcc => inspectMp4(mp4({ tracks: [{ handler: 'vide', fourcc, w: 640, h: 360, payload: fill(4) }] }).file).codec
    expect(codec('hvc1')).toBe('hvc1')
    expect(codec('hev1')).toBe('hvc1')
    expect(codec('avc3')).toBe('avc1')
    expect(codec('av01')).toBe('av01')
    expect(codec('vp09')).toBe('vp09')
    expect(codec('mp4v')).toBe('other')
    expect(inspectMp4(mp4({ brand: 'qt  ' }).file).brand).toBe('qt  ')
  })
  it('refuses a file without ftyp first, without moov, or with a box overrunning the file', () => {
    const { file } = mp4()
    expect(inspectMp4(file.subarray(24))).toBeNull()
    expect(inspectMp4(bytes(ftyp(), box('mdat', fill(10))))).toBeNull()
    expect(inspectMp4(file.subarray(0, file.length - 5))).toBeNull()
  })
})

// A box shaped like a full box (version, flags, one field), enough for a walker to step over.
const fullBoxLike = type => box(type, fill(4, 0), fill(4, 0))

describe('scrubMp4', () => {
  const GPS = latin1('+47.3769+008.5417/ GPS FIX')
  const build = () => mp4({
    tracks: [
      { handler: 'vide', fourcc: 'avc1', w: 640, h: 360, payload: fill(64, 0x77) },
      { handler: 'soun', fourcc: 'mp4a', payload: fill(32, 0x66) },
      { handler: 'meta', fourcc: 'gpmd', payload: bytes(GPS, fill(8, 0x33)) },
      { handler: 'tmcd', fourcc: 'tmcd', payload: fill(4, 0x22) }
    ],
    moovExtra: [box('udta', box('\xa9xyz', latin1('+47.3769+008.5417/')), box('\xa9mak', latin1('Apple'))), box('meta', fill(4, 0), latin1('com.apple.quicktime.location.ISO6709'))],
    top: [box('uuid', fill(16, 0xbe), latin1('<xmp>GPS</xmp>'))]
  })

  it('zeroes the metadata boxes and the samples of the GPS track, and nothing else', () => {
    const { file, sampleAt } = build()
    const before = file.slice()
    const out = scrubMp4(file)
    expect(out).toBe(file)                         // in place
    expect(out.length).toBe(before.length)
    expect(has(out, '47.3769')).toBe(false)
    expect(has(out, 'Apple')).toBe(false)
    expect(has(out, 'com.apple.quicktime.location')).toBe(false)
    expect(has(out, '<xmp>')).toBe(false)
    expect(has(out, 'udta')).toBe(false)
    expect(has(out, 'uuid')).toBe(false)
    // Picture, sound and timecode samples are byte for byte what they were.
    for (const [i, len] of [[0, 64], [1, 32], [3, 4]]) {
      expect(out.subarray(sampleAt[i], sampleAt[i] + len)).toEqual(before.subarray(sampleAt[i], sampleAt[i] + len))
    }
    expect(out.subarray(sampleAt[2], sampleAt[2] + GPS.length + 8).every(x => x === 0)).toBe(true)
    // Still a file the inspector reads the same way.
    expect(inspectMp4(out)).toMatchObject({ durationSec: 5, width: 640, height: 360, codec: 'avc1', handlers: ['vide', 'soun', 'meta', 'tmcd'] })
  })

  it('refuses a sample table that points outside the file, and leaves the file as it was', () => {
    const { file } = mp4({ tracks: [{ handler: 'meta', fourcc: 'gpmd', payload: fill(16, 0x33) }] })
    // Point the one chunk offset past the end of the file.
    const stco = [...Array(file.length - 4).keys()].find(i => file[i] === 0x73 && file[i + 1] === 0x74 && file[i + 2] === 0x63 && file[i + 3] === 0x6f)
    const off = stco + 4 + 4 + 4
    new DataView(file.buffer).setUint32(off, file.length + 10)
    const before = file.slice()
    expect(() => scrubMp4(file)).toThrow()
    expect(file).toEqual(before)
  })

  it('zeroes a uuid box inside moov or a trak (a Canon keeps its EXIF and GPS there)', () => {
    const { file } = mp4({
      tracks: [{ handler: 'vide', fourcc: 'avc1', w: 640, h: 360, payload: fill(64, 0x77), extra: [box('uuid', fill(16, 0xab), latin1('CNTH GPSLatitude 48.8577'))] }],
      moovExtra: [box('uuid', fill(16, 0x85), latin1('CMT4 GPSLatitude 48.8577'))]
    })
    const out = scrubMp4(file)
    expect(has(out, 'GPSLatitude')).toBe(false)
    expect(has(out, 'uuid')).toBe(false)
    expect(inspectMp4(out)).toMatchObject({ width: 640, height: 360, codec: 'avc1', handlers: ['vide'] })
  })

  it('a fragmented file: zeroes the uuid and meta boxes of its fragments, and refuses one with a track that is neither picture nor sound', () => {
    const frag = (...extra) => [box('moof', fullBoxLike('mfhd'), box('traf', fullBoxLike('tfhd'), ...extra)), box('mdat', fill(16, 0x77))]
    const av = mp4({ top: frag(box('uuid', fill(16, 0x6d), latin1('SECRETGPS'))) }).file
    expect(has(scrubMp4(av), 'SECRETGPS')).toBe(false)
    const withText = mp4({
      tracks: [{ handler: 'vide', fourcc: 'avc1', w: 640, h: 360, payload: fill(64, 0x77) }, { handler: 'text', fourcc: 'tx3g', payload: bytes() }],
      top: [box('moof', fullBoxLike('mfhd'), box('traf', fullBoxLike('tfhd'))), box('mdat', latin1('SECRETGPS'))]
    }).file
    expect(() => scrubMp4(withText)).toThrow(/fragmented/)
  })

  it('refuses what is not an MP4', () => {
    expect(() => scrubMp4(png())).toThrow()
  })
})

describe('inspectWebm', () => {
  it('reads size, codec and length from the header elements', () => {
    expect(inspectWebm(webm({ w: 1280, h: 720, codec: 'V_VP9', durationMs: 4000 }))).toEqual({ width: 1280, height: 720, codec: 'vp9', durationSec: 4 })
    expect(inspectWebm(webm({ codec: 'V_VP8' })).codec).toBe('vp8')
    expect(inspectWebm(webm({ codec: 'V_AV1' })).codec).toBe('av01')
  })
  it('gives a null length for a recording that never wrote one', () => {
    expect(inspectWebm(webm({ durationMs: null })).durationSec).toBeNull()
  })
  it('refuses Matroska and everything else', () => {
    expect(inspectWebm(webm({ docType: 'matroska' }))).toBeNull()
    expect(inspectWebm(mp4().file)).toBeNull()
  })
})
