import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escape, frames, createReceiver, parse, PART, MAX_PARTS } from '../entry/src/main/js/MainAbility/common/frames.js'

const vectors = JSON.parse(readFileSync(new URL('./frames.json', import.meta.url), 'utf8'))

test('every vector: text to frames with id "a"', () => {
  vectors.forEach(v => assert.deepEqual(frames(v.text, 'a'), v.frames, v.name))
})

test('every vector: frames back to the text, in order and shuffled', () => {
  vectors.forEach(v => {
    ;[v.frames, v.frames.slice().reverse()].forEach(order => {
      const rx = createReceiver()
      const got = order.map(f => rx.accept(f)).filter(x => x !== null)
      assert.equal(got.length, 1, v.name)
      assert.deepEqual(JSON.parse(got[0]), JSON.parse(v.text), v.name)
    })
  })
})

test('escape: ASCII stays, everything else is \\uXXXX in lower case, surrogates one by one', () => {
  assert.equal(escape('a b~'), 'a b~')
  assert.equal(escape('ü\n\u007f'), '\\u00fc\\u000a\\u007f')
  assert.equal(escape('😀'), '\\ud83d\\ude00')
  assert.equal(JSON.parse('"' + escape('Rücken 😀') + '"'), 'Rücken 😀')
})

test('960 characters are one frame, 961 are two, 16 parts is the cap', () => {
  assert.equal(frames('x'.repeat(PART), 'a').length, 1)
  assert.equal(frames('x'.repeat(PART + 1), 'a').length, 2)
  assert.equal(frames('x'.repeat(PART * MAX_PARTS), 'a').length, MAX_PARTS)
  assert.equal(frames('x'.repeat(PART * MAX_PARTS + 1), 'a'), null)
  // the cap counts the escaped text: 4 non-ASCII characters make 24 characters
  assert.equal(frames('ü'.repeat(PART), 'a').length, 6)
})

const f = (id, i, n, part) => id + '.' + i + '.' + n + '|' + part

test('a frame of another id drops a half-gathered message', () => {
  const rx = createReceiver()
  assert.equal(rx.accept(f('a', 0, 2, '{"x":')), null)
  assert.equal(rx.accept(f('b', 0, 2, '{"y":')), null)
  assert.equal(rx.accept(f('a', 1, 2, '1}')), null) // a's first part is gone: a starts over, b is dropped
  assert.equal(rx.accept(f('b', 1, 2, '2}')), null) // b starts over, a is dropped
  assert.equal(rx.accept(f('b', 0, 2, '{"y":')), '{"y":2}')
})

test('another n under the same id starts over', () => {
  const rx = createReceiver()
  rx.accept(f('a', 0, 3, 'p'))
  assert.equal(rx.accept(f('a', 0, 2, '{')), null)
  assert.equal(rx.accept(f('a', 1, 2, '}')), '{}')
})

test('the same index twice: the later one stands, and it is still one part', () => {
  const rx = createReceiver()
  assert.equal(rx.accept(f('a', 0, 2, 'old')), null)
  assert.equal(rx.accept(f('a', 0, 2, '{"k":')), null)
  assert.equal(rx.accept(f('a', 1, 2, '1}')), '{"k":1}')
})

test('a finished message is forgotten: its frame again gathers from nothing', () => {
  const rx = createReceiver()
  assert.equal(rx.accept(f('a', 0, 1, '{}')), '{}')
  assert.equal(rx.accept(f('a', 0, 1, '{}')), '{}')
})

test('frames that do not match are ignored and leave the gathering alone', () => {
  const rx = createReceiver()
  rx.accept(f('a', 0, 2, '{'))
  ;['', 'hello', 'a.0.1', 'A.0.1|x', 'abcdefg.0.1|x', '.0.1|x', 'a.x.1|x', 'a.0.0|x', 'a.0.17|x', 'a.2.2|x', 'a.1|x', 'a.0.1.1|x', 'a.-1.2|x', 'a.0.1x|x', 'a.1000.2|x', null, undefined, 5, {}]
    .forEach(bad => assert.equal(rx.accept(bad), null, String(bad)))
  assert.equal(rx.accept(f('a', 1, 2, '}')), '{}')
})

test('parts may hold | and .', () => {
  assert.deepEqual(parse('a.0.1|x|y.z'), ['a', 0, 1, 'x|y.z'])
  assert.deepEqual(parse('0z9.15.16|'), ['0z9', 15, 16, ''])
})

test('escape: text that needs nothing comes back as it is; one needing a little keeps the rest', () => {
  const plain = '{"a":"hello"}'
  assert.equal(escape(plain), plain)
  assert.equal(escape('üxü'), '\\u00fcx\\u00fc')
  assert.equal(escape('ü'), '\\u00fc')
  assert.equal(escape('abü'), 'ab\\u00fc')
  assert.equal(escape(''), '')
})

test('the receiver says when a message is half gathered', () => {
  const rx = createReceiver()
  assert.equal(rx.busy(), false)
  rx.accept('a.0.2|{')
  assert.equal(rx.busy(), true)
  rx.accept('a.1.2|}')
  assert.equal(rx.busy(), false)
})
