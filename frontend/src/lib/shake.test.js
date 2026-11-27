// @vitest-environment happy-dom
// A hard shake (lib/shake.js): three jolts in under a second, not one bump.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shakeDetector, watchShake, askMotion, motionNeedsAsk, _resetMotionForTests, SHAKE_G } from './shake.js'

const jolt = (x, y = 0, z = 0) => ({ acceleration: { x, y, z } })
afterEach(() => { delete window.DeviceMotionEvent; _resetMotionForTests() })

describe('shakeDetector', () => {
  it('three hard jolts within the window are a shake, with the last jolt’s direction', () => {
    const on = vi.fn()
    const feed = shakeDetector(on)
    feed(jolt(18), 0); feed(jolt(-18), 150)
    expect(on).not.toHaveBeenCalled()
    feed(jolt(20, 4), 300)
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0]).toMatchObject({ x: 20, y: 4 })
    expect(on.mock.calls[0][0].strength).toBeGreaterThan(1)
  })

  it('a single bump, gentle moves, or jolts spread out are not', () => {
    const on = vi.fn()
    const feed = shakeDetector(on)
    feed(jolt(25), 0)
    for (let t = 100; t < 2000; t += 50) feed(jolt(SHAKE_G - 3), t)
    feed(jolt(20), 3000); feed(jolt(20), 4000); feed(jolt(20), 5000)
    expect(on).not.toHaveBeenCalled()
  })

  it('samples of one jolt count once', () => {
    const on = vi.fn()
    const feed = shakeDetector(on)
    feed(jolt(20), 0); feed(jolt(20), 16); feed(jolt(20), 32)
    expect(on).not.toHaveBeenCalled()
  })

  it('reads gravity-included values when that is all the sensor gives', () => {
    const on = vi.fn()
    const feed = shakeDetector(on)
    const g = v => ({ acceleration: null, accelerationIncludingGravity: { x: v, y: 9.81, z: 0 } })
    feed(g(0), 0)
    expect(on).not.toHaveBeenCalled() // the phone at rest is 1 g, not a jolt
    feed(g(25), 100); feed(g(-25), 250); feed(g(25), 400)
    expect(on).toHaveBeenCalledTimes(1)
  })

  it('keeps on shaking: fires again every three jolts', () => {
    const on = vi.fn()
    const feed = shakeDetector(on)
    for (let i = 0; i < 6; i++) feed(jolt(i % 2 ? -20 : 20), i * 120)
    expect(on).toHaveBeenCalledTimes(2)
  })

  it('ignores events without numbers', () => {
    const on = vi.fn()
    const feed = shakeDetector(on)
    expect(feed({}, 0)).toBe(false)
    expect(feed(null, 0)).toBe(false)
  })
})

describe('the motion sensor', () => {
  it('no sensor: nothing listens and nothing breaks', () => {
    const stop = watchShake(vi.fn())
    expect(typeof stop).toBe('function')
    stop()
  })

  it('iOS asks once, from a tap, and remembers a yes', async () => {
    const ask = vi.fn(async () => 'granted')
    window.DeviceMotionEvent = function () {}
    window.DeviceMotionEvent.requestPermission = ask
    expect(motionNeedsAsk()).toBe(true)
    expect(await askMotion()).toBe(true)
    expect(await askMotion()).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('a no, or an error, is a no', async () => {
    window.DeviceMotionEvent = function () {}
    window.DeviceMotionEvent.requestPermission = async () => 'denied'
    expect(await askMotion()).toBe(false)
    window.DeviceMotionEvent.requestPermission = async () => { throw new Error('not from a tap') }
    expect(await askMotion()).toBe(false)
  })

  it('listens for devicemotion while watched, and stops after', () => {
    window.DeviceMotionEvent = function () {}
    const on = vi.fn()
    const stop = watchShake(on)
    const fire = (x, t) => { vi.setSystemTime(t); const e = new Event('devicemotion'); e.acceleration = { x, y: 0, z: 0 }; window.dispatchEvent(e) }
    vi.useFakeTimers({ toFake: ['Date'] })
    fire(20, 1000); fire(-20, 1150); fire(20, 1300)
    expect(on).toHaveBeenCalledTimes(1)
    stop()
    fire(20, 2000); fire(-20, 2150); fire(20, 2300)
    expect(on).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
