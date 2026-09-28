/* Tiny synthetic media files for the media tests: just enough structure for the magic bytes and
   the MP4 box walk, built in code so the repo carries no binary fixtures and every test states
   exactly which bytes it feeds in. Not a *.test.js file, so `npm test` does not run it. */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

export const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const pad = n => crypto.randomBytes(Math.max(0, n));

export const jpeg = (n = 1000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad(n - 4)]);
export const png = (n = 1000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad(n - 8)]);
export const gif = (n = 1000, v = '89a') => Buffer.concat([Buffer.from('GIF' + v, 'latin1'), pad(n - 6)]);
export function webp(n = 1000) {
  const b = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1'), pad(n - 16)]);
  b.writeUInt32LE(b.length - 8, 4);
  return b;
}
export const svg = () => Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
export const html = () => Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
export const pdf = () => Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj\n', 'latin1');
export const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), pad(100)]);

/* ---- EBML (WebM / Matroska) ---- */
export function ebml(docType = 'webm', n = 400) {
  const el = (id, body) => Buffer.concat([Buffer.from(id), Buffer.from([0x80 | body.length]), body]);
  const kids = Buffer.concat([
    el([0x42, 0x86], Buffer.from([1])), el([0x42, 0xf7], Buffer.from([1])),
    el([0x42, 0xf2], Buffer.from([4])), el([0x42, 0xf3], Buffer.from([8])),
    el([0x42, 0x82], Buffer.from(docType, 'latin1')),
    el([0x42, 0x87], Buffer.from([4])), el([0x42, 0x85], Buffer.from([2]))
  ]);
  const head = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | kids.length]), kids]);
  return Buffer.concat([head, pad(n - head.length)]);
}

/* ---- ISO-BMFF (MP4 / MOV / HEIC / M4A) ---- */
export function box(type, ...parts) {
  const body = Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + body.length, 0);
  h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
// size = 1 and a 64-bit size after the type, which is how a camera writes an mdat over 4 GB.
export function box64(type, body) {
  const h = Buffer.alloc(16);
  h.writeUInt32BE(1, 0);
  h.write(type, 4, 'latin1');
  h.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([h, body]);
}
export const ftyp = (brand = 'isom', compat = ['isom', 'mp41']) =>
  box('ftyp', Buffer.from(brand, 'latin1'), Buffer.alloc(4), Buffer.from(compat.join(''), 'latin1'));

export function mvhd({ version = 0, timescale = 1000, duration = 5000 } = {}) {
  if (version === 1) {
    const b = Buffer.alloc(112);
    b[0] = 1;
    b.writeUInt32BE(timescale, 20);
    b.writeBigUInt64BE(BigInt(duration), 24);
    return box('mvhd', b);
  }
  const b = Buffer.alloc(100);
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration >>> 0, 16);
  return box('mvhd', b);
}
export function mehd(duration) {
  const b = Buffer.alloc(8);
  b.writeUInt32BE(duration, 4);
  return box('mehd', b);
}

/**
 * A structurally valid MP4/MOV: ftyp, then moov (mvhd + an empty trak) and mdat in either order.
 * `seconds` is written as mvhd's duration at `timescale`; `moovPad` inflates moov with a `free`
 * box, `mdatBytes` sizes the media data.
 */
export function mp4({ brand = 'isom', seconds = 5, timescale = 1000, version = 0, moovAtEnd = false, mdatBytes = 2000, moovPad = 0, extraMoov = [], bigMdat = false } = {}) {
  const moov = box('moov', mvhd({ version, timescale, duration: Math.round(seconds * timescale) }),
    box('trak', box('tkhd', Buffer.alloc(84))), ...extraMoov, ...(moovPad ? [box('free', Buffer.alloc(moovPad))] : []));
  const mdat = bigMdat ? box64('mdat', pad(mdatBytes)) : box('mdat', pad(mdatBytes));
  return Buffer.concat(moovAtEnd ? [ftyp(brand), mdat, moov] : [ftyp(brand), moov, mdat]);
}

/* ---- a request stand-in for receive() ---- */
/**
 * What receive() reads off a request: `headers` and a byte stream. `bytes` is sent in `chunk`
 * pieces; `declare` is the Content-Type, `length` the Content-Length (true = the real length,
 * a number = that claim, null = none, as with chunked encoding).
 */
export function fakeReq(bytes, { declare = 'image/jpeg', length = true, chunk = 64 * 1024 } = {}) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += chunk) parts.push(bytes.subarray(i, i + chunk));
  const req = Readable.from(parts, { objectMode: false });
  req.headers = { 'content-type': declare };
  if (length !== null) req.headers['content-length'] = String(length === true ? bytes.length : length);
  return req;
}
