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

export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try {
    const ctx = wake()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.frequency.value = freq || 880; o.type = 'sine'
    const t0 = ctx.currentTime + (when || 0)
    g.gain.setValueAtTime(0.001, t0)
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.18))
    o.start(t0); o.stop(t0 + (dur || 0.18) + 0.05)
    sleepAfter((when || 0) + (dur || 0.18) + 0.05)
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


export function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ } }
