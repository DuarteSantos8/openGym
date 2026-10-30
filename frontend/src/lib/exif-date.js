// The day a photo was taken, read from its EXIF, to suggest the date a progress photo is filed
// under (#557, #939). A few dozen lines rather than a library: the TIFF block that holds the EXIF
// (its header in either byte order, IFD0, the Exif IFD it points to) and, in it, the date tags.
// The block is found in a JPEG's APP1 "Exif" segment, a PNG's eXIf chunk and a WebP's EXIF chunk;
// anything else (HEIC and AVIF keep it in an item, not at a fixed place) is searched for by its
// "Exif" marker. Anything it cannot read is null, and the caller tries the file's name or asks.
// It only reads bytes the person chose themselves, and only the date.

const DATE = /^(\d{4})[:\-/. ](\d{2})[:\-/. ](\d{2})/
const EXIF_TAG = [0x45, 0x78, 0x69, 0x66, 0, 0]   // "Exif\0\0"

// The dates in the order worth trusting: when the shutter went, when it was digitised, then the
// file's last-edit stamp in IFD0 (what many editors and messengers keep when they drop the rest).
const EXIF_IFD_TAGS = [0x9003, 0x9004]
const IFD0_TAGS = [0x0132]

const at = (b, i, pat) => pat.every((x, k) => b[i + k] === x)

/** 'YYYY-MM-DD' from a photo's bytes (ArrayBuffer or Uint8Array), or null. */
export function exifDateOf(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input || [])
  if (b.length < 12) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let found = null
  if (b[0] === 0xff && b[1] === 0xd8) found = fromJpeg(b, v)
  else if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) found = fromPng(b, v)
  else if (at(b, 0, [0x52, 0x49, 0x46, 0x46]) && at(b, 8, [0x57, 0x45, 0x42, 0x50])) found = fromWebp(b, v)
  return found || scan(b, v)
}

// APP1 "Exif" in a JPEG. Fill bytes (0xFF 0xFF) before a marker are legal and some cameras write
// them; a segment that is not the EXIF one (XMP is APP1 too) is stepped over.
function fromJpeg(b, v) {
  let p = 2
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return null
    if (b[p + 1] === 0xff) { p++; continue }
    const marker = b[p + 1]
    if (marker === 0xda || marker === 0xd9) return null           // the image data begins: no EXIF
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { p += 2; continue }   // no length
    const len = v.getUint16(p + 2)
    if (len < 2 || p + 2 + len > b.length) return null
    if (marker === 0xe1 && len >= 8 && at(b, p + 4, EXIF_TAG)) return fromTiff(b, v, p + 10, p + 2 + len)
    p += 2 + len
  }
  return null
}

// PNG: chunks of length, type, data, CRC; the EXIF is the TIFF block alone in an "eXIf" chunk.
function fromPng(b, v) {
  let p = 8
  while (p + 12 <= b.length) {
    const len = v.getUint32(p)
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7])
    if (type === 'eXIf') return fromTiff(b, v, p + 8, Math.min(b.length, p + 8 + len))
    if (type === 'IDAT' || type === 'IEND') return null
    p += 12 + len
  }
  return null
}

// WebP: RIFF chunks of fourcc, little-endian length, data; "EXIF" holds the TIFF block, with or
// without the "Exif\0\0" prefix JPEG has.
function fromWebp(b, v) {
  let p = 12
  while (p + 8 <= b.length) {
    const type = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3])
    const len = v.getUint32(p + 4, true)
    if (type === 'EXIF') {
      const start = p + 8 + (at(b, p + 8, EXIF_TAG) ? 6 : 0)
      return fromTiff(b, v, start, Math.min(b.length, p + 8 + len))
    }
    p += 8 + len + (len & 1)
  }
  return null
}

// HEIC, AVIF and anything damaged on the way: the block is the bytes after an "Exif\0\0" marker
// that are a TIFF header ("II*\0" or "MM\0*").
function scan(b, v) {
  for (let i = 0; i + 14 < b.length; i++) {
    if (b[i] !== 0x45 || !at(b, i, EXIF_TAG)) continue
    const t = i + 6
    const ok = (b[t] === 0x49 && b[t + 1] === 0x49 && b[t + 2] === 0x2a && b[t + 3] === 0) ||
      (b[t] === 0x4d && b[t + 1] === 0x4d && b[t + 2] === 0 && b[t + 3] === 0x2a)
    if (!ok) continue
    const d = fromTiff(b, v, t, b.length)
    if (d) return d
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
    const base = start + ifd
    const n = u16(base)
    if (n == null || n > 1000) return null
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12
      if (u16(e) === want) return { type: u16(e + 2), count: u32(e + 4), value: e + 8 }
    }
    return null
  }
  const date = (ifd, ids) => {
    for (const id of ids) {
      const dt = tag(ifd, id)
      if (!dt || dt.type !== 2 || !(dt.count >= 10)) continue
      const off = dt.count > 4 ? start + u32(dt.value) : dt.value
      if (off + 10 > end) continue
      const m = DATE.exec(String.fromCharCode(...b.subarray(off, off + 10)))
      if (!m) continue
      const [, y, mo, d] = m
      if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +y < 1990) continue
      return `${y}-${mo}-${d}`
    }
    return null
  }
  const ifd0 = u32(start + 4)
  if (ifd0 == null) return null
  const exifPtr = tag(ifd0, 0x8769)
  const exifIfd = exifPtr ? u32(exifPtr.value) : null
  return (exifIfd != null && date(exifIfd, EXIF_IFD_TAGS)) || date(ifd0, IFD0_TAGS)
}

/** The same from a File or Blob (the first 1 MB, where EXIF lives). Never throws. */
export async function exifDateOfFile(file) {
  try {
    if (!file || typeof file.slice !== 'function') return null
    const head = await file.slice(0, 1024 * 1024).arrayBuffer()
    return exifDateOf(head)
  } catch { return null }
}
