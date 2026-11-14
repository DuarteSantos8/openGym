// The Side Service's view of the server (lib/relay-client.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanServer, boxUrl, redeemUrl, bodyOf } from '../lib/relay-client.js'

test('the address as people type it', () => {
  assert.equal(cleanServer(' gym.example.com/ '), 'https://gym.example.com')
  assert.equal(cleanServer('http://192.168.1.20:8080'), 'http://192.168.1.20:8080')
  assert.equal(cleanServer('https://example.com/gym/'), 'https://example.com/gym')
  assert.equal(cleanServer(''), '')
  assert.equal(cleanServer('not an address'), '')
  assert.equal(cleanServer(null), '')
  assert.equal(boxUrl('https://a.b'), 'https://a.b/api/watch/box')
  assert.equal(redeemUrl('https://a.b/gym'), 'https://a.b/gym/api/watch/redeem')
})

test('the body, parsed or as text', () => {
  assert.deepEqual(bodyOf({ a: 1 }), { a: 1 })
  assert.deepEqual(bodyOf('{"a":1}'), { a: 1 })
  assert.equal(bodyOf('<html>'), null)
  assert.equal(bodyOf(''), null)
  assert.equal(bodyOf('3'), null)
})
