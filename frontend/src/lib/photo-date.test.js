import { describe, expect, it } from 'vitest'
import { dateFromFileName, dateFromModified, photoDateOfFile } from './photo-date.js'

const TODAY = '2026-10-30'

describe('dateFromFileName', () => {
  it('reads the names phones, messengers and screenshots give', () => {
    for (const name of [
      'IMG_20260914_073102.jpg', 'PXL_20260914_073102345.jpg', 'IMG-20260914-WA0001.jpg', '20260914_073102.jpg',
      '2026-09-14 07.31.02.jpg', 'Screenshot 2026-09-14 at 07.31.02.png', 'WhatsApp Image 2026-09-14 at 07.31.02.jpeg',
      'photo_2026_09_14.heic', 'Screenshot_2026.09.14-07.31.png', 'foto 2026-09-14.jpg',
    ]) expect(dateFromFileName(name, TODAY), name).toBe('2026-09-14')
  })

  it('does not take other numbers for a date', () => {
    for (const name of ['IMG_4821.jpg', 'DSC00123.JPG', '1773480000000.jpg', 'photo.jpg', '', null, undefined,
      'IMG_20261399.jpg', 'IMG_20260230.jpg', '123420260914567.jpg']) expect(dateFromFileName(name, TODAY), String(name)).toBeNull()
  })

  it('does not believe the future or a date before 2000', () => {
    expect(dateFromFileName('IMG_20261231.jpg', TODAY)).toBeNull()
    expect(dateFromFileName('IMG_19991231.jpg', TODAY)).toBeNull()
    expect(dateFromFileName('IMG_20261030.jpg', TODAY)).toBe('2026-10-30')
  })
})

describe('dateFromModified', () => {
  it('is the local day of the time', () => {
    expect(dateFromModified(new Date(2026, 8, 14, 7, 31).getTime(), TODAY)).toBe('2026-09-14')
    expect(dateFromModified(new Date(2026, 8, 14, 23, 59).getTime(), TODAY)).toBe('2026-09-14')
  })
  it('is null for no time, the epoch, the future', () => {
    for (const ms of [0, NaN, undefined, null, -5, new Date(2030, 0, 1).getTime(), 86400000]) expect(dateFromModified(ms, TODAY)).toBeNull()
  })
})

describe('photoDateOfFile', () => {
  const file = (name, lastModified) => Object.assign(new Blob(['not an image']), { name, lastModified })
  const tiffJpeg = () => {   // a JPEG whose EXIF says 2026-03-02
    const t = [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x69, 0x87, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0,
      1, 0, 0x03, 0x90, 2, 0, 20, 0, 0, 0, 44, 0, 0, 0, 0, 0, 0, 0, ...[...'2026:03:02 10:00:00'].map(c => c.charCodeAt(0)), 0]
    const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t]
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2])
  }

  it('prefers the EXIF date over the name and the modified time', async () => {
    const f = Object.assign(new Blob([tiffJpeg()]), { name: 'IMG_20260914.jpg', lastModified: new Date(2026, 5, 1).getTime() })
    expect(await photoDateOfFile(f, TODAY)).toEqual({ date: '2026-03-02', source: 'exif' })
  })
  it('then the name, then the modified time', async () => {
    expect(await photoDateOfFile(file('IMG_20260914.jpg', new Date(2026, 5, 1).getTime()), TODAY)).toEqual({ date: '2026-09-14', source: 'name' })
    expect(await photoDateOfFile(file('x.jpg', new Date(2026, 5, 1, 12).getTime()), TODAY)).toEqual({ date: '2026-06-01', source: 'modified' })
  })
  it('does not call a file saved today a date', async () => {
    expect(await photoDateOfFile(file('x.jpg', new Date(2026, 9, 30, 9).getTime()), TODAY)).toBeNull()
  })
  it('is null when nothing says, and for no file', async () => {
    expect(await photoDateOfFile(file('x.jpg', 0), TODAY)).toBeNull()
    expect(await photoDateOfFile(null, TODAY)).toBeNull()
  })
})
