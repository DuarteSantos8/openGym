/* The library's pure parts: the payload cleaners, the container metadata checks, the store's
   blocklist (the built-in catalogue by hash), its GC, auto-hide, and the config switches. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanPayload, cleanText, cleanUrl, refsOf, LibraryError } from '../library/clean.js';
import { jpegClean, pngClean, webpClean, gifClean, wavInfo, mp4Clean } from '../library/metadata.js';
import { createLibraryStore, loadCatalogueHashes, newItemId, ITEM_ID_RE } from '../library/store.js';
import { libraryConfig } from '../library/config.js';
import { autoHide } from '../library/moderation.js';
import * as M from './media-samples.mjs';

const h = n => crypto.createHash('sha256').update(String(n)).digest('hex');

test('config: off unless LIBRARY=on, SHARING=off wins, personal media need their own switch', () => {
  assert.equal(libraryConfig({}).on, false);
  assert.equal(libraryConfig({ LIBRARY: 'on' }).on, true);
  assert.equal(libraryConfig({ LIBRARY: 'on', SHARING: 'off' }).on, false);
  assert.ok(!libraryConfig({ LIBRARY: 'on' }).types.includes('photo'));
  assert.ok(!libraryConfig({ LIBRARY: 'on', SHARE_TYPES: 'sound,photo' }).types.includes('photo'));
  assert.deepEqual(libraryConfig({ LIBRARY: 'on', SHARE_TYPES: 'sound,tip' }).types, ['sound', 'tip']);
  assert.ok(libraryConfig({ LIBRARY: 'on', SHARE_PERSONAL_MEDIA: 'on' }).types.includes('progress'));
  assert.equal(libraryConfig({ SHARE_VIDEO_MAX_MB: 'oops' }).videoMB, 25);
  assert.equal(libraryConfig({ SHARE_REVIEW: 'on' }).review, true);
});

test('texts: control and bidi characters out, lengths capped, links http(s) only', () => {
  assert.equal(cleanText('Gong‮ gnoG\u0007', 60), 'Gong gnoG');
  assert.equal(cleanText('x'.repeat(100), 60).length, 60);
  assert.equal(cleanUrl('javascript:alert(1)'), '');
  assert.equal(cleanUrl('https://user:pw@example.com/x'), '');
  assert.equal(cleanUrl('https://example.com/x'), 'https://example.com/x');
});

test('payloads: per type, no catalogue ids, refs collected, prototype keys gone', () => {
  const m = { kind: 'image', hash: h(1), mime: 'image/webp', size: 10, width: 2, height: 2, poster: { hash: h(2), mime: 'image/webp', size: 5, width: 2, height: 2 } };
  const ex = cleanPayload('exercise', { ex: { n: 'Walk', id: '0001', _ts: 3, shared: { id: 's' }, sm: ['glutes', 4] }, media: m });
  assert.equal(ex.ex.id, undefined);
  assert.equal(ex.ex._ts, undefined);
  assert.deepEqual(ex.ex.sm, ['glutes', 4]);
  assert.deepEqual(refsOf(ex), [h(1), h(2)]);
  assert.throws(() => cleanPayload('sound', { name: 'x' }), LibraryError);
  assert.throws(() => cleanPayload('nope', {}), e => e.code === 'type-off');
  const plan = cleanPayload('plan', JSON.parse('{"bundle":{"routines":[{"name":"A","__proto__":{"x":1}}]}}'));
  assert.equal(Object.getPrototypeOf(plan.bundle.routines[0]), Object.prototype);
  assert.equal(plan.bundle.routines[0].x, undefined);
  assert.throws(() => cleanPayload('equipment', { profile: { m } }), LibraryError, 'a gym profile carries no files');
  assert.deepEqual(cleanPayload('look', { flame: { v: '🔥', c: '#FF0000' }, freeze: { v: '<img>' } }), { flame: { v: '🔥', c: '#ff0000' } });
  assert.equal(cleanPayload('measures', { fields: Array.from({ length: 30 }, (_, i) => ({ name: 'F' + i, unit: 'cm' })) }).fields.length, 20);
});

test('metadata: Exif, XMP, text chunks, GIF comments, WAV tags and MP4 boxes are found', () => {
  const jfif = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
  const exif = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0, 0xff, 0xda]);
  assert.equal(jpegClean(jfif), true);
  assert.equal(jpegClean(exif), false);
  const chunk = (id, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(id, 4, 'latin1'); data.copy(b, 8); return b; };
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(pngClean(Buffer.concat([pngSig, chunk('IHDR', Buffer.alloc(13)), chunk('IEND', Buffer.alloc(0))])), true);
  assert.equal(pngClean(Buffer.concat([pngSig, chunk('tEXt', Buffer.from('Author\0me')), chunk('IEND', Buffer.alloc(0))])), false);
  const riff = (...cs) => { const body = Buffer.concat(cs); const b = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), body]); b.writeUInt32LE(b.length - 8, 4); return b; };
  const wc = (id, n) => { const b = Buffer.alloc(8 + n); b.write(id, 0, 'latin1'); b.writeUInt32LE(n, 4); return b; };
  assert.equal(webpClean(riff(wc('VP8 ', 10))), true);
  assert.equal(webpClean(riff(wc('VP8X', 10), wc('EXIF', 4), wc('VP8 ', 10))), false);
  const gifHead = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0, 0, 0])]);
  const img = Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 0]);
  assert.equal(gifClean(Buffer.concat([gifHead, img, Buffer.from([0x3b])])), true);
  assert.equal(gifClean(Buffer.concat([gifHead, Buffer.from([0x21, 0xfe, 3, 0x61, 0x62, 0x63, 0]), img, Buffer.from([0x3b])])), false);
  assert.equal(wavInfo(M.wav(22050)).ok, true);
  assert.ok(Math.abs(wavInfo(M.wav(22050)).sec - 1) < 0.01);
  const tagged = Buffer.concat([M.wav(100), Buffer.from('LIST\x04\0\0\0INFO', 'latin1')]);
  assert.equal(wavInfo(tagged).ok, false);
  // MP4: a clean one, and one with a udta box under moov.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-mp4-'));
  const check = bytes => { const f = path.join(dir, 'x.mp4'); fs.writeFileSync(f, bytes); const fd = fs.openSync(f, 'r'); try { return mp4Clean(fd, bytes.length); } finally { fs.closeSync(fd); } };
  assert.equal(check(M.mp4()), true);
  assert.equal(check(M.mp4({ extraMoov: [M.box('udta', Buffer.from('©xyz+47.3+008.5/'))] })), false);
  assert.equal(check(M.mp4({ extraMoov: [M.box('free', Buffer.alloc(16))] })), true, 'what scrubMp4 leaves behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store: ids, catalogue hashes blocked, blocklist kept, files and GC', () => {
  for (let i = 0; i < 20; i++) assert.match(newItemId(), ITEM_ID_RE);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-store-'));
  let now = 1e12;
  const s = createLibraryStore({ dir, catalogue: new Set([h('cat')]), now: () => now });
  assert.equal(s.blocked(h('cat')), true);
  assert.equal(s.fromCatalogue(h('cat')), true);
  assert.equal(s.blocked(h('mine')), false);
  s.blockHashes([h('mine')], 'removed');
  assert.equal(createLibraryStore({ dir, catalogue: new Set() }).blocked(h('mine')), true, 'the blocklist is on disk');
  const src = path.join(dir, 'src.wav');
  fs.writeFileSync(src, M.wav(10));
  s.put(h('a'), src, 'wav');
  assert.ok(s.file(h('a')));
  s.add({ id: 's_a', owner: 'u1', status: 'withdrawn', media: [h('a')], updatedAt: now });
  assert.equal(s.sweep({ graceDays: 14 }).removed, 0, 'withdrawn within the grace');
  now += 15 * 86400000;
  assert.equal(s.sweep({ graceDays: 14 }).removed, 1);
  assert.equal(s.file(h('a')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the real catalogue list blocks every built-in media file (by hash, nothing decoded)', () => {
  const set = loadCatalogueHashes();
  assert.ok(set.size > 10000, `only ${set.size} catalogue hashes: run node scripts/catalogue/media-hashes.mjs`);
  const media = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'catalogue', 'media');
  // A handful of files, read as bytes for the checksum only.
  const sample = [];
  for (const sub of ['still', 'clip']) {
    let names = [];
    try { names = fs.readdirSync(path.join(media, sub)).slice(0, 3); } catch { /* an image without the catalogue */ }
    for (const n of names) sample.push(path.join(media, sub, n));
  }
  for (const f of sample) assert.ok(set.has(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')), f);
});

test('auto-hide: three different people, or one licence report; reports before an approval do not count', () => {
  const cfg = { autohide: 3 };
  const it = { status: 'live', reports: [{ by: 'a', reason: 'spam', at: 1 }, { by: 'b', reason: 'spam', at: 2 }] };
  assert.equal(autoHide(it, cfg), false);
  it.reports.push({ by: 'c', reason: 'other', at: 3 });
  assert.equal(autoHide(it, cfg), true);
  assert.equal(it.status, 'pending');
  const ok = { status: 'live', mod: { action: 'approve', at: 10 }, reports: [{ by: 'a', at: 1 }, { by: 'b', at: 2 }, { by: 'c', at: 3 }, { by: 'd', reason: 'spam', at: 11 }] };
  assert.equal(autoHide(ok, cfg), false);
  const lic = { status: 'live', reports: [{ by: 'a', reason: 'licensed', at: 1 }] };
  assert.equal(autoHide(lic, cfg), true);
});
