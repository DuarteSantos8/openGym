/* Before a file is shared: does its container still carry anything that can say who, where or
 * when (library design 6.5)? Only headers are read, nothing is decoded. The app already strips
 * all of it on the device (canvas re-encode, cleanGif, scrubMp4, sound-ingest); this is the second
 * look, because a shared file is seen by everybody on the server. A refusal is 422 media-metadata
 * and the app encodes the file again.
 *
 *   JPEG  no APP1 (Exif, XMP), APP13 (IPTC) or COM segment; APP2 only as an ICC profile
 *   PNG   no eXIf, tEXt, iTXt or zTXt chunk
 *   WebP  no EXIF or "XMP " chunk
 *   GIF   no comment extension, no application extension but the looping one
 *   MP4   no udta, meta or uuid box left anywhere the scrub looks (it renames them to free)
 *   WAV   RIFF/WAVE with fmt and data only, at most the sound length the server allows
 *   WebM  refused outright: the device does not scrub it yet */
import fs from 'node:fs';
import { LibraryError } from './clean.js';

const meta = what => new LibraryError(422, 'media-metadata', `that file still carries ${what}; the app cleans it before sharing`);
const ascii = (b, off, len) => (b.length >= off + len ? b.toString('latin1', off, off + len) : '');

export function jpegClean(b) {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return true;
    const mk = b[i + 1];
    if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0x01) { i += 2; continue; }
    if (mk === 0xda || mk === 0xd9) return true;
    if (mk === 0xe1 || mk === 0xed || mk === 0xfe) return false;
    if (mk === 0xe2 && ascii(b, i + 4, 11) !== 'ICC_PROFILE') return false;
    i += 2 + b.readUInt16BE(i + 2);
  }
  return true;
}
export function pngClean(b) {
  let i = 8;
  while (i + 8 <= b.length) {
    const len = b.readUInt32BE(i);
    const id = ascii(b, i + 4, 4);
    if (id === 'eXIf' || id === 'tEXt' || id === 'iTXt' || id === 'zTXt') return false;
    if (id === 'IEND') return true;
    i += 12 + len;
  }
  return true;
}
export function webpClean(b) {
  let i = 12;
  while (i + 8 <= b.length) {
    const id = ascii(b, i, 4);
    if (id === 'EXIF' || id === 'XMP ') return false;
    const len = b.readUInt32LE(i + 4);
    i += 8 + len + (len & 1);
  }
  return true;
}
// Walks the GIF block structure: header, logical screen, colour tables, then images and extensions.
export function gifClean(b) {
  if (b.length < 13) return false;
  let i = 13;
  const flags = b[10];
  if (flags & 0x80) i += 3 * (2 << (flags & 7));
  const subBlocks = () => { while (i < b.length) { const n = b[i++]; if (!n) return; i += n; } };
  while (i < b.length) {
    const tag = b[i++];
    if (tag === 0x3b) return true;
    if (tag === 0x21) {
      const label = b[i++];
      if (label === 0xfe) return false;                  // comment
      if (label === 0xff) {                              // application: only NETSCAPE/ANIMEXTS looping
        const id = ascii(b, i + 1, 11);
        if (id !== 'NETSCAPE2.0' && id !== 'ANIMEXTS1.0') return false;
      }
      subBlocks();
    } else if (tag === 0x2c) {
      if (i + 9 > b.length) return false;
      const lf = b[i + 8];
      i += 9;
      if (lf & 0x80) i += 3 * (2 << (lf & 7));
      i += 1;                                            // LZW minimum code size
      subBlocks();
    } else return false;
  }
  return true;
}

/** { ok, sec } for a WAV: only fmt and data chunks, plain PCM, its length from the header. */
export function wavInfo(b) {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') return { ok: false };
  let i = 12, byteRate = 0, dataLen = -1;
  while (i + 8 <= b.length) {
    const id = ascii(b, i, 4);
    const len = b.readUInt32LE(i + 4);
    if (id === 'fmt ') { if (b.readUInt16LE(i + 8) !== 1) return { ok: false }; byteRate = b.readUInt32LE(i + 16); }
    else if (id === 'data') dataLen = Math.min(len, b.length - i - 8);
    else return { ok: false, chunk: id };
    i += 8 + len + (len & 1);
  }
  if (!byteRate || dataLen < 0) return { ok: false };
  return { ok: true, sec: dataLen / byteRate };
}

// MP4/MOV: positioned reads over the box headers, so a 25 MB video is never loaded whole.
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex', 'moof', 'traf']);
const METADATA = new Set(['udta', 'meta', 'uuid']);
export function mp4Clean(fd, size) {
  let boxes = 0;
  const head = Buffer.alloc(16);
  const walk = (pos, end, depth) => {
    while (pos + 8 <= end) {
      if (++boxes > 20000 || depth > 12) return false;
      if (fs.readSync(fd, head, 0, 16, pos) < 8) return false;
      let len = head.readUInt32BE(0), hl = 8;
      if (len === 1) { len = Number(head.readBigUInt64BE(8)); hl = 16; }
      else if (len === 0) len = end - pos;
      if (len < hl || pos + len > end) return false;
      const type = head.toString('latin1', 4, 8);
      if (METADATA.has(type)) return false;
      if (CONTAINERS.has(type) && !walk(pos + hl, pos + len, depth + 1)) return false;
      pos += len;
    }
    return true;
  };
  return walk(0, size, 0);
}

/**
 * Throws a LibraryError when the stored file at `file` (sniffed as `mime`) may not be shared as is.
 * `limits`: { soundSec }.
 */
export function checkShareable(file, mime, size, limits) {
  if (mime === 'video/webm') throw new LibraryError(422, 'media-webm', 'please share this video as an MP4');
  if (mime === 'video/mp4' || mime === 'video/quicktime') {
    const fd = fs.openSync(file, 'r');
    try { if (!mp4Clean(fd, size)) throw meta('a metadata box'); } finally { fs.closeSync(fd); }
    return;
  }
  const b = fs.readFileSync(file);
  if (mime === 'image/jpeg' && !jpegClean(b)) throw meta('Exif or XMP');
  if (mime === 'image/png' && !pngClean(b)) throw meta('text or Exif chunks');
  if (mime === 'image/webp' && !webpClean(b)) throw meta('Exif or XMP');
  if (mime === 'image/gif' && !gifClean(b)) throw meta('a comment');
  if (mime === 'audio/wav') {
    const w = wavInfo(b);
    if (!w.ok) throw meta('extra chunks such as a title or an artist');
    if (w.sec > limits.soundSec + 0.5) throw new LibraryError(413, 'media-too-long', 'that sound is too long to share', { maxSec: limits.soundSec });
  }
}
