// The voice behind Spoken cues (Settings → Timer alerts, lib/spoken-cues.js).
//
// On the phones it is the phone's own voice (lib/rest-alert.js speakNative: Android TextToSpeech,
// iPhone AVSpeechSynthesizer), because only the native side can ask the music to turn down for a
// moment and come back up, the way the end tone does, and because Android's WebView has no
// speechSynthesis at all. In a browser, and in a phone app from before this existed, it is the
// Web Speech API, which every current browser has (the music keeps its volume there: a page
// cannot duck another app). Neither ever pauses other audio.
//
// The voice (Settings → Timer alerts → Voice, v1.4.5) is one of the device's own voices for the
// app's language, or the system's default when none was picked. Voices differ per device (a
// Chrome voice does not exist on an iPhone), so the pick is kept on this device only
// (VOICE_KEY), never synced; a pick that is not on the device any more is the default again.
// Speed and pitch are numbers in S (speechRateN, speechPitch, 0.5 to 2, 1 is normal) and sync;
// `speechRate` (Slow, Normal, Fast) is how an app from before stored the speed, and is still
// written, rounded to the nearest of the three, for those apps.
import { MOBILE } from './mobile.js'
import { speakNative, hushNative, voicesNative } from './rest-alert.js'
import { dateLocale } from './i18n-core.js'

export const SPEECH_RATES = { slow: 0.8, normal: 1, fast: 1.25 }
export const speechRateOf = S => (S?.speechRate in SPEECH_RATES ? S.speechRate : 'normal')
export const SPEECH_MIN = 0.5
export const SPEECH_MAX = 2
const clampSpeech = n => Math.round(Math.min(SPEECH_MAX, Math.max(SPEECH_MIN, n)) * 100) / 100
const okNum = v => typeof v === 'number' && Number.isFinite(v)

/** The speed a profile speaks at, as a number (1 is normal). */
export const speechRateNum = S => (okNum(S?.speechRateN) ? clampSpeech(S.speechRateN) : SPEECH_RATES[speechRateOf(S)])
/** The pitch a profile speaks at (1 is normal). */
export const speechPitchNum = S => (okNum(S?.speechPitch) ? clampSpeech(S.speechPitch) : 1)

/** Sets the speed on a store draft, and the old Slow/Normal/Fast field an older app reads. */
export function setSpeechRate (s, n) {
  if (!okNum(n)) return
  s.speechRateN = clampSpeech(n)
  s.speechRate = s.speechRateN < 0.9 ? 'slow' : s.speechRateN > 1.12 ? 'fast' : 'normal'
}
export function setSpeechPitch (s, n) { if (okNum(n)) s.speechPitch = clampSpeech(n) }

const VOICE_KEY = 'og_speech_voice'
/** The voice picked on this device ('' for the system's default). */
export function pickedVoice () {
  try { return String(localStorage.getItem(VOICE_KEY) || '') } catch { return '' }
}
export function setPickedVoice (id) {
  try { if (id) localStorage.setItem(VOICE_KEY, String(id)); else localStorage.removeItem(VOICE_KEY) } catch { /* private mode: the default voice */ }
}

/** What speak() needs from a profile: { rate, pitch, voice }. */
export const voiceOpts = S => ({ rate: speechRateNum(S), pitch: speechPitchNum(S), voice: pickedVoice() })

/** The app's language as a voice language: 'de-DE', 'pt-BR', 'ar' (no Unicode extensions). */
export const speechLang = (loc = dateLocale()) => String(loc || 'en-GB').split('-u-')[0]

const webSpeech = () => (typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null)

/** Whether anything here can talk: the phone app always can (it falls back to the page if need be). */
export const speechSupported = () => MOBILE || !!webSpeech()

const normLang = l => String(l || '').replace('_', '-').toLowerCase()
/** Whether a voice (`lang` as the engine gives it) speaks `lang`: the same language, any region. */
export const voiceSpeaks = (vLang, lang) => {
  const a = normLang(vLang), b = normLang(lang)
  if (!a || !b) return false
  return a === b || a.split('-')[0] === b.split('-')[0]
}

// A voice for the language, picked once the browser has listed them: the one picked in Settings
// when it is there and speaks the language, else the browser's default voice for that language
// when it marks one, else the first that speaks it. None: the browser decides by `lang`.
function voiceFor(synth, lang, picked = '') {
  let voices = []
  try { voices = synth.getVoices() || [] } catch { return null }
  if (picked) {
    const own = voices.find(v => v.voiceURI === picked || v.name === picked)
    if (own && voiceSpeaks(own.lang, lang)) return own
  }
  const base = lang.split('-')[0].toLowerCase()
  const exact = voices.filter(v => (v.lang || '').toLowerCase().replace('_', '-') === lang.toLowerCase())
  const same = exact.length ? exact : voices.filter(v => (v.lang || '').toLowerCase().startsWith(base))
  return same.find(v => v.default) || same.find(v => v.localService) || same[0] || null
}

function speakWeb(text, { lang, rate, pitch, voice }) {
  const synth = webSpeech()
  if (!synth) return false
  try {
    const u = new window.SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = rate
    if (pitch !== 1) u.pitch = pitch
    const v = voiceFor(synth, lang, voice)
    if (v) u.voice = v
    synth.speak(u)
    return true
  } catch { return false }
}

/**
 * Says `text` now. `queue: false` (a countdown number) cuts off whatever is still being said, so
 * "3" is never heard after "2"; the default waits its turn. Resolves true once something took it.
 * `onSilent` is on by default: a voice someone switched on is heard through the iPhone's silent
 * switch and whether or not the end-of-rest sound is on (lib/spoken-cues.js VOICE_ON_SILENT).
 */
export async function speak(text, { rate = 1, pitch = 1, voice = '', lang = speechLang(), onSilent = true, queue = true } = {}) {
  if (!text) return false
  if (MOBILE && await speakNative(text, { lang, rate, pitch, voice, onSilent, flush: !queue })) return true
  if (!queue) { try { webSpeech()?.cancel() } catch { /* nothing to stop */ } }
  return speakWeb(text, { lang, rate, pitch, voice })
}

// The browser lists its voices late (Chrome only after 'voiceschanged'): wait a moment for them.
function webVoices(synth, wait = 1500) {
  let now = []
  try { now = synth.getVoices() || [] } catch { return Promise.resolve([]) }
  if (now.length || typeof synth.addEventListener !== 'function') return Promise.resolve(now)
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); try { synth.removeEventListener('voiceschanged', done) } catch { /* */ } try { resolve(synth.getVoices() || []) } catch { resolve([]) } }
    const timer = setTimeout(done, wait)
    synth.addEventListener('voiceschanged', done)
  })
}

const regionName = (tag, ui) => {
  const region = String(tag || '').split(/[-_]/)[1]
  if (!region || !/^[a-z]{2}$|^\d{3}$/i.test(region)) return ''
  try { return new Intl.DisplayNames([ui || 'en'], { type: 'region' }).of(region.toUpperCase()) || '' } catch { return region.toUpperCase() }
}
/**
 * A voice's name as the picker shows it. Android names its voices by code ("de-de-x-nfh-local",
 * "en-US-language"): those read as the region and the code ("Germany · NFH"); a real name stays.
 */
export function voiceLabel (v, ui = speechLang()) {
  const name = String(v?.name || v?.id || '')
  const code = /^([a-z]{2,3})[-_]([a-z0-9]{2,4})[-_]x[-_]([a-z0-9]+)(?:[-_](?:local|network))?$/i.exec(name)
  if (code) return [regionName(name, ui), code[3].toUpperCase()].filter(Boolean).join(' · ')
  if (/^[a-z]{2,3}[-_][a-z0-9]{2,4}[-_]language$/i.test(name)) return regionName(name, ui) || name
  return name
}

/**
 * The voices this device has for `lang`, as [{ id, name, lang, online }], sorted by name with the
 * exact region first. `online`: the voice needs the internet (some of Chrome's, a few of
 * Android's); `offline: true` leaves those out (openGym Offline has no network at all).
 * The phone's own list in the apps, the browser's elsewhere.
 */
export async function listVoices({ lang = speechLang(), offline = false } = {}) {
  let raw = []
  if (MOBILE) raw = (await voicesNative()) || []
  if (!raw.length) {
    const synth = webSpeech()
    if (synth) raw = (await webVoices(synth)).map(v => ({ id: v.voiceURI || v.name, name: v.name, lang: v.lang, online: v.localService === false }))
  }
  const seen = new Set()
  const out = []
  for (const v of raw) {
    if (!v || typeof v.id !== 'string' || !v.id || seen.has(v.id)) continue
    if (!voiceSpeaks(v.lang, lang)) continue
    const online = v.online === true
    if (offline && online) continue
    seen.add(v.id)
    const quality = v.quality === 'enhanced' || v.quality === 'premium' ? v.quality : null
    out.push({ id: v.id, name: String(v.name || v.id), lang: String(v.lang || ''), online, ...(quality ? { quality } : {}) })
  }
  const exact = v => (normLang(v.lang) === normLang(lang) ? 0 : 1)
  return out.sort((a, b) => exact(a) - exact(b) || a.name.localeCompare(b.name))
}

/** Stops speaking, and drops what was still waiting to be said. */
export function hush() {
  if (MOBILE) hushNative()
  try { webSpeech()?.cancel() } catch { /* nothing to stop */ }
}
