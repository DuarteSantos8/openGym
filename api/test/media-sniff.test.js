/* What the server stores is decided by the first bytes of a file and nothing else: not its name,
   not the Content-Type the client declared. Seven types pass; SVG and HTML — the two that would
   run in the app's origin if a browser were ever talked into rendering them — and everything
   else do not. mp4Info is the one place the server looks deeper, to read a video's length off
   its headers without loading it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sniffMedia, mp4Info, MEDIA_TYPES } from '../media.js';
import * as M from './media-samples.mjs';

const head = b => b.subarray(0, 64);
const kindOf = b => sniffMedia(head(b));

test('each of the seven stored types is recognised from its magic bytes', () => {
  const cases = [
    [M.jpeg(), 'image/jpeg', 'image', 'still', 'jpg'],
    [M.png(), 'image/png', 'image', 'still', 'png'],
    [M.webp(), 'image/webp', 'image', 'still', 'webp'],
    [M.gif(), 'image/gif', 'gif', 'still', 'gif'],
    [M.gif(1000, '87a'), 'image/gif', 'gif', 'still', 'gif'],
    [M.mp4(), 'video/mp4', 'video', 'video', 'mp4'],
    [M.mp4({ brand: 'qt  ' }), 'video/quicktime', 'video', 'video', 'mov'],
    [M.ebml('webm'), 'video/webm', 'video', 'video', 'webm']
  ];
  for (const [bytes, mime, kind, category, ext] of cases) {
    assert.deepEqual(kindOf(bytes), { mime, kind, category, ext }, mime);
  }
  assert.equal(Object.keys(MEDIA_TYPES).length, 7);
});

test('every MP4 brand on the list is a video, and a brand nobody vouched for is not', () => {
  for (const brand of ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VP', 'dash', 'mmp4', 'MSNV', '3gp4', '3gp5', '3gp6', '3g2a']) {
    assert.equal(kindOf(M.mp4({ brand }))?.mime, 'video/mp4', brand);
  }
  for (const brand of ['abcd', 'iso9', 'mp71', 'crx ']) assert.equal(kindOf(M.mp4({ brand })), null, brand);
});

test('HEIC and AVIF stills are refused — the app re-encodes them, it never uploads them', () => {
  for (const brand of ['heic', 'heix', 'heim', 'heis', 'hevc', 'mif1', 'msf1', 'avif', 'avis']) {
    assert.equal(kindOf(M.mp4({ brand })), null, brand);
  }
});

test('SVG, HTML, PDF, ZIP, M4A audio and Matroska are refused', () => {
  assert.equal(kindOf(M.svg()), null, 'svg');
  assert.equal(kindOf(M.html()), null, 'html');
  assert.equal(kindOf(M.pdf()), null, 'pdf');
  assert.equal(kindOf(M.zip()), null, 'zip');
  assert.equal(kindOf(M.mp4({ brand: 'M4A ' })), null, 'm4a');
  assert.equal(kindOf(M.ebml('matroska')), null, 'matroska');
  assert.equal(kindOf(Buffer.from('BM' + 'x'.repeat(60))), null, 'bmp');
  assert.equal(kindOf(Buffer.from([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4])), null, 'tiff');
  assert.equal(kindOf(Buffer.from([0, 0, 1, 0, 1, 0])), null, 'ico');
  assert.equal(kindOf(Buffer.alloc(0)), null, 'empty');
  assert.equal(kindOf(Buffer.from([0xff, 0xd8])), null, 'truncated jpeg');
});

/* ---------------- mp4Info ---------------- */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-sniff-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
function info(bytes) {
  const f = path.join(dir, `f${n++}.mp4`);
  fs.writeFileSync(f, bytes);
  const fd = fs.openSync(f, 'r');
  try { return mp4Info(fd, bytes.length); } finally { fs.closeSync(fd); }
}

test('mp4Info reads the length from mvhd, version 0 and version 1', () => {
  assert.deepEqual(info(M.mp4({ seconds: 12.5 })), { brand: 'isom', durationSec: 12.5 });
  assert.deepEqual(info(M.mp4({ version: 1, seconds: 42, timescale: 90000 })), { brand: 'isom', durationSec: 42 });
  assert.deepEqual(info(M.mp4({ brand: 'qt  ', seconds: 61, timescale: 600 })), { brand: 'qt  ', durationSec: 61 });
});

test('mp4Info finds a moov that sits after the media data, even behind a 64-bit mdat', () => {
  assert.equal(info(M.mp4({ moovAtEnd: true, seconds: 30, mdatBytes: 200000 })).durationSec, 30);
  assert.equal(info(M.mp4({ moovAtEnd: true, seconds: 7, bigMdat: true })).durationSec, 7);
});

test('a fragmented file with no length in mvhd is read from mehd, and one with neither is unknown', () => {
  const frag = M.mp4({ seconds: 0, extraMoov: [M.box('mvex', M.mehd(95000))] });
  assert.equal(info(frag).durationSec, 95);
  assert.equal(info(M.mp4({ seconds: 0 })).durationSec, null);
});

test('mp4Info refuses what is not a well-formed file', () => {
  const noMoov = Buffer.concat([M.ftyp(), M.box('mdat', Buffer.alloc(100))]);
  assert.equal(info(noMoov), null, 'no moov');
  const noMvhd = Buffer.concat([M.ftyp(), M.box('moov', M.box('trak', Buffer.alloc(20)))]);
  assert.equal(info(noMvhd), null, 'no mvhd');
  assert.equal(info(M.mp4({ timescale: 0 })), null, 'zero timescale');
  assert.equal(info(Buffer.concat([M.box('free', Buffer.alloc(8)), M.mp4()])), null, 'ftyp not first');
  // A moov over 8 MB: no real clip has one, and walking it is what an attacker would want.
  assert.equal(info(M.mp4({ moovPad: 8 * 1024 * 1024 + 10 })), null, 'moov > 8 MB');
  // A box that claims more bytes than its parent has.
  const lying = M.mp4();
  lying.writeUInt32BE(lying.length * 2, M.ftyp().length);
  assert.equal(info(lying), null, 'box overruns the file');
  // A size smaller than its own header.
  const tiny = M.mp4();
  tiny.writeUInt32BE(4, M.ftyp().length);
  assert.equal(info(tiny), null, 'box smaller than its header');
});

test('mp4Info gives up after 10k boxes instead of walking forever', () => {
  const many = Buffer.concat([M.ftyp(), ...Array.from({ length: 10050 }, () => M.box('free')), M.box('moov', M.mvhd())]);
  assert.equal(info(many), null);
});
