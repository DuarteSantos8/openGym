// Spoken cues (Settings → Timer alerts → Spoken cues, off by default): the timer says what it
// knows, so the phone can stay in the pocket.
//
//   rest starts      the next set: "Set 3, 80 kilos, 8 reps" (with the exercise's name first when
//                    the next set is another exercise's, as in a superset or after the last set)
//   10 s to go       "10 seconds" (rests of 20 seconds or more)
//   rest over        "Rest is over"
//   timed holds      "3", "2", "1", "Go!" through the count-in of a hold that starts by itself,
//                    and "3", "2", "1" at the end of every hold
//
// All of it in the app's language, through lib/speech.js (the phone's voice, which turns music
// down for a moment and never pauses it; the browser's elsewhere). Only while a workout runs and
// the page is on screen: a locked phone keeps the end tone and the notification it always had.
// useUI calls these at the moments above; what to say is worked out here, from the state.
//
// Settings → Timer alerts → Voice (v1.4.5) adds a voice, a speed and a pitch (lib/speech.js), a
// style for the moments (lib/voice-styles.js: a line after the next set, at 10 s, at the end, on
// the last set and on a record) and clips of one's own per moment (lib/voice-clips.js), played
// instead of that moment's line. A clip and a spoken line never talk over each other: a line
// waits for a clip to finish, and a clip for the lines before it (by an estimate of how long
// they take to say, since a phone's voice only says when it took a line, not when it is done).
import { isWarmupRow, isSideSet } from './workout-model.js'
import { modeOf, supersetUnits, lastEntryFor } from './history.js'
import { fmtNum } from './format.js'
import { t, tn, tnf, exerciseNameFor } from './i18n-core.js'
import { EXIDX } from './exercises.js'
import { viewEntry, exUnitOf, shownWeight } from './ex-unit.js'
import { speak, voiceOpts } from './speech.js'
import { pickLine, linesFor, cueLevelOf, cueStyleOf, NEWS } from './voice-styles.js'
import { setOutcome } from './set-outcome.js'
import { sessionHistory } from './backfill.js'
import { pickClip, voiceClipsOf } from './voice-clips.js'
import { MOBILE } from './mobile.js'

/** Whether cues are on for this profile, and a workout is running. */
export const cuesOn = S => S?.spokenCues === true && !!S?.active

// The number a set row goes by: work sets and warm-ups are counted apart, a per-side timed pair is one.
function setNumber(sets, i) {
  const warm = isWarmupRow(sets[i])
  const n = sets.slice(0, i + 1).filter(x => isWarmupRow(x) === warm).length
  return sets[i]?.side ? Math.ceil(n / 2) : n
}

const notDone = s => !!s && !(isSideSet(s) ? s.sides.L.done && s.sides.R.done : s.done)

/**
 * The set that comes after a rest started by entry `forIdx`: in a superset the next exercise of
 * the group that still has a set to do (round and round), else the same exercise, else the next
 * exercise down the list with one. `{ idx, i }` or null when the workout is done.
 */
export function nextSetAfter(active, forIdx) {
  const entries = active?.entries || []
  if (!entries.length) return null
  const firstOpen = idx => { const i = (entries[idx]?.sets || []).findIndex(notDone); return i >= 0 ? { idx, i } : null }
  const at = Number.isInteger(forIdx) && forIdx >= 0 && forIdx < entries.length ? forIdx : (active.cur || 0)
  const unit = supersetUnits(entries).find(u => u.includes(at)) || [at]
  if (unit.length > 1) {
    const k = unit.indexOf(at)
    for (let j = 1; j <= unit.length; j++) { const hit = firstOpen(unit[(k + j) % unit.length]); if (hit) return hit }
  } else {
    const hit = firstOpen(at)
    if (hit) return hit
  }
  for (let j = 1; j < entries.length; j++) { const hit = firstOpen((at + j) % entries.length); if (hit) return hit }
  return null
}

const weightWords = (w, unit) => (unit === 'lb' ? tnf('{0} pound', '{0} pounds', w, fmtNum(w)) : tnf('{0} kilo', '{0} kilos', w, fmtNum(w)))

/**
 * What to say for set `i` of `entry` ("Set 3, 80 kilos, 8 reps"). `name` (the exercise's) goes
 * first when given. Weights are read in the unit the exercise is shown in.
 */
export function setCueText(S, entry, i, { name = null } = {}) {
  const view = viewEntry(S, entry) || entry
  const s = view?.sets?.[i]
  if (!s) return ''
  const unit = exUnitOf(S, entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const parts = [isWarmupRow(s) ? t('Warm-up') : t('Set {0}', setNumber(view.sets, i))]
  const w = Number(s.w) || 0
  if (mode === 'cardio') {
    const min = Number(s.min) || 0
    if (min > 0) parts.push(tnf('{0} minute', '{0} minutes', min, fmtNum(min)))
  } else if (mode === 'time') {
    if (w > 0) parts.push(weightWords(w, unit))
    const sec = Number(s.sec ?? entry.target?.sec) || 0
    if (sec > 0) parts.push(tn('{0} second', '{0} seconds', sec))
  } else {
    if (w > 0) parts.push(weightWords(w, unit))
    if (isSideSet(s)) {
      const r = Number(s.sides.L.r) || 0
      if (r > 0) parts.push(tn('{0} rep per side', '{0} reps per side', r))
    } else {
      const r = Number(s.r) || 0
      if (r > 0) parts.push(tn('{0} rep', '{0} reps', r))
    }
  }
  const line = parts.join(', ')
  return name ? `${name}. ${line}` : line
}

/** The line said when a rest starts after a set of entry `forIdx`, or '' when nothing is left. */
export function restStartText(S, forIdx) {
  const next = nextSetAfter(S?.active, forIdx)
  if (!next) return ''
  const entry = S.active.entries[next.idx]
  const other = next.idx !== forIdx
  const ex = EXIDX[entry.id]
  const name = other ? (ex ? exerciseNameFor(ex) : (entry.n || '')) || null : null
  return setCueText(S, entry, next.i, { name })
}

/** Whether the next set (`next`, from nextSetAfter) is the last work set of its exercise. */
export function isLastSet(active, next) {
  const sets = active?.entries?.[next?.idx]?.sets || []
  const s = sets[next?.i]
  if (!s || isWarmupRow(s)) return false
  // The other half of a per-side pair is the same set.
  return !sets.some((x, j) => j !== next.i && notDone(x) && !isWarmupRow(x))
}

/* ------------------------------ the moments useUI calls ------------------------------ */

let readStore = null
/** useUI hands over how to read the profile (it owns no copy of it). */
export function bindCueState(get) { readStore = get }

const live = () => {
  const S = readStore?.()
  return cuesOn(S) && !(typeof document !== 'undefined' && document.hidden) ? S : null
}

// About how long a line takes to say, in ms: enough for a clip not to start over it.
export const speechMs = (text, rate = 1) => Math.round((350 + String(text || '').length * 65) / (rate > 0 ? rate : 1))
const GAP = 150
// The voice is heard whatever the end-of-rest sound and the ring/silent switch say (TestFlight
// 11-08: "the voice can only be heard if I have the notification sound activated"). Spoken cues
// are their own opt-in, so a lifter who switched them on wants to hear them, the iPhone on silent
// included. On the iPhone that is the .playback session with mixWithOthers and duckOthers
// (CueAudioLedger): music still only turns down for a line, it never stops.
export const VOICE_ON_SILENT = true
let freeAt = 0      // when everything handed over so far should be done
let clipUntil = 0   // until when a clip is playing: a line waits for it

const sayNow = (S, text, opts = {}) => {
  const o = voiceOpts(S)
  speak(text, { ...o, onSilent: VOICE_ON_SILENT, ...opts }).catch?.(() => {})
  freeAt = Math.max(freeAt, Date.now()) + speechMs(text, o.rate)
}
const say = (S, text, opts = {}) => {
  if (!text) return
  if (opts.queue === false) { clipUntil = 0; freeAt = Date.now(); sayNow(S, text, opts); return }
  const wait = clipUntil - Date.now()
  if (wait > 0) {
    freeAt = Math.max(freeAt, clipUntil) + speechMs(text, voiceOpts(S).rate)
    setTimeout(() => { const now = readStore?.() || S; speak(text, { ...voiceOpts(now), onSilent: VOICE_ON_SILENT, ...opts }).catch?.(() => {}) }, wait)
    return
  }
  sayNow(S, text, opts)
}

// How a clip is played: the phone's own player in the apps (music ducks for it, as for the end
// tone), Web Audio elsewhere or when that fails. Resolves false when the file is not here.
let clipPlayer = async clip => {
  const { mediaStore } = await import('./media-store.js')
  if (!(await mediaStore.has(clip.m.hash))) return false
  const tone = 'u:' + clip.m.hash
  if (MOBILE) {
    const { toneNative } = await import('./rest-alert.js')
    if (await toneNative(tone, { onSilent: VOICE_ON_SILENT })) return true
  }
  const { playUserTone, unlock } = await import('./sound.js')
  unlock(true)
  return playUserTone(true, tone)
}
/** Test seam: how a clip is played. */
export function _setClipPlayer(fn) { clipPlayer = fn }
export function _resetCueQueue() { freeAt = 0; clipUntil = 0; recordFor = newsFor = null }

// A clip after whatever was said before it; `fallback`, the moment's line, if it cannot play.
function playClip(S, clip, fallback) {
  const now = Date.now()
  const start = Math.max(now, freeAt, clipUntil)
  const dur = Math.max(300, Math.round((Number(clip.m.dur) || 2) * 1000))
  clipUntil = freeAt = start + dur + GAP
  const go = () => {
    Promise.resolve().then(() => clipPlayer(clip)).then(ok => {
      if (ok) return
      clipUntil = 0
      if (fallback) say(S, fallback)
    }, () => { clipUntil = 0; if (fallback) say(S, fallback) })
  }
  if (start > now) setTimeout(go, start - now); else go()
}

/** A moment: a clip of one's own when it has one, else a line of the style ('' says nothing). */
function moment(S, name) {
  const clip = pickClip(S, name)
  if (clip) { playClip(S, clip, pickLine(S, name)); return }
  say(S, pickLine(S, name))
}
const hasSomething = (S, name) => voiceClipsOf(S, name).length > 0 || linesFor(S, name).length > 0

const nameOf = entry => { const ex = EXIDX[entry?.id]; return (ex ? exerciseNameFor(ex) : (entry?.n || '')) || '' }
const repsWords = (r, side) => (side ? tn('{0} rep per side', '{0} reps per side', r) : tn('{0} rep', '{0} reps', r))

// The set a record trophy was just shown for (cheerRecord runs before the rest starts), so that
// set's rest says no outcome line: the record was its news. Cleared by the next rest, and by a
// new or finished workout, so a record with no rest after it (the last set, rest off) cannot
// leak onto a set of the same position later.
let recordFor = null
// The set whose news was said, so a rest restarted for it (+15 s, the wheel, a watch) does not
// say it again. The tick time tells a set ticked again from the same one.
let newsFor = null
const setKey = (S, idx, i) => `${idx}:${i}:${S.active.entries[idx]?.sets?.[i]?.at ?? ''}`

// What beat last time, in words: "1 rep", "2.5 kilos" (the unit the exercise is shown in).
function beatLine(S, entry, beat) {
  if (beat.kind === 'plan') return t(NEWS.beatPlan)
  const words = beat.kind === 'reps' ? repsWords(beat.n, beat.side)
    : beat.kind === 'sec' ? tn('{0} second', '{0} seconds', beat.n)
    : weightWords(beat.n, exUnitOf(S, entry.id))
  return t(NEWS.beatLast, words)
}

/** What is worth saying about the set just done and the one coming: the first that applies, or ''. */
function newsLine(S, forIdx, forSet, next) {
  if (cueStyleOf(S) === 'own') return ''
  const done = S.active.entries[forIdx]
  const o = Number.isInteger(forSet) ? setOutcome(S, done, forSet) : null
  if (o?.outcome === 'short') return t(NEWS.short)
  if (o?.outcome === 'hard') return t(NEWS.hard)
  if (o?.outcome === 'beat') return beatLine(S, done, o.beat)
  if (isLastSet(S.active, next)) { const name = nameOf(S.active.entries[next.idx]); return name ? t(NEWS.last, name) : '' }
  return introLine(S, next)
}

// "Last time, 80 kilos for 8 reps." for the first set of an exercise that has a last time, in the
// unit the exercise is shown in and per side for a per-side set.
function introLine(S, next) {
  const entry = S.active.entries[next.idx]
  const row = entry.sets[next.i]
  if (!row || isWarmupRow(row) || entry.sets.slice(0, next.i).some(x => !isWarmupRow(x))) return ''
  const prev = lastEntryFor(sessionHistory(S), entry.id, entry.rid)?.sets?.[0]
  if (!prev || modeOf({ ...(entry.target || {}), id: entry.id }) !== 'reps') return ''
  const side = isSideSet(prev)
  const reps = side ? Math.min(Number(prev.sides.L.r) || 0, Number(prev.sides.R.r) || 0) : Number(prev.r) || 0
  const w = shownWeight(S, entry.id, Number(prev.w) || 0)
  if (!(w > 0) || !(reps > 0)) return ''
  return t(NEWS.intro, weightWords(w, exUnitOf(S, entry.id)), repsWords(reps, side))
}

export const cues = {
  /** A rest began after set `forSet` of entry `forIdx`: the next set, then what to say about the
   *  set that was done and the one coming, by how much the profile wants said (voice-styles cueLevel). */
  restStarted(forIdx, forSet) {
    const S = live()
    if (!S) return
    const next = nextSetAfter(S.active, forIdx)
    const level = cueLevelOf(S)
    const key = Number.isInteger(forSet) ? setKey(S, forIdx, forSet) : null
    // A rest restarted for the set whose news was said: the facts again, never the news.
    const again = !!key && newsFor?.key === key
    const wasRecord = again ? newsFor.wasRecord : !!recordFor && recordFor.idx === forIdx && recordFor.i === forSet
    if (key && !again) newsFor = { key, wasRecord }
    recordFor = null
    if (!next) return
    const m = isLastSet(S.active, next) && hasSomething(S, 'lastSet') ? 'lastSet' : 'restStart'
    // A record set's news was the record line, said when the trophy showed. "Records and the end"
    // says only that; an own clip for the moment is played in place of the news line.
    let news = again || wasRecord || level === 'end' ? '' : newsLine(S, forIdx, forSet, next)
    if (level === 'rest' && news && voiceClipsOf(S, m).length) news = ''
    say(S, restStartText(S, forIdx))
    if (news) say(S, news)
    if (level === 'end' || (news && level === 'rest')) return
    if (wasRecord && level !== 'every') return
    moment(S, m)
  },
  /** A rest's second ticked: 10 s before the end once, on rests long enough for it to help. */
  restLeft(left, total) { if (left === 10 && total >= 20) { const S = live(); if (S) moment(S, 'tenLeft') } },
  /** The rest ran out on screen. */
  restOver() { const S = live(); if (S) moment(S, 'restOver') },
  /** A set just earned a record trophy (views/Workout.jsx cheerRecord): a clip of one's own, else
   *  the style's line, else "That's a new best on ..."; one record line, and that set's rest says
   *  no outcome line after it. */
  record(forIdx, forSet) {
    const S = live()
    if (!S) return
    recordFor = { idx: forIdx, i: forSet }
    if (hasSomething(S, 'record')) { moment(S, 'record'); return }
    const name = nameOf(S.active.entries?.[forIdx])
    if (cueStyleOf(S) !== 'own' && name) say(S, t(NEWS.record, name))
  },
  /** A workout begins: the first exercise's first set, named. Only a rest announced anything
   *  before, so the first exercise went unsaid until its first set was done — worked around with
   *  a dummy rest before it (#1210). */
  began() {
    const S = live()
    recordFor = newsFor = null
    const entry = S?.active?.entries?.[Number.isInteger(S?.active?.cur) ? S.active.cur : 0]
    const i = (entry?.sets || []).findIndex(notDone)
    if (!entry || i < 0) return
    say(S, setCueText(S, entry, i, { name: nameOf(entry) || null }))
    if (cueLevelOf(S) !== 'end' && cueStyleOf(S) !== 'own') { const intro = introLine(S, { idx: S.active.entries.indexOf(entry), i }); if (intro) say(S, intro) }
  },
  /** The focus moved to another exercise with no rest between (a superset's next member,
   *  views/Workout.jsx): its next set, named. A rest is what announced the next set before, and
   *  a circuit has none between its members, so only the round's first exercise was ever said
   *  (#1210). No style line here: it is not a rest, and every member would shout one. */
  movedOn(forIdx) {
    const S = live()
    if (!S) return
    const text = restStartText(S, forIdx)
    if (text) say(S, text)
    const next = nextSetAfter(S.active, forIdx)
    if (text && next && cueLevelOf(S) !== 'end' && cueStyleOf(S) !== 'own') { const intro = introLine(S, next); if (intro) say(S, intro) }
  },
  /** The workout is being saved (sheets.jsx doFinishWorkout, before it is cleared): how long it
   *  took, the minutes the summary shows (`w`, the workout as built: its end is cut at a pause). */
  finished(S, w) {
    const A = S?.active
    recordFor = newsFor = null
    if (!A || A.backfill || !live() || cueStyleOf(S) === 'own' || !(A.entries || []).some(e => (e.sets || []).some(x => x.done && !isWarmupRow(x)))) return
    const min = Math.floor(((Number(w?.end) || 0) - (Number(w?.start) || 0)) / 60000)
    if (min >= 1) say(S, t(NEWS.closer, tnf('{0} minute', '{0} minutes', min, fmtNum(min))))
  },
  /** A count-in or the end of a hold: a number, cutting off whatever is still being said. */
  count(n) { if (n >= 1 && n <= 3) { const S = live(); if (S) say(S, String(n), { queue: false }) } },
  /** The count-in is over and the hold begins. */
  go() { const S = live(); if (S) say(S, t('Go!'), { queue: false }) },
}

/** The line the Settings row says when tried: what a rest would announce. */
export const sampleCue = (unit = 'kg') => [t('Set {0}', 3), weightWords(unit === 'lb' ? 185 : 80, unit), tn('{0} rep', '{0} reps', 8)].join(', ')
