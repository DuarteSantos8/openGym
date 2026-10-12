import { test } from 'node:test'
import assert from 'node:assert/strict'
import { otsu, binarize, pgm, blank } from '../src/image.js'

// A 20×10 crop: a dark band with a bright 6×4 "letter" in it.
function crop(bg, fg) {
  const px = new Uint8Array(200).fill(bg)
  for (let y = 3; y < 7; y++) for (let x = 7; x < 13; x++) px[y * 20 + x] = fg
  return px
}

test('bright text on a dark band comes out black on white', () => {
  const b = binarize(crop(30, 230))
  assert.equal(b.px[5 * 20 + 9], 0)
  assert.equal(b.px[0], 255)
  assert.ok(!blank(b))
})

test('dark text on a light band too', () => {
  const b = binarize(crop(220, 20))
  assert.equal(b.px[5 * 20 + 9], 0)
  assert.equal(b.px[0], 255)
})

test('a flat crop is blank', () => {
  assert.ok(blank(binarize(new Uint8Array(200).fill(128))))
  assert.ok(blank(binarize(crop(120, 135))), 'too little contrast to be a caption')
})

test('otsu splits two clusters', () => {
  const t = otsu(Uint8Array.from([10, 12, 11, 200, 210, 205]))
  assert.ok(t >= 12 && t < 200)
})

test('pgm header', () => {
  const buf = pgm(new Uint8Array([0, 255, 0, 255]), 2, 2)
  assert.equal(buf.subarray(0, 11).toString('ascii'), 'P5\n2 2\n255\n')
  assert.equal(buf.length, 15)
})

test('difference: the share of pixels two crops disagree on', async () => {
  const { difference } = await import('../src/image.js')
  const a = new Uint8Array(100).fill(255), b = a.slice()
  b[0] = 0; b[1] = 0
  assert.equal(difference(a, b), 0.02)
  assert.equal(difference(a, a), 0)
  assert.equal(difference(a, new Uint8Array(5)), 1)
})
