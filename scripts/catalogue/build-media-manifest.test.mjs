import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildMediaManifest, mediaDimensions } from './build-media-manifest.mjs'
import { stageMedia, checkStagedMedia } from './stage-media.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const webp = (width = 180, height = 180) => {
  const b = Buffer.alloc(30); b.write('RIFF'); b.writeUInt32LE(22, 4); b.write('WEBPVP8X', 8); b.writeUInt32LE(10, 16); b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3); return b
}
const mp4 = (width = 180, height = 180) => {
  const b = Buffer.alloc(124); b.writeUInt32BE(16, 0); b.write('ftypisom', 4); b.writeUInt32BE(108, 16); b.write('moov', 20); b.writeUInt32BE(100, 24); b.write('trak', 28); b.writeUInt32BE(92, 32); b.write('tkhd', 36); b.writeUInt32BE(width * 65536, 116); b.writeUInt32BE(height * 65536, 120); return b
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-manifest-')); roots.push(root)
  const stillDir = path.join(root, 'still'), clipDir = path.join(root, 'clip'), notice = path.join(root, 'NOTICE.md'), out = path.join(root, 'out')
  fs.mkdirSync(stillDir); fs.mkdirSync(clipDir); fs.writeFileSync(notice, 'Fixture media created for tests')
  for (const id of ['0001', '2476']) { fs.writeFileSync(path.join(stillDir, id + '.webp'), webp()); fs.writeFileSync(path.join(clipDir, id + '.mp4'), mp4()) }
  return { root, stillDir, clipDir, notice, out, catalogue: [{ id: '0001', femaleVariant: '2476' }, { id: '2476', variantOf: '0001' }] }
}

test('reads real dimensions from WebP/MP4, rejects wrong types and malformed boxes', () => {
  assert.deepEqual(mediaDimensions(webp(240, 180), 'webp'), { width: 240, height: 180 })
  assert.deepEqual(mediaDimensions(mp4(240, 180), 'mp4'), { width: 240, height: 180 })
  assert.equal(mediaDimensions(Buffer.from('<html>not a video</html>'), 'mp4'), null)
  assert.equal(mediaDimensions(mp4().subarray(0, 100), 'mp4'), null)
  assert.equal(mediaDimensions(webp().subarray(0, 28), 'webp'), null)
})

test('deterministic identities, leading zero IDs, actual bytes and content hashes', () => {
  const f = fixture(), a = buildMediaManifest(f), b = buildMediaManifest({ ...f, catalogue: [...f.catalogue].reverse() })
  assert.deepEqual(a, b); assert.equal(a.assets.length, 4)
  assert.equal(a.assets[0].drawingId, '0001'); assert.equal(a.assets[0].bytes, 124)
  assert.equal(a.assets[0].remotePath, 'objects/' + a.assets[0].sha256 + '.mp4')
  fs.writeFileSync(path.join(f.clipDir, '0001.mp4'), mp4(179))
  assert.notEqual(buildMediaManifest(f).mediaRevision, a.mediaRevision)
})

test('coverage includes every figure variant and rejects absent or unknown drawings', () => {
  const f = fixture(); fs.unlinkSync(path.join(f.clipDir, '2476.mp4'))
  assert.throws(() => buildMediaManifest(f), /missing clip drawing: 2476/)
  fs.writeFileSync(path.join(f.clipDir, '2476.mp4'), mp4()); fs.writeFileSync(path.join(f.stillDir, '9999.webp'), webp())
  assert.throws(() => buildMediaManifest(f), /unexpected still file/)
})

test('slim requires an HTTPS source and deterministic media revision survives mode change', () => {
  const f = fixture(), full = buildMediaManifest(f)
  assert.throws(() => buildMediaManifest({ ...f, mode: 'slim' }), /approved HTTPS/)
  for (const baseUrl of ['http://media.example/', 'https://u:p@media.example/', 'https://media.example/?key=x'])
    assert.throws(() => buildMediaManifest({ ...f, mode: 'slim', baseUrl }), /HTTPS/)
  const slim = buildMediaManifest({ ...f, mode: 'slim', baseUrl: 'https://media.example/approved' })
  assert.equal(slim.mediaRevision, full.mediaRevision)
  assert.equal(slim.baseUrl, 'https://media.example/approved/')
  assert.ok(slim.assets.filter(a => a.kind === 'clip').every(a => a.bundledPath === null))
})

test('full then slim staging removes residual clips and retains complete stills/NOTICE', () => {
  const f = fixture(); stageMedia(f)
  assert.equal(fs.readdirSync(path.join(f.out, 'exercise-media/clip')).length, 2)
  stageMedia({ ...f, mode: 'slim', baseUrl: 'https://media.example/' })
  assert.equal(fs.existsSync(path.join(f.out, 'exercise-media/clip')), false)
  assert.equal(fs.readdirSync(path.join(f.out, 'exercise-media/still')).length, 2)
  assert.deepEqual(checkStagedMedia(f.out), [])
  fs.mkdirSync(path.join(f.out, 'exercise-media/clip')); fs.writeFileSync(path.join(f.out, 'exercise-media/clip/0001.mp4'), mp4())
  assert.match(checkStagedMedia(f.out).join(), /unexpected staged media/)
})

test('staging refuses a target overlapping source without changing source bytes', () => {
  const f = fixture(), original = fs.readFileSync(path.join(f.clipDir, '0001.mp4'))
  fs.mkdirSync(path.join(f.root, 'exercise-media'))
  const clipDir = path.join(f.root, 'exercise-media/clip'); fs.renameSync(f.clipDir, clipDir)
  assert.throws(() => stageMedia({ ...f, out: f.root, clipDir }), /overlaps/)
  assert.deepEqual(fs.readFileSync(path.join(clipDir, '0001.mp4')), original)
})

test('duplicate catalogue drawing IDs are rejected', () => {
  const f = fixture()
  assert.throws(() => buildMediaManifest({ ...f, catalogue: [...f.catalogue, f.catalogue[0]] }), /duplicate catalogue/)
})

test('staged file tampering is detected against manifest bytes/hash', () => {
  const f = fixture(); stageMedia(f); fs.writeFileSync(path.join(f.out, 'exercise-media/still/0001.webp'), webp(179))
  assert.match(checkStagedMedia(f.out).join(), /bundled media mismatch/)
})
