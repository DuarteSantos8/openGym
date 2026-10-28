import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strips, pickNameBox, tsvWords, MIN_CAPTIONS } from '../src/auto-roi.js'

// The reading of one strip at one moment: words with the pixels of the strip image, 1408 wide, 96 high.
const word = (text, x, conf = 90, y = 30, h = 30) => ({ text, conf, x, y, w: text.length * 18, h })
const line = (text, x0 = 100) => { let x = x0; return text.split(' ').map(t => { const w = word(t, x); x += w.w + 12; return w }) }
const CAPTIONS = ['HIP THRUST', 'STEP UPS LEFT', 'WALL SIT', 'BULGARIAN SPLIT SQUAT', 'SINGLE LEG RDL', 'GLUTE BRIDGE', 'BANDED SQUATS', 'JUMP SQUATS']
const list = strips()
const opts = { width: 854, scale: 1408 / 854 }

test('the strips cover the whole frame and the last one ends at its foot', () => {
  assert.equal(list[0].y, 0)
  const last = list[list.length - 1]
  assert.ok(Math.abs(last.y + last.h - 1) < 1e-6)
  for (let i = 1; i < list.length; i++) assert.ok(list[i].y > list[i - 1].y)
})

test('the strip whose readings are many different exercise names is the name, and the box is where the words were', () => {
  const caption = list.findIndex(s => s.y >= 0.1)
  const readings = list.map(() => CAPTIONS.map(() => []))
  CAPTIONS.forEach((c, p) => { readings[caption][p] = line(c, 120) })
  const found = pickNameBox(readings, list, opts)
  assert.ok(found, 'a name box')
  assert.equal(found.strip, caption)
  assert.ok(found.captions >= MIN_CAPTIONS)
  const { box } = found
  // From the first word's start to the longest caption's end (BULGARIAN SPLIT SQUAT), with a margin.
  assert.ok(box.x < 120 / 1408 && box.x > 0)
  // The last word of BULGARIAN SPLIT SQUAT ends at 486 px of 1408.
  assert.ok(box.x + box.w >= 486 / 1408, 'wide enough for the longest name: ' + JSON.stringify(box))
  assert.ok(box.y >= list[caption].y - 0.02 && box.y + box.h <= list[caption].y + list[caption].h + 0.02)
})

test('a label that never changes, a talking head and noise are not the name', () => {
  const same = list.map(() => CAPTIONS.map(() => line('WORKOUT', 100)))
  assert.equal(pickNameBox(same, list, opts), null, 'one caption all video is a label')
  const noise = list.map(() => CAPTIONS.map((_, p) => line(['XQZV', 'KJHG', 'PLMN', 'QWRT', 'ZXCV', 'BNMQ', 'WERT', 'YUIO'][p] + ' RTYU', 100)))
  assert.equal(pickNameBox(noise, list, opts), null, 'words nothing knows are not a name')
  const none = list.map(() => CAPTIONS.map(() => []))
  assert.equal(pickNameBox(none, list, opts), null)
})

test('words the OCR is unsure of do not make a caption, and the timer\'s column is left out', () => {
  const caption = 3
  const doubtful = list.map(() => CAPTIONS.map(() => []))
  CAPTIONS.forEach((c, p) => { doubtful[caption][p] = line(c).map(w => ({ ...w, conf: 20 })) })
  assert.equal(pickNameBox(doubtful, list, opts), null)
  // A caption that shares its strip with the timer's digits: the digits' column is skipped.
  const shared = list.map(() => CAPTIONS.map(() => []))
  CAPTIONS.forEach((c, p) => { shared[caption][p] = [...line(c, 100), word('PUSH', 1200)] })
  const found = pickNameBox(shared, list, { ...opts, avoid: [{ x: 0.8, y: 0, w: 0.2, h: 1 }] })
  assert.ok(found && found.box.x + found.box.w < 0.8, JSON.stringify(found?.box))
})

test('Tesseract TSV becomes words, per image', () => {
  const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '5\t1\t1\t1\t1\t1\t10\t20\t50\t30\t91\tHIP', '5\t1\t1\t1\t1\t2\t70\t20\t90\t30\t88\tTHRUST', '5\t2\t1\t1\t1\t1\t5\t6\t40\t20\t30\tWALL', '4\t2\t1\t1\t1\t0\t0\t0\t10\t10\t-1\t'].join('\n')
  const pages = tsvWords(tsv, 2)
  assert.deepEqual(pages[0].map(w => w.text), ['HIP', 'THRUST'])
  assert.deepEqual(pages[1].map(w => [w.text, w.conf]), [['WALL', 30]])
})
