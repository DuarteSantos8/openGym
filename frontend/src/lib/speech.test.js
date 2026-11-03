// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { speak, hush, speechLang, speechSupported, speechRateOf } from './speech.js'

let spoken, cancelled
beforeEach(() => {
  spoken = []; cancelled = 0
  window.SpeechSynthesisUtterance = function (text) { this.text = text }
  window.speechSynthesis = {
    speak: u => spoken.push(u), cancel: () => { cancelled++ },
    getVoices: () => [{ lang: 'en-US', name: 'A' }, { lang: 'de-DE', name: 'Anna', localService: true }, { lang: 'de-AT', name: 'B', default: true }],
  }
})
afterEach(() => { delete window.speechSynthesis; delete window.SpeechSynthesisUtterance })

describe('the voice in a browser', () => {
  test('speaks in the language asked, with a voice for it, at the rate asked', async () => {
    expect(speechSupported()).toBe(true)
    expect(await speak('Satz 3', { lang: 'de-DE', rate: 1.25 })).toBe(true)
    expect(spoken[0]).toMatchObject({ text: 'Satz 3', lang: 'de-DE', rate: 1.25 })
    expect(spoken[0].voice.name).toBe('Anna')
  })
  test('a countdown number cuts off what is still being said', async () => {
    await speak('3', { lang: 'en-GB', queue: false })
    expect(cancelled).toBe(1)
    hush()
    expect(cancelled).toBe(2)
  })
  test('nothing to say, or no voice at all', async () => {
    expect(await speak('')).toBe(false)
    delete window.speechSynthesis
    expect(speechSupported()).toBe(false)
    expect(await speak('hello')).toBe(false)
  })
  test('the language and the rate setting', () => {
    expect(speechLang('bn-BD-u-nu-latn')).toBe('bn-BD')
    expect(speechLang('ar-u-nu-latn')).toBe('ar')
    expect(speechRateOf({ speechRate: 'fast' })).toBe('fast')
    expect(speechRateOf({ speechRate: 'warp' })).toBe('normal')
  })
})
void vi
