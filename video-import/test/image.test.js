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

test('digitsOnly: the dashes of a progress ring go, the digit stays', async () => {
  const { digitsOnly } = await import('../src/image.js')
  const w = 20, h = 20, px = new Uint8Array(w * h).fill(255)
  for (let y = 4; y < 16; y++) { px[y * w + 9] = 0; px[y * w + 10] = 0 }   // a "1" in the middle, 12 px tall
  px[0 * w + 5] = 0; px[0 * w + 6] = 0                                     // a dash on the top edge
  px[18 * w + 2] = 0                                                         // a tick near the bottom
  const out = digitsOnly(px, w, h)
  assert.equal(out[10 * w + 9], 0, 'the digit is kept')
  assert.equal(out[0 * w + 5], 255, 'the edge dash is gone')
  assert.equal(out[18 * w + 2], 255, 'the small tick is gone')
  const tight = new Uint8Array(w * h).fill(255)
  for (let y = 0; y < h; y++) tight[y * w + 9] = 0                          // a digit touching both edges
  assert.equal(digitsOnly(tight, w, h), tight, 'nothing digit-sized left: the crop stays as it was')
})

test('timerMask: white digits on a light wall survive, the ring round them does not', async () => {
  const { timerMask } = await import('../src/image.js')
  const w = 60, h = 60, g = new Uint8Array(w * h).fill(200)                 // a light wall
  const put = (x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * w + x] = v }
  put(15, 18, 26, 42, 252); put(32, 18, 43, 42, 252)                         // two white digits,
  put(18, 22, 23, 38, 200); put(35, 22, 40, 38, 200)                         // drawn as strokes, not blocks
  for (let y = 4; y < 56; y++) { g[y * w + 4] = 250; g[y * w + 55] = 250 }  // the ring's sides, taller than any digit
  const m = timerMask(g, w, h)
  assert.ok(m)
  assert.equal(m[30 * w + 16], 0, 'a digit is ink')
  assert.equal(m[30 * w + 4], 255, 'the ring is not')
  assert.equal(timerMask(new Uint8Array(w * h).fill(200), w, h), null, 'nothing on it, nothing read')
})

test('parseTimer reads "0:40" with its colon lost, and refuses what is no time', async () => {
  const { parseTimer } = await import('../src/text.js')
  assert.equal(parseTimer('040'), 40)
  assert.equal(parseTimer('130'), 90)
  assert.equal(parseTimer('271'), null)
  assert.equal(parseTimer('27'), 27)
  assert.equal(parseTimer('1:05'), 65)
})
