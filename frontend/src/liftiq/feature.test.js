// @vitest-environment happy-dom
// LIFTIQ-FORK: feature gating (off by default, on by the simulator flag or the opt-in key) and the
// Web Bluetooth feature detection, which must never throw.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { liftiqEnabled, simRequested, simSpeed, bluetoothSupport, ENABLED_KEY, SIM_KEY } from './feature.js'

const setUrl = search => window.history.replaceState({}, '', '/' + search)

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setUrl('') })
afterEach(() => { localStorage.clear(); sessionStorage.clear(); setUrl('') })

describe('feature gating', () => {
  it('is off by default (an upstream build shows nothing)', () => {
    expect(liftiqEnabled()).toBe(false)
    expect(simRequested()).toBe(false)
  })

  it('?liftiqSim=1 turns it on and the simulator with it, and survives navigation without the query', () => {
    setUrl('?liftiqSim=1')
    expect(liftiqEnabled()).toBe(true)
    expect(sessionStorage.getItem(SIM_KEY)).toBe('1')
    setUrl('')
    expect(simRequested()).toBe(true)
    setUrl('?liftiqSim=0')
    expect(simRequested()).toBe(false)
    expect(liftiqEnabled()).toBe(false)
  })

  it('localStorage opt-in turns the integration on without the simulator', () => {
    localStorage.setItem(ENABLED_KEY, '1')
    expect(liftiqEnabled()).toBe(true)
    expect(simRequested()).toBe(false)
  })

  it('reads a bounded playback speed', () => {
    expect(simSpeed()).toBe(1)
    setUrl('?liftiqSim=1&liftiqSpeed=4')
    expect(simSpeed()).toBe(4)
    setUrl('?liftiqSpeed=99')
    expect(simSpeed()).toBe(8)
    setUrl('?liftiqSpeed=abc')
    expect(simSpeed()).toBe(1)
  })
})

describe('bluetoothSupport', () => {
  it('says why Web Bluetooth is missing and does not throw', () => {
    expect(bluetoothSupport().ok).toBe(false)
    expect(bluetoothSupport().reason).toBe('browser')
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari' })
    expect(bluetoothSupport().reason).toBe('ios')
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: {} })
    expect(bluetoothSupport()).toEqual({ ok: true, reason: null })
    delete navigator.bluetooth
  })

  it('treats the simulator as supported', () => {
    setUrl('?liftiqSim=1')
    expect(bluetoothSupport().ok).toBe(true)
  })
})
