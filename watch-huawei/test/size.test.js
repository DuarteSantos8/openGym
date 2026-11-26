import test from 'node:test'
import assert from 'node:assert/strict'
import { overLimit, LIMIT } from '../huawei-size.mjs'

test('overLimit lists only files above 46,080 bytes', () => {
  assert.equal(LIMIT, 46080)
  const files = [['app.js', 100], ['pages/index/index.js', 46081], ['manifest.json', 46080]]
  assert.deepEqual(overLimit(files), [['pages/index/index.js', 46081]])
  assert.deepEqual(overLimit([]), [])
})
