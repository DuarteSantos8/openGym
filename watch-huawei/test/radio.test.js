import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRadio } from '../entry/src/main/js/MainAbility/common/radio.js'
import { frames } from '../entry/src/main/js/MainAbility/common/frames.js'

// A P2P client that keeps each send's callbacks until the test answers.
function fake () {
  const f = { sent: [], pending: [], registered: null, unregistered: 0, throwOn: -1 }
  f.client = {
    send: (m, cb) => {
      if (f.sent.length === f.throwOn) throw new Error('boom')
      f.sent.push(m.text)
      f.pending.push(cb)
    },
    registerReceiver: r => { f.registered = r },
    unregisterReceiver: r => { f.unregistered += 1; r.onSuccess() }
  }
  // answer the oldest unanswered send the way wearengine.js does
  f.ok = () => { const cb = f.pending.shift(); cb.onSuccess(); cb.onSendResult({ data: 'ERROR_CODE_COMM_SUCCESS', code: 207 }); cb.onSendProgress('100%') }
  f.fail = () => { const cb = f.pending.shift(); cb.onFailure(); cb.onSendResult({ data: 'x', code: 206 }); cb.onSendProgress('0%') }
  return f
}
const build = text => ({ text: text })
const listener = () => { const l = { done: 0, err: 0 }; l.onComplete = () => { l.done += 1 }; l.onError = () => { l.err += 1 }; return l }
const big = { events: [{ id: 'h1', type: 'start', routineIds: ['a'.repeat(1500)] }] }

test('a small message is one frame holding JSON.stringify(message), then onComplete', () => {
  const f = fake()
  const l = listener()
  createRadio(f.client, build, 0).transmit({ events: [{ id: 'h1', type: 'hello', at: 1 }] }, l)
  assert.deepEqual(f.sent, ['1.0.1|{"events":[{"id":"h1","type":"hello","at":1}]}'])
  assert.equal(l.done, 0)
  f.ok()
  assert.deepEqual([l.done, l.err], [1, 0])
})

test('frames go one after the other, the next only after the one before reported success', () => {
  const f = fake()
  const l = listener()
  createRadio(f.client, build, 0).transmit(big, l)
  const want = frames(JSON.stringify(big), '1')
  assert.equal(want.length, 2)
  assert.deepEqual(f.sent, [want[0]])
  f.ok()
  assert.deepEqual(f.sent, want)
  assert.equal(l.done, 0)
  f.ok()
  assert.deepEqual([l.done, l.err], [1, 0])
})

test('the first failure ends the message: no more frames, one onError', () => {
  const f = fake()
  const l = listener()
  createRadio(f.client, build, 0).transmit(big, l)
  f.fail()
  assert.equal(f.sent.length, 1)
  assert.deepEqual([l.done, l.err], [0, 1])
})

test('result codes alone decide when onSuccess and onFailure are silent: 207 sent, 206 failed', () => {
  const f = fake()
  const l = listener()
  createRadio(f.client, build, 0).transmit(big, l)
  f.pending.shift().onSendResult({ code: 207 })
  assert.equal(f.sent.length, 2)
  f.pending.shift().onSendResult({ code: 206 })
  assert.deepEqual([l.done, l.err], [0, 1])
  const g = fake()
  const m = listener()
  createRadio(g.client, build, 0).transmit({ events: [] }, m)
  g.pending.shift().onSendResult(undefined)
  assert.equal(m.err, 1)
})

test('a send that throws is a failure, and each frame settles once', () => {
  const f = fake()
  f.throwOn = 0
  const l = listener()
  createRadio(f.client, build, 0).transmit({ events: [] }, l)
  assert.deepEqual([l.done, l.err], [0, 1])
  const g = fake()
  const m = listener()
  createRadio(g.client, build, 0).transmit({ events: [] }, m)
  const cb = g.pending.shift()
  cb.onSuccess(); cb.onSendResult({ code: 207 }); cb.onFailure(); cb.onSendResult({ code: 206 })
  assert.deepEqual([m.done, m.err], [1, 0])
})

test('a message over 16 parts is not sent', () => {
  const f = fake()
  const l = listener()
  createRadio(f.client, build, 0).transmit({ x: 'y'.repeat(16 * 960) }, l)
  assert.deepEqual([f.sent.length, l.err], [0, 1])
})

test('a newer message takes over: the old chain stops and reports nothing', () => {
  const f = fake()
  const a = listener()
  const b = listener()
  const radio = createRadio(f.client, build, 0)
  radio.transmit(big, a)
  radio.transmit({ events: [] }, b)
  assert.equal(f.sent.length, 2)
  f.ok() // the old first frame comes back late
  assert.equal(f.sent.length, 2)
  f.ok()
  assert.deepEqual([a.done, a.err, b.done, b.err], [0, 0, 1, 0])
})

test('a newer message of another radio takes over too: the old chain sends no more frames', () => {
  const f = fake()
  const g = fake()
  const a = listener()
  const b = listener()
  createRadio(f.client, build, 0).transmit(big, a)
  createRadio(g.client, build, 0).transmit({ events: [] }, b) // the next page's radio
  f.ok() // the old page's first frame comes back
  assert.equal(f.sent.length, 1)
  assert.deepEqual([a.done, a.err], [0, 0])
  g.ok()
  assert.deepEqual([b.done, b.err], [1, 0])
})

test('the id differs from one message to the next and stays within six base-36 characters', () => {
  const f = fake()
  const radio = createRadio(f.client, build, 36 ** 6 - 1)
  radio.transmit({ a: 1 }, listener())
  radio.transmit({ a: 1 }, listener())
  const ids = f.sent.map(s => s.split('.')[0])
  assert.notEqual(ids[0], ids[1])
  ids.forEach(id => assert.match(id, /^[0-9a-z]{1,6}$/))
})

test('receiving: frames in, one object out, non-ASCII back as it was', () => {
  const f = fake()
  const got = []
  const states = []
  createRadio(f.client, build, 0).listen(o => got.push(o), s => states.push(s))
  f.registered.onSuccess()
  const obj = { v: 1, active: { name: 'Beine | Rücken', note: 'x'.repeat(1200) } }
  frames(JSON.stringify(obj), 'q').forEach(fr => f.registered.onReceiveMessage(fr))
  assert.deepEqual(got, [obj])
  assert.ok(states.length >= 2 && states.every(x => x === true)) // its own callback, then a frame arrived
})

test('receiving: files, non-JSON, arrays, strings and null are ignored', () => {
  const f = fake()
  const got = []
  createRadio(f.client, build, 0).listen(o => got.push(o), () => {})
  f.registered.onReceiveMessage({ isFileType: true, name: 'internal://app/x' })
  f.registered.onReceiveMessage(undefined)
  ;['{not json', '[1,2]', '"text"', 'null', '5'].forEach(t => f.registered.onReceiveMessage('z.0.1|' + t))
  assert.deepEqual(got, [])
})

test('a receiver that fails to register says so; a throwing client too; stop unregisters', () => {
  const f = fake()
  const states = []
  const radio = createRadio(f.client, build, 0)
  radio.listen(() => {}, s => states.push(s))
  f.registered.onFailure()
  const bad = createRadio({ registerReceiver: () => { throw new Error('x') }, unregisterReceiver: () => { throw new Error('y') } }, build, 0)
  bad.listen(() => {}, s => states.push(s))
  bad.stop()
  radio.stop()
  assert.deepEqual(states, [false, false])
  assert.equal(f.unregistered, 1)
})

test('gathering is true between the first frame and the last, and any frame counts as registered', () => {
  const f = fake()
  const states = []
  const radio = createRadio(f.client, build, 0)
  radio.listen(() => {}, s => states.push(s))
  assert.equal(radio.gathering(), false)
  const fr = frames(JSON.stringify({ x: 'y'.repeat(1100) }), 'z')
  f.registered.onReceiveMessage(fr[0])
  assert.equal(radio.gathering(), true)
  assert.deepEqual(states, [true]) // no onSuccess came, the frame did it
  f.registered.onReceiveMessage(fr[1])
  assert.equal(radio.gathering(), false)
})

test('stop forgets a part of a message: nothing is gathering when the next receiver fails to register', () => {
  const f = fake()
  const radio = createRadio(f.client, build, 0)
  radio.listen(() => {}, () => {})
  frames(JSON.stringify({ x: 'y'.repeat(1200) }), 'q').slice(0, 1).forEach(fr => f.registered.onReceiveMessage(fr))
  assert.equal(radio.gathering(), true)
  radio.stop()
  assert.equal(radio.gathering(), false)
})
