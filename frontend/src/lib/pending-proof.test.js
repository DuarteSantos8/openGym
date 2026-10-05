import { describe, expect, it } from 'vitest'
import { forgetProof, recallProof, rememberProof } from './pending-proof.js'

// A tiny in-memory Storage stand-in, so these tests do not depend on a DOM environment.
function fakeStorage(initial = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    removeItem: k => { delete data[k] }
  }
}
const throwingStorage = {
  getItem() { throw new Error('storage refused') },
  setItem() { throw new Error('storage refused') },
  removeItem() { throw new Error('storage refused') }
}

describe('rememberProof / recallProof', () => {
  it('recalls exactly what was remembered, once, then answers null', () => {
    const storage = fakeStorage()
    rememberProof({ act: 'identity-remove', draft: { note: 'x' } }, { storage, now: 1000 })
    expect(recallProof({ storage, now: 1000 })).toEqual({ act: 'identity-remove', draft: { note: 'x' } })
    expect(recallProof({ storage, now: 1000 })).toBeNull()
  })

  it('nothing remembered answers null without touching storage badly', () => {
    expect(recallProof({ storage: fakeStorage() })).toBeNull()
  })

  it('a record older than five minutes is refused', () => {
    const storage = fakeStorage()
    rememberProof({ act: 'identity-link' }, { storage, now: 0 })
    expect(recallProof({ storage, now: 5 * 60 * 1000 + 1 })).toBeNull()
  })

  it('a record exactly at the five-minute edge still counts', () => {
    const storage = fakeStorage()
    rememberProof({ act: 'identity-link' }, { storage, now: 0 })
    expect(recallProof({ storage, now: 5 * 60 * 1000 })).toEqual({ act: 'identity-link', draft: undefined })
  })

  it('a malformed record (not JSON, or missing the fields a real one always has) is refused', () => {
    expect(recallProof({ storage: fakeStorage({ gym_pending_proof: 'not json' }) })).toBeNull()
    expect(recallProof({ storage: fakeStorage({ gym_pending_proof: JSON.stringify({ draft: 'x' }) }) })).toBeNull()   // no act
    expect(recallProof({ storage: fakeStorage({ gym_pending_proof: JSON.stringify({ act: 'x' }) }) })).toBeNull()   // no at
    expect(recallProof({ storage: fakeStorage({ gym_pending_proof: JSON.stringify(null) }) })).toBeNull()
    expect(recallProof({ storage: fakeStorage({ gym_pending_proof: '42' }) })).toBeNull()
  })

  it('a storage that throws on every access answers null and remembers nothing, without throwing itself', () => {
    expect(() => rememberProof({ act: 'identity-link' }, { storage: throwingStorage })).not.toThrow()
    expect(recallProof({ storage: throwingStorage })).toBeNull()
  })
})

describe('forgetProof', () => {
  it('clears a remembered record so a later recall finds nothing', () => {
    const storage = fakeStorage()
    rememberProof({ act: 'identity-remove' }, { storage, now: 0 })
    forgetProof({ storage })
    expect(recallProof({ storage, now: 0 })).toBeNull()
  })

  it('a throwing storage does not make forgetProof throw', () => {
    expect(() => forgetProof({ storage: throwingStorage })).not.toThrow()
  })
})
