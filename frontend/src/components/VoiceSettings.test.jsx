// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [] }
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
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, nativePlatform: () => Promise.resolve(null) }))

const { default: VoiceSettings, momentSummary, micErrorText, recordType } = await import('./VoiceSettings.jsx')

let host, root, spoken
beforeEach(() => {
  spoken = []
  window.SpeechSynthesisUtterance = function (text) { this.text = text }
  window.speechSynthesis = { speak: u => spoken.push(u), cancel: () => {}, getVoices: () => [{ voiceURI: 'anna', name: 'Anna', lang: 'en-GB', localService: true }, { voiceURI: 'hans', name: 'Hans', lang: 'de-DE' }] }
  mocks.S = { unit: 'kg', spokenCues: true }
  mocks.sheets = []
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
    expect(rowTitled('Voice').querySelector('.lrow-v').textContent).toBe('Default voice')
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
    expect(titles()).toEqual(['Default voice', 'Anna'])
    await act(async () => { rowTitled('Anna').click() })
    expect(localStorage.getItem('og_speech_voice')).toBe('anna')
    expect(spoken.at(-1).voice.name).toBe('Anna')
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
