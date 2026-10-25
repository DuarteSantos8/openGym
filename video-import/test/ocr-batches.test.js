import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapBatches } from '../src/ocr.js'

const wait = ms => new Promise(r => setTimeout(r, ms))

test('batches come back in order however long each one takes', async () => {
  const batches = [['a', 'b'], ['c'], ['d', 'e', 'f'], ['g']]
  const delays = [40, 5, 20, 1]
  const out = await mapBatches(batches, async b => { await wait(delays[batches.indexOf(b)]); return b.map(x => x.toUpperCase()) }, 3)
  assert.deepEqual(out, ['A', 'B', 'C', 'D', 'E', 'F', 'G'])
})

test('no more batches run at once than there are lanes, and progress counts what is done', async () => {
  let live = 0, peak = 0
  const seen = []
  const batches = Array.from({ length: 9 }, (_, i) => [i, i + 100])
  await mapBatches(batches, async b => { live++; peak = Math.max(peak, live); await wait(5); live--; return b }, 2, n => seen.push(n))
  assert.equal(peak, 2)
  assert.equal(seen.length, 9)
  assert.equal(seen[seen.length - 1], 18)
  assert.deepEqual([...seen].sort((x, y) => x - y), seen, 'progress never goes back')
})

test('one lane is the old one-after-another, and a failure stops the rest', async () => {
  const order = []
  await mapBatches([[1], [2], [3]], async b => { order.push(b[0]); return b }, 1)
  assert.deepEqual(order, [1, 2, 3])
  const started = []
  await assert.rejects(mapBatches([[1], [2], [3], [4]], async b => { started.push(b[0]); if (b[0] === 2) throw new Error('boom'); return b }, 1), /boom/)
  assert.deepEqual(started, [1, 2], 'nothing starts after the failure')
})

test('an empty list is an empty answer', async () => {
  assert.deepEqual(await mapBatches([], async () => { throw new Error('never') }, 4), [])
})
