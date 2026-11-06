import { describe, expect, it } from 'vitest'
import { exifDateOf, exifDateOfFile } from './exif-date.js'

/* The date a photo was taken, read from a JPEG's EXIF (#557). The JPEGs here are built byte by
   byte: SOI, an APP1 "Exif" segment with a TIFF header, IFD0 pointing at the Exif IFD, and
   DateTimeOriginal in it. */
function tiffBlock({ le = true, date = '2026:09:14 07:31:02', tagId = 0x9003 } = {}) {
  const tiff = []
  const u16 = n => (le ? [n & 255, n >> 8] : [n >> 8, n & 255])
  const u32 = n => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8))
  // IFD0 at 8: one entry, the Exif IFD pointer -> 26
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0))
  // Exif IFD at 26: one entry, DateTimeOriginal (ASCII, 20 bytes) at 44
  tiff.push(...u16(1), ...u16(tagId), ...u16(2), ...u32(20), ...u32(44), ...u32(0))
  tiff.push(...[...date].map(c => c.charCodeAt(0)), 0)
  return tiff
}
// IFD0 holding only its own DateTime (0x0132), no Exif IFD: what some editors leave.
function ifd0Only(date = '2026:09:14 07:31:02') {
  const u16 = n => [n & 255, n >> 8]
  const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]
  return [0x49, 0x49, ...u16(42), ...u32(8), ...u16(1), ...u16(0x0132), ...u16(2), ...u32(20), ...u32(26), ...u32(0),
    ...[...date].map(c => c.charCodeAt(0)), 0]
}
const EXIF = [0x45, 0x78, 0x69, 0x66, 0, 0]
const bytes = s => [...s].map(c => c.charCodeAt(0))
function jpeg({ extra = [], tiff, ...o } = {}) {
  const app1 = [...EXIF, ...(tiff || tiffBlock(o))]
  const len = app1.length + 2
  return new Uint8Array([0xff, 0xd8, ...extra, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2])
}

describe('exifDateOf', () => {
  it('reads DateTimeOriginal, in either byte order', () => {
    expect(exifDateOf(jpeg())).toBe('2026-09-14')
    expect(exifDateOf(jpeg({ le: false }))).toBe('2026-09-14')
  })
  it('steps over other segments before it', () => {
    const app0 = [0xff, 0xe0, 0, 6, 0x4a, 0x46, 0x49, 0x46]   // a JFIF stub
    expect(exifDateOf(jpeg({ extra: app0 }))).toBe('2026-09-14')
  })
  it('falls back to DateTimeDigitized', () => {
    expect(exifDateOf(jpeg({ tagId: 0x9004 }))).toBe('2026-09-14')
  })
  it('null for anything it cannot read: no JPEG, no EXIF, a blank or silly date, cut-off bytes', () => {
    expect(exifDateOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(exifDateOf(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull()
    expect(exifDateOf(jpeg({ date: '    :  :     :  :  ' }))).toBeNull()
    expect(exifDateOf(jpeg({ date: '1970:01:01 00:00:00' }))).toBeNull()
    expect(exifDateOf(jpeg().slice(0, 30))).toBeNull()
    expect(exifDateOf(undefined)).toBeNull()
  })
  it('steps over an XMP APP1 and fill bytes between segments', () => {
    const xmp = bytes('http://ns.adobe.com/xap/1.0/\0<x/>')
    const xmpSeg = [0xff, 0xe1, (xmp.length + 2) >> 8, (xmp.length + 2) & 255, ...xmp]
    expect(exifDateOf(jpeg({ extra: [...xmpSeg, 0xff, 0xff] }))).toBe('2026-09-14')
  })
  it('falls back to the IFD0 DateTime and takes dashes or slashes', () => {
    expect(exifDateOf(jpeg({ tiff: ifd0Only() }))).toBe('2026-09-14')
    expect(exifDateOf(jpeg({ date: '2026-09-14 07:31:02' }))).toBe('2026-09-14')
    expect(exifDateOf(jpeg({ date: '2026/09/14 07:31:02' }))).toBe('2026-09-14')
  })
  it('never a day that does not exist, or a camera clock never set', () => {
    expect(exifDateOf(jpeg({ date: '2026:02:31 07:31:02' }))).toBeNull()
    expect(exifDateOf(jpeg({ date: '2000:01:01 00:00:00' }))).toBeNull()
  })
  it('reads a PNG eXIf chunk, with or without the Exif prefix', () => {
    const png = data => {
      const len = data.length
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 13, ...bytes('IHDR'), ...new Array(13).fill(0), 0, 0, 0, 0,
        len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...bytes('eXIf'), ...data, 0, 0, 0, 0,
        0, 0, 0, 0, ...bytes('IEND'), 0, 0, 0, 0])
    }
    expect(exifDateOf(png(tiffBlock()))).toBe('2026-09-14')
    expect(exifDateOf(png([...EXIF, ...tiffBlock({ le: false })]))).toBe('2026-09-14')
  })
  it('reads a WebP EXIF chunk past the image chunk, padding included', () => {
    const vp8 = [1, 2, 3]   // odd length: one pad byte follows
    const ex = tiffBlock()
    const chunk = (id, data) => [...bytes(id), data.length & 255, (data.length >> 8) & 255, 0, 0, ...data, ...(data.length & 1 ? [0] : [])]
    const body = [...bytes('WEBP'), ...chunk('VP8 ', vp8), ...chunk('EXIF', ex)]
    const riff = new Uint8Array([...bytes('RIFF'), body.length & 255, (body.length >> 8) & 255, 0, 0, ...body])
    expect(exifDateOf(riff)).toBe('2026-09-14')
  })
  it('finds the Exif item of a HEIC or AVIF', () => {
    const box = [0, 0, 0, 24, ...bytes('ftypheic'), 0, 0, 0, 0, ...bytes('mif1heic')]
    const heic = new Uint8Array([...box, ...new Array(40).fill(7), 0, 0, 0, 6, ...EXIF, ...tiffBlock({ date: '2025:12:31 23:59:59' })])
    expect(exifDateOf(heic)).toBe('2025-12-31')
    const avif = new Uint8Array([0, 0, 0, 24, ...bytes('ftypavif'), 0, 0, 0, 0, ...new Array(30).fill(1)])
    expect(exifDateOf(avif)).toBeNull()
  })
  it('from a File, and quietly null for no file', async () => {
    expect(await exifDateOfFile(new Blob([jpeg()]))).toBe('2026-09-14')
    expect(await exifDateOfFile(null)).toBeNull()
  })
})
