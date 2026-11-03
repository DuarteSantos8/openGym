// The day a photo was taken, from its EXIF DateTimeOriginal, to suggest the date a progress photo
// is filed under (#557). JPEG only, a few dozen lines rather than a library: the APP1 "Exif"
// segment, its TIFF header (either byte order), IFD0's pointer to the Exif IFD, and tag 0x9003
// there ("YYYY:MM:DD HH:MM:SS"). Anything it cannot read is null, and the person picks the date.
// It only reads bytes the person chose themselves, and only the date.

const DATE = /^(\d{4}):(\d{2}):(\d{2})/

/** 'YYYY-MM-DD' from a JPEG's bytes (ArrayBuffer or Uint8Array), or null. */
export function exifDateOf(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || [])
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let p = 2
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null
    const marker = b[p + 1]
    if (marker === 0xda || marker === 0xd9) return null           // the image data begins: no EXIF
    const len = v.getUint16(p + 2)
    if (len < 2 || p + 2 + len > b.length) return null
    if (marker === 0xe1 && len >= 8 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
      return fromTiff(b, v, p + 10, p + 2 + len)
    }
    p += 2 + len
  }
  return null
}

function fromTiff(b, v, start, end) {
  if (start + 8 > end) return null
  const le = b[start] === 0x49 && b[start + 1] === 0x49
  if (!le && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return null
  const u16 = o => (o + 2 <= end ? v.getUint16(o, le) : null)
  const u32 = o => (o + 4 <= end ? v.getUint32(o, le) : null)
  const tag = (ifd, want) => {
    const at = start + ifd
    const n = u16(at)
    if (n == null || n > 1000) return null
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12
      if (u16(e) === want) return { type: u16(e + 2), count: u32(e + 4), value: e + 8 }
    }
    return null
  }
  const ifd0 = u32(start + 4)
  if (ifd0 == null) return null
  const exifPtr = tag(ifd0, 0x8769)
  if (!exifPtr) return null
  const exifIfd = u32(exifPtr.value)
  if (exifIfd == null) return null
  const dt = tag(exifIfd, 0x9003) || tag(exifIfd, 0x9004)
  if (!dt || dt.type !== 2 || !(dt.count >= 10)) return null
  const off = dt.count > 4 ? start + u32(dt.value) : dt.value
  if (off + 10 > end) return null
  const text = String.fromCharCode(...b.subarray(off, off + 10))
  const m = DATE.exec(text)
  if (!m) return null
  const [, y, mo, d] = m
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +y < 1990) return null
  return `${y}-${mo}-${d}`
}

/** The same from a File or Blob (the first 256 KB, where EXIF lives). Never throws. */
export async function exifDateOfFile(file) {
  try {
    if (!file || typeof file.slice !== 'function') return null
    const head = await file.slice(0, 256 * 1024).arrayBuffer()
    return exifDateOf(head)
  } catch { return null }
}
