import { describe, expect, it } from 'vitest'
import { canonicalJSON, contentHash, deepFreeze } from '../../../../api/engine/canonical.js'

// FNV-1a-64 over raw UTF-8 bytes, checked against the published vectors. The engine never
// hashes a raw string — it hashes canonical JSON — so these go through a tiny local copy of
// the core loop rather than through contentHash. A test that confuses the two looks correct
// and is wrong (spec §8.4).
const fnv1a64 = str => {
  const bytes = new TextEncoder().encode(str)
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < bytes.length; i++) h = ((h ^ BigInt(bytes[i])) * 0x100000001b3n) & 0xffffffffffffffffn
  return h.toString(16).padStart(16, '0')
}

describe('canonicalJSON', () => {
  it('sorts object keys by code unit at every depth and keeps array order', () => {
    const a = { b: { y: 1, x: [1, { q: 2, p: 3 }] }, a: 'é' }
    const b = { a: 'é', b: { x: [1, { p: 3, q: 2 }], y: 1 } }
    expect(canonicalJSON(a)).toBe('{"a":"é","b":{"x":[1,{"p":3,"q":2}],"y":1}}')
    expect(canonicalJSON(a)).toBe(canonicalJSON(b))
    expect(canonicalJSON({ x: [1, 2] })).not.toBe(canonicalJSON({ x: [2, 1] }))
  })
  it('omits undefined properties and emits no whitespace', () => {
    expect(canonicalJSON({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(canonicalJSON([1, { a: 1 }])).toBe('[1,{"a":1}]')
  })
  it('throws ENGINE_NON_FINITE on a non-finite number', () => {
    expect(() => canonicalJSON({ n: NaN })).toThrow(/ENGINE_NON_FINITE/)
    expect(() => canonicalJSON({ n: Infinity })).toThrow(/ENGINE_NON_FINITE/)
  })
  it('treats null and nested nulls as JSON null, not as objects', () => {
    expect(canonicalJSON({ a: null })).toBe('{"a":null}')
  })
})

describe('contentHash', () => {
  it('reproduces the published FNV-1a-64 raw-byte vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325')
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
    expect(fnv1a64('foobar')).toBe('85944171f73967e8')
  })
  it('hashes the canonical JSON, not the raw string', () => {
    expect(contentHash('a')).toBe('d4272417d7c77eea')
    expect(contentHash('a')).not.toBe('af63dc4c8601ec8c')
  })
  it('is key-order independent and stable', () => {
    const a = { b: { y: 1, x: [1, { q: 2, p: 3 }] }, a: 'é' }
    const b = { a: 'é', b: { x: [1, { p: 3, q: 2 }], y: 1 } }
    expect(contentHash(a)).toBe('3ff1c35cf4e45e55')
    expect(contentHash(b)).toBe('3ff1c35cf4e45e55')
    expect(contentHash(a)).toBe(contentHash(a))
  })
  it('distinguishes array order and collapses 1 / 1.0', () => {
    expect(contentHash({ x: [1, 2] })).not.toBe(contentHash({ x: [2, 1] }))
    expect(contentHash({ n: 1 })).toBe(contentHash({ n: 1.0 }))
  })
  it('returns 16 lowercase hex characters', () => {
    expect(contentHash({ any: 'thing' })).toMatch(/^[0-9a-f]{16}$/)
    expect(contentHash({})).toMatch(/^[0-9a-f]{16}$/)
  })
  it('throws ENGINE_NON_FINITE rather than hashing a non-finite number', () => {
    expect(() => contentHash({ n: NaN })).toThrow(/ENGINE_NON_FINITE/)
  })
})

describe('deepFreeze', () => {
  it('freezes recursively and returns the same reference', () => {
    const o = { a: { b: [{ c: 1 }] } }
    expect(deepFreeze(o)).toBe(o)
    expect(Object.isFrozen(o.a.b[0])).toBe(true)
    expect(() => { 'use strict'; o.a.b[0].c = 2 }).toThrow()
  })
})
