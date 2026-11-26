import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { badLines, heapPeak, hook, inject, failures } from '../huawei-sim.mjs'

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

test('failures: an OOM before the first feed is one line, not also "never ran"', () => {
  assert.deepEqual(failures({ fed: true, answered: true, bad: [] }), [])
  assert.deepEqual(failures({ fed: true, answered: false, bad: [] }), ['FAIL the fake phone never answered the start (no OGSMOKE answered in the simulator log)'])
  assert.deepEqual(failures({ fed: false, bad: [] }), ['FAIL the app never ran its workout (no OGSMOKE feed in the simulator log)'])
  assert.deepEqual(failures({ fed: false, bad: ['JS HEAP OOM'] }), ['FAIL JS HEAP OOM'])
  assert.deepEqual(failures({ fed: true, answered: true, bad: ['JS REF LIMIT'] }), ['FAIL JS REF LIMIT'])
})

test('inject puts the debug phone in the app.js copy, after the core is made, and refuses an app.js it does not recognise', () => {
  const app = readFileSync(new URL('../entry/src/main/js/MainAbility/app.js', import.meta.url), 'utf8')
  const out = inject(app)
  assert.match(out, /^import drive from '\.\/common\/debugphone\.js'\n/)
  assert.match(out, /\}, stored\)\n {2}drive\(A, K\)\n/)
  assert.throws(() => inject('nothing to hook'), /anchor/)
})

test('hook tells the driver which page is up, in the copy of every page, and refuses a page it does not recognise', () => {
  const out = hook('onInit: function () {\n    attach(G.init()); attachLift(G.K)\n  },\n  onDestroy: function () { G.destroy() }')
  assert.match(out, /attach\(G\.init\(\)\); G\.A\.pg = this;/)
  assert.match(out, /G\.destroy\(\); if \(G\.A\.pg === this\) G\.A\.pg = null/) // a page that is gone is not kept alive
  assert.throws(() => hook('nothing to hook'), /anchor/)
  ;['index', 'lift', 'rest', 'over'].forEach(n => assert.doesNotThrow(() => hook(readFileSync(new URL('../entry/src/main/js/MainAbility/pages/' + n + '/index.js', import.meta.url), 'utf8')), n))
})

test('the debug phone is never inside the app', () => {
  const root = new URL('../entry/src/', import.meta.url).pathname
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
  const hits = walk(root).filter(f => /debugphone|OGSMOKE/.test(f) || (/\.(js|json|hml|css)$/.test(f) && /debugphone|OGSMOKE/.test(readFileSync(f, 'utf8'))))
  assert.deepEqual(hits, [])
})
