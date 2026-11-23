import { describe, it, expect, afterEach, vi } from 'vitest'
import { tick } from './haptics.js'
import { setVibrate, setNativeBuzzer } from './sound.js'

afterEach(() => {
  setNativeBuzzer(null); setVibrate(true)
  delete navigator.vibrate
})

describe('haptics tick', () => {
  it('does nothing and never throws on the web without vibrate', () => {
    expect(() => tick('lift')).not.toThrow()
  })

  it('pulses navigator.vibrate shortly, drop a touch firmer', () => {
    const calls = []
    Object.defineProperty(navigator, 'vibrate', { value: p => { calls.push(p); return true }, configurable: true, writable: true })
    tick('lift'); tick('select'); tick('drop')
    expect(calls).toEqual([10, 10, 18])
  })

  it('hands the native buzzer the kind\'s style', () => {
    const fn = vi.fn(() => Promise.resolve(true))
    setNativeBuzzer(fn)
    tick('lift'); tick('drop'); tick('select')
    expect(fn.mock.calls).toEqual([[10, 'light'], [18, 'medium'], [10, 'selection']])
  })

  it('stays silent with Vibrate off', () => {
    const fn = vi.fn(() => Promise.resolve(true))
    setNativeBuzzer(fn); setVibrate(false)
    tick('drop')
    expect(fn).not.toHaveBeenCalled()
  })
})
