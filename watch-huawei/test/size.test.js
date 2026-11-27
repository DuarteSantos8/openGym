import test from 'node:test'
import assert from 'node:assert/strict'
import { overLimit, appOver, LIMIT } from '../huawei-size.mjs'

test('overLimit lists only files above 46,080 bytes', () => {
  assert.equal(LIMIT, 46080)
  const files = [['app.js', 100], ['pages/index/index.js', 46081], ['manifest.json', 46080]]
  assert.deepEqual(overLimit(files), [['pages/index/index.js', 46081]])
  assert.deepEqual(overLimit([]), [])
})

test('appOver: only app.js or app.bc over the limit fails the gate under --report', () => {
  assert.deepEqual(appOver([['pages/index/index.js', 90000], ['app.js', 46080]]), [])
  assert.deepEqual(appOver([['app.js', 46081], ['app.bc', 10]]), [['app.js', 46081]])
  assert.deepEqual(appOver([['app.bc', 50000]]), [['app.bc', 50000]])
})
