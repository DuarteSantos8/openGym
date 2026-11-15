// The day a photo was taken, from the EXIF block the camera wrote into it, to suggest the date a
// progress photo is filed under (#557, #940). A few container walks rather than a library:
//
//   JPEG        the APP1 segment that starts "Exif\0\0" (an XMP APP1 before it is stepped over,
//               and so are the 0xFF fill bytes some encoders put between segments)
//   PNG         the eXIf chunk
//   WebP        the EXIF chunk of the RIFF container
//   HEIC/AVIF   an ISO-BMFF file: its Exif item is found by the "Exif\0\0" marker in front of it
//
// Each leads to the same TIFF block: IFD0, its pointer to the Exif IFD, and there
// DateTimeOriginal (0x9003), else DateTimeDigitized (0x9004), else IFD0's own DateTime (0x0132).
// Anything it cannot read is null, and the person picks the date. It only reads bytes the person
// chose themselves, and only the date: the photo that is kept is drawn again on a canvas
// (lib/media-ingest.js), so no location or camera data ever reaches the server.

// "2026:09:14 07:31:02" as EXIF writes it; some tools write dashes or slashes instead.
const DATE = /^(\d{4})[:\-/](\d{2})[:\-/](\d{2})/
const EXIF_MARK = [0x45, 0x78, 0x69, 0x66, 0, 0]   // "Exif\0\0"

const at = (b, p, bytes) => bytes.every((x, i) => b[p + i] === x)
const ascii = (b, p, s) => [...s].every((c, i) => b[p + i] === c.charCodeAt(0))
const isTiff = (b, p) => (b[p] === 0x49 && b[p + 1] === 0x49 && b[p + 2] === 0x2a && b[p + 3] === 0) ||
  (b[p] === 0x4d && b[p + 1] === 0x4d && b[p + 2] === 0 && b[p + 3] === 0x2a)

/** A real calendar day as 'YYYY-MM-DD', or null. */
export function isoDay(y, mo, d) {
  y = +y; mo = +mo; d = +d
  if (!(y >= 1900 && y <= 9999) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1) return null                       // 31 February
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' from a photo's bytes (ArrayBuffer or Uint8Array), or null. */
export function exifDateOf(input) {
  let b
  try { b = input instanceof Uint8Array ? input : new Uint8Array(input || []) } catch { return null }
  if (b.length < 12) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let tiff = -1
  if (b[0] === 0xff && b[1] === 0xd8) tiff = jpegTiff(b, v)
  else if (at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) tiff = pngTiff(b, v)
  else if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) tiff = webpTiff(b, v)
  else if (ascii(b, 4, 'ftyp')) tiff = markedTiff(b, 8)
  return tiff >= 0 ? fromTiff(b, v, tiff, b.length) : null
}

/** Where the TIFF header of a block that may or may not start with "Exif\0\0" begins, or -1. */
function tiffIn(b, p, end) {
  if (at(b, p, EXIF_MARK)) p += 6
  return p + 8 <= end && isTiff(b, p) ? p : -1
}

function jpegTiff(b, v) {
  let p = 2
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) return -1
    while (b[p + 1] === 0xff && p + 2 < b.length) p++                 // fill bytes
    const marker = b[p + 1]
    if (marker === 0xda || marker === 0xd9) return -1                // the image data: no EXIF
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue }  // no length
    if (p + 4 > b.length) return -1
    const len = v.getUint16(p + 2)
    if (len < 2) return -1
    const end = Math.min(b.length, p + 2 + len)
    if (marker === 0xe1 && at(b, p + 4, EXIF_MARK)) {
      const t = tiffIn(b, p + 4, end)
      if (t >= 0) return t
    }
    p += 2 + len
  }
  return -1
}

function pngTiff(b, v) {
  let p = 8
  while (p + 12 <= b.length) {
    const len = v.getUint32(p)
    if (ascii(b, p + 4, 'eXIf')) return tiffIn(b, p + 8, Math.min(b.length, p + 8 + len))
    if (ascii(b, p + 4, 'IEND')) return -1
    p += 12 + len
  }
  return -1
}

function webpTiff(b, v) {
  let p = 12
  while (p + 8 <= b.length) {
    const len = v.getUint32(p + 4, true)
    if (ascii(b, p, 'EXIF')) return tiffIn(b, p + 8, Math.min(b.length, p + 8 + len))
    p += 8 + len + (len & 1)
  }
  return -1
}

/* HEIC and AVIF keep the EXIF as an item somewhere in the file (where iloc says), written as a
   4-byte offset, then "Exif\0\0" and the TIFF block. Walking iloc properly is a lot of code for
   one date; the marker followed by a valid TIFF header is distinctive enough. */
function markedTiff(b, from) {
  for (let p = from; p + 14 <= b.length; p++) {
    if (b[p] === 0x45 && at(b, p, EXIF_MARK) && isTiff(b, p + 6)) return p + 6
  }
  return -1
}

function fromTiff(b, v, start, end) {
  if (start + 8 > end) return null
  const le = b[start] === 0x49
  const u16 = o => (o >= 0 && o + 2 <= end ? v.getUint16(o, le) : null)
  const u32 = o => (o >= 0 && o + 4 <= end ? v.getUint32(o, le) : null)
  const tag = (ifd, want) => {
    if (ifd == null) return null
    const base = start + ifd
    const n = u16(base)
    if (n == null || n > 1000) return null
    for (let i = 0; i < n; i++) {
      const e = base + 2 + i * 12
      const id = u16(e)
      if (id == null) return null
      if (id === want) return { type: u16(e + 2), count: u32(e + 4), value: e + 8 }
    }
    return null
  }
  const dateOf = entry => {
    if (!entry || entry.type !== 2 || !(entry.count >= 10)) return null
    const off = entry.count > 4 ? start + u32(entry.value) : entry.value
    if (!(off >= 0) || off + 10 > end) return null
    const m = DATE.exec(String.fromCharCode(...b.subarray(off, off + 10)))
    return m ? isoDay(m[1], m[2], m[3]) : null
  }
  const ifd0 = u32(start + 4)
  const ptr = tag(ifd0, 0x8769)
  const exif = ptr ? u32(ptr.value) : null
  const d = dateOf(tag(exif, 0x9003)) || dateOf(tag(exif, 0x9004)) || dateOf(tag(ifd0, 0x0132))
  // A camera whose clock was never set writes 1970 or 2000-01-01; neither is a progress photo's day.
  return d && d >= '2000-01-02' ? d : null
}

/** The same from a File or Blob: the first 512 KB, where EXIF lives (a HEIC may keep it a little
 *  further in than a JPEG does). Never throws. */
export async function exifDateOfFile(file) {
  try {
    if (!file || typeof file.slice !== 'function') return null
    const head = await file.slice(0, 512 * 1024).arrayBuffer()
    return exifDateOf(head)
  } catch { return null }
}
