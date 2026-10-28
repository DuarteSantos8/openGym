import { test } from 'node:test'
import assert from 'node:assert/strict'
import { poorRead, quality } from '../src/gate.js'

// Signals measured on recorded videos read with boxes the program found itself (see auto-roi.js).
test('reads that were wrong are poor, reads that were right are not', () => {
  assert.equal(poorRead({ timed: true, rows: 48, namedShare: 0.48, meanConf: 0.39, runCover: 0.97 }), true, 'names unreadable')
  assert.equal(poorRead({ timed: true, rows: 50, namedShare: 0.94, meanConf: 0.89, runCover: 0.31 }), true, 'second timer missed: the countdown covers a third')
  assert.equal(poorRead({ timed: true, rows: 36, namedShare: 1, meanConf: 0.91, runCover: 0.91 }), false)
  assert.equal(poorRead({ timed: true, rows: 38, namedShare: 0.76, meanConf: 0.71, runCover: 0.95 }), false)
})

test('without a followed timer only the names are judged; nothing at all is poor', () => {
  assert.equal(poorRead({ timed: false, rows: 12, namedShare: 0.9, meanConf: 0.8, runCover: 0 }), false)
  assert.equal(poorRead({ timed: false, rows: 0, namedShare: 0, meanConf: 0, runCover: 0 }), true)
  assert.equal(poorRead(undefined), false, 'not measured: not doubted')
})

test('a timer that was found but could not be followed makes the read poor', () => {
  // ScInp and t-3H: one timer found and counting, names read, but the read never confirmed a countdown.
  assert.equal(poorRead({ timed: false, expectTimed: true, rows: 18, namedShare: 1, meanConf: 0.82, runCover: 0.02 }), true)
  assert.equal(poorRead({ timed: false, expectTimed: true, rows: 34, namedShare: 0.97, meanConf: 0.7, runCover: 0.27 }), true)
  assert.equal(poorRead({ timed: false, expectTimed: false, rows: 18, namedShare: 1, meanConf: 0.82, runCover: 0 }), false, 'no timer expected: names alone')
})

test('quality counts named rows and their confidence', () => {
  const draft = { sections: [{ rows: [{ name: 'A', conf: 0.8 }, { name: '', conf: 0 }] }, { rows: [{ name: 'B', conf: 0.6 }] }] }
  assert.deepEqual(quality([], draft, false), { timed: false, expectTimed: false, rows: 3, namedShare: 0.67, meanConf: 0.47, runCover: 0 })
})
