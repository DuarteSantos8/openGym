// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as audio from './sound.js'
import { cue } from './feedback.js'

const buzz = vi.fn()
function setup({ reduced = false, vibrate = buzz } = {}) {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  vi.stubGlobal('navigator', { vibrate })
  vi.spyOn(audio, 'beep').mockImplementation(() => {})
  vi.spyOn(audio, 'chime').mockImplementation(() => {})
  audio.setVibrate(true)
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); buzz.mockClear() })

describe('workout feedback', () => {
  it('distinguishes a checked set, a record, and a saved session', () => {
    setup()
    for (const kind of ['set-done', 'record', 'session-done']) cue(kind, { sound: true })
    expect(audio.beep).toHaveBeenCalledTimes(6)
    expect(new Set(buzz.mock.calls.map(([pattern]) => JSON.stringify(pattern))).size).toBe(3)
  })

  it('reads sound, vibration and the separate record-tone preference', () => {
    setup()
    cue('set-done', { sound: false, vibrate: true })
    expect(audio.beep).not.toHaveBeenCalled()
    expect(buzz).toHaveBeenCalledOnce()
    cue('session-done', { sound: true, vibrate: false })
    expect(audio.beep).toHaveBeenCalledTimes(3)
    expect(buzz).toHaveBeenCalledOnce()
    cue('record', { sound: true, recordSound: false })
    expect(audio.beep).toHaveBeenCalledTimes(3)
    expect(buzz).toHaveBeenCalledTimes(2)
  })

  it('suppresses additional feedback under reduced motion and leaves the functional timer audible', () => {
    setup({ reduced: true })
    const ring = vi.fn()
    for (const kind of ['set-done','record','session-done']) cue(kind, {sound:true})
    expect(audio.beep).not.toHaveBeenCalled()
    expect(buzz).not.toHaveBeenCalled()
    cue('rest-over', {sound:true, vibrate:false}, ring)
    expect(ring).toHaveBeenCalledOnce()
    expect(audio.chime).not.toHaveBeenCalled()
  })

  it('supports an absent vibration API, muted rest alarm and blocked browser storage', () => {
    setup({vibrate:null})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('write refused') })
    const ring = vi.fn()
    cue('rest-over', {sound:false}, ring)
    expect(ring).not.toHaveBeenCalled()
    expect(() => cue('session-done', {sound:true})).not.toThrow()
    expect(audio.beep).toHaveBeenCalledTimes(3)
  })
})
