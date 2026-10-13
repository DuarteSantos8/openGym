import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tsvLines, suggestRois, cleanBox, padBox } from '../src/roi-suggest.js'

const HEAD = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
const word = (block, line, n, x, y, w, h, conf, text) => `5\t1\t${block}\t1\t${line}\t${n}\t${x}\t${y}\t${w}\t${h}\t${conf}\t${text}`
const tsv = rows => [HEAD, ...rows].join('\n')

test('words on one line become one line box', () => {
  const lines = tsvLines(tsv([word(1, 1, 1, 100, 50, 80, 30, 90, 'JUMP'), word(1, 1, 2, 190, 52, 100, 30, 80, 'SQUATS'), '4\t1\t1\t1\t1\t0\t100\t50\t190\t32\t-1\t']))
  assert.equal(lines.length, 1)
  assert.deepEqual(lines[0], { text: 'JUMP SQUATS', conf: 85, x: 100, y: 50, w: 190, h: 32 })
})

test('the changing words are the name, the changing clock is the timer, the fixed logo is neither', () => {
  const frame = (name, clock) => ({
    width: 640, height: 360,
    tsv: tsv([
      word(1, 1, 1, 40, 280, 200, 36, 92, name),            // bottom-left caption
      word(2, 1, 1, 540, 20, 70, 40, 88, clock),             // top-right timer
      word(3, 1, 1, 20, 20, 120, 20, 95, 'FITCHANNEL')       // a logo: never changes
    ])
  })
  const s = suggestRois([frame('BURPEES', '0:35'), frame('PLANK', '0:12'), frame('SQUATS', '0:40'), frame('BURPEES', '0:05')])
  assert.ok(s.name && s.timer)
  assert.ok(s.name.y > 0.7 && s.name.x < 0.1, JSON.stringify(s.name))
  assert.ok(s.timer.x > 0.8 && s.timer.y < 0.1, JSON.stringify(s.timer))
})

test('nothing that changes, nothing suggested', () => {
  const f = { width: 640, height: 360, tsv: tsv([word(1, 1, 1, 20, 20, 120, 20, 95, 'LOGO')]) }
  assert.deepEqual(suggestRois([f, f, f]), { name: null, names: [], timer: null })
  assert.deepEqual(suggestRois([]), { name: null, names: [], timer: null })
})

test('boxes from the client are clamped and refused when degenerate', () => {
  assert.deepEqual(cleanBox({ x: 0.9, y: -0.2, w: 0.5, h: 0.3 }), { x: 0.9, y: 0, w: 0.1, h: 0.3 })
  assert.equal(cleanBox({ x: 0.5, y: 0.5, w: 0.001, h: 0.2 }), null)
  assert.equal(cleanBox({ x: 'a', y: 0, w: 1, h: 1 }), null)
  assert.equal(cleanBox(null), null)
  const p = padBox({ x: 0.9, y: 0.9, w: 0.2, h: 0.2 })
  assert.ok(p.x + p.w <= 1 && p.y + p.h <= 1)
})

test('a label that never changes ("NEXT") is not the name, even when OCR misreads it now and then', () => {
  const frame = (label, name) => ({
    width: 640, height: 360,
    tsv: tsv([word(1, 1, 1, 290, 40, 60, 20, 90, label), word(2, 1, 1, 260, 280, 120, 16, 88, name)])
  })
  const s = suggestRois([frame('NEXT', 'SIDE SQUATS'), frame('NEXT', 'GOBLET SQUAT'), frame('NEXI', 'CALF RAISES'), frame('NEXT', 'PUSH UPS')])
  assert.ok(s.name && s.name.y > 0.7, JSON.stringify(s))
  assert.equal(s.names.length, 1)
})
