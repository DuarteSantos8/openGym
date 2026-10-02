/* receive(): one upload from the first byte to the rename. In-process, so the memory it holds
   and the state it leaves behind on every way out can be looked at directly. The production API
   runs with a 128 MB memory limit and a video may be 40 MB: the bytes must stream to disk, never
   collect in memory. And whatever ends an upload — success, refusal, a client hanging up, a
   stall — the temp file goes, and the in-flight slot and the quota reservation come back. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { createMediaStore, mediaLimits, MediaError } from '../media.js';
import * as M from './media-samples.mjs';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const quiet = { warn() {}, error() {}, log() {} };

function setup(t, limits = {}, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-recv-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'uploads');
  const store = createMediaStore({ dir, limits: { ...mediaLimits({}), minFreeMB: 0, ...limits }, log: quiet, ...opts });
  const tmpFiles = uid => { try { return fs.readdirSync(path.join(dir, uid, '.tmp')); } catch { return []; } };
  const files = uid => { try { return fs.readdirSync(path.join(dir, uid)).filter(n => !n.startsWith('.')); } catch { return []; } };
  return { dir, store, tmpFiles, files };
}
const isMediaError = (status, code) => e => e instanceof MediaError && e.status === status && e.code === code;

test('a 30 MB upload streams through with a flat memory profile', async t => {
  const h = setup(t);
  // A real MP4 head so the whole path runs, sniff and box walk included; the rest is fresh
  // 64 KB buffers, each its own ArrayBuffer, so a receiver that kept them would show.
  const headPart = M.mp4({ seconds: 20, mdatBytes: 0 });
  const TOTAL = 30 * 1024 * 1024, CHUNK = 64 * 1024;
  const bodyLen = TOTAL - headPart.length;
  // mdat's size field has to cover what follows it for mp4Info to accept the file.
  headPart.writeUInt32BE(8 + bodyLen, headPart.length - 8);
  const crypto = await import('node:crypto');
  const hasher = crypto.createHash('sha256').update(headPart);
  const lenAt = i => Math.min(CHUNK, bodyLen - i * CHUNK);
  const fillOf = i => (i * 7) & 0xff;
  const chunkAt = i => Buffer.allocUnsafeSlow(lenAt(i)).fill(fillOf(i));
  const nChunks = Math.ceil(bodyLen / CHUNK);
  // Hashed through one scratch buffer: 30 MB of garbage made here would still be waiting for
  // the collector when the baseline is taken, and its release would then hide real growth.
  const scratch = Buffer.alloc(CHUNK);
  for (let i = 0; i < nChunks; i++) hasher.update(scratch.fill(fillOf(i)).subarray(0, lenAt(i)));
  const hash = hasher.digest('hex');

  // ArrayBuffer backing stores are released by a task after the collection, not inside it.
  const settle = async () => { gc(); await new Promise(r => setImmediate(r)); gc(); };
  await settle();
  const base = process.memoryUsage().arrayBuffers;
  let peak = 0;
  async function* body() {
    yield headPart;
    for (let i = 0; i < nChunks; i++) {
      if (i % 32 === 0) { gc(); peak = Math.max(peak, process.memoryUsage().arrayBuffers - base); }
      yield chunkAt(i);
    }
  }
  const req = Readable.from(body(), { objectMode: false });
  req.headers = { 'content-type': 'video/mp4', 'content-length': String(TOTAL) };
  const r = await h.store.receive('u1', hash, req);
  assert.equal(r.status, 201);
  assert.equal(r.body.size, TOTAL);
  await settle();
  peak = Math.max(peak, process.memoryUsage().arrayBuffers - base);
  assert.ok(peak < 8 * 1024 * 1024, `arrayBuffers grew by ${(peak / 1048576).toFixed(1)} MB`);
  assert.equal(fs.statSync(path.join(h.dir, 'u1', `${hash}.mp4`)).size, TOTAL);
});

test('a client that hangs up mid-upload leaves no temp file and gives back its slot and reservation', async t => {
  const h = setup(t, { quotaMB: 1 });
  const bytes = M.jpeg(500000);
  let sent = 0;
  const req = new Readable({
    read() {
      if (sent >= 3) { this.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })); return; }
      this.push(bytes.subarray(sent * 65536, ++sent * 65536));
    }
  });
  req.headers = { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) };
  await assert.rejects(h.store.receive('u1', M.sha(bytes), req), e => e.clientGone === true);
  assert.deepEqual(h.tmpFiles('u1'), []);
  assert.deepEqual(h.files('u1'), []);
  // The reservation came back: a file that needs almost the whole quota fits.
  const full = M.jpeg(1000000);
  assert.equal((await h.store.receive('u1', M.sha(full), M.fakeReq(full))).status, 201);
  // And the slot: two more at once are both taken.
  const a = M.jpeg(1000), b = M.jpeg(1000);
  const h2 = setup(t);
  const results = await Promise.all([h2.store.receive('u1', M.sha(a), M.fakeReq(a)), h2.store.receive('u1', M.sha(b), M.fakeReq(b))]);
  assert.deepEqual(results.map(r => r.status), [201, 201]);
});

test('an upload that stops sending is cut off after the idle time with 408', async t => {
  const h = setup(t, {}, { idleMs: 80 });
  const bytes = M.jpeg(200000);
  const req = new Readable({ read() {} });          // pushes one chunk, then nothing, ever
  req.push(bytes.subarray(0, 65536));
  req.headers = { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) };
  await assert.rejects(h.store.receive('u1', M.sha(bytes), req), isMediaError(408, 'timeout'));
  assert.deepEqual(h.tmpFiles('u1'), []);
});

test('an upload without a length is capped while streaming, not after', async t => {
  const h = setup(t, { imageMB: 0.1 });
  const bytes = M.jpeg(300000);
  const req = M.fakeReq(bytes, { length: null });
  await assert.rejects(h.store.receive('u1', M.sha(bytes), req), e => isMediaError(413, 'media-too-large')(e) && e.extra.maxMB === 0.1);
  assert.deepEqual(h.tmpFiles('u1'), []);
  assert.deepEqual(h.store.usage('u1'), { bytes: 0, count: 0, quotaBytes: 200 * 1048576 });
});

test('a declared length over the cap is refused before a byte is read', async t => {
  const h = setup(t, { imageMB: 0.1 });
  const bytes = M.jpeg(300000);
  await assert.rejects(h.store.receive('u1', M.sha(bytes), M.fakeReq(bytes)), isMediaError(413, 'media-too-large'));
  assert.equal(fs.existsSync(path.join(h.dir, 'u1', '.tmp')), false, 'no temp file was ever opened');
});

test('the file is stored as what it is: a JPEG declared as a GIF is a JPEG, over the image cap it is refused', async t => {
  const h = setup(t, { imageMB: 0.01, gifMB: 1 });
  const small = M.jpeg(5000);
  const r = await h.store.receive('u1', M.sha(small), M.fakeReq(small, { declare: 'image/gif' }));
  assert.deepEqual(r.body, { ok: true, hash: M.sha(small), mime: 'image/jpeg', size: 5000, existed: false });
  assert.deepEqual(h.files('u1'), [`${M.sha(small)}.jpg`]);
  const big = M.jpeg(50000);
  await assert.rejects(h.store.receive('u1', M.sha(big), M.fakeReq(big, { declare: 'image/gif' })), e => isMediaError(413, 'media-too-large')(e) && e.extra.maxMB === 0.01);
});

test('a video declared as an image, SVG declared as PNG, and an unknown type are refused', async t => {
  const h = setup(t);
  const vid = M.mp4();
  await assert.rejects(h.store.receive('u1', M.sha(vid), M.fakeReq(vid, { declare: 'image/jpeg' })), isMediaError(415, 'media-type'));
  const svg = M.svg();
  await assert.rejects(h.store.receive('u1', M.sha(svg), M.fakeReq(svg, { declare: 'image/png' })), isMediaError(415, 'media-type'));
  await assert.rejects(h.store.receive('u1', M.sha(svg), M.fakeReq(svg, { declare: 'image/svg+xml' })), isMediaError(415, 'media-type'));
  await assert.rejects(h.store.receive('u1', M.sha(svg), M.fakeReq(svg, { declare: 'text/html' })), isMediaError(415, 'media-type'));
  assert.deepEqual(h.files('u1'), []);
  assert.deepEqual(h.tmpFiles('u1'), []);
});

test('bytes that do not hash to their name are refused and leave nothing', async t => {
  const h = setup(t);
  const bytes = M.jpeg();
  await assert.rejects(h.store.receive('u1', 'f'.repeat(64), M.fakeReq(bytes)), isMediaError(400, 'hash-mismatch'));
  assert.deepEqual(h.files('u1'), []);
  assert.deepEqual(h.tmpFiles('u1'), []);
});

test('videos: too long, unreadable, and a WebM that only the byte cap applies to', async t => {
  const h = setup(t, { videoSec: 60 });
  const ok = M.mp4({ seconds: 61 });                 // one second of slack for rounding
  assert.equal((await h.store.receive('u1', M.sha(ok), M.fakeReq(ok, { declare: 'video/mp4' }))).status, 201);
  const long = M.mp4({ seconds: 62 });
  await assert.rejects(h.store.receive('u1', M.sha(long), M.fakeReq(long, { declare: 'video/mp4' })), e => isMediaError(413, 'media-too-long')(e) && e.extra.maxSec === 60);
  const broken = Buffer.concat([M.ftyp(), M.box('mdat', Buffer.alloc(100))]);
  await assert.rejects(h.store.receive('u1', M.sha(broken), M.fakeReq(broken, { declare: 'video/mp4' })), isMediaError(415, 'media-invalid'));
  const mov = M.mp4({ brand: 'qt  ', seconds: 10 });
  const r = await h.store.receive('u1', M.sha(mov), M.fakeReq(mov, { declare: 'video/mp4' }));
  assert.equal(r.body.mime, 'video/quicktime');
  const webm = M.ebml('webm', 5000);
  assert.equal((await h.store.receive('u1', M.sha(webm), M.fakeReq(webm, { declare: 'video/webm' }))).body.mime, 'video/webm');
  assert.deepEqual(h.files('u1').map(n => n.split('.')[1]).sort(), ['mov', 'mp4', 'webm']);
});

test('a file the server already has is answered as such and counted once', async t => {
  const h = setup(t);
  const bytes = M.png(4000);
  const first = await h.store.receive('u1', M.sha(bytes), M.fakeReq(bytes, { declare: 'image/png' }));
  const again = await h.store.receive('u1', M.sha(bytes), M.fakeReq(bytes, { declare: 'image/png' }));
  assert.equal(first.status, 201);
  assert.deepEqual([again.status, again.body], [200, { ok: true, hash: M.sha(bytes), mime: 'image/png', size: 4000, existed: true }]);
  assert.deepEqual(h.store.usage('u1'), { bytes: 4000, count: 1, quotaBytes: 200 * 1048576 });
  // The same bytes from two devices at once: one file, counted once.
  const both = M.jpeg(300000);
  const rs = await Promise.all([1, 2].map(() => h.store.receive('u2', M.sha(both), M.fakeReq(both, { chunk: 4096 }))));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 201]);
  assert.deepEqual(h.store.usage('u2'), { bytes: 300000, count: 1, quotaBytes: 200 * 1048576 });
  assert.deepEqual(h.tmpFiles('u2'), []);
});

test('a third upload at once is refused as busy', async t => {
  const h = setup(t);
  const stalled = () => { const r = new Readable({ read() {} }); r.headers = { 'content-type': 'image/jpeg', 'content-length': '100000' }; return r; };
  const a = stalled(), b = stalled();
  const pa = h.store.receive('u1', 'a'.repeat(64), a), pb = h.store.receive('u1', 'b'.repeat(64), b);
  const c = M.jpeg();
  await assert.rejects(h.store.receive('u1', M.sha(c), M.fakeReq(c)), e => isMediaError(429, 'busy')(e) && e.extra.retryAfter === 5 && e.headers['Retry-After'] === '5');
  // Another profile is not affected.
  assert.equal((await h.store.receive('u2', M.sha(c), M.fakeReq(c))).status, 201);
  a.destroy(new Error('aborted')); b.destroy(new Error('aborted'));
  await Promise.allSettled([pa, pb]);
  assert.equal((await h.store.receive('u1', M.sha(c), M.fakeReq(c))).status, 201, 'the slots came back');
});

test('a refused upload is drained up to twice the largest cap, then cut off', async t => {
  const h = setup(t, { imageMB: 0.001, gifMB: 0.001, videoMB: 0.01 });
  const small = M.jpeg(15000);                       // under 2 × 10 KB: read to its end
  const a = M.fakeReq(small);
  h.store.discard(a);
  await new Promise(r => a.on('end', r));
  assert.equal(a.readableEnded, true);
  const big = M.jpeg(200000);                        // far over: cut off, not read to the end
  const b = M.fakeReq(big, { chunk: 4096 });
  let seen = 0;
  b.on('data', d => { seen += d.length; });
  h.store.discard(b);
  await new Promise(r => b.on('close', r));
  assert.ok(!b.readableEnded && seen < 40000, `read ${seen} bytes`);
});

test('the disk floor refuses an upload with 507 and holds no reservation afterwards', async t => {
  const h = setup(t, { minFreeMB: 1e9 });
  const bytes = M.jpeg();
  await assert.rejects(h.store.receive('u1', M.sha(bytes), M.fakeReq(bytes)), isMediaError(507, 'storage-full'));
  assert.deepEqual(h.tmpFiles('u1'), []);
});
