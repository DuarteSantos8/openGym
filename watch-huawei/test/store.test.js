import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../entry/src/main/js/MainAbility/common/store.js'

// An in-memory @system.file. Calls queue up and finish when the test says (so a save can be caught
// half way). `crashAfter`: the number of operations that still take effect; the next write lands
// torn (half its text; with cleanCrash it does not land at all) and nothing after it does anything or calls back, as if the app was killed.
function fakeFile (disk, opts) {
  // failReads: every read fails (code 300); failFirst: only the first n reads; tear: the nth read returns half its text
  const o = Object.assign({ crashAfter: Infinity, failWrites: false, failReads: false, failFirst: 0, tear: -1, maxRead: 4096, maxWrite: 4096, cleanCrash: false }, opts || {})
  let reads = 0
  const q = []
  // failWrites may be switched on and off by a test; failOn: only the writes whose uri matches this pattern fail
  const f = { disk: disk, q: q, ops: 0, dead: false, writes: [], maxOutstanding: 0, failWrites: o.failWrites, failOn: null }
  const queue = fn => { q.push(fn); f.maxOutstanding = Math.max(f.maxOutstanding, q.length) }
  const apply = (kind, uri, text) => {
    if (f.dead) return false
    if (f.ops >= o.crashAfter) {
      f.dead = true
      if (kind === 'write' && !o.cleanCrash) disk.set(uri, text.substring(0, Math.floor(text.length / 2)))
      return false
    }
    f.ops += 1
    return true
  }
  f.api = {
    readText: p => queue(() => {
      if (f.dead) return
      reads += 1
      if (o.failReads || reads <= o.failFirst) { p.fail('x', 300); return }
      if (!disk.has(p.uri)) { p.fail('x', 301); return }
      let t = disk.get(p.uri)
      if (reads === o.tear) t = t.substring(0, Math.floor(t.length / 2))
      if (t.length > o.maxRead) { p.fail('x', 302); return }
      p.success({ text: t })
    }),
    writeText: p => queue(() => {
      assert.ok(p.text.length <= o.maxWrite, 'a write over the limit')
      assert.match(p.uri, /^internal:\/\/app\/[a-z0-9]+$/)
      if (!apply('write', p.uri, p.text)) return
      f.writes.push(p.uri)
      if (f.failWrites || (f.failOn && f.failOn.test(p.uri))) { p.fail('x', 300); return }
      disk.set(p.uri, p.text)
      p.success()
    }),
    delete: p => queue(() => { if (!apply('delete', p.uri)) return; disk.delete(p.uri); p.success() })
  }
  // run queued calls (and what they queue) until nothing is left
  f.settle = () => { while (q.length) q.shift()() }
  return f
}
const loadOf = (disk) => { const f = fakeFile(disk); let got; createStore(f.api).load(s => { got = s }); f.settle(); return got }
// a store that has loaded (a fresh folder says 'fresh'), so it may save, as the page does
const open = f => { const st = createStore(f.api); st.load(() => {}); f.settle(); return st }
const state = n => ({ w: { name: 'Push ü', entries: [{ id: 'x'.repeat(n), sets: [1, 2, 3] }] }, ob: [[1, 'h']], rest: 5 })
const BIG = 9000 // three or four parts

test('a fresh install and an empty folder load as null', () => {
  assert.equal(loadOf(new Map()), null)
})

test('save then load gives the state back, in parts that fit the file API', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(BIG))
  f.settle()
  assert.ok([...disk.keys()].filter(k => /p\d+$/.test(k)).length >= 3)
  assert.deepEqual(loadOf(disk), state(BIG))
  assert.equal(st.failed, false)
})

test('the stored text is ASCII', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  open(f).save(state(10))
  f.settle()
  disk.forEach(t => assert.match(t, /^[\x20-\x7e]*$/))
})

test('each save leaves only its own generation: old parts are deleted', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(BIG)); f.settle()
  const first = [...disk.keys()].sort()
  st.save(state(10)); f.settle()
  const second = [...disk.keys()].sort()
  assert.equal(second.filter(k => /^internal:\/\/app\/g1p/.test(k)).length, 0)
  assert.ok(first.length > second.length)
  st.save(state(20)); f.settle()
  assert.deepEqual(loadOf(disk), state(20))
  assert.equal([...disk.keys()].filter(k => /g2p/.test(k)).length, 0)
})

test('the app killed at any point of a save: the load gives the old state or the new one, whole', () => {
  const A = state(BIG)
  const B = state(5000)
  const seen = { A: 0, B: 0 }
  for (let k = 0; k < 40; k++) {
    const disk = new Map()
    const f0 = fakeFile(disk)
    const s0 = open(f0)
    s0.save(A); f0.settle()
    const f = fakeFile(disk, { crashAfter: k })
    const s = open(f)
    s.load(() => {}); f.settle() // a restart loads first, as the page does; it may delete and so spend ops too
    f.ops = 0
    s.save(B); f.settle()
    const got = loadOf(disk)
    const which = JSON.stringify(got) === JSON.stringify(A) ? 'A' : JSON.stringify(got) === JSON.stringify(B) ? 'B' : null
    assert.ok(which, 'crash after ' + k + ' ops: ' + JSON.stringify(got).slice(0, 80))
    seen[which] += 1
  }
  assert.ok(seen.A >= 3 && seen.B >= 3, JSON.stringify(seen)) // both sides of the head write were hit
})

test('killed while the head is being written (torn head): the earlier state loads', () => {
  const A = state(100)
  const disk = new Map()
  const f0 = fakeFile(disk)
  const s0 = open(f0)
  s0.save(A); f0.settle()
  // second save: one part, then the head. Let the part through, tear the head.
  const f = fakeFile(disk, { crashAfter: 1 })
  const s = open(f)
  s.load(() => {}); f.settle(); f.ops = 0
  s.save(state(200)); f.settle()
  assert.ok(f.dead)
  assert.deepEqual(loadOf(disk), A)
})

test('a broken newest generation falls back to the older head that still reads', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(BIG)); f.settle()
  // make the second save complete its head but lose a part afterwards
  const keep = new Map(disk)
  st.save(state(10)); f.settle()
  const heads = [...disk.keys()].filter(k => /head\d$/.test(k))
  assert.equal(heads.length, 2)
  const newest = [...disk.keys()].filter(k => /g2p/.test(k))
  newest.forEach(k => disk.set(k, 'garbage')) // same length would be needed; this one is shorter
  // the older generation's parts were deleted by the save, so restore them to model "delete never ran"
  keep.forEach((v, k) => { if (/g1p/.test(k)) disk.set(k, v) })
  assert.deepEqual(loadOf(disk), state(BIG))
})

test('a wrong length, a missing part, junk and a head that is not JSON all give null', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  open(f).save(state(BIG)); f.settle()
  const head = [...disk.keys()].find(k => /head\d$/.test(k))
  const h = JSON.parse(disk.get(head))
  const part0 = 'internal://app/g' + h.g + 'p0'
  const ok = new Map(disk)
  disk.set(head, JSON.stringify(Object.assign({}, h, { len: h.len + 1 })))
  assert.equal(loadOf(disk), null)
  disk.set(head, disk.get(head).slice(0, 5))
  assert.equal(loadOf(disk), null)
  ok.forEach((v, k) => disk.set(k, v))
  disk.delete(part0)
  assert.equal(loadOf(disk), null)
  ok.forEach((v, k) => disk.set(k, v))
  disk.set(head, JSON.stringify({ g: 1, n: 1, len: 3 }))
  disk.set('internal://app/g1p0', '[1]')
  assert.equal(loadOf(disk), null) // an array is not a state
  disk.set('internal://app/g1p0', 'nul')
  assert.equal(loadOf(disk), null)
})

// load with its status, the way the page reads it
const statusOf = (disk, opts) => { const f = fakeFile(disk, opts); const st = createStore(f.api); let got; st.load((s, status) => { got = [s, status] }); f.settle(); return { got: got, st: st, f: f } }
const snapshotOfDisk = disk => JSON.stringify([...disk.entries()].sort())

test('load says fresh for an empty folder, ok with the state, damaged for a broken one', () => {
  assert.deepEqual(statusOf(new Map()).got, [null, 'fresh'])
  const disk = new Map()
  const f = fakeFile(disk)
  open(f).save(state(BIG)); f.settle()
  assert.deepEqual(statusOf(disk).got, [state(BIG), 'ok'])
  const head = [...disk.keys()].find(k => /head\d$/.test(k))
  disk.delete('internal://app/g1p0')
  assert.deepEqual(statusOf(disk).got, [null, 'damaged'])
  disk.set(head, JSON.stringify({ g: 1, n: 1, len: 99 }))
  assert.equal(statusOf(disk).got[1], 'damaged')
})

test('a read that fails once is read again: the state loads', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  open(f).save(state(BIG)); f.settle()
  for (let n = 1; n <= 2; n++) assert.deepEqual(statusOf(disk, { failFirst: n }).got, [state(BIG), 'ok'], 'first ' + n + ' reads fail')
})

test('a read that always fails is unreadable, not fresh, and a save writes nothing', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  open(f).save(state(BIG)); f.settle()
  const before = snapshotOfDisk(disk)
  const r = statusOf(disk, { failReads: true })
  assert.deepEqual(r.got, [null, 'unreadable'])
  r.st.save(state(1)); r.f.settle()
  assert.equal(r.f.writes.length, 0)
  assert.equal(snapshotOfDisk(disk), before)
  // too many failures in a row (past the tries) are unreadable too, and nothing is lost
  assert.equal(statusOf(disk, { failFirst: 3 }).got[1], 'unreadable')
  assert.equal(snapshotOfDisk(disk), before)
  assert.deepEqual(loadOf(disk), state(BIG))
})

test('a part that fails to read is unreadable even when an older head exists: no fallback past it', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(BIG)); f.settle()
  const keep = new Map(disk)
  st.save(state(10)); f.settle()
  keep.forEach((v, k) => { if (/g1p/.test(k)) disk.set(k, v) }) // the older generation is still there, and reads fine
  // the control runs on a copy: a load that works deletes the older parts
  assert.deepEqual(statusOf(new Map(disk)).got, [state(10), 'ok'])
  // only the newest generation's part fails to read (the head reads and the older parts do not)
  const g = fakeFile(disk)
  const api = { readText: p => { if (/g2p0$/.test(p.uri)) p.fail('x', 300); else g.api.readText(p) }, writeText: g.api.writeText, delete: g.api.delete }
  let got
  createStore(api).load((s, status) => { got = [s, status] }); g.settle()
  assert.deepEqual(got, [null, 'unreadable'])
})

test('a torn read of a part or of a head is read again; torn for good is damaged', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  open(f).save(state(BIG)); f.settle()
  for (let n = 1; n <= 6; n++) assert.deepEqual(statusOf(disk, { tear: n }).got, [state(BIG), 'ok'], 'read ' + n + ' torn')
  const bad = new Map(disk)
  bad.set('internal://app/g1p1', bad.get('internal://app/g1p1').slice(0, 10))
  assert.equal(statusOf(bad).got[1], 'damaged')
})

test('kill the app anywhere while reads fail once, fail always, or come back torn: never a lost state, never an empty overwrite', () => {
  const A = state(BIG)
  const B = state(5000)
  const variants = [{}, { failFirst: 1 }, { failFirst: 2 }, { tear: 1 }, { tear: 3 }, { failReads: true }, { failFirst: 5 }]
  variants.forEach(v => {
    for (let k = 0; k < 30; k++) {
      const disk = new Map()
      const f0 = fakeFile(disk)
      open(f0).save(A); f0.settle()
      const before = snapshotOfDisk(disk)
      const f = fakeFile(disk, Object.assign({ crashAfter: k }, v))
      const st = createStore(f.api)
      let first
      st.load((s, status) => { first = [s, status] }); f.settle()
      f.ops = 0
      st.save(B); f.settle()
      const unreadable = first[1] === 'unreadable'
      if (unreadable) {
        assert.equal(f.writes.length, 0, JSON.stringify(v) + ' k' + k)
        assert.equal(snapshotOfDisk(disk), before)
      }
      const got = loadOf(disk)
      const ok = JSON.stringify(got) === JSON.stringify(A) || JSON.stringify(got) === JSON.stringify(B)
      assert.ok(ok, JSON.stringify(v) + ' crash after ' + k + ': ' + JSON.stringify(got).slice(0, 60))
      if (!unreadable) assert.ok(first[1] === 'ok', JSON.stringify(v) + ' ' + first[1])
    }
  })
})

test('a store that never loaded writes nothing, and an unchanged state is not written twice', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = createStore(f.api)
  st.save(state(10)); f.settle()
  assert.equal(f.writes.length, 0)
  st.load(() => {}); f.settle()
  st.save(state(10)); f.settle()
  const n = f.writes.length
  assert.ok(n > 0)
  st.save(state(10)); f.settle()
  assert.equal(f.writes.length, n)
  st.save(state(11)); f.settle()
  assert.ok(f.writes.length > n)
})

test('a read that throws is read again, then unreadable', () => {
  let got
  createStore({ readText: () => { throw new Error('x') } }).load((s, status) => { got = [s, status] })
  assert.deepEqual(got, [null, 'unreadable'])
})

test('only one save runs at a time and the newest state asked for wins', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(BIG))
  st.save(state(11)) // while the first is in flight
  st.save(state(12))
  st.save(state(13))
  f.settle()
  assert.equal(f.maxOutstanding, 1)
  assert.deepEqual(loadOf(disk), state(13))
  // two saves ran, not four: the generations are 1 and 2
  assert.deepEqual([...disk.keys()].filter(k => /head/.test(k)).sort(), ['internal://app/head0', 'internal://app/head1'])
  assert.ok(f.writes.filter(u => /g3p/.test(u)).length === 0)
})

test('a failed write marks the store failed; the next save on the same store tries again and clears it', () => {
  const disk = new Map()
  const f = fakeFile(disk, { failWrites: true })
  const st = open(f)
  st.save(state(10)); f.settle()
  assert.equal(st.failed, true)
  assert.equal(loadOf(disk), null)
  f.failWrites = false
  st.save(state(10)); f.settle()
  assert.equal(st.failed, false)
  assert.deepEqual(loadOf(disk), state(10))
})

test('a save whose parts reached the disk but whose head did not keeps the older state, and the next save carries on', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(20)); f.settle()
  f.failOn = /head/
  st.save(state(30)); f.settle()
  assert.equal(st.failed, true)
  assert.ok(f.writes.some(u => /g2p0$/.test(u)), 'the parts of the replacement were written')
  assert.deepEqual(loadOf(disk), state(20))
  f.failOn = null
  st.save(state(40)); f.settle()
  assert.equal(st.failed, false)
  assert.deepEqual(loadOf(disk), state(40))
})

test('a failed save keeps the older state; a restart then a save carries on from the newest generation', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(20)); f.settle()
  st.save(state(30)); f.settle()
  const f2 = fakeFile(disk)
  const st2 = open(f2)
  let got
  st2.load(s => { got = s }); f2.settle()
  assert.deepEqual(got, state(30))
  st2.save(state(40)); f2.settle()
  assert.deepEqual(loadOf(disk), state(40))
  assert.equal([...disk.keys()].filter(k => /p\d+$/.test(k)).length, 1) // one part, nothing left over
})

test('a head that is there but does not parse is damaged, not fresh; two missing heads are fresh', () => {
  const disk = new Map([['internal://app/head1', '{"g":1,']])
  assert.equal(statusOf(disk).got[1], 'damaged')
  assert.equal(statusOf(new Map()).got[1], 'fresh')
  // and the folder can be started again
  const f = fakeFile(disk)
  const st = createStore(f.api)
  st.load(() => {}); f.settle()
  st.save(state(10)); f.settle()
  assert.deepEqual(loadOf(disk), state(10))
})

test('a save after a fallback never writes over the parts the damaged head names: killed anywhere it is the older state or the new one', () => {
  // the same length, so a mix of the damaged generation's parts and the new ones would still read whole
  const mk = c => ({ a: c.repeat(BIG) })
  const A = mk('a')
  const B = mk('b')
  const C = mk('c')
  let killed = 0
  for (let k = 0; k < 40; k++) {
    const disk = new Map()
    const f0 = fakeFile(disk)
    const s0 = open(f0)
    s0.save(A); f0.settle()
    const older = new Map(disk)
    s0.save(B); f0.settle()
    older.forEach((v, u) => { if (/g1p/.test(u)) disk.set(u, v) }) // the older generation is still there, as if its delete never ran
    disk.set('internal://app/g2p0', 'junk') // the newest generation is damaged, its head is whole: a load falls back to A
    const f = fakeFile(disk, { crashAfter: k, cleanCrash: true }) // killed between two writes
    const st = createStore(f.api)
    let first
    st.load((x, status) => { first = [x, status] }); f.settle()
    assert.deepEqual(first, [A, 'ok'])
    f.ops = 0
    st.save(C); f.settle()
    if (f.dead) killed += 1
    const got = JSON.stringify(loadOf(disk))
    assert.ok(got === JSON.stringify(A) || got === JSON.stringify(C), 'crash after ' + k + ': ' + got.slice(0, 40))
  }
  assert.ok(killed > 5)
})

test('after a fallback the damaged generation\'s parts go with the next save, and the folder holds one generation', () => {
  const disk = new Map()
  const f0 = fakeFile(disk)
  const s0 = open(f0)
  s0.save(state(BIG)); f0.settle()
  const older = new Map(disk)
  s0.save(state(BIG + 1)); f0.settle()
  older.forEach((v, u) => { if (/g1p/.test(u)) disk.set(u, v) })
  disk.set('internal://app/g2p0', 'junk')
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(10)); f.settle()
  assert.deepEqual(loadOf(disk), state(10))
  assert.equal([...disk.keys()].filter(k => /p\d+$/.test(k)).length, 1)
})

test('a delete that failed is tried again after the next save', () => {
  const disk = new Map()
  const f = fakeFile(disk)
  const st = open(f)
  st.save(state(BIG)); f.settle()
  const realDelete = f.api.delete
  f.api.delete = p => { p.fail('x', 300) } // the old generation's parts will not delete
  st.save(state(11)); f.settle()
  assert.ok([...disk.keys()].some(u => /g1p/.test(u)), 'a leftover part')
  f.api.delete = realDelete
  st.save(state(12)); f.settle()
  assert.equal([...disk.keys()].filter(u => /g1p/.test(u)).length, 0)
  assert.deepEqual(loadOf(disk), state(12))
})
