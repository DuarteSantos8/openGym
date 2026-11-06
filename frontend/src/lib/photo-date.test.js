import { describe, expect, it } from 'vitest'
import { dateFromName, dateFromModified, photoDateFrom, photoDateOfFile } from './photo-date.js'

const TODAY = '2026-11-06'

describe('dateFromName', () => {
  it('reads the names phones and apps give photos', () => {
    expect(dateFromName('IMG_20260914_073102.jpg')).toBe('2026-09-14')
    expect(dateFromName('PXL_20260914_073102123.MP.jpg')).toBe('2026-09-14')
    expect(dateFromName('IMG-20260914-WA0001.jpeg')).toBe('2026-09-14')
    expect(dateFromName('Screenshot 2026-09-14 at 07.31.02.png')).toBe('2026-09-14')
    expect(dateFromName('2026-09-14 07.31.02.heic')).toBe('2026-09-14')
    expect(dateFromName('20260914073102.jpg')).toBe('2026-09-14')
    expect(dateFromName('photo_2026.09.14.webp')).toBe('2026-09-14')
  })
  it('leaves alone what only looks a bit like a date', () => {
    expect(dateFromName('IMG_1234.jpg')).toBeNull()
    expect(dateFromName('IMG_20261314_0001.jpg')).toBeNull()      // month 13
    expect(dateFromName('IMG_20260231_0001.jpg')).toBeNull()      // 31 February
    expect(dateFromName('2026-09_14.jpg')).toBeNull()             // mixed separators
    expect(dateFromName('9920260914.jpg')).toBeNull()              // glued to more digits
    expect(dateFromName('2026091412.jpg')).toBeNull()
    expect(dateFromName(undefined)).toBeNull()
  })
})

describe('photoDateFrom', () => {
  it('trusts the photo first, then the name, then the file date', () => {
    expect(photoDateFrom({ exif: '2026-09-01', name: 'IMG_20260902_1.jpg', modified: new Date(2026, 8, 3, 12).getTime() }, TODAY))
      .toEqual({ d: '2026-09-01', source: 'photo' })
    expect(photoDateFrom({ exif: null, name: 'IMG_20260902_1.jpg', modified: new Date(2026, 8, 3, 12).getTime() }, TODAY))
      .toEqual({ d: '2026-09-02', source: 'name' })
    expect(photoDateFrom({ exif: null, name: 'me.jpg', modified: new Date(2026, 8, 3, 12).getTime() }, TODAY))
      .toEqual({ d: '2026-09-03', source: 'file' })
  })
  it('never believes the future or before 2000, and a file saved today says nothing', () => {
    expect(photoDateFrom({ exif: '2027-01-01', name: 'IMG_19990101_1.jpg', modified: new Date(2026, 10, 6, 9).getTime() }, TODAY))
      .toEqual({ d: null, source: null })
    expect(photoDateFrom({ exif: '2026-11-06' }, TODAY)).toEqual({ d: '2026-11-06', source: 'photo' })
  })
  it('a missing or silly modified time is no date', () => {
    expect(dateFromModified(0)).toBeNull()
    expect(dateFromModified(NaN)).toBeNull()
    expect(dateFromModified('x')).toBeNull()
  })
})

describe('photoDateOfFile', () => {
  it('works from a plain File without EXIF', async () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'IMG_20260502_101010.jpg', { lastModified: new Date(2026, 5, 1, 12).getTime() })
    expect(await photoDateOfFile(f, TODAY)).toEqual({ d: '2026-05-02', source: 'name' })
  })
})
