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

// While a timer is running the context is held open (holdSession). Two reasons, and the second
// is the one that matters in a gym: a suspended context is not "playing media", so iOS points the
// hardware volume buttons at the RINGER instead of the media channel the timer actually uses
// (audioSession 'playback'). Pressing volume-up between two beeps therefore turned up the wrong
// thing, and a phone whose media volume is low had no reachable way to fix it — which is what a
// timer that stays quiet however loud the app makes it looks like. Held, the buttons do what you
// expect for as long as the rest lasts. (The first reason is smaller: a tone never has to start
// from suspended.) The trade-off is the one the Settings switch already names — under 'playback'
// the phone's own music stays paused for the whole rest, not just across each beep.
let held = false
export function holdSession(on) {
  held = !!on
  if (held) { try { wake() } catch (e) { /* */ } } else sleepAfter(0)
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
    if (held) return          // a timer is running; holdSession(false) schedules the sleep instead
    try { if (audioCtx && audioCtx.state === 'running') { const p = audioCtx.suspend(); if (p && p.catch) p.catch(() => {}) } } catch (e) { /* */ }
  }, at - Date.now())
}

// How loud every tone in this file is (Settings → Sound volume, S.soundVol), applied page-wide by
// App.jsx like setPlayOnSilent rather than passed to every call.
//
// Gain is the wrong knob, and it took two measurements on the phone it is for to believe it:
// 0.35 → 1.0 on a sine changed nothing audible, and then a square at 0.5 and the same square at
// 1.0 came out the same as each other. A phone speaker sits behind a limiter, so above a fairly
// low ceiling more amplitude buys more limiting, not more sound — and a limiter is free to erase
// the difference between two levels that differ only by a multiplier. That is what "medium and
// loud sound the same" is.
//
// What a limiter cannot flatten is WHERE the energy sits. A phone driver has a few millimetres of
// excursion: at 660–880 Hz it is barely moving air, while 2–4 kHz is both its efficient band and
// the ear's most sensitive one. So each level differs in spectrum, on two axes that survive:
//
//   low    — a pure sine at the written pitch. All of it on the fundamental, down where neither
//            the speaker nor the ear is helping. Exactly what every build before this setting
//            shipped with, for anyone who liked the soft chime.
//   medium — a square at the written pitch: odd harmonics reaching up into the efficient band.
//   loud   — a square an OCTAVE UP, which moves the fundamental itself into that band and takes
//            the harmonics with it (the 660 Hz countdown tick becomes 1320 Hz, the rest-over
//            880 → 1760). The default, including for settings saved before the choice existed.
//
// Modelled against a phone's response and A-weighted: medium is ~8 dB over low and loud a further
// ~5 dB over medium, and those hold even in the worst case where the limiter pins every level to
// the same peak. The octave keeps every pattern, interval and duration intact — the sounds stay
// recognisably themselves, pitched up, rather than becoming different sounds.
//
// An octave is also where the curve flattens, which is worth knowing before anyone reaches for a
// bigger number: across the five notes this file plays, x2.5 is +0.1 dB on x2 and x3 is already
// -0.2 dB, because a small driver falls away above ~5 kHz as surely as it does below 1 kHz.
// Between that, the limiter on gain, and a square being the most energy a waveform can carry for
// a given peak, this is as loud as Web Audio goes on a phone.
// `tick` is the length of one countdown tick, and it is the fourth lever. The ear integrates
// loudness over roughly 200 ms, so below that a tone of twice the length is heard as about 3 dB
// louder for nothing — as much as the whole medium-to-loud step costs in spectrum. It applies to
// the countdown alone: the ticks are a second apart and have all the room in the world, while the
// rest-over patterns are 0.15 s apart and would run into each other and stop being countable.
export const VOLUMES = {
  low: { gain: 0.35, type: 'sine', pitch: 1, tick: 0.1 },
  medium: { gain: 0.7, type: 'square', pitch: 1, tick: 0.15 },
  loud: { gain: 1, type: 'square', pitch: 2, tick: 0.2 },
}
export const DEFAULT_VOLUME = 'loud'
let volume = VOLUMES[DEFAULT_VOLUME]
export function setVolume(level) { volume = VOLUMES[level] || VOLUMES[DEFAULT_VOLUME] }

// One tone. Returns the oscillator so a scheduled burst can still be called off (see hush).
const tone = (freq, dur, when) => {
  const ctx = wake()
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.connect(g); g.connect(ctx.destination)
  o.frequency.value = (freq || 880) * volume.pitch; o.type = volume.type
  const t0 = ctx.currentTime + (when || 0)
  g.gain.setValueAtTime(0.001, t0)
  g.gain.exponentialRampToValueAtTime(volume.gain, t0 + 0.02)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.18))
  o.start(t0); o.stop(t0 + (dur || 0.18) + 0.05)
  sleepAfter((when || 0) + (dur || 0.18) + 0.05)
  return o
}

export function beep(enabled, freq, dur, when) {
  if (!enabled) return
  try { tone(freq, dur, when) } catch (e) { /* */ }
}

// The last seconds of a timer, ticked out loud so you can put the phone down and still be
// ready. Scheduled as one burst the moment the timer starts, not beeped a tick at a time:
// setInterval is throttled to a crawl (often to once a minute) in a backgrounded tab or behind
// a locked screen, which is exactly where a phone spends a rest — so the tick-by-tick version
// counted you in only when you were already watching the screen. Audio that is queued inside
// the tap that started the timer keeps its own clock and plays regardless.
//
// A timer shorter than COUNTDOWN_SEC counts down from what it has. hush() is what makes the
// burst safe: every way a timer ends early (Skip, Done, Cancel, a new timer, the workout
// discarded) goes through it, so ticks for a rest that is already over never arrive late.
export const COUNTDOWN_SEC = 5
let ticks = []
export function countdown(enabled, secLeft) {
  hush()
  if (!enabled) return
  const left = Math.floor(Number(secLeft) || 0)
  try {
    for (let n = Math.min(COUNTDOWN_SEC, left); n >= 1; n--) ticks.push(tone(660, volume.tick, left - n))
  } catch (e) { /* */ }
}
export function hush() {
  for (const o of ticks) { try { o.stop(0) } catch (e) { /* */ } }
  ticks = []
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

// One rest-over sound per kind of rest, so you can tell without looking whether to stay at the
// station, go back to the top of the superset, or move on:
//   set   — same exercise, next set:          two mid beeps
//   round — a superset round is over:         three quick high beeps
//   block — this exercise (or superset) is finished and another follows: a long two-note chime
// None of them opens on the 660 Hz countdown tick, and none is a rising triple like the
// finish-workout fanfare (sheets.jsx) or the unchanged hold-done sound (useUI.js).
// The kind is decided in supersetFlow.restKind, next to the rule that decides whether a set
// earns a rest at all. Unknown kinds get the plain set sound.
const REST_OVER = {
  set: [[880, 0.15, 0], [880, 0.15, 0.25]],
  round: [[1100, 0.1, 0], [1100, 0.1, 0.15], [1100, 0.1, 0.3]],
  block: [[880, 0.25, 0], [1320, 0.5, 0.35]],
}
export function restOver(enabled, kind) {
  for (const [freq, dur, when] of REST_OVER[kind] || REST_OVER.set) beep(enabled, freq, dur, when)
}

export function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p) } catch (e) { /* */ } }
