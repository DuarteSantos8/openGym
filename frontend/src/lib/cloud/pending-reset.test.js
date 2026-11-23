import { describe, expect, it } from 'vitest'
import { RESET_KEY, createPendingReset } from './pending-reset.js'

const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: k => { m.delete(k) }, m } }

describe('createPendingReset', () => {
  it('is for the account it was marked for, and no other', () => {
    const p = createPendingReset(memory())
    expect(p.isFor('u-1')).toBe(false)
    p.mark('u-1')
    expect(p.isFor('u-1')).toBe(true)
    expect(p.isFor('u-2')).toBe(false)
    for (const none of [undefined, null, '']) expect(p.isFor(none)).toBe(false)
  })

  it('survives the page being loaded again: the next one reads the same storage', () => {
    const s = memory()
    createPendingReset(s).mark('u-1')
    expect(createPendingReset(s).isFor('u-1')).toBe(true)
  })

  it('keeps the account and nothing else: never the link, never a token', () => {
    const s = memory()
    createPendingReset(s).mark('u-1')
    expect([...s.m.entries()]).toEqual([[RESET_KEY, 'u-1']])
  })

  it('clear forgets it, here and in storage', () => {
    const s = memory()
    const p = createPendingReset(s)
    p.mark('u-1'); p.clear()
    expect(p.isFor('u-1')).toBe(false)
    expect(s.m.size).toBe(0)
  })

  it('marking nobody clears', () => {
    const p = createPendingReset(memory())
    p.mark('u-1'); p.mark(undefined)
    expect(p.isFor('u-1')).toBe(false)
  })

  it('still works for this page when storage refuses or is missing', () => {
    const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
    for (const s of [broken, null]) {
      const p = createPendingReset(s)
      p.mark('u-1')
      expect(p.isFor('u-1')).toBe(true)
      p.clear()
      expect(p.isFor('u-1')).toBe(false)
    }
  })
})
