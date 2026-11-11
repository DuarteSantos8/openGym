import { describe, expect, it } from 'vitest'
import { exifDateOf, exifDateOfFile } from './exif-date.js'

/* The date a photo was taken, read from a JPEG's EXIF (#557). The JPEGs here are built byte by
   byte: SOI, an APP1 "Exif" segment with a TIFF header, IFD0 pointing at the Exif IFD, and
   DateTimeOriginal in it. */
function jpeg({ le = true, date = '2026:09:14 07:31:02', tagId = 0x9003, extra = [] } = {}) {
  const tiff = []
  const u16 = n => (le ? [n & 255, n >> 8] : [n >> 8, n & 255])
  const u32 = n => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8))
  // IFD0 at 8: one entry, the Exif IFD pointer -> 26
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0))
  // Exif IFD at 26: one entry, DateTimeOriginal (ASCII, 20 bytes) at 44
  tiff.push(...u16(1), ...u16(tagId), ...u16(2), ...u32(20), ...u32(44), ...u32(0))
  tiff.push(...[...date].map(c => c.charCodeAt(0)), 0)
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
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
  it('from a File, and quietly null for no file', async () => {
    expect(await exifDateOfFile(new Blob([jpeg()]))).toBe('2026-09-14')
    expect(await exifDateOfFile(null)).toBeNull()
  })
})

/* The same TIFF block in other containers, and the odd cases that made dates go missing. */
function tiffBlock({ date = '2026:09:14 07:31:02', where = 'exif' } = {}) {
  const t = []
  const u16 = n => [n & 255, n >> 8]
  const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]
  const text = [...date].map(c => c.charCodeAt(0)).concat(0)
  t.push(0x49, 0x49, ...u16(42), ...u32(8))
  if (where === 'ifd0') {
    // IFD0 at 8: one entry, DateTime (0x0132, ASCII x20) -> 26, no Exif IFD at all
    t.push(...u16(1), ...u16(0x0132), ...u16(2), ...u32(20), ...u32(26), ...u32(0), ...text)
  } else {
    t.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0))
    t.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0), ...text)
  }
  return t
}
const ascii = s => [...s].map(c => c.charCodeAt(0))
const be32 = n => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
const le32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]

describe('exifDateOf beyond the plain JPEG', () => {
  it('reads a PNG eXIf chunk', () => {
    const t = tiffBlock()
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...be32(0), ...ascii('IHDR'), 0, 0, 0, 0,
      ...be32(t.length), ...ascii('eXIf'), ...t, 0, 0, 0, 0,
      ...be32(0), ...ascii('IEND'), 0, 0, 0, 0])
    expect(exifDateOf(png)).toBe('2026-09-14')
  })
  it('reads a WebP EXIF chunk, with or without the Exif prefix', () => {
    for (const prefix of [[], [0x45, 0x78, 0x69, 0x66, 0, 0]]) {
      const data = [...prefix, ...tiffBlock()]
      const webp = new Uint8Array([...ascii('RIFF'), ...le32(4 + 8 + data.length), ...ascii('WEBP'),
        ...ascii('EXIF'), ...le32(data.length), ...data])
      expect(exifDateOf(webp)).toBe('2026-09-14')
    }
  })
  it('finds the block in a HEIC-style file by its Exif marker', () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic'), 1, 2, 3, 4, 5, 6,
      0, 0, 0, 6, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiffBlock(), 9, 9, 9])
    expect(exifDateOf(heic)).toBe('2026-09-14')
  })
  it('does not mistake the word "Exif" in other bytes for a block', () => {
    const junk = new Uint8Array([...ascii('ftypheic'), 0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(exifDateOf(junk)).toBeNull()
  })
})

describe('exifDateOf, the cases that used to come back empty', () => {
  const wrap = tiff => {
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    return [0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1]
  }
  it('steps over fill bytes between segments', () => {
    const j = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff, ...wrap(tiffBlock()), 0xff, 0xda, 0, 2])
    expect(exifDateOf(j)).toBe('2026-09-14')
  })
  it('steps over an XMP APP1 that comes before the EXIF one', () => {
    const xmp = [0xff, 0xe1, 0, 12, ...ascii('http://ns.'), 0, 0]
    const j = new Uint8Array([0xff, 0xd8, ...xmp, ...wrap(tiffBlock()), 0xff, 0xda, 0, 2])
    expect(exifDateOf(j)).toBe('2026-09-14')
  })
  it('takes the DateTime of IFD0 when there is no Exif IFD', () => {
    const j = new Uint8Array([0xff, 0xd8, ...wrap(tiffBlock({ where: 'ifd0' })), 0xff, 0xda, 0, 2])
    expect(exifDateOf(j)).toBe('2026-09-14')
  })
  it('takes dates written with dashes or slashes', () => {
    for (const date of ['2026-09-14 07:31:02', '2026/09/14 07:31:02']) {
      const j = new Uint8Array([0xff, 0xd8, ...wrap(tiffBlock({ date })), 0xff, 0xda, 0, 2])
      expect(exifDateOf(j), date).toBe('2026-09-14')
    }
  })
})

