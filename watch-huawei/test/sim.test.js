import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { badLines, heapPeak, inject } from '../huawei-sim.mjs'

test('badLines finds the three failures and nothing else', () => {
  const log = ['[INFO] fine', 'JS HEAP OOM', 'x Eval JS file failed y', 'JS REF LIMIT', 'view model is undefined'].join('\n')
  assert.deepEqual(badLines(log), ['JS HEAP OOM', 'x Eval JS file failed y', 'JS REF LIMIT'])
  assert.deepEqual(badLines('all good'), [])
})

test('heapPeak is the largest peakAllocBytes the pipe reported', () => {
  const m = n => `{"property":"memoryUsage","result":{"totalBytes":1,"allocBytes":2,"peakAllocBytes":${n}}}\0`
  assert.equal(heapPeak(m(100) + m(129584) + m(5000)), 129584)
  assert.equal(heapPeak(''), 0)
})

test('inject puts the debug phone in a page copy and refuses a page it does not recognise', () => {
  const page = "import x from 'y'\nimport { blank, newUi } from '../../common/view.js'\nfunction start () {\n  A.make(stored)\n}\n"
  const out = inject(page)
  assert.match(out, /import drive from '\.\.\/\.\.\/common\/debugphone\.js'/)
  assert.match(out, /A\.make\(stored\); drive\(page, A, K\)/)
  assert.throws(() => inject('nothing to hook'), /anchor/)
})

test('the debug phone is never inside the app', () => {
  const root = new URL('../entry/src/', import.meta.url).pathname
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
  const hits = walk(root).filter(f => /debugphone|OGSMOKE/.test(f) || (/\.(js|json|hml|css)$/.test(f) && /debugphone|OGSMOKE/.test(readFileSync(f, 'utf8'))))
  assert.deepEqual(hits, [])
})
