// @vitest-environment happy-dom
// Display and voice in the profile (1.4.6): a profile without them takes this device's, one that
// arrives from another device is applied here, and nothing is written when nothing differs.
import { beforeEach, describe, expect, it } from 'vitest'
import { syncPrefs, savePrefs, prefsOf } from './device-prefs-sync.js'
import { readDisplay, applyDisplay, _resetDisplay } from './display-prefs.js'
import { pickedVoice, setPickedVoice } from './speech.js'

const store = S => ({ S, update: fn => { fn(S) } })

beforeEach(() => {
  localStorage.clear()
  _resetDisplay()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
})

describe('device prefs in the profile', () => {
  it('a profile without prefs and a device on the defaults: nothing is written', () => {
    const { S, update } = store({})
    expect(syncPrefs(S, update)).toBe('same')
    expect(S.prefs).toBeUndefined()
  })

  it("a profile without prefs takes this device's", () => {
    applyDisplay({ motion: 'less', text: 'large' }, { save: true })
    setPickedVoice('Anna')
    const { S, update } = store({})
    expect(syncPrefs(S, update)).toBe('pushed')
    expect(prefsOf(S)).toEqual({ display: { motion: 'less', text: 'large' }, voice: { web: 'Anna' } })
  })

  it('prefs from another device are applied and cached here', () => {
    const { S, update } = store({ prefs: { display: { motion: 'less', text: 'larger' }, voice: { web: 'Daniel', ios: 'com.apple.voice.Siri' } } })
    expect(syncPrefs(S, update)).toBe('applied')
    expect(readDisplay()).toEqual({ motion: 'less', text: 'larger' })
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
    expect(document.documentElement.style.fontSize).toBe('125%')
    expect(pickedVoice()).toBe('Daniel')
    expect(syncPrefs(S, update)).toBe('same')
  })

  it('a change here goes into the profile; junk in the profile is cleaned', () => {
    const { S, update } = store({})
    applyDisplay({ motion: 'system', text: 'small' }, { save: true })
    savePrefs(update)
    expect(S.prefs).toEqual({ display: { motion: 'system', text: 'small' }, voice: {} })
    S.prefs = { display: { motion: 'wild', text: 'huge' }, voice: 7 }
    syncPrefs(S, update)
    expect(readDisplay()).toEqual({ motion: 'system', text: 'small' })
  })
})

describe('the voice, per platform', () => {
  it("a pick here never changes another platform's, and theirs never blanks ours", () => {
    const { S, update } = store({ prefs: { display: { motion: 'system', text: 'default' }, voice: { ios: 'Siri Voice 2' } } })
    expect(syncPrefs(S, update)).toBe('same')
    expect(pickedVoice()).toBe('')
    setPickedVoice('Google Deutsch')
    savePrefs(update)
    expect(S.prefs.voice).toEqual({ ios: 'Siri Voice 2', web: 'Google Deutsch' })
    setPickedVoice('')
    savePrefs(update)
    expect(S.prefs.voice).toEqual({ ios: 'Siri Voice 2' })
  })

  it('a voice picked here before the profile had one for this platform goes up', () => {
    setPickedVoice('Anna')
    const { S, update } = store({ prefs: { display: { motion: 'system', text: 'default' }, voice: { android: 'x' } } })
    expect(syncPrefs(S, update)).toBe('pushed')
    expect(S.prefs.voice).toEqual({ android: 'x', web: 'Anna' })
  })
})
