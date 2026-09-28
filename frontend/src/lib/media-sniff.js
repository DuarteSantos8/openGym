/* What a picked file really is, and the few things this app reads or changes inside one.
 *
 * Pure byte work on Uint8Arrays, with no DOM and no imports, so all of it runs in the tests.
 *
 *  - sniffKind: the type from the first bytes alone, never from the name or file.type. It follows
 *    api/media.js sniffMedia rule for rule, so a device never uploads something the server would
 *    refuse, and additionally knows HEIC/AVIF photos, which are only ever re-encoded.
 *  - imageDims: a photo's size from its header, for the pixel guard that runs before any decode.
 *  - inspectGif / cleanGif: a GIF's frames and length, and a copy without the blocks that carry
 *    text and metadata (comments, XMP, ICC), keeping the loop blocks.
 *  - inspectMp4 / scrubMp4: an MP4/MOV's brand, length, size and codec, and the metadata scrub —
 *    udta/meta/uuid boxes and the samples of tracks that are neither sound nor picture (timed
 *    metadata, an action camera's GPS track) are zeroed IN PLACE. Nothing moves, so every offset
 *    in the file stays valid and the video plays exactly as before.
 *  - inspectWebm: size, codec and (when written) length of a WebM, which has no scrub (deferred).
 */

const ascii = (b, off, len) => {
  if (off < 0 || off + len > b.length) return ''
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i])
  return s
}
const at = (b, off, bytes) => bytes.every((x, i) => b[off + i] === x)
const u16be = (b, o) => (b[o] << 8) | b[o + 1]
const u16le = (b, o) => b[o] | (b[o + 1] << 8)
const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
// A 64-bit field as a Number. Nothing real comes near 2^53; past it the file is broken anyway.
const u64be = (b, o) => u32be(b, o) * 4294967296 + u32be(b, o + 4)
const i32be = (b, o) => u32be(b, o) | 0

// The same list as api/media.js MP4_BRANDS: brands nobody vouched for (M4A audio, a 3GPP brand
// the server does not know) are refused on both sides.
const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VP',
  'dash', 'mmp4', 'MSNV', '3gp4', '3gp5', '3gp6', '3g2a'
])
// HEIF/AVIF stills: accepted as input only — decoded and re-encoded like any photo.
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1', 'avif', 'avis'])

// An EBML variable-length integer at b[i]. IDs keep their length marker, sizes drop it. A size of
// all ones means "unknown" (a live recording that never went back to write it).
function vint(b, i, keepMarker) {
  if (i >= b.length || b[i] === 0) return null
  const first = b[i]
  let len = 1
  while (!(first & (0x80 >> (len - 1)))) len++
  if (len > 8 || i + len > b.length) return null
  let v = keepMarker ? first : first & (0xff >> len)
  let allOnes = v === (0xff >> len)
  for (let k = 1; k < len; k++) { v = v * 256 + b[i + k]; if (b[i + k] !== 0xff) allOnes = false }
  return { value: v, len, unknown: !keepMarker && allOnes }
}
function ebmlDocType(b) {
  const hs = vint(b, 4, false)
  if (!hs) return null
  let i = 4 + hs.len
  const end = Math.min(b.length, i + hs.value)
  while (i < end) {
    const id = vint(b, i, true)
    const sz = id && vint(b, i + id.len, false)
    if (!sz) return null
    const body = i + id.len + sz.len
    if (id.value === 0x4282) {
      if (body + sz.value > b.length) return null
      return ascii(b, body, sz.value).replace(/\0+$/, '')
    }
    i = body + sz.value
  }
  return null
}

/**
 * { mime, kind, category, input? } from the first bytes, or null. `input: true` marks a type
 * that is read here but never stored or uploaded as it is (HEIC/AVIF — the server refuses them).
 * Everything else is refused: SVG and XML, HTML, PDF, ZIP, BMP, TIFF, ICO, M4A, Matroska.
 */
export function sniffKind(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (at(b, 0, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', kind: 'image', category: 'still' }
  if (at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', kind: 'image', category: 'still' }
  const sig = ascii(b, 0, 6)
  if (sig === 'GIF87a' || sig === 'GIF89a') return { mime: 'image/gif', kind: 'gif', category: 'still' }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { mime: 'image/webp', kind: 'image', category: 'still' }
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4)
    if (brand === 'qt  ') return { mime: 'video/quicktime', kind: 'video', category: 'video' }
    if (MP4_BRANDS.has(brand)) return { mime: 'video/mp4', kind: 'video', category: 'video' }
    if (HEIF_BRANDS.has(brand)) return { mime: brand.startsWith('avi') ? 'image/avif' : 'image/heic', kind: 'image', category: 'still', input: true }
    return null
  }
  if (at(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return ebmlDocType(b) === 'webm' ? { mime: 'video/webm', kind: 'video', category: 'video' } : null
  }
  return null
}

/* ---------------------------------------------------------------- still images */

/**
 * { width, height } of a JPEG (its SOFn frame header), PNG (IHDR), WebP (VP8, VP8L or VP8X) or
 * GIF (logical screen), or null. Read before any decode: a 100-megapixel photo would take a phone
 * a few hundred MB just to open, so it is refused on these numbers instead.
 */
export function imageDims(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  const s = sniffKind(b)
  if (!s) return null
  if (s.mime === 'image/png') {
    if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null
    return dims(u32be(b, 16), u32be(b, 20))
  }
  if (s.mime === 'image/gif') return b.length >= 10 ? dims(u16le(b, 6), u16le(b, 8)) : null
  if (s.mime === 'image/webp') {
    const chunk = ascii(b, 12, 4)
    if (chunk === 'VP8 ' && b.length >= 30) return dims(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff)
    if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      return dims((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    }
    if (chunk === 'VP8X' && b.length >= 30) return dims(u24le(b, 24) + 1, u24le(b, 27) + 1)
    return null
  }
  if (s.mime === 'image/jpeg') {
    let i = 2
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null
      const m = b[i + 1]
      if (m === 0xff) { i++; continue }                   // fill byte
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }   // no length
      if (m === 0xd9 || m === 0xda) return null           // end, or image data before any frame header
      const len = u16be(b, i + 2)
      if (len < 2) return null
      // SOF0..SOF15, minus DHT (C4), JPG (C8) and DAC (CC), which share the range.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        if (i + 9 > b.length) return null
        return dims(u16be(b, i + 7), u16be(b, i + 5))
      }
      i += 2 + len
    }
    return null
  }
  return null
}
const dims = (width, height) => (width > 0 && height > 0 ? { width, height } : null)

/* ---------------------------------------------------------------- GIF */

// Walks a GIF's blocks and calls `on(kind, start, end, extra)` for each, in order: 'head' (the
// header, the logical screen and the global colour table), 'ext' (an extension, label in extra),
// 'image' (a descriptor, its colour table and its data) and 'end' (the trailer). Throws on a
// block that runs past the end of the file.
function walkGif(b, on) {
  if (b.length < 13) throw new Error('gif: too short')
  let i = 13
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1))
  if (i > b.length) throw new Error('gif: colour table')
  on('head', 0, i)
  const subBlocks = j => {
    while (true) {
      if (j >= b.length) throw new Error('gif: truncated')
      const n = b[j]
      j += 1 + n
      if (n === 0) return j
    }
  }
  while (i < b.length) {
    const t = b[i]
    if (t === 0x3b) { on('end', i, i + 1); return }
    if (t === 0x21) {
      if (i + 2 > b.length) throw new Error('gif: truncated')
      const end = subBlocks(i + 2)
      if (end > b.length) throw new Error('gif: truncated')
      on('ext', i, end, b[i + 1])
      i = end
    } else if (t === 0x2c) {
      if (i + 10 > b.length) throw new Error('gif: truncated')
      let j = i + 10
      if (b[i + 9] & 0x80) j += 3 * (1 << ((b[i + 9] & 7) + 1))
      j += 1   // LZW minimum code size
      const end = subBlocks(j)
      if (end > b.length) throw new Error('gif: truncated')
      on('image', i, end)
      i = end
    } else throw new Error('gif: unknown block')
  }
  on('end', b.length, b.length)   // no trailer: the file simply stops after a whole block
}

/**
 * { width, height, frames, durMs } of a GIF, or null for one that does not parse. A frame
 * delay of 0 counts as 10 ms, so a GIF of zero-delay frames still has a length.
 */
export function inspectGif(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (sniffKind(b)?.mime !== 'image/gif') return null
  let frames = 0, durMs = 0, delay = null
  try {
    walkGif(b, (kind, start, end, label) => {
      if (kind === 'ext' && label === 0xf9 && end - start >= 8) delay = u16le(b, start + 4)
      if (kind === 'image') { frames++; durMs += delay ? delay * 10 : 10; delay = null }
    })
  } catch { if (!frames) return null }
  if (!frames) return null
  return { width: u16le(b, 6), height: u16le(b, 8), frames, durMs }
}

// The application blocks a GIF needs to keep looping; every other one (XMP, ICC profiles, an
// editor's own data) is metadata.
const LOOP_APPS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0'])

/**
 * A copy of a GIF with its comment (0xFE), plain-text (0x01) and non-loop application blocks
 * (XMP, ICC and the like) left out. Graphic control blocks, frames and the loop block stay, so
 * it animates exactly as before. A graphic control block that belonged to a dropped plain-text
 * block goes with it, so its delay cannot land on the next frame. Throws on a GIF that does not
 * parse; one that simply stops after a whole block gets its trailer.
 */
export function cleanGif(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (sniffKind(b)?.mime !== 'image/gif') throw new Error('gif: not a gif')
  const keep = []
  let gce = null
  walkGif(b, (kind, start, end, label) => {
    if (kind === 'head') { keep.push([start, end]); return }
    if (kind === 'end') { keep.push(null); return }
    if (kind === 'image') { if (gce) keep.push(gce); gce = null; keep.push([start, end]); return }
    if (label === 0xf9) { gce = [start, end]; return }
    if (label === 0x01) { gce = null; return }
    if (label === 0xff && b[start + 2] === 11 && LOOP_APPS.has(ascii(b, start + 3, 11))) keep.push([start, end])
  })
  const total = keep.reduce((n, r) => n + (r ? r[1] - r[0] : 1), 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const r of keep) {
    if (!r) { out[o++] = 0x3b; continue }
    out.set(b.subarray(r[0], r[1]), o)
    o += r[1] - r[0]
  }
  return out
}

/* ---------------------------------------------------------------- MP4 / MOV */

const MAX_BOXES = 10000
const MAX_DEPTH = 8
// Boxes whose children are boxes, as far down as anything here needs to look.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex'])

// The box whose header starts at `pos` and which must end by `end`. size 1 = a 64-bit size
// follows, size 0 = it runs to `end`. A box that would reach past its parent means a broken file.
function boxAt(b, pos, end) {
  if (end - pos < 8) return null
  let size = u32be(b, pos)
  let head = 8
  if (size === 1) {
    if (end - pos < 16) return null
    size = u64be(b, pos + 8)
    head = 16
  } else if (size === 0) size = end - pos
  if (size < head || pos + size > end) return null
  return { type: ascii(b, pos + 4, 4), start: pos, body: pos + head, end: pos + size }
}

// Every box in b[start, end), depth first, as { type, start, body, end, depth, parent }. Throws
// on a box that overruns its parent, more than 10k boxes, or nesting deeper than 8.
function walkBoxes(b, start, end, visit, counter = { n: 0 }, depth = 0, parent = null) {
  if (depth > MAX_DEPTH) throw new Error('mp4: nested too deep')
  let pos = start
  while (pos < end) {
    if (end - pos < 8) {
      // Trailing zero padding after the last box is common and harmless.
      if (depth === 0 && b.subarray(pos, end).every(x => x === 0)) return
      throw new Error('mp4: truncated box')
    }
    if (++counter.n > MAX_BOXES) throw new Error('mp4: too many boxes')
    const box = boxAt(b, pos, end)
    if (!box) throw new Error('mp4: box overruns its parent')
    box.depth = depth
    box.parent = parent
    const descend = visit(box) !== false
    if (descend && CONTAINERS.has(box.type)) walkBoxes(b, box.body, box.end, visit, counter, depth + 1, box)
    pos = box.end
  }
}

const child = (b, box, type) => {
  let found = null
  let pos = box.body
  while (pos < box.end && !found) {
    const c = boxAt(b, pos, box.end)
    if (!c) return null
    if (c.type === type) found = c
    pos = c.end
  }
  return found
}
const path = (b, box, ...types) => types.reduce((cur, t) => (cur ? child(b, cur, t) : null), box)

const CODEC_OF = { avc1: 'avc1', avc3: 'avc1', hvc1: 'hvc1', hev1: 'hvc1', av01: 'av01', vp09: 'vp09', vp08: 'vp8' }

// What one trak holds: its handler, its first sample entry, its display size, and the sample
// table boxes the scrub needs.
function readTrak(b, trak) {
  const out = { handler: null, fourcc: null, width: 0, height: 0, stbl: null }
  const hdlr = path(b, trak, 'mdia', 'hdlr')
  if (hdlr && hdlr.end - hdlr.body >= 12) out.handler = ascii(b, hdlr.body + 8, 4)
  const stbl = path(b, trak, 'mdia', 'minf', 'stbl')
  out.stbl = stbl
  const stsd = stbl && child(b, stbl, 'stsd')
  if (stsd && stsd.end - stsd.body >= 16) {
    out.fourcc = ascii(b, stsd.body + 12, 4)
    // A visual sample entry's own width and height: the fallback when tkhd says 0.
    const e = stsd.body + 8
    if (out.handler === 'vide' && e + 36 <= stsd.end) { out.sw = u16be(b, e + 32); out.sh = u16be(b, e + 34) }
  }
  const tkhd = child(b, trak, 'tkhd')
  if (tkhd) {
    const v = b[tkhd.body]
    const m = tkhd.body + (v === 1 ? 52 : 40)        // the transformation matrix
    const wOff = tkhd.body + (v === 1 ? 88 : 76)
    if (wOff + 8 <= tkhd.end) {
      let w = Math.round(u32be(b, wOff) / 65536)
      let h = Math.round(u32be(b, wOff + 4) / 65536)
      // A phone filming upright stores the sensor's landscape size and a 90° matrix (a = d = 0):
      // what is seen is the other way round.
      if (m + 16 <= tkhd.end && i32be(b, m) === 0 && i32be(b, m + 16) === 0) [w, h] = [h, w]
      out.width = w
      out.height = h
    }
  }
  if (out.handler === 'vide' && (!out.width || !out.height) && out.sw && out.sh) { out.width = out.sw; out.height = out.sh }
  return out
}

// The movie header's length in seconds: mvhd, or for a fragmented file (mvhd says 0) mvex/mehd.
function movieSeconds(b, moov) {
  const mvhd = child(b, moov, 'mvhd')
  if (!mvhd) return undefined
  const v = b[mvhd.body]
  let scale, dur
  if (v === 1) {
    if (mvhd.body + 32 > mvhd.end) return undefined
    scale = u32be(b, mvhd.body + 20); dur = u64be(b, mvhd.body + 24)
    if (dur >= 0xffffffffffff) dur = 0
  } else {
    if (mvhd.body + 20 > mvhd.end) return undefined
    scale = u32be(b, mvhd.body + 12); dur = u32be(b, mvhd.body + 16)
    if (dur === 0xffffffff) dur = 0
  }
  if (!scale) return undefined
  if (!dur) {
    const mehd = path(b, moov, 'mvex', 'mehd')
    if (mehd && mehd.body + 8 <= mehd.end) {
      const wide = b[mehd.body] === 1 && mehd.body + 12 <= mehd.end
      dur = wide ? u64be(b, mehd.body + 4) : u32be(b, mehd.body + 4)
    }
  }
  return dur ? Math.round((dur / scale) * 1000) / 1000 : null
}

function topLevel(b) {
  const boxes = []
  let pos = 0, n = 0
  while (pos < b.length) {
    if (b.length - pos < 8 && b.subarray(pos).every(x => x === 0)) break
    if (++n > MAX_BOXES) throw new Error('mp4: too many boxes')
    const box = boxAt(b, pos, b.length)
    if (!box) throw new Error('mp4: box overruns the file')
    boxes.push(box)
    pos = box.end
  }
  return boxes
}

/**
 * { brand, durationSec, width, height, codec, handlers } of an MP4/MOV, or null for anything
 * that is not a well-formed one: ftyp not first, no moov, a box overrunning its parent.
 * durationSec is null when the file does not say; width/height are what is seen (a 90° matrix
 * swaps them); codec is the video track's first sample entry reduced to
 * avc1 | hvc1 | av01 | vp09 | vp8 | other; handlers lists every trak's handler type.
 */
export function inspectMp4(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  try {
    const top = topLevel(b)
    if (!top.length || top[0].type !== 'ftyp' || top[0].end - top[0].body < 4) return null
    const moov = top.find(x => x.type === 'moov')
    if (!moov) return null
    const durationSec = movieSeconds(b, moov)
    if (durationSec === undefined) return null
    const traks = []
    let pos = moov.body
    while (pos < moov.end) {
      const c = boxAt(b, pos, moov.end)
      if (!c) return null
      if (c.type === 'trak') traks.push(readTrak(b, c))
      pos = c.end
    }
    const video = traks.find(t => t.handler === 'vide')
    return {
      brand: ascii(b, top[0].body, 4),
      durationSec,
      width: video?.width || 0,
      height: video?.height || 0,
      codec: video ? (CODEC_OF[video.fourcc] || 'other') : null,
      handlers: traks.map(t => t.handler)
    }
  } catch { return null }
}

// Handlers whose samples are the video itself: picture, sound, and the timecode track editors add.
const KEEP_HANDLERS = new Set(['vide', 'soun', 'tmcd'])
const MAX_SAMPLES = 5_000_000

// [offset, size] of every sample of a trak, from its sample table (stsz + stsc + stco/co64).
// Throws on a table that is malformed or points outside the file.
function sampleRanges(b, stbl) {
  const stsz = child(b, stbl, 'stsz')
  const stsc = child(b, stbl, 'stsc')
  const stco = child(b, stbl, 'stco') || child(b, stbl, 'co64')
  if (!stsz || !stsc || !stco) {
    // A track with no samples at all has nothing to zero; a partial table is a broken file.
    if (!stsz && !stsc && !stco) return []
    throw new Error('mp4: incomplete sample table')
  }
  const wide = stco.type === 'co64'
  const nChunks = u32be(b, stco.body + 4)
  if (stco.body + 8 + nChunks * (wide ? 8 : 4) > stco.end) throw new Error('mp4: chunk table')
  const chunkAt = i => (wide ? u64be(b, stco.body + 8 + i * 8) : u32be(b, stco.body + 8 + i * 4))
  const fixed = u32be(b, stsz.body + 4)
  const nSamples = u32be(b, stsz.body + 8)
  if (nSamples > MAX_SAMPLES) throw new Error('mp4: too many samples')
  if (!fixed && stsz.body + 12 + nSamples * 4 > stsz.end) throw new Error('mp4: size table')
  const sizeOf = i => (fixed || u32be(b, stsz.body + 12 + i * 4))
  const nRuns = u32be(b, stsc.body + 4)
  if (stsc.body + 8 + nRuns * 12 > stsc.end) throw new Error('mp4: chunk runs')
  const runs = []
  for (let r = 0; r < nRuns; r++) {
    const o = stsc.body + 8 + r * 12
    runs.push({ first: u32be(b, o), per: u32be(b, o + 4) })
  }
  const out = []
  let s = 0
  for (let r = 0; r < runs.length && s < nSamples; r++) {
    const last = r + 1 < runs.length ? runs[r + 1].first - 1 : nChunks
    if (runs[r].first < 1 || last > nChunks || runs[r].per > MAX_SAMPLES) throw new Error('mp4: chunk runs')
    for (let c = runs[r].first; c <= last && s < nSamples; c++) {
      let off = chunkAt(c - 1)
      for (let k = 0; k < runs[r].per && s < nSamples; k++) {
        const size = sizeOf(s++)
        if (off + size > b.length) throw new Error('mp4: sample outside the file')
        out.push([off, size])
        off += size
      }
    }
  }
  return out
}

// Boxes that hold what a camera or an editor says about the recording rather than the recording:
// QuickTime's user data, ISO metadata, and vendor boxes (a Canon keeps its EXIF, GPS included, in
// a uuid box inside moov; XMP travels in one too).
const METADATA_BOXES = new Set(['udta', 'meta', 'uuid'])

/**
 * Zeroes, IN PLACE, what in an MP4/MOV can say where and by whom it was filmed, and returns the
 * same array. (a) Every udta, meta and uuid box — at the top level, anywhere under moov, and
 * directly under a fragment's moof and traf — becomes a 'free' box of the same size with a zeroed
 * body: QuickTime's location, the phone's make and model and a camera's EXIF live there.
 * (b) Every sample of a track that is neither picture nor sound (timed metadata, an action
 * camera's GPS and sensor tracks, a subtitle track) is zeroed where it sits in mdat; the track
 * itself stays. No size changes, so stco/co64 stay right and the video and sound bytes are
 * untouched. Throws on a file that does not parse or whose sample tables point outside it — such
 * a file is refused rather than kept with its metadata — and on a fragmented file (moof) that has
 * such a track: its samples sit in fragments the sample table does not list, and the scrub does
 * not walk trun, so it refuses rather than keep them.
 */
export function scrubMp4(bytes) {
  const b = bytes
  const top = topLevel(b)
  if (!top.length || top[0].type !== 'ftyp') throw new Error('mp4: no ftyp')
  const blank = box => {
    b[box.start + 4] = 0x66; b[box.start + 5] = 0x72; b[box.start + 6] = 0x65; b[box.start + 7] = 0x65   // 'free'
    b.fill(0, box.body, box.end)
  }
  // The direct children of a box, for moof and traf (not containers the inspector descends into).
  const kids = box => {
    const out = []
    for (let pos = box.body; pos < box.end;) {
      const c = boxAt(b, pos, box.end)
      if (!c) throw new Error('mp4: box overruns its parent')
      out.push(c)
      pos = c.end
    }
    return out
  }
  const traks = []
  const counter = { n: 0 }
  const fragmented = top.some(x => x.type === 'moof')
  for (const box of top) {
    if (METADATA_BOXES.has(box.type)) { blank(box); continue }
    if (box.type === 'moof') {
      for (const c of kids(box)) {
        if (METADATA_BOXES.has(c.type)) blank(c)
        else if (c.type === 'traf') for (const g of kids(c)) if (METADATA_BOXES.has(g.type)) blank(g)
      }
      continue
    }
    if (box.type !== 'moov') continue
    walkBoxes(b, box.body, box.end, c => {
      if (METADATA_BOXES.has(c.type)) { blank(c); return false }
      if (c.type === 'trak') traks.push(c)
      return true
    }, counter, 1, box)
  }
  // Sample ranges are read before anything is zeroed: blanking a box never touches a sample
  // table, but reading them all first means a table that fails halfway leaves no track zeroed.
  const doomed = []
  for (const trak of traks) {
    const t = readTrak(b, trak)
    if (KEEP_HANDLERS.has(t.handler)) continue
    if (fragmented) throw new Error('mp4: fragmented file with a track that is neither picture nor sound')
    if (!t.stbl) continue
    doomed.push(...sampleRanges(b, t.stbl))
  }
  for (const [off, size] of doomed) b.fill(0, off, off + size)
  return b
}

/* ---------------------------------------------------------------- WebM */

const EBML_WALK_MAX = 1 << 20   // the track headers sit before the first cluster

/**
 * { width, height, codec, durationSec } of a WebM from its header elements (Segment → Info and
 * Tracks), read from at most the first MB, or null. A recording that never wrote its length
 * (MediaRecorder) gives durationSec null.
 */
export function inspectWebm(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (sniffKind(b)?.mime !== 'video/webm') return null
  const limit = Math.min(b.length, EBML_WALK_MAX)
  const out = { width: 0, height: 0, codec: null, durationSec: null }
  let scale = 1000000, dur = null
  const readUint = (i, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[i + k]; return v }
  const readFloat = (i, n) => {
    const dv = new DataView(b.buffer, b.byteOffset + i, n)
    return n === 4 ? dv.getFloat32(0) : n === 8 ? dv.getFloat64(0) : null
  }
  // Masters worth descending into: Segment, Info, Tracks, TrackEntry, Video.
  const MASTER = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0])
  const walk = (start, end, depth) => {
    let i = start
    while (i < end && i < limit) {
      const id = vint(b, i, true)
      const sz = id && vint(b, i + id.len, false)
      if (!sz) return
      const body = i + id.len + sz.len
      const stop = sz.unknown ? end : Math.min(end, body + sz.value)
      if (id.value === 0x1f43b675) return   // the first Cluster: every header is behind us
      if (MASTER.has(id.value) && depth < 6) {
        walk(body, stop, depth + 1)
      } else if (body + sz.value <= b.length) {
        // Only the video track has a V_ codec and a PixelWidth, so audio tracks pass by.
        if (id.value === 0x2ad7b1) scale = readUint(body, sz.value)                   // TimecodeScale
        else if (id.value === 0x4489) dur = readFloat(body, sz.value)                   // Duration
        else if (id.value === 0x86) {                                                  // CodecID
          const c = ascii(b, body, sz.value).replace(/\0+$/, '')
          if (c.startsWith('V_') && !out.codec) out.codec = c === 'V_VP8' ? 'vp8' : c === 'V_VP9' ? 'vp9' : c === 'V_AV1' ? 'av01' : 'other'
        }
        else if (id.value === 0xb0 && !out.width) out.width = readUint(body, sz.value)  // PixelWidth
        else if (id.value === 0xba && !out.height) out.height = readUint(body, sz.value) // PixelHeight
      }
      if (sz.unknown) return
      i = body + sz.value
    }
  }
  try { walk(0, b.length, 0) } catch { return null }
  if (dur != null && Number.isFinite(dur) && dur > 0) out.durationSec = Math.round((dur * scale) / 1e6) / 1000
  return out
}
