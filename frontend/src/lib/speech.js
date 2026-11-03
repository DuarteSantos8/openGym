// The voice behind Spoken cues (Settings → Timer alerts, lib/spoken-cues.js).
//
// On the phones it is the phone's own voice (lib/rest-alert.js speakNative: Android TextToSpeech,
// iPhone AVSpeechSynthesizer), because only the native side can ask the music to turn down for a
// moment and come back up, the way the end tone does, and because Android's WebView has no
// speechSynthesis at all. In a browser, and in a phone app from before this existed, it is the
// Web Speech API, which every current browser has (the music keeps its volume there: a page
// cannot duck another app). Neither ever pauses other audio.
//
// The voice is the system's default for the app's language; the rate is Slow, Normal or Fast.
import { MOBILE } from './mobile.js'
import { speakNative, hushNative } from './rest-alert.js'
import { dateLocale } from './i18n-core.js'

export const SPEECH_RATES = { slow: 0.8, normal: 1, fast: 1.25 }
export const speechRateOf = S => (S?.speechRate in SPEECH_RATES ? S.speechRate : 'normal')

/** The app's language as a voice language: 'de-DE', 'pt-BR', 'ar' (no Unicode extensions). */
export const speechLang = (loc = dateLocale()) => String(loc || 'en-GB').split('-u-')[0]

const webSpeech = () => (typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null)

/** Whether anything here can talk: the phone app always can (it falls back to the page if need be). */
export const speechSupported = () => MOBILE || !!webSpeech()

// A voice for the language, picked once the browser has listed them: its default voice for that
// language when it marks one, else the first that speaks it. None: the browser decides by `lang`.
function voiceFor(synth, lang) {
  let voices = []
  try { voices = synth.getVoices() || [] } catch { return null }
  const base = lang.split('-')[0].toLowerCase()
  const exact = voices.filter(v => (v.lang || '').toLowerCase().replace('_', '-') === lang.toLowerCase())
  const same = exact.length ? exact : voices.filter(v => (v.lang || '').toLowerCase().startsWith(base))
  return same.find(v => v.default) || same.find(v => v.localService) || same[0] || null
}

function speakWeb(text, { lang, rate }) {
  const synth = webSpeech()
  if (!synth) return false
  try {
    const u = new window.SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = rate
    const v = voiceFor(synth, lang)
    if (v) u.voice = v
    synth.speak(u)
    return true
  } catch { return false }
}

/**
 * Says `text` now. `queue: false` (a countdown number) cuts off whatever is still being said, so
 * "3" is never heard after "2"; the default waits its turn. Resolves true once something took it.
 */
export async function speak(text, { rate = 1, lang = speechLang(), onSilent = false, queue = true } = {}) {
  if (!text) return false
  if (MOBILE && await speakNative(text, { lang, rate, onSilent, flush: !queue })) return true
  if (!queue) { try { webSpeech()?.cancel() } catch { /* nothing to stop */ } }
  return speakWeb(text, { lang, rate })
}

/** Stops speaking, and drops what was still waiting to be said. */
export function hush() {
  if (MOBILE) hushNative()
  try { webSpeech()?.cancel() } catch { /* nothing to stop */ }
}
