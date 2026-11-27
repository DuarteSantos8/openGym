// @vitest-environment happy-dom
// The iPhone app asks for the motion sensor at a tap. The first 1.4.6 test build asked once and
// gave up when iOS did not take that event as a tap, so the snow globe never came on an iPhone.
import { describe, expect, it, vi } from 'vitest'
vi.mock('./mobile.js', () => ({ MOBILE: true }))
const { watchShake } = await import('./shake.js')
const flush = () => new Promise(r => setTimeout(r, 0))

describe('the iPhone app asks for the sensor', () => {
  it('again at the next tap after a try iOS refused to start, and stops once it has a yes', async () => {
    let n = 0
    window.DeviceMotionEvent = function () {}
    window.DeviceMotionEvent.requestPermission = vi.fn(async () => { n++; if (n === 1) throw new Error('not from a tap'); return 'granted' })
    const stop = watchShake(() => {})
    window.dispatchEvent(new Event('touchend')); await flush()
    window.dispatchEvent(new Event('touchend')); await flush()
    window.dispatchEvent(new Event('click')); await flush()
    expect(window.DeviceMotionEvent.requestPermission).toHaveBeenCalledTimes(2)
    stop()
  })
})
