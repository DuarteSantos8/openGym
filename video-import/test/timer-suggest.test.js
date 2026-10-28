import { test } from 'node:test'
import assert from 'node:assert/strict'
import { candidateBoxes, stepShare } from '../src/timer-suggest.js'

test('stepShare: a countdown steps by one, a scatter does not, a gap is not a miss', () => {
  const count = [[29], [28], [27], [], [25], [24, 7], [23]]
  const a = stepShare(count)
  assert.equal(a.pairs, 4)
  assert.equal(a.steps, 4)
  const scatter = stepShare([[4], [19], [2], [33], [8], [8], [1]])
  assert.ok(scatter.share < 0.3, JSON.stringify(scatter))
  assert.equal(stepShare([[3], [], [], []]).pairs, 0)
})

test('candidateBoxes: a grid over the frame, every box inside it', () => {
  const boxes = candidateBoxes()
  assert.ok(boxes.length >= 16)
  for (const b of boxes) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, JSON.stringify(b))
  }
  assert.ok(boxes.some(b => b.x < 0.05 && b.y < 0.05), 'a top left box')
  assert.ok(boxes.some(b => b.x + b.w > 0.95 && b.y < 0.05), 'a top right box')
  assert.ok(boxes.some(b => b.y + b.h > 0.95), 'a bottom box')
})
