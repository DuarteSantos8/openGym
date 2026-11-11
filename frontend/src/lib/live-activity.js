// The running workout on the iPhone's Lock Screen and in the Dynamic Island (a Live Activity), the
// page's side (native: ios/App/App/LiveActivityPlugin.swift and WorkoutActivity.swift, the views in
// ios/App/OpenGymWidgets). An Apple Watch shows the same activity in its Smart Stack.
//
// Page → activity: while a workout runs, its state as the Lock Screen shows it (the set to do now
// and the few after it, the rest's end, how far along the session is) whenever that changes. The
// rest counts down on the Lock Screen by itself (Text(timerInterval:)), so nothing is sent per
// second.
//
// Activity → page: its Done button ticks the set it shows. iOS runs that in the app (an App Intent)
// even with the page asleep, so the native side queues it as a small event ({ id, type: 'setDone',
// wid, exId, entryIdx, setIdx, at }), moves the activity on to the next set itself, and the page
// applies the event when it can: through the workout screen's own tick (bindLiveActions), the one
// a tap in the app runs (rest timer, the high-water mark, the end-of-workout sheet), never a second
// copy of it. Each event is applied once, by its id, and only then acknowledged, which takes it out
// of the native queue; until the workout screen is there to apply it, it waits there.
// Next to Done sits one smaller button: Skip rest while a rest runs ({ type: 'restSkip', wid, at }),
// otherwise Next exercise ({ type: 'next', wid, fromEntryIdx, at }), which moves on to the next
// exercise without ticking anything (Discord: Done read like "finish", and there was no way to
// leave a machine somebody else took). The native side moves the activity on by itself for both.
//
// Android (#760) gets the same card as one ongoing notification, a Live Update on Android 16
// (android/.../LiveActivityPlugin.java, WorkoutNotification.java, WorkoutCard.java for the moves):
// the same state, the same queued taps, and the rest after a Log set started natively too.
//
// v1.4.5, the glance (lib/live-glance.js, LIVE_VERSION 4): every set says what kind it is and
// brings its own words (`kd`, `tv`, `ck`, `bg`, `sh`, `b`, `fr`, `img`, `adj`, see setExtras), and
// `state.g` carries the few choices from Settings (look, which session details, the clocks, the
// rest's buttons). The surfaces pick what to draw from the set they show and the moment (a set to
// do, a hold, a rest, a rest before a new exercise, all done), so a set the Lock Screen moves on to
// by itself is drawn right too. More buttons queue more events: adjust, restAdd, prev, warm,
// addSet, pause. The workout screen's strip runs its buttons through the same events
// (runLiveAction), so every surface ends up in one applier, once per event id.
//
// No animations, ever (Gym visual licence). Phone apps only, apart from the in-app card.
import { stripBidi } from './bidi.js'
import { MOBILE, nativePlatform } from './mobile.js'
import { EXIDX, imgSrc, figureOf } from './exercises.js'
import { t } from './i18n.js'
import { exerciseNameText, fmtNum } from './format.js'
import { setLabel, supersetUnits, fmtSec, fmtMetres } from './history.js'
import { viewRow, exUnitTag, exUnitOf } from './ex-unit.js'
import { isWarmupRow } from './workout-model.js'
import { nextUnfinishedUnit, restSecFor } from './supersetFlow.js'
import { speedUnitOf, fmtSpeed } from './speed.js'
import { fmtDist, distUnitOf } from './distance.js'
import { hasIncline, hasLevel } from './incline.js'
import { accentPair, accentValue } from './accent.js'
import { circuitClock } from './circuit.js'
import { ACTIONS, REST_ADD_SEC } from './live-layout.js'
import { setBandsOf, bandText, bandsOf } from './bands.js'
import { glanceOf, kindOf, plainLift, detailsFor, workButtons, restButtons, sessionDetails, detailRoom, bodyweightOf, KINDS } from './live-glance.js'
import { setValues, sessionValues, heartSource, clip, effortText } from './live-tiles.js'
import { adjustFor, stepped, NO_EFFORT, withNumbers } from './live-adjust.js'
import { isPaused } from './workout-pause.js'
import { liveHeartRate, onLiveHeartRate } from './phone-workout.js'
import { makeWarmupAt, makeWorkAt, canBeWarmup, modeOf, EFFORT, effortOf } from './history.js'

export const LIVE_VERSION = 4
const APPLIED_KEY = 'gym_live_applied'
const APPLIED_MAX = 300
const SEND_DEBOUNCE_MS = 300
// After the tap of a button only the page can draw (Previous exercise, Warm-up, Add set) the answer
// goes out at once, with no timer in between (drainLiveEvents, sendNow): that send is the first
// thing the tap shows, and the tap mostly comes from the Lock Screen, where the page is hidden. A
// hidden page's timers are held to the full second and may not run at all before the phone puts
// the app back to sleep. TAP_DEBOUNCE_MS is what is left for a change that only lands after that
// direct send. Every other tap the phone has drawn already, and its answer keeps the usual pause,
// so a quick − − − or + + + still goes out as one update at the end and not as one per tap. Android
// drops a notification's updates past about five a second, and iOS may hold a Live Activity back
// that is updated very often: the very slowness this is about.
const TAP_DEBOUNCE_MS = 60
const PAGE_DRAWN = ['prev', 'warm', 'addSet']
// A send the native side turned down as older than a tap (`stale`) is tried again this often, each
// time after a fresh drain. Still turned down then, the tap is one the page cannot get (a drain
// that fails, an entry it cannot read): the next try goes without `seen`, which the native side
// takes as it is. The page's state always gets through in the end; a card is never stuck.
const STALE_RETRIES = 3
const HEART_EVERY_MS = 15000
// The sets after the current one the activity carries, so its Done can move on without the page.
export const LIVE_AHEAD = 8
// The first open set of this many later exercises, so Next exercise works without the page too.
export const LIVE_UNITS = 4
// ActivityKit drops an update over 4 KB. Long names in a script with 3-byte letters can get there,
// so the farthest sets go first until it fits (the page sends a fresh list after every tick anyway).
export const LIVE_BUDGET = 3600

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/* ---------- what the activity shows ---------- */

/**
 * The sets still to do, in the order the workout screen leads through them: from the current
 * exercise's unit on, a superset round by round (a1, b1, a2, b2), then the units after it, then
 * the ones before it that still have sets open. Each with the rest that follows it.
 */
export function upcomingSets (S) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries) || !A.entries.length) return []
  const units = supersetUnits(A.entries)
  const cur = Math.max(0, Math.min(A.entries.length - 1, A.cur || 0))
  const start = Math.max(0, units.findIndex(u => u.includes(cur)))
  const order = [...units.slice(start), ...units.slice(0, start)]
  const out = []
  for (const unit of order) {
    const rounds = Math.max(0, ...unit.map(i => (A.entries[i]?.sets || []).length))
    let rest = 0
    try { rest = restSecFor(A.entries, unit, num(S.restSec) || 0) || 0 } catch { rest = num(S.restSec) || 0 }
    for (let r = 0; r < rounds; r++) {
      const inRound = unit.filter(i => { const s = A.entries[i]?.sets?.[r]; return s && !s.done })
      inRound.forEach((i, k) => out.push({ entryIdx: i, setIdx: r, restAfter: k === inRound.length - 1 ? rest : 0, unit: unit[0] }))
    }
  }
  return out
}

// A still inside the app package: relative, no way out of it, a picture (lib/watch-sync.js inPackage).
const stillPath = p => (typeof p === 'string' && /\.(webp|jpe?g|png)$/i.test(p) && !/^[a-z]+:|^\//i.test(p) && !p.includes('..') && p.length <= 120 ? p : null)
const FIELD_OF = { wDown: 'w', wUp: 'w', rDown: 'r', rUp: 'r', effort: 'e' }
// A detail's key among the set's tile texts (lib/live-tiles.js setValues).
const DETAIL_TILE = { record: 'pr' }

/** The settings (lib/live-glance.js) and what follows from them for every set: worked out once per update. */
export function liveNeeds (S) {
  const G = glanceOf(S)
  return { G, sx: sessionDetails(G), room: detailRoom(G) }
}

const secText = sec => { const n = Math.max(0, Math.round(num(Number(sec)) || 0)); return n < 60 ? `${n} s` : fmtSec(n) }
function setView (S, A, { entryIdx, setIdx, restAfter, unit }, needs = null, withAdj = false) {
  const e = A.entries[entryIdx]
  const s = e.sets[setIdx]
  const target = e.target || {}
  const work = (e.sets || []).filter(x => !isWarmupRow(x))
  const warmup = !!isWarmupRow(s)
  const n = warmup ? (e.sets || []).filter(isWarmupRow).indexOf(s) + 1 : work.indexOf(s) + 1
  let label = ''
  // An exercise in a weight unit of its own (#657) reads in it, and says which.
  try { label = stripBidi(setLabel(e.id, viewRow(S, e.id, s), target, speedUnitOf(S))) + exUnitTag(S, e.id) } catch { label = '' }
  return {
    exId: String(e.id),
    entryIdx,
    setIdx,
    // Cased as the workout screen shows it: the stored names are lower-case and only CSS title-cases
    // them in the app, which the Lock Screen never sees (Discord).
    exName: clip(EXIDX[e.id] ? exerciseNameText(EXIDX[e.id]) : String(target.name || e.name || e.id), 60),
    setLine: clip(warmup ? t('Warm-up') + ' ' + n : t('Set {0} of {1}', n, work.length), 40),
    target: clip(label, 60),
    restAfter: Math.max(0, Math.min(3600, Math.round(num(restAfter) || 0))),
    // The superset unit's first entry: Next exercise moves on to the next set with another one.
    unit: Number.isInteger(unit) ? unit : entryIdx,
    // One set that cannot be worked out keeps its classic fields, never takes the activity down.
    ...(needs ? (() => { try { return setExtras(S, A, entryIdx, setIdx, needs, withAdj) } catch { return {} } })() : {}),
  }
}

/**
 * What a set brings to the glance (lib/live-glance.js), each only when it has something to say:
 * `kd` its kind; `tv` its texts (weight and reps of a plain lift, so − and + can rewrite the big
 * line on the Lock Screen, and its details); `ck` the details to show, in order; `bg` the big line
 * where it is not weight × reps (a hold's seconds, a carry's metres and load); `sh` a few letters
 * for the Dynamic Island's pill; `b` its buttons when they are not just Log set; `fr` it starts a
 * new exercise (the rest before it says "Next exercise"); `img` its still; `adj` the − + lists.
 */
function setExtras (S, A, entryIdx, setIdx, needs, withAdj) {
  const out = {}
  const e = A.entries[entryIdx]
  const s = e.sets[setIdx]
  const { G } = needs
  const kind = kindOf(e, s)
  if (kind !== 'lift') out.kd = kind
  const plain = plainLift(e, s)
  const details = detailsFor(G, kind).map(k => DETAIL_TILE[k] || k)
  const keys = [...(plain ? ['weight', 'reps'] : []), ...details]
  const btns = workButtons(G, kind, { bw: bodyweightOf(e) })
  if (btns.includes('effort') && !keys.includes('effort')) keys.push('effort')
  const tv = keys.length ? setValues(S, A, entryIdx, setIdx, keys) : {}
  // A detail is a chip without a caption, so the superset partner says what it is.
  if (tv.partner) tv.partner = clip(t('Superset with {0}', tv.partner))
  if (Object.keys(tv).length) out.tv = tv
  // The record hint is a sentence: its own line on the detailed look, never a chip. The set up
  // next is never rated yet ("RIR –"), so "Effort" on its own showed in no moment at all (owner,
  // TestFlight 67): then the last rated set of this exercise says how hard it was going. A rated
  // set with the effort button there needs no chip: the button says it ("RIR 2").
  const unrated = !!tv.effort && /–$/.test(tv.effort)
  if (unrated) {
    const last = lastEffort(e, setIdx)
    if (last != null) out.tv = { ...(out.tv || tv), effortLast: clip(t('Last set: {0}', effortText(S, last))) }
  }
  const effortChip = unrated ? (out.tv?.effortLast ? ['effortLast'] : []) : btns.includes('effort') ? [] : ['effort']
  const ck = details.flatMap(k => (k === 'effort' ? effortChip : [k])).filter(k => k !== 'pr' && (out.tv || tv)[k])
  if (ck.length) out.ck = ck
  const row = (() => { try { return viewRow(S, e.id, s) } catch { return s } })()
  const unit = (() => { try { return exUnitOf(S, e.id) } catch { return '' } })()
  if (kind === 'hold') {
    const sec = num(Number(row.sec)) ?? num(Number(e.target?.sec))
    if (sec != null) {
      out.sh = secText(sec)
      out.bg = out.sh + (Number(row.w) > 0 ? ` · ${fmtNum(Number(row.w))} ${unit}` : '')
    }
  } else if (kind === 'carry') {
    const m = num(Number(row.m)) ?? num(Number(e.target?.m))
    if (m != null) {
      out.sh = fmtMetres(m)
      out.bg = out.sh + (Number(row.w) > 0 ? ` · ${fmtNum(Number(row.w))} ${unit}` : '')
    }
  } else if (kind === 'cardio') {
    // Minutes and speed (or distance) as the big line; incline and level as details, so a long
    // treadmill line is not cut off on a small screen.
    const min = num(Number(row.min)) ?? num(Number(e.target?.min))
    if (min != null) out.sh = `${fmtNum(min)} min`
    const km = num(Number(row.km))
    const speed = num(Number(row.speed)) ?? num(Number(e.target?.speed))
    const parts = [min != null ? `${fmtNum(min)} min` : '', km > 0 ? fmtDist(km, distUnitOf(S)) : speed > 0 ? fmtSpeed(speed, speedUnitOf(S)) : '']
    if (parts.some(Boolean)) out.bg = parts.filter(Boolean).join(' · ')
    const extra = {}
    if (hasIncline(row)) extra.incline = t('{0}% incline', fmtNum(Number(row.incline)))
    if (hasLevel(row)) extra.level = t('Level {0}', fmtNum(Number(row.level)))
    if (Object.keys(extra).length) {
      out.tv = { ...(out.tv || {}), ...extra }
      out.ck = [...Object.keys(extra), ...(out.ck || [])]
    }
  } else if (kind === 'band') {
    const r = num(Number(row.r))
    const names = bandText(setBandsOf(s), bandsOf(S))
    if (r != null) {
      out.sh = `${fmtNum(Math.round(r))}×`
      out.bg = names ? `${fmtNum(Math.round(r))} × ${names}` : `${fmtNum(Math.round(r))}×`
    }
  } else if (!plain) {
    const r = num(Number(row.r))
    if (r != null) out.sh = `${fmtNum(Math.round(r))}×`
  }
  if (out.bg) out.bg = clip(out.bg, 40)
  if (out.sh) out.sh = clip(out.sh, 8)
  if (btns.length !== 1 || btns[0] !== 'log') out.b = btns
  // The first open set of a superset unit none of whose sets is ticked yet: a new exercise starts.
  const unit0 = supersetUnits(A.entries).find(u => u.includes(entryIdx)) || [entryIdx]
  if (!unit0.some(i => (A.entries[i]?.sets || []).some(x => x?.done))) out.fr = true
  if (G.show.picture) {
    const ex = EXIDX[e.id]
    const p = ex && ex.img ? stillPath(imgSrc(ex, figureOf(S))) : null
    if (p) out.img = p
  }
  const fields = [...new Set(btns.map(k => FIELD_OF[k]).filter(Boolean))]
  if (withAdj && fields.length) {
    const adj = adjustFor(S, A, entryIdx, setIdx, fields)
    if (Object.keys(adj).length) out.adj = adj
  }
  return out
}

const bytes = o => new TextEncoder().encode(JSON.stringify(o)).length

/** The effort of the last rated work set of entry `e` before set `setIdx`, or null. */
function lastEffort (e, setIdx) {
  for (let i = Math.min(setIdx, (e.sets || []).length) - 1; i >= 0; i--) {
    const x = e.sets[i]
    if (!x?.done || isWarmupRow(x)) continue
    const v = x.rir ?? x.rpe
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

/**
 * Trims until the activity fits ActivityKit's 4 KB: the − + lists of the sets after the current
 * one, then the farthest sets' stills, then the farthest sets, then the farthest exercises. If it
 * still does not fit (names of absurd length), the glance goes and the surfaces draw the classic card.
 */
export function fitLive (live) {
  const st = live.state
  const later = () => [...st.ahead, ...st.unitStarts]
  for (const x of later()) { if (bytes(live) <= LIVE_BUDGET) break; delete x.adj }
  for (const x of later().reverse()) { if (bytes(live) <= LIVE_BUDGET) break; delete x.img }
  while (bytes(live) > LIVE_BUDGET && (st.ahead.length || st.unitStarts.length)) {
    if (st.ahead.length > st.unitStarts.length) st.ahead.pop()
    else st.unitStarts.pop()
  }
  if (bytes(live) > LIVE_BUDGET && st.cur) { delete st.cur.adj; delete st.cur.tv; delete st.cur.ck }
  if (bytes(live) > LIVE_BUDGET) { delete st.g; delete st.tv; delete st.tl }
  return live
}

// The words the glance needs beyond the activity's fixed labels, in the page's language (`tl`),
// so the surfaces never need translations of their own: each button's name (for VoiceOver and
// Android's action titles) and a few headings.
function labelsFor (G) {
  const tl = {}
  const all = new Set(['log', 'restSkip', 'restAdd', 'finish'])
  for (const k of KINDS) for (const b of workButtons(G, k)) all.add(b)
  for (const k of KINDS) for (const b of workButtons(G, k, { bw: true })) all.add(b)
  for (const k of all) if (ACTIONS[k]) tl['a.' + k] = t(ACTIONS[k].label)
  if (tl['a.pause']) tl['a.resume'] = t('Resume')
  tl.nextEx = t('Next exercise')
  tl.elapsed = t('Time since start')
  tl.paused = t('Paused')
  return tl
}

/**
 * The activity's fixed part (`attributes`: what stays the same for the workout) and its state, or
 * null when no workout is running here. `timer` is the rest as useUI holds it; `hold` the hold
 * (`work`) and the count-in before one that starts by itself (`countIn`), also from useUI.
 */
export function buildLiveActivity (S, timer = null, hold = {}, ctx = {}) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries) || !A.entries.length || A.editingWorkoutId) return null
  const next = upcomingSets(S)
  let done = 0, total = 0
  for (const e of A.entries) for (const s of e?.sets || []) { total++; if (s?.done) done++ }
  // A circuit's clock (lib/circuit.js circuitClock) stands in for the rest and the hold it
  // replaces while it runs: its rests and get ready count down as a rest, its timed work as a hold.
  const cc = circuitClock(hold && hold.circuit)
  const rest = cc ? (cc.kind === 'rest' ? cc : null) : timer && !timer.ready && timer.kind !== 'switch' ? timer : null
  // A hold counting down, or the 3-2-1 before one (lib/auto-holds.js): the Lock Screen counts it
  // down like the rest, under its own word, and offers Stop auto beside Log set while a chain runs.
  const ci = !cc && hold && hold.countIn
  const wk = cc ? (cc.kind === 'hold' ? cc : null) : !ci && hold && hold.work ? hold.work : null
  const clock = ci || wk
  const auto = !!(ci || (wk && wk.auto) || (timer && !timer.ready && hold && hold.autoNext))
  const pair = accentPair(accentValue(S))
  let needs = null
  try { needs = liveNeeds(S) } catch { needs = null }
  // The first open set of each exercise after the current one, in the order the sets come.
  const starts = []
  for (const x of next) {
    if (x.unit === next[0].unit || starts.some(y => y.unit === x.unit)) continue
    if (starts.length >= LIVE_UNITS) break
    starts.push(x)
  }
  return fitLive({
    attributes: {
      v: LIVE_VERSION,
      wid: String(A.id || ''),
      start: num(A.start),
      accent: pair.accent,
      ink: pair.ink,
      labels: {
        // "Log set", not "Done": it ticks the set, and "Done" read like finishing the workout.
        done: t('Log set'),
        rest: t('Rest'),
        next: t('Up next'),
        allDone: t('All sets done'),
        restOver: t('Rest’s over. Next set!'),
        nextExercise: t('Next exercise'),
        skipRest: t('Skip rest'),
        // Sets are left, but the activity ran past the ones it carries (many taps, page asleep).
        openApp: t('Open openGym for the next set'),
        hold: t('Hold'),
        getReady: t('Get ready'),
        stopAuto: t('Stop auto'),
      },
    },
    state: {
      name: A.name || '',
      cur: next.length ? setView(S, A, next[0], needs, true) : null,
      ahead: next.slice(1, 1 + LIVE_AHEAD).map((x, i) => setView(S, A, x, needs, i === 0)),
      unitStarts: starts.map(x => setView(S, A, x, needs, true)),
      restEndsAt: rest && !rest.paused ? num(rest.endsAt) : null,
      restLeft: rest && rest.paused ? num(rest.left) : null,
      restTotal: rest ? num(rest.total) : null,
      holdEndsAt: clock && !clock.paused ? num(clock.endsAt) : null,
      holdLeft: clock && clock.paused ? num(clock.left) : null,
      holdTotal: clock ? num(clock.total) : null,
      holdKind: ci ? 'countin' : wk ? 'hold' : null,
      auto,
      done,
      total,
      ...(needs ? liveExtras(S, A, needs, ctx) : {}),
    },
  })
}

function liveExtras (S, A, needs, ctx) {
  const { G } = needs
  const g = { lk: G.look, el: G.show.elapsed, nx: G.show.next, rb: restButtons(G) }
  if (needs.sx.length) g.sx = needs.sx
  if (G.show.picture) g.pic = true
  const out = { g, tl: labelsFor(G) }
  const tv = sessionValues(S, A, needs.sx, ctx)
  if (Object.keys(tv).length) out.tv = tv
  if (tv.hr) out.hs = heartSource(A, ctx.live)
  if (isPaused(A)) out.paused = true
  return out
}

/* ---------- applying the activity's events ---------- */

let handlers = null   // the workout screen's: setDone, next, restSkip, timer
const readApplied = () => { try { return JSON.parse(localStorage.getItem(APPLIED_KEY)) || [] } catch { return [] } }
const writeApplied = ids => { try { localStorage.setItem(APPLIED_KEY, JSON.stringify(ids.slice(-APPLIED_MAX))) } catch { /* the queue's ack is what counts */ } }

/**
 * Where Next exercise from `fromEntryIdx` goes: the first entry of the next unit with sets open, as
 * the workout screen's own Next would. null when the page already moved off that unit (an event
 * applied twice, or a tick that advanced by itself) or nothing else is open.
 */
export function nextExerciseTarget (A, fromEntryIdx) {
  if (!A || !Array.isArray(A.entries) || !Number.isInteger(fromEntryIdx)) return null
  const units = supersetUnits(A.entries)
  const from = units.find(u => u.includes(fromEntryIdx))
  if (!from || !from.includes(A.cur || 0)) return null
  const to = nextUnfinishedUnit(A.entries, units, fromEntryIdx)
  return to && to !== from ? to[0] : null
}

/** Whether Skip rest tapped at `at` is about this rest: one started after the tap is a new one. */
export function restSkipApplies (timer, at) {
  if (!timer || timer.kind === 'switch') return false
  if (timer.paused || timer.ready || !num(at)) return true
  const started = num(timer.endsAt) != null && num(timer.total) != null ? timer.endsAt - timer.total * 1000 : null
  // A second of slack: the page restarts a rest it hears of late from the tap's own time.
  return started == null || started <= at + 1000
}

/** Where Previous exercise from `fromEntryIdx` goes: the first entry of the unit before it, or null. */
export function prevExerciseTarget (A, fromEntryIdx) {
  if (!A || !Array.isArray(A.entries) || !Number.isInteger(fromEntryIdx)) return null
  const units = supersetUnits(A.entries)
  const at = units.findIndex(u => u.includes(fromEntryIdx))
  if (at <= 0 || !units[at].includes(A.cur || 0)) return null
  return units[at - 1][0]
}

/**
 * One − + step (or an effort picked) on set `setIdx` of entry `idx`, onto a store draft: `field`
 * 'w' or 'r' (on a per-side set the side still open), 'e' the effort on the profile's scale (-1
 * clears it). Absolute values, so an event applied twice does no harm. False when nothing changed.
 */
export function applyAdjust (s, idx, setIdx, field, value) {
  const A = s?.active
  const e = A?.entries?.[idx]
  const row = e?.sets?.[setIdx]
  const v = num(value)
  if (!row || row.done || v == null || !['w', 'r', 'e'].includes(field)) return false
  let next
  if (field === 'e') {
    const sc = EFFORT[effortOf(s)] || EFFORT.rir
    next = { ...row }
    delete next.rir; delete next.rpe
    if (v !== NO_EFFORT) next[sc.f] = Math.max(sc.min, Math.min(sc.max, v))
  } else {
    const x = field === 'r' ? Math.max(0, Math.round(v)) : Math.max(0, v)
    if (row.sides && row.sides.L && row.sides.R) {
      const side = !row.sides.L.done ? 'L' : 'R'
      next = withNumbers({ ...row, sides: { ...row.sides, [side]: { ...row.sides[side], [field]: x } } }, {})
    } else next = { ...row, [field]: x }
  }
  e.sets = e.sets.map((y, i) => (i === setIdx ? next : y))
  return true
}

/** A planned reps set made a warm-up, or a warm-up back into a work set (the set's own menu does this). */
export function applyWarmToggle (s, idx, setIdx) {
  const e = s?.active?.entries?.[idx]
  const row = e?.sets?.[setIdx]
  if (!row || row.done) return false
  let mode = 'reps'
  try { mode = modeOf({ ...(e.target || {}), id: e.id }) } catch { mode = 'reps' }
  if (mode !== 'reps') return false
  if (isWarmupRow(row)) { e.sets = makeWorkAt(e.sets, setIdx); return true }
  if (!canBeWarmup(row) || !e.sets.some((x, j) => j !== setIdx && !isWarmupRow(x))) return false
  e.sets = makeWarmupAt(e.sets, setIdx)
  return true
}

function entryIndexOf (A, ev) {
  if (A.entries[ev.entryIdx] && String(A.entries[ev.entryIdx].id) === String(ev.exId)) return ev.entryIdx
  return A.entries.findIndex(e => String(e.id) === String(ev.exId))
}

/**
 * Applies the events not applied yet, in order, and returns the ids that are done with: applied
 * now, applied before, or about a workout that is not running any more. Without the workout
 * screen's actions the run stops, and that event and the ones after it stay queued.
 */
export function applyLiveEvents (events, getState) {
  if (!Array.isArray(events)) return []
  const applied = readApplied()
  const done = []
  for (const ev of events) {
    if (!ev || typeof ev.id !== 'string') continue
    if (applied.includes(ev.id)) { done.push(ev.id); continue }
    const A = getState()?.S?.active
    const ours = A && Array.isArray(A.entries) && !A.editingWorkoutId && (!ev.wid || ev.wid === String(A.id))
    if (ev.type === 'setDone' && ours) {
      if (!handlers) break
      const idx = entryIndexOf(A, ev)
      const set = idx >= 0 ? A.entries[idx].sets?.[ev.setIdx] : null
      if (set && !set.done) handlers.setDone(idx, ev.setIdx, { at: num(ev.at) })
    } else if (ev.type === 'next' && ours) {
      if (!handlers) break
      const to = nextExerciseTarget(A, ev.fromEntryIdx)
      if (to != null) handlers.next?.(to)
    } else if (ev.type === 'autoStop' && ours) {
      if (!handlers) break
      handlers.autoStop?.()
    } else if (ev.type === 'restSkip' && ours) {
      if (!handlers) break
      if (restSkipApplies(handlers.timer?.(), num(ev.at))) handlers.restSkip?.()
    } else if (ev.type === 'restAdd' && ours) {
      if (!handlers) break
      // Only to the rest it was tapped on, like Skip rest; a minute at the most per tap.
      const sec = Math.max(1, Math.min(60, Math.round(num(ev.sec) || REST_ADD_SEC)))
      if (restSkipApplies(handlers.timer?.(), num(ev.at))) handlers.restAdd?.(sec)
    } else if (ev.type === 'prev' && ours) {
      if (!handlers) break
      const to = prevExerciseTarget(A, ev.fromEntryIdx)
      if (to != null) handlers.next?.(to)
    } else if ((ev.type === 'adjust' || ev.type === 'warm') && ours) {
      const st = getState()
      const idx = entryIndexOf(A, ev)
      // − + through the workout screen's own setter when it is there (the cascade to the sets after),
      // else straight into the stored workout, as the Home Screen widget's numbers go.
      const own = idx >= 0 && ev.type === 'adjust' && num(ev.value) != null && handlers?.adjust?.(idx, ev.setIdx, ev.field, ev.value)
      if (idx >= 0 && !own && st?.update) st.update(s => { if (ev.type === 'warm') applyWarmToggle(s, idx, ev.setIdx); else applyAdjust(s, idx, ev.setIdx, ev.field, ev.value) })
    } else if (ev.type === 'addSet' && ours) {
      if (!handlers) break
      const idx = entryIndexOf(A, ev)
      if (idx >= 0) handlers.addSet?.(idx)
    } else if (ev.type === 'pause' && ours) {
      if (!handlers) break
      // The state asked for, not a toggle: two taps heard late end where the last one said.
      if (typeof ev.on === 'boolean' && ev.on !== isPaused(A)) handlers.pause?.(ev.on)
    } else if (ev.type === 'finish' && ours) {
      if (!handlers) break
      handlers.finish?.()
    }
    // Applied, or meaningless now (another workout, a set that is gone or already ticked).
    applied.push(ev.id)
    done.push(ev.id)
  }
  writeApplied(applied)
  return done
}

/* ---------- off on this phone ---------- */

// Settings > Workout > Live widget's master switch. A fact about this phone, not the profile (the
// tablet may want it while the phone does not), so it lives in localStorage and never in S: absent
// means on. The sync below ends the activity when it is switched off and sends again when it is
// switched back on.
const OFF_KEY = 'gym_live_off'
const offSubs = new Set()
export function liveOff () { try { return localStorage.getItem(OFF_KEY) === '1' } catch { return false } }
export function setLiveOff (v) {
  try { if (v) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY) } catch { /* private mode: on for this visit */ }
  for (const fn of [...offSubs]) { try { fn(!!v) } catch { /* a listener's own trouble */ } }
}
/** Calls `fn(off)` when the master switch moves. Returns the unsubscribe. */
export function onLiveOff (fn) { offSubs.add(fn); return () => offSubs.delete(fn) }

/** The iOS major version a WKWebView user agent names ("iPhone OS 16_7 like Mac OS X" → 16), or null. */
export function iosMajor (ua) {
  const m = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d+)[_.]/.exec(String(ua || ''))
  return m ? Number(m[1]) : null
}

/* ---------- the native plugin ---------- */

let pluginP = null
// Inside an object: a Capacitor plugin proxy answers `then` (lib/rest-alert.js, the Coach hang #42).
const livePlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE || !['ios', 'android'].includes(await nativePlatform())) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { LiveActivity: registerPlugin('LiveActivity') }
})().catch(() => null))

let getStateRef = null
let draining = null
// Taps the native side moved the activity on for (it updates the Lock Screen, the island or the
// notification itself, at once) that the page has not applied yet: until it has, the page's own
// copy is behind, and sending it would put the set it shows back for a moment.
let pendingTaps = 0
// The ids of the last drain, sent along with the page's state: a tap the native side has that is
// not among them came in after the state was built, and the native side keeps what it drew.
let seenIds = []
// A tap only the page can draw was just drained: the next send goes out after TAP_DEBOUNCE_MS,
// not SEND_DEBOUNCE_MS.
let tapSoon = false
// The running sync's "send now, without a timer" (startLiveActivitySync), or null before it started.
let sendNow = null
// The native side said a tap came in while a drain was already running. That drain may have read
// the queue before the tap was in it, and nothing else would look again before the next send's
// timer, which a hidden page may never run: one more drain follows it (drainLiveEvents).
let heard = false
// As in lib/watch-sync.js: nothing is applied, acknowledged or sent before the store has its copy
// back (boot's finishBoot), so a tap is never dropped against an empty, not yet restored state.
const storeReady = () => getStateRef?.()?.ready !== false

/**
 * Takes the Done taps from the native queue, applies them, and acknowledges what is done once the
 * change is on disk (the store's saveNow): until then the queue is the tap's only copy.
 */
export function drainLiveEvents () {
  if (draining) return draining
  draining = (async () => {
    let direct = false
    // Whatever was announced up to here is in the queue by the time this drain reads it.
    heard = false
    try {
      const p = await livePlugin()
      if (!p || !getStateRef || !storeReady()) return []
      const { events = [] } = (await p.LiveActivity.drain()) || {}
      seenIds = events.filter(ev => ev && typeof ev.id === 'string').map(ev => ev.id)
      // Before applying: the store's change schedules the send while applyLiveEvents still runs.
      if (events.some(ev => ev && PAGE_DRAWN.includes(ev.type))) tapSoon = true
      const done = applyLiveEvents(events, getStateRef)
      pendingTaps = events.filter(ev => ev && typeof ev.id === 'string' && !done.includes(ev.id)).length
      direct = events.some(ev => ev && PAGE_DRAWN.includes(ev.type) && done.includes(ev.id))
      if (done.length) await getStateRef()?.saveNow?.()
      if (done.length) await p.LiveActivity.ack({ ids: done })
      return done
    } catch { return [] } finally {
      draining = null
      // A tap only the page can draw was applied: its answer goes out now, not from a timer. Here
      // and not earlier: the send drains first, and would wait for this very drain.
      if (direct) { try { sendNow?.() } catch { /* the timer the change set still runs */ } }
      // A tap was announced while this drain ran, maybe after it had read the queue: once more,
      // now. (A send that went out just above has started that drain already, and `heard` is
      // down again.)
      if (heard) drainLiveEvents()
    }
  })()
  return draining
}

// Finish from a live widget opens the app: the workout screen opens its sheet once it is there.
let finishAsked = false
export function requestLiveFinish () {
  if (handlers?.finish) handlers.finish()
  else finishAsked = true
}

let seq = 0
const newId = () => `app-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`

/**
 * The event button `k` of the live widget makes for the set shown now (the in-app card's tap), or
 * null when it means nothing now (− at the bottom of the list, Skip rest without a rest).
 */
export function liveActionEvent (k, S, { timer = null, now = Date.now() } = {}) {
  const A = S && S.active
  if (!A || !Array.isArray(A.entries) || A.editingWorkoutId || !ACTIONS[k]) return null
  const up = upcomingSets(S)
  const cur = up[0] || null
  const base = { id: newId(), wid: String(A.id || ''), at: now }
  const at = cur ? { exId: String(A.entries[cur.entryIdx].id), entryIdx: cur.entryIdx, setIdx: cur.setIdx } : null
  const resting = !!(timer && !timer.ready && timer.kind !== 'switch')
  switch (k) {
    case 'log': return at ? { ...base, type: 'setDone', ...at } : null
    case 'next': return cur ? { ...base, type: 'next', fromEntryIdx: A.cur || 0 } : null
    case 'prev': return { ...base, type: 'prev', fromEntryIdx: A.cur || 0 }
    case 'restSkip': return resting ? { ...base, type: 'restSkip' } : null
    case 'restAdd': return resting ? { ...base, type: 'restAdd', sec: REST_ADD_SEC } : null
    case 'warm': return at ? { ...base, type: 'warm', ...at } : null
    case 'addSet': return { ...base, type: 'addSet', exId: String(A.entries[A.cur || 0]?.id ?? ''), entryIdx: A.cur || 0 }
    case 'pause': return { ...base, type: 'pause', on: !isPaused(A) }
    case 'finish': return { ...base, type: 'finish' }
    default: {
      const f = FIELD_OF[k]
      if (!f || !at) return null
      const v = stepped(adjustFor(S, A, cur.entryIdx, cur.setIdx, [f], 1), f, /Down$/.test(k) ? -1 : 1)
      return v == null ? null : { ...base, type: 'adjust', field: f, value: v, ...at }
    }
  }
}

/** Runs button `k` from the workout screen's card through the same applier as the Lock Screen's. */
export function runLiveAction (k, getState, opts = {}) {
  const ev = liveActionEvent(k, getState()?.S, opts)
  if (!ev) return false
  return applyLiveEvents([ev], getState).includes(ev.id)
}

/** The workout screen hands over its own tick (and Next, Skip rest) while it is mounted. Returns the unbind. */
export function bindLiveActions (h) {
  handlers = h
  if (finishAsked) { finishAsked = false; setTimeout(() => { if (handlers === h) h.finish?.() }, 0) }
  drainLiveEvents()
  return () => { if (handlers === h) handlers = null }
}

/**
 * Started once by the app: shows, updates and ends the activity as the workout and its rest
 * change (debounced, only what differs from the last one sent), and drains the Done taps when the
 * app comes back or the native side says one came in. Resolves with the stop function.
 */
export async function startLiveActivitySync ({ useStore, useUI, useCircuit = null }) {
  const p = await livePlugin()
  if (!p) return () => {}
  getStateRef = () => useStore.getState()
  let supported = false
  // null: the phone did not answer (a bridge hiccup), which is not a "no".
  const ask = async () => { try { return !!(await p.LiveActivity.status())?.supported } catch { return null } }
  supported = (await ask()) === true
  // `early`: the sends still waiting for their drain, so before they built what they send.
  let last = null, tm = null, beat = null, staleRuns = 0, early = 0
  const send = async () => {
    clearTimeout(tm)
    tm = null
    const quick = tapSoon
    tapSoon = false
    if (useStore.getState().tourSandbox) return
    // Switched off on this phone (Settings > Live widget): nothing goes out, taps still come in.
    if (liveOff()) { drainLiveEvents(); return }
    // An empty, not yet restored copy would end the activity of a workout that is still running.
    if (!storeReady()) return
    try {
      // Taps first, so what goes out has them. One still waiting for the workout screen means the
      // activity is ahead of the page: leave it be (the native side drew the tap at once); the
      // page sends once it applied it (the store changes and schedule runs again).
      early++
      try { await drainLiveEvents() } finally { early-- }
      if (pendingTaps > 0) return
      // Taken here, with no await before the state is built: exactly the taps it has in it.
      const seen = seenIds.slice()
      const ui = useUI.getState()
      const live = buildLiveActivity(useStore.getState().S, ui.timer, { work: ui.work, countIn: ui.countIn, autoNext: !!ui.timer?.autoNext, circuit: useCircuit?.getState().run || null }, { live: liveHeartRate(), now: Date.now() })
      const json = live ? JSON.stringify(live) : ''
      // Calories and the like move on by themselves: a fresh look a minute later, while one is shown.
      clearTimeout(beat)
      // Only while one of them is really on show (a heart rate read, calories counted), not merely asked for.
      if (live && live.state.tv && Object.keys(live.state.tv).length) beat = setTimeout(schedule, 60e3)
      // Nothing new yet: a tap's change that lands after this still goes out quickly.
      if (json === last) { tapSoon = quick; return }
      if (live) {
        const args = { wid: live.attributes.wid, attributes: JSON.stringify(live.attributes), state: JSON.stringify(live.state) }
        if (staleRuns < STALE_RETRIES) args.seen = seen
        const r = await p.LiveActivity.update(args)
        // A button was tapped while this was on its way: the native side already shows the tap and
        // left this older state out. Not remembered as sent; the tap is drained and it goes again.
        if (r && r.stale) { if (staleRuns++ < STALE_RETRIES) schedule(); return }
      } else await p.LiveActivity.end()
      staleRuns = 0
      last = json
    } catch { /* not now: the next change tries again */ }
  }
  // Nor to the Lock Screen: the tour's practice workout (useStore enterTourSandbox) is not a session.
  const schedule = () => { if (!supported || useStore.getState().tourSandbox) return; clearTimeout(tm); tm = setTimeout(send, tapSoon ? TAP_DEBOUNCE_MS : SEND_DEBOUNCE_MS) }
  // For drainLiveEvents: the answer to a tap only the page can draw, with no timer before it.
  // Not beside a send that is still waiting for that same drain: it builds its state after the
  // tap and carries it, and a second one would only send the same again.
  const direct = () => { if (supported && !early && !useStore.getState().tourSandbox) send() }
  sendNow = direct
  const offStore = useStore.subscribe((s, prev) => {
    if (s.ready && !prev.ready) { drainLiveEvents(); schedule() }
    else if (s.S !== prev.S) schedule()
  })
  const restOf = x => (x ? `${x.endsAt}|${!!x.paused}|${!!x.ready}|${x.left}|${x.kind || ''}` : '')
  const holdOf = x => (x ? `${x.endsAt}|${!!x.paused}|${!!x.auto}` : '')
  const offUI = useUI.subscribe((s, prev) => {
    // A hold or a count-in starting, pausing or ending (not its every second).
    if (holdOf(s.work) !== holdOf(prev.work) || holdOf(s.countIn) !== holdOf(prev.countIn)) { schedule(); return }
    if (s.timer === prev.timer) return
    // A running rest changes `left` every second; only a start, a stop or a pause matters here.
    const a = s.timer, b = prev.timer
    const same = a && b && !a.paused && !b.paused && a.endsAt === b.endsAt && !!a.ready === !!b.ready
    if (!same && restOf(a) !== restOf(b)) schedule()
  })
  // A circuit's step starting, pausing or ending (lib/circuit.js), not its every second.
  const stepOf = r => (r ? `${r.i}|${r.at}|${r.paused}|${r.ended}|${r.split}` : '')
  const offCircuit = useCircuit ? useCircuit.subscribe((s, prev) => { if (stepOf(s.run) !== stepOf(prev.run)) schedule() }) : () => {}
  // Heart rate, calories and the like change with no tap: at most one update per HEART_EVERY_MS for
  // them, and only while a surface shows one (an unchanged card is never sent anyway).
  const ticking = () => { try { return liveNeeds(useStore.getState().S).sx.length > 0 } catch { return false } }
  let lastBeat = 0
  const offHr = onLiveHeartRate(() => { const now = Date.now(); if (now - lastBeat >= HEART_EVERY_MS && ticking()) { lastBeat = now; schedule() } })
  const sub = await p.LiveActivity.addListener('liveActivityEvent', () => { heard = true; drainLiveEvents() }).catch(() => null)
  // Coming back: Live Activities may have been switched on (or off) in the iPhone's Settings
  // meanwhile. `supported` was read once at launch before, so turning them on did nothing until
  // the app was started again. A fresh yes forgets what was sent, so the workout shows at once.
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    drainLiveEvents()
    ask().then(now => {
      // No answer: keep what was known, so one failed call never silences a running workout.
      if (now != null) {
        if (now && !supported) last = null
        supported = now
      }
      schedule()
    })
  }
  document.addEventListener('visibilitychange', onVisible)
  // The master switch: off ends what is showing and forgets it, so on sends it again.
  const offMaster = onLiveOff(off => {
    clearTimeout(tm); clearTimeout(beat)
    last = null
    if (off) { if (!tryWid) p.LiveActivity.end().catch(() => {}) } else schedule()
  })
  // At launch: a workout that ended while the app was gone takes its activity with it.
  if (supported) send()
  drainLiveEvents()
  return () => { if (sendNow === direct) sendNow = null; offStore(); offUI(); offCircuit(); offHr(); offMaster(); clearTimeout(beat); sub?.remove?.(); document.removeEventListener('visibilitychange', onVisible); clearTimeout(tm) }
}

/* ---------- Settings' "Try it": the real widget with a sample moment ---------- */

export const TRY_SECONDS = 120
let tryWid = null
let tryTimer = null

/**
 * What the phone can show: `{ native, supported, island, allowed, tooOld }`. `island`: an iPhone
 * with a Dynamic Island. `allowed`: Android's notification permission (always true elsewhere).
 * `tooOld`: an iPhone below iOS 17, where `supported` is false for good and no setting helps.
 */
export async function liveStatus () {
  const p = await livePlugin()
  if (!p) return { native: false, supported: false, island: false, allowed: true, tooOld: false }
  let tooOld = false
  try {
    if ((await nativePlatform()) === 'ios') { const v = iosMajor(globalThis.navigator?.userAgent); tooOld = v != null && v < 17 }
  } catch { tooOld = false }
  try {
    const r = (await p.LiveActivity.status()) || {}
    return { native: true, supported: !!r.supported, island: r.island === true, allowed: r.allowed !== false, tooOld }
  } catch { return { native: true, supported: false, island: false, allowed: true, tooOld } }
}

/**
 * Shows `live` (a sample from lib/live-samples.js, with the settings to try) as the real Live
 * Activity or notification, marked a preview (`pv`): its buttons move it along on the phone but
 * queue nothing, so nothing reaches the history. Never while a workout runs (`S.active`): that
 * card is the workout's, and never while the widget is switched off on this phone. Ends by itself
 * after TRY_SECONDS. Resolves true when the phone showed it.
 */
export async function tryLive (live, S) {
  if (!live || S?.active || liveOff()) return false
  const p = await livePlugin()
  if (!p) return false
  if (!tryWid) tryWid = 'preview-' + Date.now().toString(36)
  const attributes = { ...live.attributes, wid: tryWid, pv: true }
  try {
    const r = await p.LiveActivity.update({ wid: tryWid, attributes: JSON.stringify(attributes), state: JSON.stringify(live.state) })
    // The phone said no (Live Activities or notifications off, iOS too old): nothing is showing,
    // so "Stop" would be a lie. An older plugin answers nothing at all: that counts as shown.
    if (r && r.shown === false) { clearTimeout(tryTimer); tryTimer = null; tryWid = null; return false }
  } catch { return false }
  clearTimeout(tryTimer)
  tryTimer = setTimeout(() => { endTryLive() }, TRY_SECONDS * 1000)
  return true
}

/** Ends the preview, unless a workout started meanwhile (its own update replaced it already). */
export async function endTryLive (getS = () => getStateRef?.()?.S) {
  clearTimeout(tryTimer)
  tryTimer = null
  if (!tryWid) return
  tryWid = null
  const p = await livePlugin()
  if (!p || getS()?.active) return
  try { await p.LiveActivity.end() } catch { /* gone already */ }
}

export const tryingLive = () => tryWid != null

/**
 * Android's own question for the notification permission (the widget is a notification there).
 * Resolves true when it is allowed afterwards. A "no" given twice is final for Android: only the
 * system's settings can change it then, which is where the page sends people next.
 */
export async function askLiveNotifications () {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    return (await LocalNotifications.requestPermissions())?.display === 'granted'
  } catch { return false }
}

// Test seams.
export function _setLivePluginForTest (plugin, getState) { pluginP = Promise.resolve(plugin ? { LiveActivity: plugin } : null); getStateRef = getState || null }
export function _resetLiveActivity () { handlers = null; finishAsked = false; pluginP = null; getStateRef = null; draining = null; pendingTaps = 0; seenIds = []; tapSoon = false; sendNow = null; heard = false; clearTimeout(tryTimer); tryTimer = null; tryWid = null }
