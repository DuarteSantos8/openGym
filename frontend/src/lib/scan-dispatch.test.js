import { describe, expect, it, vi } from 'vitest'
import { dispatchScan, handleScannedCode } from './scan-dispatch.js'

const lf = { name: 'lf', match: t => (t.includes('lfconnect') ? { kind: 'x' } : null), handle: vi.fn() }
const sticker = { name: 'sticker', match: t => t, handle: vi.fn() }

describe('dispatchScan', () => {
  it('the first handler that recognises the code wins', () => {
    expect(dispatchScan('https://lfconnect.com/q?t=c', [lf, sticker]).handler).toBe(lf)
    expect(dispatchScan('opengym:ex:1', [lf, sticker])).toEqual({ handler: sticker, match: 'opengym:ex:1' })
  })
  it('a handler that throws is passed over; none matching is null', () => {
    const bad = { match: () => { throw new Error('x') }, handle: () => {} }
    expect(dispatchScan('a', [bad, sticker]).handler).toBe(sticker)
    expect(dispatchScan('a', [lf])).toBeNull()
    expect(dispatchScan('a', null)).toBeNull()
  })
})

describe('handleScannedCode', () => {
  it('runs the winner with what it read and the context', () => {
    const ctx = { active: {} }
    expect(handleScannedCode('https://lfconnect.com', [lf, sticker], ctx)).toBe(true)
    expect(lf.handle).toHaveBeenCalledWith({ kind: 'x' }, ctx, 'https://lfconnect.com')
    expect(sticker.handle).not.toHaveBeenCalled()
  })
})
