// @vitest-environment happy-dom
// lib/feel.js: the rolling number, the hold-to-repeat timing and the stepper's limit. The DOM parts
// (press light, pop) are CSS and are judged on the phone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sound.js', () => ({ haptic: vi.fn() }))
import { haptic } from './sound.js'
import { rollCols, repeatDelay, HOLD_MS, holdProps, stepOnce, stopHold, recentTick } from './feel.js'

describe('rollCols', () => {
  it('rolls only the digits that changed when the length is the same', () => {
    expect(rollCols('102', '103')).toEqual([['1', '1'], ['0', '0'], ['2', '3']])
  })
  it('rolls the whole value when it has a decimal or changes length', () => {
    expect(rollCols('82.5', '85')).toEqual([['82.5', '85']])
    expect(rollCols('99', '100')).toEqual([['99', '100']])
    expect(rollCols('82.5', '83.5')).toEqual([['82.5', '83.5']])
  })
  it('an unchanged string has equal pairs, so nothing moves', () => {
    expect(rollCols('80', '80').every(([a, b]) => a === b)).toBe(true)
  })
})

describe('repeat timing', () => {
  it('waits 420 ms, then repeats every 150 ms, speeding up to 55', () => {
    expect(HOLD_MS).toBe(420)
    expect([0, 1, 5, 9, 10, 40].map(repeatDelay)).toEqual([150, 140, 100, 60, 55, 55])
  })
})

describe('stepOnce and holdProps', () => {
  beforeEach(() => { vi.useFakeTimers(); haptic.mockClear() })
  afterEach(() => { stopHold(); vi.useRealTimers(); delete document.documentElement.dataset.platform })

  it('a step is a selection haptic, and a limit is one light haptic (iPhone)', () => {
    document.documentElement.dataset.platform = 'ios'
    expect(stepOnce(() => true, 1)).toBe(true)
    expect(stepOnce(() => false, 1)).toBe(false)
    expect(haptic.mock.calls).toEqual([['selection'], ['light']])
  })

  it('a tap steps once (on the click); holding repeats and the click after it adds nothing', () => {
    document.documentElement.dataset.platform = 'ios'
    const step = vi.fn(() => true)
    const p = holdProps(step, 1)
    p.onClick()
    expect(step).toHaveBeenCalledTimes(1)
    p.onPointerDown({ button: 0 })
    vi.advanceTimersByTime(419); expect(step).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1); expect(step).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(140); expect(step).toHaveBeenCalledTimes(3)
    p.onPointerUp()
    vi.advanceTimersByTime(50); expect(step).toHaveBeenCalledTimes(3)
    p.onClick(); expect(step).toHaveBeenCalledTimes(3)
    p.onClick(); expect(step).toHaveBeenCalledTimes(4)
  })

  it('a hold that ended with no click (slid off) does not swallow a later click', () => {
    document.documentElement.dataset.platform = 'ios'
    const step = vi.fn(() => true)
    const p = holdProps(step, 1)
    p.onPointerDown({ button: 0 })
    vi.advanceTimersByTime(420); expect(step).toHaveBeenCalledTimes(1)
    p.onPointerCancel()
    vi.advanceTimersByTime(2000)
    p.onClick(); expect(step).toHaveBeenCalledTimes(2)
  })

  it('a hold stops at the limit', () => {
    document.documentElement.dataset.platform = 'ios'
    let n = 0
    const step = vi.fn(() => ++n < 3)
    holdProps(step, 1).onPointerDown({ button: 0 })
    vi.advanceTimersByTime(5000)
    expect(step).toHaveBeenCalledTimes(3)
    expect(haptic.mock.calls.at(-1)).toEqual(['light'])
  })

  it('sliding the finger off the button stops the repeat', () => {
    document.documentElement.dataset.platform = 'ios'
    const step = vi.fn(() => true)
    const p = holdProps(step, 1)
    p.onPointerDown({ button: 0 })
    vi.advanceTimersByTime(420); expect(step).toHaveBeenCalledTimes(1)
    p.onPointerMove({ clientX: 500, clientY: 500, currentTarget: { getBoundingClientRect: () => ({ left: 0, right: 40, top: 0, bottom: 40 }) } })
    vi.advanceTimersByTime(1000); expect(step).toHaveBeenCalledTimes(1)
  })

  it('off the iPhone a set row keeps the plain click (no repeat)', () => {
    const step = vi.fn()
    const p = holdProps(step, -1, false)
    expect(Object.keys(p)).toEqual(['onClick'])
    p.onClick(); expect(step).toHaveBeenCalledWith(-1)
  })

  it('off the iPhone a step makes no haptic', () => {
    stepOnce(() => true, 1)
    expect(haptic).not.toHaveBeenCalled()
  })

  it('a record trophy sparkles only right after your own tick', () => {
    expect(recentTick()).toBe(false)
  })
})
