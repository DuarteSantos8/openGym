// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [], opts: [], mobile: false, voices: { voices: [], auto: null, ios: false }, subs: [], refresh: () => Promise.resolve() }
  state.snapshot = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: render => { mocks.sheets.push(render) } })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.mobile }, nativePlatform: () => Promise.resolve(null) }))
// The phone's voice list is the lib's business (speech.test.js); here it is whatever the test says.
vi.mock('../lib/speech.js', async importOriginal => {
  const o = await importOriginal()
  return {
    ...o,
    speak: (text, opts) => { mocks.opts.push(opts); return o.speak(text, opts) },
    voiceState: () => mocks.voices,
    onVoices: cb => { mocks.subs.push(cb); return () => {} },
    refreshVoices: () => mocks.refresh(),
  }
})

const { default: VoiceSettings, momentSummary, micErrorText, recordType } = await import('./VoiceSettings.jsx')

let host, root, spoken
beforeEach(() => {
  spoken = []
  window.SpeechSynthesisUtterance = function (text) { this.text = text }
  window.speechSynthesis = { speak: u => spoken.push(u), cancel: () => {}, getVoices: () => [{ voiceURI: 'anna', name: 'Anna', lang: 'en-GB', localService: true }, { voiceURI: 'hans', name: 'Hans', lang: 'de-DE' }] }
  mocks.S = { unit: 'kg', spokenCues: true }
  mocks.sheets = []
  mocks.opts = []
  mocks.subs = []
  mocks.refresh = () => Promise.resolve()
  mocks.mobile = false
  mocks.voices = { voices: [{ id: 'anna', name: 'Anna', lang: 'en-GB', online: false }], auto: null, ios: false }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
  try { localStorage.clear() } catch { /* */ }
})

const render = async el => { await act(async () => { root.render(el) }); await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const titles = () => [...host.querySelectorAll('.lrow .lrow-t')].map(e => e.textContent)
const rowTitled = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)

describe('Settings → Timer alerts → Voice', () => {
  it('shows the voice, speed, pitch, the styles and the moments', async () => {
    await render(<VoiceSettings />)
    expect(titles()).toEqual(['Voice', 'Speed', 'Pitch', 'Try it', 'Just the facts', 'Calm coach', 'Drill sergeant', 'Hype man', 'Deadpan', 'Your own lines',
      'When a rest starts', '10 seconds left', 'When the rest is over', 'Before the last set', 'New record'])
    expect(rowTitled('Voice').querySelector('.lrow-v').textContent).toBe('Automatic')
    expect(rowTitled('Just the facts').querySelector('.lrow-k')).not.toBeNull()
    expect(host.querySelectorAll('[role="slider"]')).toHaveLength(2)
    expect(host.querySelector('[role="slider"]').getAttribute('aria-valuetext')).toBe('1×')
  })
  it('picking a style says one of its lines and keeps it', async () => {
    await render(<VoiceSettings />)
    await act(async () => { rowTitled('Hype man').click() })
    expect(mocks.S.cueStyle).toBe('hype')
    expect(spoken.at(-1).text).toBe('LET’S GO! ONE MORE, CHAMP!')
  })
  it('the voice sheet lists this language’s voices; a pick is kept on this device', async () => {
    await render(<VoiceSettings />)
    await act(async () => { rowTitled('Voice').click() })
    expect(mocks.sheets).toHaveLength(1)
    const { VoiceSheetForTest } = { VoiceSheetForTest: mocks.sheets[0] }
    await render(VoiceSheetForTest(() => {}))
    expect(titles()).toEqual(['Automatic', 'Anna'])
    await act(async () => { rowTitled('Anna').click() })
    expect(localStorage.getItem('og_speech_voice')).toBe('anna')
    expect(spoken.at(-1).voice.name).toBe('Anna')
  })
  describe('the voice sheet and the iPhone hint', () => {
    const phone = (voices, auto, ios = true) => { mocks.mobile = true; mocks.voices = { voices, auto, ios } }
    const anna = { id: 'anna', name: 'Anna', lang: 'en-GB', online: false }
    const serena = { id: 'serena', name: 'Serena', lang: 'en-GB', online: false, quality: 'premium' }
    const sheetText = async () => { await render(mocks.sheets[0](() => {})); return host.textContent }
    const openSheet = async () => { await act(async () => { rowTitled('Voice').click() }) }
    const hint = 'Better voices need a download. Tap Voice to see how.'
    it('a stuck iPhone says Standard voice, points to the sheet, and the sheet says how', async () => {
      phone([anna], null)
      await render(<VoiceSettings />)
      expect(rowTitled('Voice').querySelector('.lrow-v').textContent).toBe('Standard voice')
      expect(host.textContent).toContain(hint)
      await openSheet()
      const text = await sheetText()
      expect(text).toContain('British English')
      expect(text).toContain('Settings → Accessibility → Read & Speak → Voices')
      expect(text).toContain('Uses your phone’s standard voice.')
    })
    it('a premium voice is named by the Automatic row, and nothing says stuck', async () => {
      phone([serena, anna], serena)
      await render(<VoiceSettings />)
      expect(rowTitled('Voice').querySelector('.lrow-v').textContent).toBe('Automatic')
      expect(host.textContent).not.toContain(hint)
      await openSheet()
      await render(mocks.sheets[0](() => {}))
      expect(rowTitled('Automatic').querySelector('.lrow-s').textContent).toBe('Uses Serena (Premium), the best British English voice on this iPhone.')
      expect(titles()).toEqual(['Automatic', 'Serena', 'Anna'])
      expect(rowTitled('Serena').querySelector('.lrow-s').textContent).toBe('Premium · British English')
      expect(host.textContent).toContain('More voices: Settings → Accessibility → Read & Speak → Voices.')
      expect(host.textContent).not.toContain('only has the standard voice')
      await act(async () => { rowTitled('Automatic').click() })
      expect(mocks.opts.at(-1).voice).toBe('serena')
      expect(localStorage.getItem('og_speech_voice')).toBeNull()
    })
    it('an American iPhone in an English app: the hint names American English', async () => {
      phone([{ ...anna, lang: 'en-US' }], null)
      mocks.voices.tag = 'en-US'
      await render(<VoiceSettings />)
      await openSheet()
      const text = await sheetText()
      expect(text).toContain('American English')
      expect(text).not.toContain('British English')
    })
    it('a voice downloaded while away shows in the Voice row when the refresh lands', async () => {
      phone([anna], null)
      await render(<VoiceSettings />)
      expect(rowTitled('Voice').querySelector('.lrow-v').textContent).toBe('Standard voice')
      mocks.voices = { voices: [serena, anna], auto: serena, ios: true }
      await act(async () => { mocks.subs.forEach(cb => cb()) })
      expect(rowTitled('Voice').querySelector('.lrow-v').textContent).toBe('Automatic')
    })
    it('before the first listing the Voice row shows no value', async () => {
      phone(null, null, false)
      await render(<VoiceSettings />)
      expect(rowTitled('Voice').querySelector('.lrow-v')).toBeNull()
    })
    it('a listing that fails still lets the sheet open, with nothing to pick', async () => {
      phone(null, null, false)
      mocks.refresh = () => Promise.reject(new Error('no list'))
      await render(<VoiceSettings />)
      await openSheet()
      expect(mocks.sheets).toHaveLength(1)
      expect(await sheetText()).toContain('No other voices')
    })
    it('Android gets no "on this iPhone" subtitle and no standard-voice note', async () => {
      phone([anna], null, false)
      await render(<VoiceSettings />)
      await openSheet()
      await render(mocks.sheets[0](() => {}))
      expect(rowTitled('Automatic').querySelector('.lrow-s')).toBeNull()
    })
    it('Android and the web get no download hint', async () => {
      for (const mobile of [true, false]) {
        phone([anna], null, false)
        mocks.mobile = mobile
        await render(<VoiceSettings />)
        expect(rowTitled('Voice').querySelector('.lrow-v').textContent).toBe('Automatic')
        expect(host.textContent).not.toContain(hint)
        await openSheet()
        const text = await sheetText()
        expect(text).not.toContain('Read & Speak')
        mocks.sheets = []
      }
    })
    it('a picked voice shows its name and no hint', async () => {
      phone([anna], null)
      localStorage.setItem('og_speech_voice', 'anna')
      await render(<VoiceSettings />)
      expect(rowTitled('Voice').querySelector('.lrow-v').textContent).toBe('Anna')
      expect(host.textContent).not.toContain(hint)
    })
  })
  it('a moment says what it holds', () => {
    const m = { kind: 'audio', hash: 'a'.repeat(64), mime: 'audio/wav', size: 10, width: 1, height: 1, dur: 1 }
    expect(momentSummary({}, 'restOver')).toBe('Rest is over')
    expect(momentSummary({}, 'record')).toBe('Quiet')
    expect(momentSummary({ sounds: [{ id: 'v', name: 'x', m, voice: 'record' }] }, 'record')).toBe('Your clip')
  })
  it('editing a pack’s lines makes them your own', async () => {
    mocks.S.cueStyle = 'drill'
    await render(<VoiceSettings />)
    await act(async () => { rowTitled('New record').click() })
    await render(mocks.sheets[0](() => {}))
    expect(titles()).toContain('New record. I am almost impressed.')
    await act(async () => { rowTitled('Edit these lines').click() })
    expect(mocks.S.cueStyle).toBe('own')
    expect(mocks.S.cueLines.record).toEqual(['New record. I am almost impressed.', 'Personal best! Don’t let it go to your head.'])
    expect(mocks.S.cueLines.restOver).toEqual(['Break’s over. Move it!', 'Back on the bar. That was not a request.'])
  })
  it('the microphone and the recorder', () => {
    expect(micErrorText({ name: 'NotAllowedError' })).toMatch(/microphone is off/)
    expect(micErrorText(new Error('x'))).toMatch(/No microphone/)
    expect(recordType({ isTypeSupported: x => x === 'audio/webm' })).toBe('audio/webm')
    expect(recordType(undefined)).toBe('')
  })
})
