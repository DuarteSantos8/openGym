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

describe('the voice picker (v1.4.5)', () => {
  test('lists the voices for the language, the exact region first, online ones marked', async () => {
    window.speechSynthesis.getVoices = () => [
      { voiceURI: 'g-de', name: 'Google Deutsch', lang: 'de-DE', localService: false },
      { voiceURI: 'anna', name: 'Anna', lang: 'de-DE', localService: true },
      { voiceURI: 'at', name: 'Bert', lang: 'de_AT', localService: true },
      { voiceURI: 'en', name: 'Eve', lang: 'en-US', localService: true },
    ]
    const { listVoices } = await import('./speech.js')
    const all = await listVoices({ lang: 'de-DE' })
    expect(all.map(v => v.id)).toEqual(['anna', 'g-de', 'at'])
    expect(all.find(v => v.id === 'g-de').online).toBe(true)
    expect((await listVoices({ lang: 'de-DE', offline: true })).map(v => v.id)).toEqual(['anna', 'at'])
  })
  test('speaks in the voice picked, with its pitch; a voice of another language is not used', async () => {
    window.speechSynthesis.getVoices = () => [{ voiceURI: 'anna', name: 'Anna', lang: 'de-DE' }, { voiceURI: 'eve', name: 'Eve', lang: 'en-US' }, { voiceURI: 'otto', name: 'Otto', lang: 'de-DE', default: true }]
    await speak('Satz', { lang: 'de-DE', voice: 'anna', pitch: 1.4 })
    expect(spoken[0].voice.name).toBe('Anna')
    expect(spoken[0].pitch).toBe(1.4)
    await speak('Satz', { lang: 'de-DE', voice: 'eve' })
    expect(spoken[1].voice.name).toBe('Otto')
  })
  test('speed and pitch as numbers, the old three speeds still read and written', async () => {
    const { speechRateNum, speechPitchNum, setSpeechRate, setSpeechPitch, voiceOpts, setPickedVoice, pickedVoice } = await import('./speech.js')
    expect(speechRateNum({ speechRate: 'fast' })).toBe(1.25)
    expect(speechRateNum({ speechRate: 'fast', speechRateN: 0.7 })).toBe(0.7)
    const s = {}
    setSpeechRate(s, 3); expect(s).toEqual({ speechRateN: 2, speechRate: 'fast' })
    setSpeechRate(s, 0.75); expect(s.speechRate).toBe('slow')
    setSpeechRate(s, 1.05); expect(s.speechRate).toBe('normal')
    setSpeechPitch(s, 0.1); expect(speechPitchNum(s)).toBe(0.5)
    expect(speechPitchNum({ speechPitch: 'high' })).toBe(1)
    setPickedVoice('anna')
    expect(pickedVoice()).toBe('anna')
    expect(voiceOpts({ speechRateN: 1.5 })).toEqual({ rate: 1.5, pitch: 1, voice: 'anna' })
    setPickedVoice('')
    expect(pickedVoice()).toBe('')
  })
  test('Android voice codes read as a region and a code', async () => {
    const { voiceLabel } = await import('./speech.js')
    expect(voiceLabel({ name: 'de-de-x-nfh-local' }, 'en')).toBe('Germany · NFH')
    expect(voiceLabel({ name: 'en-GB-language' }, 'en')).toBe('United Kingdom')
    expect(voiceLabel({ name: 'Samantha' }, 'en')).toBe('Samantha')
  })
})
