// WebAudio beeps + haptics (ported from the vanilla app). `enabled` gates sound.
//
// iOS needs three things a desktop browser does not (#152, "flash but no beep"):
//  1. The ring/silent switch mutes Web Audio. WebKit gives a page whose only audio is Web Audio
//     the Ambient category, and Ambient obeys the switch — at a gym the phone is usually on
//     silent, so the timer was mute exactly where it mattered. The only way out is the
//     'playback' audio-session type (iOS 17+), which is exclusive: it pauses whatever else the
//     phone is playing, and WebKit never tells that app it may resume. Hence a setting
//     (setPlayOnSilent), off by default, rather than something done for everyone.
//  2. Locking the screen or switching apps moves a running context to 'interrupted'. WebKit
//     only brings it back by itself if it was running when the interruption began; a context
//     that was suspended comes back suspended, and a suspended context makes no sound. So every
//     tone resumes the context first — allowed without a tap once the context has started
//     inside one.
//  3. A context created outside a tap starts 'suspended' and no timer tick can start it.
//     unlock() runs from the taps that lead to a timer (set check, hold start, turning Sounds
//     on) so the context has started before any tick needs it.
//
// The context is suspended again a second after the last tone: an idle context otherwise keeps
// rendering silence for the rest of the page, and under 'playback' keeps the phone's audio
// session busy. (Suspending does NOT hand the phone back to a paused music app — see 1.)
let audioCtx = null
let idleTm = null
let idleAt = 0

const ctxFor = () => {
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  return audioCtx
}

const wake = () => {
  const ctx = ctxFor()
  if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}) }
  return ctx
}

// Suspend once every scheduled tone is over. A burst schedules several tones in one go; the
// latest end wins, and a tone scheduled while the timer is pending pushes it out.
const sleepAfter = endSec => {
  const at = Date.now() + endSec * 1000 + 1000
  if (at <= idleAt && idleTm) return
  idleAt = at
  clearTimeout(idleTm)
  idleTm = setTimeout(() => {
    idleTm = null
    try { if (audioCtx && audioCtx.state === 'running') { const p = audioCtx.suspend(); if (p && p.catch) p.catch(() => {}) } } catch (e) { /* */ }
  }, at - Date.now())
}

// A timbre brighter than a sine: the fundamental plus three falling harmonics. It carries over
// music and through a phone speaker's weak low end without a square wave's buzz. The browser
// normalises a periodic wave to a peak of 1, so the gain alone decides how loud it gets. Built
// once per context; a browser without createPeriodicWave gets the nearest built-in shape.
let brightWave = null
let brightCtx = null
const setBright = (ctx, o) => {
  if (typeof ctx.createPeriodicWave !== 'function') { o.type = 'triangle'; return }
  if (brightCtx !== ctx) {
    brightCtx = ctx
    brightWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.6, 0.35, 0.2]))
  }
  o.setPeriodicWave(brightWave)
}

// One tone. The defaults are every beep the app has always made: a sine that reaches 0.35 and
// fades from there at once. `peak`, `hold` (the share of the tone kept at its peak before the
// fade) and `bright` exist for the timer chime below.
const tone = (freq, dur, when, { peak = 0.35, hold = 0, bright = false } = {}) => {
  const ctx = wake()
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.connect(g); g.connect(ctx.destination)
  o.frequency.value = freq
  if (bright) setBright(ctx, o); else o.type = 'sine'
  const t0 = ctx.currentTime + when
  g.gain.setValueAtTime(0.001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.02)
  if (hold > 0) g.gain.setValueAtTime(peak, t0 + dur * hold)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  o.start(t0); o.stop(t0 + dur + 0.05)
  sleepAfter(when + dur + 0.05)
}

export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try { tone(freq || 880, dur || 0.18, when || 0) } catch (e) { /* */ }
}

// The end of a rest or a hold (store/useUI.js). It used to be three of the beeps above and went
// unheard under music (Discord: "Rest Timer Sound Notification too Quiet"): an exponential fade
// from 0.35 is down to a tenth of that before the tone is half over. So this one
//  - peaks at CHIME_PEAK instead of 0.35. The output clips above 1, and the notes are spaced so
//    that each has stopped before the next starts, so they never add up past the peak;
//  - holds that peak for most of each note instead of fading from the first millisecond;
//  - uses the brighter timbre;
//  - has a shape of its own, high, low, then high and long (E6 B5 E6), that neither the 3-2-1
//    ticks before it (660 Hz), a set tick (1040 Hz) nor the rising finish fanfare has.
// It does not turn other apps down. A web page cannot duck another app's audio: Android only
// grants audio focus to native code, and on iOS the 'playback' session pauses the music (1. above).
//
// Some people preferred the original under music — quieter is not a defect for everyone, e.g.
// headphones at the gym rather than a phone speaker next to a stereo. Settings → "Classic timer
// sound" (S.classicChime) picks between the two without reviving the three separate beep() calls
// this replaced: CLASSIC is the exact same three tones, just driven through the same tone() path
// as the chime below, so both share one gating/try-catch and one sleepAfter bookkeeping.
export const CHIME_PEAK = 0.9
const CHIME = [[1319, 0.16, 0], [988, 0.16, 0.22], [1319, 0.5, 0.44]]
const CLASSIC = [[880, 0.15, 0], [880, 0.15, 0.25], [1320, 0.4, 0.5]]
export function chime(enabled, classic) {
  if (!enabled) return
  try {
    if (classic) CLASSIC.forEach(([freq, dur, when]) => tone(freq, dur, when))
    else CHIME.forEach(([freq, dur, when]) => tone(freq, dur, when, { peak: CHIME_PEAK, hold: 0.6, bright: true }))
  } catch (e) { /* */ }
}

// Call from inside a tap. Gets the context created and running while the browser still counts
// this as a user gesture; it goes back to sleep on its own. Nothing audible.
export function unlock(enabled) {
  if (!enabled) return
  try { wake(); sleepAfter(0) } catch (e) { /* */ }
}

// Settings → "Play sounds when the phone is on silent". Offered only where it means something:
// a WebKit with the audio-session API (iOS 17+) on a device that has a ring/silent switch or its
// Control Centre equivalent — iPhone, or an iPad (which reports itself as a Mac with a touch
// screen). macOS Safari has the API but no switch, and other browsers have neither.
// 'playback' ignores the switch; 'auto' is the browser's own choice (Ambient for a page like
// this one). Applied by App.jsx whenever the setting is loaded or changed.
export const playOnSilentSupported = () => {
  if (typeof navigator === 'undefined' || !navigator.audioSession) return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
export function setPlayOnSilent(on) {
  if (!playOnSilentSupported()) return
  try { navigator.audioSession.type = on ? 'playback' : 'auto' } catch (e) { /* */ }
}

// Settings → "Vibrate" (Discord, asierlama): the buzz at the end of a rest or a hold and on a set
// tick, switched on its own the way Sounds is. A page-level switch like setPlayOnSilent, applied
// by App.jsx, so the places that buzz do not each have to read the profile. On by default.
let buzz = true
export function setVibrate(on) { buzz = on !== false }
// Offered where the browser can buzz at all: iOS has no navigator.vibrate. The Android app needs
// android.permission.VIBRATE in its manifest, without which the WebView drops every call.
export const vibrateSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
export function vibrate(p) {
  if (!buzz) return
  try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ }
}
